"""Single-order routing engine.

For one test order the engine builds a route per scenario and candidate node:

    cif_baseline     Helmond -> destination port. Customer clears and moves goods inland.
    distributor      Helmond -> distributor stock in the region -> customer.
    3pl              Helmond -> FlexiTog stock at a 3PL -> customer.
    owned_warehouse  Helmond -> FlexiTog-run warehouse -> customer.

Every route is a list of steps. Each step carries cost, days, who pays, who
handles the goods, and whether it is a customs touchpoint. Totals, lead time and
the hassle metrics used in phase 3 all derive from the steps.

Stocked scenarios (distributor, 3PL, owned) assume stock is on hand in the region:
the order lead time is local pick + delivery, and the cost of getting stock there
(freight, clearance, duty, compliance) is allocated to the order per pallet.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import pandas as pd

from . import parameters as P
from .schema import DC_TYPE_LABELS, EU27, region_for

SCENARIOS = ["cif_baseline", "distributor", "3pl", "owned_warehouse"]
SCENARIO_LABELS = {"cif_baseline": "Baseline: CIF to port", **{k: v for k, v in DC_TYPE_LABELS.items()
                                                                  if k != "helmond_hub"}}
STOCKED = {"distributor", "3pl", "owned_warehouse"}
REGIONAL_GROUP = {"Gulf/GCC": "GCC", "North Africa": "NAF"}
LANE_RANK = {"proven": 0, "occasional": 1, "unproven": 2}
HELMOND_IDS = {"HLM", "HELMOND", "NL"}

FLEXITOG, PARTNER, CUSTOMER = "FlexiTog", "partner", "customer"
PAPERWORK_CATEGORIES = {"export_docs", "clearance", "duty", "import_fees", "compliance"}


def num(value, default: float = 0.0) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(f) else f


def blank(value) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value)) or str(value).strip() in ("", "nan", "None", "<NA>")


# ====================================================================== data

@dataclass
class Data:
    products: pd.DataFrame
    customers: pd.DataFrame
    suppliers: pd.DataFrame
    dcs: pd.DataFrame
    lanes: pd.DataFrame
    sales_history: pd.DataFrame
    general: pd.DataFrame
    freight: pd.DataFrame
    duties: pd.DataFrame
    compliance: pd.DataFrame
    lead_times: pd.DataFrame
    scenarios: pd.DataFrame
    owned_fixed: pd.DataFrame

    @classmethod
    def from_workspace(cls, ws) -> "Data":
        return cls(
            products=ws.load("products"), customers=ws.load("customers"), suppliers=ws.load("suppliers"),
            dcs=ws.load("distribution_centers"), lanes=ws.load("lanes"), sales_history=ws.load("sales_history"),
            **{name: ws.load_params(name) for name in P.DEFAULT_TABLES},
        )

    _history: tuple | None = field(default=None, repr=False)

    def history_counts(self) -> tuple[dict[str, int], dict[str, int]]:
        """Distinct orders in the last 12 months of sales history: per shipped_via node, and per
        destination country for orders shipped direct from Helmond. Computed once."""
        if self._history is None:
            via_counts: dict[str, int] = {}
            direct_counts: dict[str, int] = {}
            sh = self.sales_history
            if len(sh) and {"order_date", "order_id"} <= set(sh.columns):
                dates = pd.to_datetime(sh["order_date"], errors="coerce")
                recent = sh[dates >= dates.max() - pd.Timedelta(days=365)] if dates.notna().any() else sh
                via = (recent["shipped_via"] if "shipped_via" in recent else pd.Series("", index=recent.index))
                via = via.fillna("").astype(str).str.upper()
                via_counts = recent.groupby(via)["order_id"].nunique().to_dict()
                if "country" in recent:
                    direct = recent[via.isin(HELMOND_IDS | {""})]
                    direct_counts = direct.groupby(direct["country"].astype(str))["order_id"].nunique().to_dict()
            self._history = (via_counts, direct_counts)
        return self._history

    # ---- parameter lookups. Each returns (value or row, source).
    def g(self, name: str) -> tuple[float, str]:
        rows = self.general[self.general["parameter"] == name]
        if rows.empty:
            d = P.default_table("general")
            rows = d[d["parameter"] == name]
        r = rows.iloc[0]
        return num(r["value"]), str(r.get("source", P.PLACEHOLDER))

    def scenario(self, key: str) -> dict:
        rows = self.scenarios[self.scenarios["scenario"] == key]
        if rows.empty:
            d = P.default_table("scenarios")
            rows = d[d["scenario"] == key]
        return rows.iloc[0].to_dict()

    def duty(self, country: str) -> dict | None:
        rows = self.duties[self.duties["country"] == country]
        return rows.iloc[0].to_dict() if len(rows) else None

    def lead(self, step: str, country: str | None = None) -> tuple[float, str]:
        lt = self.lead_times
        if country:
            rows = lt[lt["step"] == f"{step}:{country}"]
            if len(rows):
                return num(rows.iloc[0]["days"]), str(rows.iloc[0]["source"])
        rows = lt[lt["step"] == step]
        if len(rows):
            return num(rows.iloc[0]["days"]), str(rows.iloc[0]["source"])
        return 0.0, P.PLACEHOLDER

    def freight_option(self, leg: str, dest: str, prefer_port: str | None = None,
                       prefer_mode: str | None = None) -> dict | None:
        f = self.freight
        # Air is an emergency option: used only when asked for, never as a silent fallback.
        f = f[f["mode"] == "air"] if prefer_mode == "air" else f[f["mode"] != "air"]
        rows = f[(f["leg"] == leg) & (f["dest_country"] == dest)]
        if rows.empty:
            rows = f[(f["leg"] == leg) & (f["dest_country"] == "*")]
        if rows.empty:
            return None
        if prefer_port:
            key = str(prefer_port).lower()
            hit = rows[rows["port_or_border"].astype(str).str.lower().map(
                lambda p: bool(p) and (key in p or p.split(" ")[0] in key))]
            if len(hit):
                rows = hit
        if prefer_mode and (rows["mode"] == prefer_mode).any():
            rows = rows[rows["mode"] == prefer_mode]
        return rows.sort_values("eur_per_pallet").iloc[0].to_dict()

    def compliance_rows(self, country: str) -> pd.DataFrame:
        return self.compliance[self.compliance["country"] == country]

    def owned_fixed_row(self, country: str) -> dict | None:
        rows = self.owned_fixed[self.owned_fixed["location"] == country]
        return rows.iloc[0].to_dict() if len(rows) else None


# ====================================================================== result types

@dataclass
class Step:
    step: str
    category: str
    cost_eur: float = 0.0
    days: float = 0.0
    paid_by: str = FLEXITOG
    party: str = ""
    customs: bool = False
    doc_steps: int = 0
    source: str = P.PLACEHOLDER
    note: str = ""


@dataclass
class Route:
    scenario: str
    dc_id: str | None
    dc_name: str
    dc_status: str
    dc_country: str | None
    customer_country: str
    order_value_eur: float
    units: float
    pallets: float
    steps: list[Step] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    lane_status: str = "unproven"
    lane_basis: str = ""
    vat_eur: float = 0.0
    min_order_value_eur: float = 0.0
    risk_premium_pct: float = 0.0

    @property
    def key(self) -> str:
        return self.dc_id or self.scenario

    @property
    def label(self) -> str:
        base = SCENARIO_LABELS[self.scenario]
        return base if not self.dc_id else f"{base} | {self.dc_name}"

    @property
    def feasible(self) -> bool:
        return not self.issues

    @property
    def below_mov(self) -> bool:
        return self.order_value_eur < self.min_order_value_eur

    @property
    def cost_to_serve(self) -> float:
        return sum(s.cost_eur for s in self.steps)

    @property
    def cost_per_unit(self) -> float:
        return self.cost_to_serve / self.units if self.units else 0.0

    @property
    def cost_pct_of_value(self) -> float:
        return 100 * self.cost_to_serve / self.order_value_eur if self.order_value_eur else 0.0

    @property
    def lead_time_days(self) -> float:
        return sum(s.days for s in self.steps)

    @property
    def score(self) -> float:
        return self.cost_to_serve * (1 + self.risk_premium_pct / 100)

    def paid(self, who: str) -> float:
        return sum(s.cost_eur for s in self.steps if s.paid_by == who)

    def by_category(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for s in self.steps:
            out[s.category] = out.get(s.category, 0.0) + s.cost_eur
        return out

    # ---- hassle metrics (phase 3 picks one)
    @property
    def customs_touchpoints(self) -> int:
        return sum(1 for s in self.steps if s.customs)

    @property
    def parties(self) -> list[str]:
        seen: list[str] = []
        for s in self.steps:
            if s.party and s.party not in seen:
                seen.append(s.party)
        return seen

    @property
    def handoffs(self) -> int:
        return max(0, len(self.parties) - 1)

    @property
    def doc_steps(self) -> int:
        return sum(s.doc_steps for s in self.steps)

    @property
    def customer_steps(self) -> int:
        """Steps the customer arranges or pays for itself (price margin excluded)."""
        return sum(1 for s in self.steps if s.paid_by == CUSTOMER and s.category not in ("margin", "receipt"))

    def paperwork(self, who: str) -> int:
        """Customs and document actions a party carries: one per customs touchpoint plus its doc steps."""
        return sum(int(s.customs) + s.doc_steps for s in self.steps
                   if s.paid_by == who and s.category in PAPERWORK_CATEGORIES)

    @property
    def customer_paperwork_steps(self) -> int:
        """Clearance, duty, levies and compliance steps the customer handles itself."""
        return sum(1 for s in self.steps if s.paid_by == CUSTOMER and s.category in PAPERWORK_CATEGORIES)

    @property
    def customer_other_steps(self) -> int:
        return self.customer_steps - self.customer_paperwork_steps

    @property
    def placeholder_cost_share(self) -> float:
        total = self.cost_to_serve
        if not total:
            return 1.0
        return sum(s.cost_eur for s in self.steps if s.source == P.PLACEHOLDER) / total

    def steps_frame(self) -> pd.DataFrame:
        return pd.DataFrame([s.__dict__ for s in self.steps])

    def summary(self) -> dict:
        return {
            "route": self.label, "scenario": self.scenario, "dc_id": self.dc_id or "",
            "feasible": self.feasible, "below_mov": self.below_mov,
            "cost_to_serve_eur": round(self.cost_to_serve, 2),
            "cost_per_unit_eur": round(self.cost_per_unit, 2),
            "cost_pct_of_value": round(self.cost_pct_of_value, 1),
            "flexitog_pays_eur": round(self.paid(FLEXITOG), 2),
            "partner_pays_eur": round(self.paid(PARTNER), 2),
            "customer_pays_eur": round(self.paid(CUSTOMER), 2),
            "lead_time_days": round(self.lead_time_days, 1),
            "lane_status": self.lane_status, "dc_status": self.dc_status,
            "risk_premium_pct": self.risk_premium_pct, "score": round(self.score, 2),
            "customs_touchpoints": self.customs_touchpoints, "handoffs": self.handoffs,
            "doc_steps": self.doc_steps, "customer_steps": self.customer_steps,
            "customer_paperwork_steps": self.customer_paperwork_steps,
            "flexitog_paperwork": self.paperwork(FLEXITOG), "partner_paperwork": self.paperwork(PARTNER),
            "customer_paperwork": self.paperwork(CUSTOMER),
            "placeholder_cost_share": round(self.placeholder_cost_share, 2),
            "issues": "; ".join(self.issues), "warnings": "; ".join(self.warnings),
        }


@dataclass
class Evaluation:
    order_id: str
    routes: list[Route]
    recommended: Route | None
    selected: Route | None
    baseline: Route | None
    reason: str
    notes: list[str] = field(default_factory=list)

    def table(self) -> pd.DataFrame:
        rows = [r.summary() for r in self.routes]
        df = pd.DataFrame(rows)
        if len(df):
            df.insert(0, "recommended", [r is self.recommended for r in self.routes])
        return df


# ====================================================================== order context

@dataclass
class OrderContext:
    order: dict
    customer: dict
    country: str
    lines: pd.DataFrame
    value: float
    units: float
    pallets: float
    duty_weights: pd.DataFrame  # sku, value, eu_origin
    cert_skus: list[str]
    skus: list[str]
    supplier: dict | None
    issues: list[str]


def order_context(order: dict, lines: pd.DataFrame, data: Data) -> OrderContext:
    issues: list[str] = []
    cust_rows = data.customers[data.customers["customer_id"].astype(str) == str(order.get("customer_id"))]
    customer = cust_rows.iloc[0].to_dict() if len(cust_rows) else {}
    if not customer:
        issues.append(f"Customer '{order.get('customer_id')}' not found")
    country = str(customer.get("country") or "")

    prod = data.products.set_index("sku")
    ol = lines[["sku", "quantity"]].copy()
    ol["quantity"] = pd.to_numeric(ol["quantity"], errors="coerce").fillna(0)
    ol = ol.join(prod[["unit_price_eur", "country_of_origin", "requires_conformity_cert"]], on="sku")
    unknown = ol.loc[ol["unit_price_eur"].isna(), "sku"].tolist()
    if unknown:
        issues.append(f"Unknown SKU or missing price: {', '.join(map(str, unknown))}")
    ol["value"] = ol["quantity"] * ol["unit_price_eur"].astype(float).fillna(0)
    ol["eu_origin"] = ol["country_of_origin"].astype(str).str.upper().isin(EU27)
    cert = ol.loc[ol["requires_conformity_cert"].fillna(False).astype(bool), "sku"].astype(str).tolist()

    pallets = num(order.get("pallet_count"))
    if pallets <= 0:
        issues.append("Pallet count missing")

    supplier = None
    if not blank(order.get("supplier_id")):
        srows = data.suppliers[data.suppliers["supplier_id"].astype(str) == str(order["supplier_id"])]
        supplier = srows.iloc[0].to_dict() if len(srows) else None
    return OrderContext(order=order, customer=customer, country=country, lines=ol,
                        value=float(ol["value"].sum()), units=float(ol["quantity"].sum()), pallets=pallets,
                        duty_weights=ol[["sku", "value", "eu_origin"]], cert_skus=cert,
                        skus=ol["sku"].astype(str).tolist(), supplier=supplier, issues=issues)


# ====================================================================== lanes

def lane_status(data: Data, origins: set[str], dests: set[str], via_dc: str | None,
                country: str) -> tuple[str, str]:
    """Best known status for a lane, from the lanes table and from sales history."""
    best, basis = "unproven", "no lane record"
    lanes = data.lanes
    if len(lanes):
        hit = lanes[lanes["origin_id"].astype(str).str.upper().isin({o.upper() for o in origins})
                    & lanes["destination_id"].astype(str).str.upper().isin({d.upper() for d in dests if d})]
        for r in hit.itertuples():
            st = str(r.status) if str(r.status) in LANE_RANK else "unproven"
            if basis == "no lane record" or LANE_RANK[st] < LANE_RANK[best]:
                best, basis = st, f"lane {r.lane_id}"

    via_counts, direct_counts = data.history_counts()
    n = via_counts.get(via_dc.upper(), 0) if via_dc else direct_counts.get(country, 0)
    threshold, _ = data.g("proven_lane_min_orders_12m")
    derived = "proven" if n >= threshold else "occasional" if n >= 1 else None
    if derived and LANE_RANK[derived] < LANE_RANK[best]:
        best, basis = derived, f"{n} order(s) in sales history, last 12 months"
    return best, basis


# ====================================================================== route builder

def _duty_rate(ctx: OrderContext, duty: dict | None) -> tuple[float, bool]:
    """Value-weighted duty %, and whether any line uses the EU preferential rate."""
    if not duty or not ctx.value:
        return 0.0, False
    eu = num(duty.get("duty_pct_eu_origin"))
    std = num(duty.get("duty_pct_standard"))
    w = ctx.duty_weights
    rate = float(((w["value"] * w["eu_origin"].map({True: eu, False: std})).sum()) / ctx.value)
    uses_pref = bool(w["eu_origin"].any()) and str(duty.get("preference_document", "none")) != "none"
    return rate, uses_pref


def _compliance(data: Data, ctx: OrderContext, country: str, alloc: float, paid_by: str,
                party: str) -> tuple[list[Step], float]:
    """Compliance steps for one country. alloc scales per-shipment items. Returns steps, max lead days."""
    steps: list[Step] = []
    lead = 0.0
    spy, _ = data.g("shipments_per_year_per_country")
    years, _ = data.g("one_off_amortisation_years")
    spy = spy or 1
    for r in data.compliance_rows(country).to_dict("records"):
        applies_certs = str(r.get("applies_to")) == "cert_skus"
        if applies_certs and not ctx.cert_skus:
            continue
        cost = num(r.get("cost_eur"))
        basis = str(r.get("basis"))
        n_skus = len(set(ctx.cert_skus if applies_certs else ctx.skus))
        if basis == "per_shipment":
            amount, note = cost * alloc, "per shipment" + (f", {alloc:.0%} allocated" if alloc < 1 else "")
        elif basis == "per_sku_year":
            amount, note = cost * n_skus / spy, f"{n_skus} SKU(s) x EUR {cost:g}/yr over {spy:g} shipments"
        elif basis == "one_off":
            amount, note = cost / (max(years, 1) * spy), f"one-off EUR {cost:g} over {years:g} yr"
        else:
            amount, note = cost, basis
        steps.append(Step(step=f"{r['item']} ({country})", category="compliance", cost_eur=amount,
                          paid_by=paid_by, party=party, doc_steps=int(num(r.get("doc_steps"))),
                          source=str(r.get("source")), note=note))
        if basis == "per_shipment":
            lead = max(lead, num(r.get("lead_days")))
    return steps, lead


def _import_block(data: Data, ctx: OrderContext, route: Route, country: str, customs_value: float,
                  alloc: float, paid_by: str, broker_party: str, count_days: bool) -> float:
    """Clearance, duty, fees and compliance for one import. Returns compliance lead days."""
    duty = data.duty(country)
    if duty is None:
        route.warnings.append(f"No duty data for {country}. Duty taken as 0")
        duty = {}
    rate, uses_pref = _duty_rate(ctx, duty)
    src = str(duty.get("source", P.PLACEHOLDER))
    clear_days, clear_src = data.lead("import_clearance", country)
    route.steps.append(Step(step=f"Import clearance {country}", category="clearance",
                            cost_eur=num(duty.get("clearance_broker_eur")) * alloc,
                            days=clear_days if count_days else 0.0, paid_by=paid_by, party=broker_party,
                            customs=True, doc_steps=1 + int(uses_pref), source=src,
                            note=("preference proof: " + str(duty.get("preference_document"))) if uses_pref else ""))
    duty_amt = customs_value * rate / 100
    route.steps.append(Step(step=f"Import duty {country} ({rate:.1f}% weighted)", category="duty",
                            cost_eur=duty_amt, paid_by=paid_by, party=broker_party, source=src,
                            note="EU-origin lines at preferential rate" if uses_pref else ""))
    fees = customs_value * num(duty.get("other_fees_pct")) / 100
    if fees:
        route.steps.append(Step(step=f"Other import levies {country}", category="import_fees", cost_eur=fees,
                                paid_by=paid_by, party=broker_party, source=src))
    route.vat_eur += (customs_value + duty_amt + fees) * num(duty.get("vat_pct")) / 100
    comp, lead = _compliance(data, ctx, country, alloc, paid_by, broker_party)
    route.steps.extend(comp)
    return lead


def build_route(ctx: OrderContext, data: Data, scenario: str, dc: dict | None = None) -> Route:
    sc = data.scenario(scenario)
    sc_src = str(sc.get("source", P.PLACEHOLDER))
    stocked = scenario in STOCKED
    country = ctx.country
    node_country = str(dc["country"]) if dc else country
    cross_border = stocked and node_country != country
    route = Route(scenario=scenario, dc_id=dc["dc_id"] if dc else None,
                  dc_name=str(dc["name"]) if dc else "Destination port",
                  dc_status=str(dc.get("status", "")) if dc else "existing",
                  dc_country=node_country, customer_country=country,
                  order_value_eur=ctx.value, units=ctx.units, pallets=ctx.pallets)
    route.issues.extend(ctx.issues)
    Pal = ctx.pallets
    V = ctx.value
    replen = num(sc.get("replenishment_pallets_per_shipment"))
    alloc = min(1.0, Pal / replen) if stocked and replen > 0 else 1.0
    factor = num(sc.get("replenishment_freight_factor"), 1.0) if stocked else 1.0
    node_party = str(dc["name"]) if dc else ""
    # Who pays and who handles the import into the node country.
    if scenario == "cif_baseline":
        import_payer, broker_party = CUSTOMER, "Customer's customs broker"
    elif scenario == "distributor":
        import_payer, broker_party = PARTNER, node_party
    else:
        import_payer, broker_party = FLEXITOG, "FlexiTog customs broker"

    mov = num(dc.get("min_order_value_eur")) if dc and not blank(dc.get("min_order_value_eur")) else \
        num(sc.get("min_order_value_eur"))
    route.min_order_value_eur = mov

    # ---- lane status and risk premium
    origins = {"HLM", "Helmond"} | ({str(ctx.supplier["supplier_id"])} if ctx.supplier else set())
    dests = {node_country, str(dc["dc_id"])} if dc else \
        {country, str(ctx.customer.get("customer_id", "")), str(ctx.customer.get("destination_port") or "")}
    route.lane_status, route.lane_basis = lane_status(data, origins, dests, route.dc_id, country)
    prem = 0.0
    if route.lane_status in ("occasional", "unproven"):
        prem += data.g(f"risk_premium_lane_{route.lane_status}_pct")[0]
    if route.dc_status in ("potential", "candidate"):
        prem += data.g(f"risk_premium_dc_{route.dc_status}_pct")[0]
    route.risk_premium_pct = prem

    # ---- supplier inbound (same for every scenario, days only hit the baseline)
    if ctx.supplier:
        f = data.freight_option("inbound", "NL")
        cost = max(num(f["min_charge_eur"]), num(f["eur_per_pallet"]) * Pal) if f else 0.0
        route.steps.append(Step(
            step=f"Inbound {ctx.supplier['supplier_id']} -> Helmond", category="freight", cost_eur=cost,
            days=0.0 if stocked else num(ctx.supplier.get("lead_time_days")),
            party=f"Supplier {ctx.supplier['supplier_id']}", source=str(f["source"]) if f else P.PLACEHOLDER,
            note="stock pre-positioned, supplier lead time not on order path" if stocked else "make-to-order"))

    # ---- Helmond
    h, hsrc = data.g("helmond_outbound_handling_eur_per_pallet")
    proc_days, _ = data.lead("order_processing_helmond")
    route.steps.append(Step(step="Pick and load at Helmond", category="handling", cost_eur=h * Pal,
                            days=0.0 if stocked else proc_days, party="FlexiTog Helmond", source=hsrc,
                            note="replenishment, not on order path" if stocked else ""))
    exp, esrc = data.g("export_docs_eur_per_shipment")
    coo, _ = data.g("certificate_of_origin_eur")
    exp_days, _ = data.lead("export_clearance_eu")
    route.steps.append(Step(step="EU export declaration + CoO", category="export_docs",
                            cost_eur=(exp + coo) * alloc, days=0.0 if stocked else exp_days,
                            party="Forwarder", customs=True, doc_steps=2, source=esrc))

    # ---- main freight Helmond -> node country
    prefer_port = (dc.get("port_of_entry") if dc else ctx.customer.get("destination_port")) or None
    f = data.freight_option("main", node_country, prefer_port=prefer_port)
    if f is None:
        route.issues.append(f"No main freight rate to {node_country}")
        freight = 0.0
        transit = 0.0
    else:
        rate = num(f["eur_per_pallet"]) * factor * Pal
        freight = rate if stocked else max(num(f["min_charge_eur"]), rate)
        transit = num(f["transit_days"])
        route.steps.append(Step(
            step=f"Main freight Helmond -> {f.get('port_or_border') or node_country} ({f['mode']})",
            category="freight", cost_eur=freight, days=0.0 if stocked else transit, party="Forwarder",
            source=str(f["source"]),
            note=f"consolidated replenishment x{factor:g}" if stocked else "single shipment, min charge applies"))
    ins_pct, isrc = data.g("cargo_insurance_pct_of_value")
    insurance = (V + freight) * ins_pct / 100
    route.steps.append(Step(step="Cargo insurance", category="insurance", cost_eur=insurance,
                            party="Forwarder", source=isrc))
    cif = V + freight + insurance

    # ---- entry into node country
    comp_lead = 0.0
    if cross_border:
        fz, fsrc = data.g("free_zone_handling_eur_per_pallet")
        route.steps.append(Step(step=f"Free-zone entry {node_country} (duty suspended)", category="clearance",
                                cost_eur=fz * Pal, party=node_party, customs=True, doc_steps=1, source=fsrc,
                                paid_by=import_payer))
    else:
        comp_lead = _import_block(data, ctx, route, node_country, cif, alloc, import_payer, broker_party,
                                  count_days=not stocked)

    # ---- in-region stock
    if stocked:
        wc_months = num(sc.get("avg_storage_months"))
        route.steps.append(Step(step="Inbound handling at node", category="handling",
                                cost_eur=num(sc.get("inbound_eur_per_pallet")) * Pal,
                                party=node_party, paid_by=import_payer, source=sc_src))
        route.steps.append(Step(step=f"Storage {wc_months:g} month(s)", category="storage",
                                cost_eur=num(sc.get("storage_eur_per_pallet_month")) * Pal * wc_months,
                                party=node_party, paid_by=import_payer, source=sc_src))
        if scenario in ("3pl", "owned_warehouse"):
            wc, wsrc = data.g("working_capital_rate_pct")
            route.steps.append(Step(step="Capital tied up in regional stock", category="working_capital",
                                    cost_eur=V * wc / 100 * wc_months / 12, party=node_party, source=wsrc))
        if scenario == "owned_warehouse":
            fx = data.owned_fixed_row(node_country)
            if fx is None:
                route.warnings.append(f"No fixed cost row for an owned warehouse in {node_country}")
            else:
                per_pal = num(fx["fixed_cost_eur_per_year"]) / max(num(fx["expected_pallets_per_year"]), 1)
                route.steps.append(Step(step="Owned warehouse fixed cost share", category="fixed_cost",
                                        cost_eur=per_pal * Pal, party=node_party, source=str(fx["source"]),
                                        note=f"EUR {per_pal:,.0f}/pallet at planned volume"))
        pick_days, psrc = data.lead("local_pick_and_dispatch")
        route.steps.append(Step(step="Pick and dispatch from regional stock", category="handling",
                                cost_eur=num(sc.get("outbound_eur_per_order")), days=pick_days,
                                party=node_party, paid_by=import_payer, source=sc_src))

    # ---- node -> customer country (hub serving a neighbour)
    if cross_border:
        group = REGIONAL_GROUP.get(region_for(country))
        rf = data.freight_option("regional", group) if group else None
        exp_days, _ = data.lead("export_clearance_eu")
        route.steps.append(Step(step=f"Free-zone exit / re-export {node_country}", category="clearance",
                                days=exp_days, party=node_party, paid_by=import_payer, customs=True,
                                doc_steps=1, source=P.PLACEHOLDER))
        if rf is None:
            route.issues.append(f"No regional freight rate from {node_country} to {country}")
            regional = 0.0
        else:
            regional = max(num(rf["min_charge_eur"]), num(rf["eur_per_pallet"]) * Pal)
            route.steps.append(Step(step=f"Regional freight {node_country} -> {country} ({rf['mode']})",
                                    category="freight", cost_eur=regional, days=num(rf["transit_days"]),
                                    party="Regional carrier", paid_by=import_payer, source=str(rf["source"])))
        # Cross-border delivery ships per order, so per-shipment costs apply in full.
        cross_lead = _import_block(data, ctx, route, country, cif + regional, 1.0, import_payer, broker_party,
                                   count_days=True)
        route.steps.append(Step(step="Compliance wait (beyond clearance)", category="compliance",
                                days=max(0.0, cross_lead - data.lead("import_clearance", country)[0]),
                                party=broker_party, paid_by=import_payer))

    # ---- baseline: compliance lead beyond transit
    if not stocked and comp_lead > transit:
        route.steps.append(Step(step="Compliance wait (beyond transit)", category="compliance",
                                days=comp_lead - transit, party=broker_party, paid_by=import_payer))

    # ---- last mile
    d = data.freight_option("domestic", country)
    if d is None:
        route.warnings.append(f"No domestic delivery rate for {country}")
    else:
        dom_payer = CUSTOMER if scenario == "cif_baseline" else import_payer
        route.steps.append(Step(step=f"Delivery to {ctx.customer.get('city') or 'customer'}", category="freight",
                                cost_eur=max(num(d["min_charge_eur"]), num(d["eur_per_pallet"]) * Pal),
                                days=num(d["transit_days"]), paid_by=dom_payer,
                                party="Customer's local carrier" if scenario == "cif_baseline" else "Local carrier",
                                source=str(d["source"])))

    # ---- distributor margin
    if scenario == "distributor":
        m = num(sc.get("margin_pct"))
        route.steps.append(Step(step=f"Distributor margin {m:g}%", category="margin", cost_eur=V * m / 100,
                                paid_by=CUSTOMER, party=node_party, source=sc_src,
                                note="paid by the customer through a higher local price"))

    route.steps.append(Step(step="Goods received", category="receipt", party="Customer",
                            paid_by=CUSTOMER, source="n/a"))

    if route.below_mov:
        route.warnings.append(f"Order value EUR {V:,.0f} below minimum EUR {mov:,.0f}")
    if region_for(country) not in ("Türkiye", "North Africa", "Gulf/GCC"):
        route.warnings.append(f"{country} is outside the three study regions")
    return route


# ====================================================================== candidates + recommendation

def candidate_nodes(data: Data, scenario: str, country: str) -> list[dict]:
    dcs = data.dcs[data.dcs["dc_type"] == scenario]
    out = []
    for dc in dcs.to_dict("records"):
        serves = {c for c in str(dc.get("serves_countries") or "").split(";") if c}
        if dc.get("country") == country or country in serves:
            out.append(dc)
    return out


def evaluate(order: dict, lines: pd.DataFrame, data: Data, override: str | None = None,
             include_baseline: bool = False) -> Evaluation:
    """Build every route for one order and pick a recommendation.

    override: a dc_id, or 'cif_baseline', forces the selected route.
    include_baseline: let the baseline win the recommendation.
    """
    ctx = order_context(order, lines, data)
    routes: list[Route] = []
    notes: list[str] = []
    baseline = build_route(ctx, data, "cif_baseline")
    routes.append(baseline)
    for scenario in ["distributor", "3pl", "owned_warehouse"]:
        nodes = candidate_nodes(data, scenario, ctx.country)
        if not nodes:
            notes.append(f"No {SCENARIO_LABELS[scenario].lower()} node serves {ctx.country or 'this country'}")
        for dc in nodes:
            routes.append(build_route(ctx, data, scenario, dc))

    pool = [r for r in routes if r.feasible and not r.below_mov
            and (include_baseline or r.scenario != "cif_baseline")]
    recommended = min(pool, key=lambda r: (r.score, LANE_RANK.get(r.lane_status, 2))) if pool else None

    reason = ""
    if recommended:
        cheapest = min(pool, key=lambda r: r.cost_to_serve)
        reason = (f"Lowest risk-adjusted cost: EUR {recommended.cost_to_serve:,.0f} "
                  f"+{recommended.risk_premium_pct:g}% premium ({recommended.lane_status} lane, "
                  f"{recommended.dc_status} node).")
        if cheapest is not recommended:
            reason += (f" {cheapest.label} is EUR {recommended.cost_to_serve - cheapest.cost_to_serve:,.0f} "
                       f"cheaper on paper but runs on a {cheapest.lane_status} lane / {cheapest.dc_status} node.")
    else:
        reason = "No feasible in-scope route. Check freight rates, nodes serving this country and MOV."

    forced = override or (None if blank(order.get("dc_override")) else str(order["dc_override"]))
    selected = recommended
    if forced:
        match = [r for r in routes if r.key == forced]
        if match:
            selected = match[0]
        else:
            notes.append(f"Forced node '{forced}' does not serve {ctx.country}. Showing the recommendation")
    return Evaluation(order_id=str(order.get("order_id", "")), routes=routes, recommended=recommended,
                      selected=selected, baseline=baseline, reason=reason, notes=notes)


def compare_to_baseline(route: Route, baseline: Route) -> dict:
    return {
        "cost_to_serve_delta_eur": route.cost_to_serve - baseline.cost_to_serve,
        "customer_pays_delta_eur": route.paid(CUSTOMER) - baseline.paid(CUSTOMER),
        "flexitog_pays_delta_eur": route.paid(FLEXITOG) - baseline.paid(FLEXITOG),
        "lead_time_delta_days": route.lead_time_days - baseline.lead_time_days,
        "customer_steps_removed": baseline.customer_steps - route.customer_steps,
        "customs_touchpoints_delta": route.customs_touchpoints - baseline.customs_touchpoints,
        "handoffs_delta": route.handoffs - baseline.handoffs,
        "doc_steps_delta": route.doc_steps - baseline.doc_steps,
    }
