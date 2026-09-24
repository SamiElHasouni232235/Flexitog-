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
    """Make DIST-SA an existing partner on a proven lane: it should win despite a small cost gap."""
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
    lines = pd.DataFrame({"order_id": ["x"], "sku": ["FT-GLV-200"], "quantity": [5]})  # EUR 45
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
