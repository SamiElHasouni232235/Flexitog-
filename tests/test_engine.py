import pandas as pd
import pytest

from flexitog import parameters as P
from flexitog.engine import CUSTOMER, FLEXITOG, PARTNER, Data, compare_to_baseline, evaluate
from flexitog.store import Workspace


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path)


def order_for(ws, order_id):
    orders, lines = ws.load("orders"), ws.load("order_lines")
    return orders[orders["order_id"] == order_id].iloc[0].to_dict(), lines[lines["order_id"] == order_id]


def by_key(ev):
    return {r.key: r for r in ev.routes}


def test_all_scenarios_built_for_saudi_order(ws):
    order, lines = order_for(ws, "T-SA-001")
    ev = evaluate(order, lines, Data.from_workspace(ws))
    routes = by_key(ev)
    assert {"cif_baseline", "DIST-SA", "3PL-JAFZ", "OWN-AE"} <= set(routes)
    assert all(r.feasible for r in routes.values())
    assert ev.recommended is not None and ev.recommended.scenario != "cif_baseline"


def test_baseline_splits_cost_between_flexitog_and_customer(ws):
    order, lines = order_for(ws, "T-SA-001")
    base = evaluate(order, lines, Data.from_workspace(ws)).baseline
    steps = base.steps_frame().set_index("category")
    # FlexiTog pays freight + insurance to port. Customer pays duty and clearance.
    assert set(steps.loc["duty", "paid_by"] if isinstance(steps.loc["duty"], pd.DataFrame)
               else [steps.loc["duty", "paid_by"]]) == {CUSTOMER}
    assert base.paid(FLEXITOG) > 0 and base.paid(CUSTOMER) > 0 and base.paid(PARTNER) == 0
    # SA duty 5% of CIF value.
    duty = sum(s.cost_eur for s in base.steps if s.category == "duty")
    freight = next(s.cost_eur for s in base.steps if s.step.startswith("Main freight"))
    ins = next(s.cost_eur for s in base.steps if s.category == "insurance")
    assert duty == pytest.approx((base.order_value_eur + freight + ins) * 0.05)
    # Baseline lead time runs through Helmond processing, transit and clearance.
    assert base.lead_time_days > 30


def test_stocked_routes_are_faster_and_remove_customer_steps(ws):
    order, lines = order_for(ws, "T-SA-001")
    ev = evaluate(order, lines, Data.from_workspace(ws))
    for r in ev.routes:
        if r.scenario == "cif_baseline":
            continue
        d = compare_to_baseline(r, ev.baseline)
        assert d["lead_time_delta_days"] < 0
        assert d["customer_steps_removed"] > 0
        assert r.customer_steps == 0


def test_cross_border_hub_adds_customs_touchpoints(ws):
    order, lines = order_for(ws, "T-SA-001")
    routes = by_key(evaluate(order, lines, Data.from_workspace(ws)))
    # Jebel Ali serving Saudi: free-zone entry, exit and Saudi import on top of EU export.
    assert routes["3PL-JAFZ"].customs_touchpoints > routes["DIST-SA"].customs_touchpoints


def test_override_forces_selected_route(ws):
    order, lines = order_for(ws, "T-SA-001")
    ev = evaluate(order, lines, Data.from_workspace(ws), override="DIST-SA")
    assert ev.selected.key == "DIST-SA"
    ev = evaluate(order, lines, Data.from_workspace(ws), override="NOPE")
    assert ev.selected is ev.recommended and any("NOPE" in n for n in ev.notes)


def test_proven_lane_wins_over_cheaper_unproven(ws):
    """Make DIST-SA an existing partner on a proven lane: it should win despite a small cost gap.
    Direct sourcing is off here: the proven lane is Helmond -> DIST-SA."""
    g = ws.load_params("general")
    g.loc[g["parameter"] == "direct_sourcing_mode", "value"] = 0
    ws.save_params("general", g)
    dcs = ws.load("distribution_centers")
    dcs.loc[dcs["dc_id"] == "DIST-SA", "status"] = "existing"
    ws.save("distribution_centers", dcs)
    sc = ws.load_params("scenarios")
    sc.loc[sc["scenario"] == "distributor", "margin_pct"] = 5
    ws.save_params("scenarios", sc)
    lanes = ws.load("lanes")
    lanes = pd.concat([lanes, pd.DataFrame([{"lane_id": "L-DSA", "origin_id": "HLM", "destination_id": "DIST-SA",
                                            "mode": "sea", "status": "proven"}])], ignore_index=True)
    ws.save("lanes", lanes)

    order, lines = order_for(ws, "T-SA-001")
    ev = evaluate(order, lines, Data.from_workspace(ws))
    dist = by_key(ev)["DIST-SA"]
    assert dist.lane_status == "proven" and dist.risk_premium_pct == 0
    assert ev.recommended.key == "DIST-SA"


def test_partner_terms_override_scenario_defaults(ws):
    dcs = ws.load("distribution_centers")
    dcs.loc[dcs["dc_id"] == "DIST-SA", "margin_pct"] = 10
    dcs.loc[dcs["dc_id"] == "DIST-SA", "data_source"] = "manual"
    ws.save("distribution_centers", dcs)
    order, lines = order_for(ws, "T-SA-001")
    dist = by_key(evaluate(order, lines, Data.from_workspace(ws)))["DIST-SA"]
    margin = next(s for s in dist.steps if s.category == "margin")
    assert margin.cost_eur == pytest.approx(dist.order_value_eur * 0.10)
    assert margin.source == "real"


def test_sales_history_marks_lane_proven(ws):
    rows = [{"order_id": f"S{i}", "order_date": f"2026-0{1 + i % 8}-01", "customer_id": "C-SA-01",
             "sku": "FT-JKT-100", "quantity": 10, "shipped_via": "DIST-SA", "country": "SA"} for i in range(8)]
    sh = pd.DataFrame(rows)
    sh["data_source"] = "manual"
    ws.save("sales_history", sh)
    order, lines = order_for(ws, "T-SA-001")
    dist = by_key(evaluate(order, lines, Data.from_workspace(ws)))["DIST-SA"]
    assert dist.lane_status == "proven"
    assert "sales history" in dist.lane_basis


def test_eu_origin_gets_preferential_duty_in_turkiye(ws):
    products = ws.load("products")
    order, lines = order_for(ws, "T-TR-001")
    data = Data.from_workspace(ws)
    base_nonEU = evaluate(order, lines, data).baseline
    products["country_of_origin"] = "PT"
    ws.save("products", products)
    base_EU = evaluate(order, lines, Data.from_workspace(ws)).baseline
    duty = lambda r: sum(s.cost_eur for s in r.steps if s.category == "duty")  # noqa: E731
    assert duty(base_nonEU) > 0 and duty(base_EU) == 0
    assert base_EU.doc_steps == base_nonEU.doc_steps + 1  # A.TR preference proof


def test_below_mov_excluded_from_recommendation(ws):
    order, _ = order_for(ws, "T-SA-001")
    lines = pd.DataFrame({"order_id": ["x"], "sku": ["GF-GLV-200"], "quantity": [5]})  # EUR 45
    ev = evaluate({**order, "pallet_count": 1}, lines, Data.from_workspace(ws))
    assert all(r.below_mov for r in ev.routes if r.scenario != "cif_baseline")
    assert ev.recommended is None


def test_country_without_rates_is_infeasible(ws):
    customers = ws.load("customers")
    customers = pd.concat([customers, pd.DataFrame([{"customer_id": "C-JO", "name": "x", "country": "JO",
                                                     "city": "Amman", "region": "Middle East (other)",
                                                     "data_source": "manual"}])], ignore_index=True)
    ws.save("customers", customers)
    order, lines = order_for(ws, "T-SA-001")
    ev = evaluate({**order, "customer_id": "C-JO"}, lines, Data.from_workspace(ws))
    assert not ev.baseline.feasible
    assert any("outside the three study regions" in w for w in ev.baseline.warnings)


def test_new_default_parameters_merge_into_old_files(ws):
    old = P.default_table("general")
    old = old[old["parameter"] != "free_zone_handling_eur_per_pallet"]
    ws.save_params("general", old)
    loaded = ws.load_params("general")
    assert "free_zone_handling_eur_per_pallet" in set(loaded["parameter"])


def test_supplier_inbound_uses_the_suppliers_mode(ws):
    """Supply goes by sea by default, on the rate for the supplier's country. A supplier set to road
    uses the road rate, since road is an allowed supply mode."""
    order, lines = order_for(ws, "T-SA-001")
    pal = order["pallet_count"]

    def inbound(sup):
        data = Data.from_workspace(ws)
        return next(s for s in evaluate({**order, "supplier_id": sup}, lines, data).baseline.steps
                    if s.step.startswith("Inbound"))
    al, cn = inbound("SUP-AL1"), inbound("SUP-CN1")
    assert (al.mode, cn.mode) == ("sea", "sea")
    assert al.cost_eur == pytest.approx(max(280, 120 * pal)) and cn.cost_eur == pytest.approx(max(300, 135 * pal))
    assert al.days == 35 and cn.days == 90  # supplier lead time, make-to-order

    sup = ws.load("suppliers")
    sup.loc[sup["supplier_id"] == "SUP-AL1", "inbound_mode"] = "road"
    ws.save("suppliers", sup)
    road = inbound("SUP-AL1")
    assert road.mode == "road" and road.cost_eur == pytest.approx(max(250, 110 * pal))


def test_seed_brands_and_origins(ws):
    products = ws.load("products").set_index("sku")
    assert set(products.loc[products["brand"] == "FlexiTog", "country_of_origin"]) == {"AL"}
    other = products[products["brand"].isin(["RefrigiWear", "Gold Freeze"])]["country_of_origin"]
    assert set(other) == {"CN", "BD", "RS"} and other.isin(["CN", "BD"]).mean() > 0.5
    sup = ws.load("suppliers")
    assert {"CN", "BD", "RS", "AL"} == set(sup["country"])
    supplied = {s for ids in sup["sku_ids"] for s in str(ids).split(";")}
    assert supplied == set(products.index)


def _set_general(ws, name, value):
    g = ws.load_params("general")
    g.loc[g["parameter"] == name, "value"] = value
    ws.save_params("general", g)


def test_stocked_nodes_refill_direct_from_supplier_when_cheaper(ws):
    order, lines = order_for(ws, "T-SA-001")
    jafz = by_key(evaluate(order, lines, Data.from_workspace(ws)))["3PL-JAFZ"]
    assert jafz.direct_share == pytest.approx(1.0)
    assert all(g["direct_eur_per_pallet"] < g["via_helmond_eur_per_pallet"] for g in jafz.sourcing)
    cats = [s.category for s in jafz.steps]
    assert "inbound" in cats and not any(s.step.startswith("Pick and load at Helmond") for s in jafz.steps)
    assert jafz.main_leg is None

    _set_general(ws, "direct_sourcing_mode", 0)
    via = by_key(evaluate(order, lines, Data.from_workspace(ws)))["3PL-JAFZ"]
    assert via.direct_share == 0 and via.main_leg is not None
    assert via.cost_to_serve > jafz.cost_to_serve
    assert any(s.step.startswith("Inbound SUP-") for s in via.steps)


def test_baseline_counts_supplier_inbound_and_never_goes_direct(ws):
    order, lines = order_for(ws, "T-SA-001")
    base = evaluate(order, lines, Data.from_workspace(ws)).baseline
    inbound = [s for s in base.steps if s.category == "inbound"]
    assert {s.party for s in inbound} == {"Supplier SUP-AL1", "Supplier SUP-CN1"}
    assert base.direct_share == 0
    pallets = sum(g["pallets"] for g in base.sourcing)
    assert pallets == pytest.approx(order["pallet_count"])


def test_supplier_can_be_barred_from_direct_shipping(ws):
    sup = ws.load("suppliers")
    sup.loc[sup["supplier_id"] == "SUP-AL1", "direct_to_partners"] = False
    ws.save("suppliers", sup)
    order, lines = order_for(ws, "T-SA-001")
    jafz = by_key(evaluate(order, lines, Data.from_workspace(ws)))["3PL-JAFZ"]
    paths = {g["supplier_id"]: g["path"] for g in jafz.sourcing}
    assert paths == {"SUP-AL1": "helmond", "SUP-CN1": "direct"}
    assert 0 < jafz.direct_share < 1 and jafz.main_leg is not None


def test_old_freight_file_gains_direct_rates(ws):
    f = ws.load_params("freight")
    ws.save_params("freight", f[f["leg"] != "direct"].drop(columns=["origin_country"]))
    f2 = ws.load_params("freight")
    assert (f2["leg"] == "direct").sum() == (P.default_table("freight")["leg"] == "direct").sum()


def _set_modes(ws, group, **fields):
    m = ws.load_params("modes")
    for k, v in fields.items():
        m.loc[m["leg_group"] == group, k] = v
    ws.save_params("modes", m)


def test_default_modes_supply_by_sea_deliver_by_road(ws):
    order, lines = order_for(ws, "T-SA-001")
    routes = by_key(evaluate(order, lines, Data.from_workspace(ws)))
    for r in routes.values():
        mix = r.mode_mix
        assert set(mix.get("inbound", {})) | set(mix.get("direct", {})) <= {"sea"}
        assert set(mix.get("regional", {})) | set(mix.get("domestic", {})) <= {"road"}
        assert "air" not in str(mix)


def test_fastest_delivery_switches_to_air(ws):
    order, lines = order_for(ws, "T-SA-001")
    base = by_key(evaluate(order, lines, Data.from_workspace(ws)))["3PL-JAFZ"]
    _set_modes(ws, "delivery", pick="fastest")
    fast = by_key(evaluate(order, lines, Data.from_workspace(ws)))["3PL-JAFZ"]
    assert fast.mode_mix["regional"] == {"air": order["pallet_count"]}
    assert fast.mode_mix["domestic"] == {"air": order["pallet_count"]}
    assert fast.lead_time_days < base.lead_time_days and fast.cost_to_serve > base.cost_to_serve


def test_mode_filters_make_legs_infeasible_without_a_rate(ws):
    _set_modes(ws, "supply", allowed_modes="road")
    order, lines = order_for(ws, "T-SA-001")
    ev = evaluate(order, lines, Data.from_workspace(ws))
    assert not ev.baseline.feasible
    assert any("No supply rate for SUP-CN1" in i for i in ev.baseline.issues)


def test_air_export_only_when_allowed(ws):
    customers = ws.load("customers")
    customers = pd.concat([customers, pd.DataFrame([{"customer_id": "C-JO", "name": "x", "country": "JO",
                                                     "city": "Amman", "data_source": "manual"}])], ignore_index=True)
    ws.save("customers", customers)
    order, lines = order_for(ws, "T-SA-001")
    assert not evaluate({**order, "customer_id": "C-JO"}, lines, Data.from_workspace(ws)).baseline.feasible
    _set_modes(ws, "export", allowed_modes="sea;road;air")
    base = evaluate({**order, "customer_id": "C-JO"}, lines, Data.from_workspace(ws)).baseline
    assert base.mode_mix["main"] == {"air": order["pallet_count"]}
