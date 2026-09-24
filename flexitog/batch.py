"""Batch simulation: build a set of test orders per region, run each through every
scenario, and aggregate a scorecard per region and scenario.

Batch sources:
    synthetic      generated from the customer and SKU master (use until real history exists)
    test orders    the saved test orders table
    sales history  one batch order per historical order
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .engine import CUSTOMER, FLEXITOG, PARTNER, SCENARIO_LABELS, Data, Route, evaluate, num
from .schema import region_for

STUDY_REGIONS = ["Türkiye", "North Africa", "Gulf/GCC"]
REGION_CODE = {"Türkiye": "TR", "North Africa": "NAF", "Gulf/GCC": "GCC", "Middle East (other)": "ME"}
IN_SCOPE = ["distributor", "3pl", "owned_warehouse"]

# Order size mix for synthetic batches: (label, pallet range, share of orders).
SIZE_MIX = [("small", (1, 1), 0.5), ("medium", (2, 4), 0.35), ("large", (6, 10), 0.15)]


# ====================================================================== hassle methods

def _customer_first(r: Route, data: Data) -> float:
    w_paper, _ = data.g("hassle_weight_customer_paperwork")
    w_other, _ = data.g("hassle_weight_customer_other")
    return w_paper * r.customer_paperwork_steps + w_other * r.customer_other_steps


HASSLE_METHODS = {
    "customer_first": ("Customer-first: paperwork left with the customer",
                       "Weighted count of clearance, duty and compliance steps the customer handles, plus other "
                       "steps it arranges itself. Target 0. FlexiTog workload is reported next to it.",
                       _customer_first),
    "customs_touchpoints": ("Customs touchpoints", "Export, free-zone and import clearances on the route.",
                            lambda r, d: r.customs_touchpoints),
    "handoffs": ("Parties and handoffs", "Custody changes between parties from Helmond to customer.",
                 lambda r, d: r.handoffs),
    "doc_steps": ("Documentation steps", "Document actions across the route (declarations, certificates, "
                  "legalisation, preference proofs).", lambda r, d: r.doc_steps),
}


# ====================================================================== batch builders

def _quantities(skus: pd.DataFrame, pallets: int, rng: np.random.Generator) -> list[tuple[str, int]]:
    """Split a pallet count over SKUs and turn each share into units."""
    shares = rng.dirichlet(np.ones(len(skus)))
    out = []
    for (_, p), share in zip(skus.iterrows(), shares):
        upp = num(p.get("units_per_pallet"), 0) or 100
        qty = max(1, int(round(upp * pallets * share / 10.0)) * 10)
        out.append((str(p["sku"]), qty))
    return out


def synthetic_batch(data: Data, per_region: int = 12, seed: int = 42,
                    regions: list[str] | None = None) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    """Random but reproducible orders from the customer and SKU master."""
    rng = np.random.default_rng(seed)
    regions = regions or STUDY_REGIONS
    customers = data.customers.copy()
    customers["region"] = customers["country"].map(region_for)
    products = data.products[data.products["unit_price_eur"].notna()]
    orders, lines, notes = [], [], []
    if products.empty:
        return pd.DataFrame(), pd.DataFrame(), ["No SKUs with a price in the product table"]
    for region in regions:
        pool = customers[customers["region"] == region]
        if pool.empty:
            notes.append(f"No customers in {region}. Add or import customers there to include it")
            continue
        for i in range(per_region):
            cust = pool.iloc[int(rng.integers(len(pool)))]
            size = rng.choice(len(SIZE_MIX), p=[s[2] for s in SIZE_MIX])
            label, (lo, hi), _ = SIZE_MIX[size]
            pallets = int(rng.integers(lo, hi + 1))
            n_skus = int(rng.integers(1, min(4, len(products)) + 1))
            skus = products.iloc[rng.choice(len(products), size=n_skus, replace=False)]
            oid = f"B-{REGION_CODE.get(region, 'X')}-{i + 1:03d}"
            orders.append({"order_id": oid, "customer_id": cust["customer_id"], "pallet_count": pallets,
                           "pallet_type": "EUR", "batch": f"synthetic-{label}", "data_source": "synthetic"})
            for sku, qty in _quantities(skus, pallets, rng):
                lines.append({"order_id": oid, "sku": sku, "quantity": qty})
    return pd.DataFrame(orders), pd.DataFrame(lines), notes


def history_batch(data: Data, per_region: int | None = None, seed: int = 42,
                  since=None) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, list[str]]:
    """One batch order per historical order. Returns orders, lines, extra customers, notes.

    Customers missing from the customer table are created from the sales row's country,
    so history works before the customer master is complete.
    """
    sh = data.sales_history.copy()
    notes: list[str] = []
    if sh.empty:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), ["Sales history is empty"]
    if since is not None:
        sh = sh[pd.to_datetime(sh["order_date"], errors="coerce") >= pd.Timestamp(since)]
    known = data.customers.set_index("customer_id")["country"].to_dict()
    sh["country_final"] = sh["customer_id"].map(known)
    if "country" in sh:
        sh["country_final"] = sh["country_final"].fillna(sh["country"])
    sh["region"] = sh["country_final"].map(region_for)
    missing_country = sh["country_final"].isna()
    if missing_country.any():
        notes.append(f"{sh.loc[missing_country, 'order_id'].nunique()} historical order(s) skipped: "
                     "no country on the sales row or in the customer table")
        sh = sh[~missing_country]

    unknown_sku = ~sh["sku"].isin(set(data.products["sku"]))
    if unknown_sku.any():
        notes.append(f"{int(unknown_sku.sum())} sales line(s) skipped: SKU not in the product table "
                     f"(e.g. {sh.loc[unknown_sku, 'sku'].iloc[0]})")
        sh = sh[~unknown_sku]

    upp = data.products.set_index("sku")["units_per_pallet"].astype(float)
    sh["pallet_share"] = sh["quantity"].astype(float) / sh["sku"].map(upp)
    agg = {"customer_id": ("customer_id", "first"), "country": ("country_final", "first"),
           "region": ("region", "first"), "order_date": ("order_date", "first"),
           "est_pallets": ("pallet_share", "sum")}
    if "pallets" in sh:
        agg["pallets"] = ("pallets", "sum")
    head = sh.groupby("order_id").agg(**agg).reset_index()
    given = head["pallets"] if "pallets" in head else pd.Series(np.nan, index=head.index)
    head["pallet_count"] = [p if num(p) > 0 else max(1, math.ceil(e - 1e-9)) if num(e) > 0 else 1
                            for p, e in zip(given, head["est_pallets"])]

    if per_region:
        head = (head.groupby("region", group_keys=False)
                .apply(lambda g: g.sample(n=min(per_region, len(g)), random_state=seed)))
    orders = head.assign(batch="history", pallet_type="EUR", data_source="history")[
        ["order_id", "customer_id", "pallet_count", "pallet_type", "order_date", "batch", "data_source"]]
    lines = (sh[sh["order_id"].isin(orders["order_id"])]
             .groupby(["order_id", "sku"], as_index=False)["quantity"].sum())

    new_cust = head[~head["customer_id"].isin(known)][["customer_id", "country", "region"]].drop_duplicates(
        "customer_id")
    new_cust = new_cust.assign(name=new_cust["customer_id"], city=None, data_source="history")
    if len(new_cust):
        notes.append(f"{len(new_cust)} customer(s) not in the customer table, placed at country level only")
    return orders.reset_index(drop=True), lines, new_cust, notes


# ====================================================================== run

def best_route(routes: list[Route]) -> Route | None:
    """Best node within one scenario: feasible and above MOV first, then lowest risk-adjusted cost."""
    if not routes:
        return None
    ok = [r for r in routes if r.feasible and not r.below_mov]
    pool = ok or [r for r in routes if r.feasible] or routes
    return min(pool, key=lambda r: r.score)


def run_batch(orders: pd.DataFrame, lines: pd.DataFrame, data: Data, progress=None) -> pd.DataFrame:
    """One row per order x scenario, using the best node for each scenario."""
    rows = []
    by_order = {oid: g for oid, g in lines.groupby("order_id")}
    total = len(orders)
    for i, order in enumerate(orders.to_dict("records")):
        olines = by_order.get(order["order_id"], lines.iloc[0:0])
        ev = evaluate(order, olines, data)
        region = region_for(ev.baseline.customer_country)
        for scenario in ["cif_baseline"] + IN_SCOPE:
            r = best_route([x for x in ev.routes if x.scenario == scenario])
            row = {"order_id": order["order_id"], "batch": order.get("batch"), "region": region,
                   "country": ev.baseline.customer_country, "scenario": scenario,
                   "scenario_label": SCENARIO_LABELS[scenario]}
            if r is None:
                row.update({"node": "", "available": False, "reason": "no node serves this country"})
            else:
                row.update({
                    "node": r.dc_id or "port", "available": r.feasible and not r.below_mov,
                    "reason": "; ".join(r.issues) or ("below minimum order value" if r.below_mov else ""),
                    "units": r.units, "pallets": r.pallets, "order_value_eur": r.order_value_eur,
                    "cost_to_serve_eur": r.cost_to_serve, "customer_pays_eur": r.paid(CUSTOMER),
                    "flexitog_pays_eur": r.paid(FLEXITOG), "partner_pays_eur": r.paid(PARTNER),
                    "lead_time_days": r.lead_time_days, "lane_status": r.lane_status,
                    "customs_touchpoints": r.customs_touchpoints, "handoffs": r.handoffs,
                    "doc_steps": r.doc_steps, "customer_steps": r.customer_steps,
                    "customer_paperwork_steps": r.customer_paperwork_steps,
                    "flexitog_paperwork": r.paperwork(FLEXITOG), "partner_paperwork": r.paperwork(PARTNER),
                    "placeholder_cost_share": r.placeholder_cost_share,
                    **{f"hassle_{k}": fn(r, data) for k, (_, _, fn) in HASSLE_METHODS.items()},
                })
            rows.append(row)
        if progress:
            progress((i + 1) / total)
    return pd.DataFrame(rows)


# ====================================================================== scorecard

# metric: (label, lower is better)
METRICS = {
    "cost_per_unit_eur": ("Cost to serve per unit (EUR)", True),
    "customer_cost_per_unit_eur": ("Customer cost per unit (EUR)", True),
    "lead_time_days": ("Lead time (days)", True),
    "hassle": ("Hassle score", True),
    "flexitog_paperwork": ("FlexiTog paperwork per order", True),
}


def scorecard(results: pd.DataFrame, method: str = "customer_first") -> pd.DataFrame:
    """Per region x scenario. Costs are unit-weighted. Unavailable orders are left out and counted."""
    if results.empty:
        return pd.DataFrame()
    hcol = f"hassle_{method}"
    out = []
    for (region, scenario), g in results.groupby(["region", "scenario"], sort=False):
        ok = g[g["available"]]
        units = ok["units"].sum() if len(ok) else 0
        out.append({
            "region": region, "scenario": scenario, "scenario_label": SCENARIO_LABELS[scenario],
            "orders": len(g), "coverage": len(ok) / len(g) if len(g) else 0.0,
            "cost_per_unit_eur": ok["cost_to_serve_eur"].sum() / units if units else np.nan,
            "cost_pct_of_value": 100 * ok["cost_to_serve_eur"].sum() / ok["order_value_eur"].sum()
            if len(ok) and ok["order_value_eur"].sum() else np.nan,
            "customer_cost_per_unit_eur": ok["customer_pays_eur"].sum() / units if units else np.nan,
            "flexitog_cost_per_unit_eur": ok["flexitog_pays_eur"].sum() / units if units else np.nan,
            "lead_time_days": ok["lead_time_days"].mean() if len(ok) else np.nan,
            "hassle": ok[hcol].mean() if len(ok) else np.nan,
            "customer_paperwork_steps": ok["customer_paperwork_steps"].mean() if len(ok) else np.nan,
            "flexitog_paperwork": ok["flexitog_paperwork"].mean() if len(ok) else np.nan,
            "proven_lane_share": (ok["lane_status"] == "proven").mean() if len(ok) else np.nan,
            "placeholder_cost_share": ok["placeholder_cost_share"].mean() if len(ok) else np.nan,
        })
    sc = pd.DataFrame(out)
    order = {s: i for i, s in enumerate(["cif_baseline"] + IN_SCOPE)}
    return sc.sort_values(["region", "scenario"], key=lambda s: s.map(order) if s.name == "scenario" else s)\
        .reset_index(drop=True)


def winners(sc: pd.DataFrame) -> pd.DataFrame:
    """Winning in-scope scenario per region and metric. Ties (within 0.5%) list every winner."""
    rows = []
    for region, g in sc.groupby("region", sort=False):
        g = g[(g["scenario"] != "cif_baseline") & (g["coverage"] > 0)]
        base = sc[(sc["region"] == region) & (sc["scenario"] == "cif_baseline")]
        row = {"region": region}
        for m, (label, _) in METRICS.items():
            vals = g.dropna(subset=[m])
            if vals.empty:
                row[label] = "n/a"
                continue
            low = vals[m].min()
            tied = vals[np.isclose(vals[m], low, rtol=0.005, atol=1e-9)]
            text = " = ".join(tied["scenario_label"]) + f" ({low:,.2f})"
            if len(base) and pd.notna(base.iloc[0][m]):
                text += f" | baseline {base.iloc[0][m]:,.2f}"
            row[label] = text
        rows.append(row)
    return pd.DataFrame(rows)


def method_check(results: pd.DataFrame) -> pd.DataFrame:
    """Does each hassle method separate the scenarios? Spread of scenario averages per region."""
    rows = []
    ok = results[results["available"]]
    for key, (label, _, _) in HASSLE_METHODS.items():
        col = f"hassle_{key}"
        for region, g in ok.groupby("region"):
            means = g.groupby("scenario")[col].mean()
            spread = float(means.max() - means.min()) if len(means) else 0.0
            in_scope = means.drop("cif_baseline", errors="ignore")
            rows.append({
                "method": label, "region": region,
                "baseline": means.get("cif_baseline", np.nan),
                **{SCENARIO_LABELS[s]: means.get(s, np.nan) for s in IN_SCOPE},
                "spread": spread,
                "separates in-scope scenarios": bool(in_scope.nunique() > 1),
                "separates from baseline": bool(len(in_scope) and (in_scope != means.get("cif_baseline")).any()),
            })
    return pd.DataFrame(rows)


def profile(orders: pd.DataFrame, lines: pd.DataFrame, data: Data, source: str) -> pd.DataFrame:
    """Order profile per region, to compare a test batch against sales history."""
    if orders.empty:
        return pd.DataFrame()
    price = data.products.set_index("sku")["unit_price_eur"].astype(float)
    ln = lines.assign(value=lines["quantity"].astype(float) * lines["sku"].map(price).fillna(0))
    per = ln.groupby("order_id").agg(value=("value", "sum"), lines=("sku", "nunique"),
                                     units=("quantity", "sum"))
    cust = data.customers.set_index("customer_id")["country"]
    o = orders.join(per, on="order_id")
    country = o["customer_id"].map(cust)
    if "country" in o:
        country = country.fillna(o["country"])
    o["region"] = country.map(region_for)
    g = o.groupby("region").agg(orders=("order_id", "count"), avg_order_value_eur=("value", "mean"),
                                median_order_value_eur=("value", "median"),
                                avg_pallets=("pallet_count", lambda s: pd.to_numeric(s).mean()),
                                avg_sku_lines=("lines", "mean"), avg_units=("units", "mean"))
    g.insert(0, "source", source)
    return g.reset_index()
