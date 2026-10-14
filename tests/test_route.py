"""Route Dashboard logic (assets/route_core.js): best scenario rule, order-weighted aggregation, coverage
matrix, issue split, lane rules and working days, and the RFQ adapter with its placeholder fallback.
Runs the browser module in node."""
import json
import shutil
import subprocess

import pytest

from flexitog.dashboard import ASSETS

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

HELPERS = r"""
const F = require(process.argv[1]);
// one batch row like engine.js runBatch: per order and scenario
const row = (o, c, s, cost, cust, lead, opt = {}) => Object.assign({order_id: o, country: c, scenario: s, available: true, units: 10,
  cost_to_serve_eur: cost * 10, customer_pays_eur: cust * 10, lead_time_days: lead, hassle: {customer_first: opt.hassle ?? 1},
  flexitog_paperwork: 2, placeholder_cost_share: opt.ph ?? 1, route: {dc_status: opt.status || "candidate"}}, opt.row || {});
const stats = (rows, inc = true, goals = []) => F.countryStats(rows, {includeCandidates: inc, goals, dcs: []});
"""


def run(body: str):
    src = HELPERS + "(async () => {\n" + body + "\nconsole.log(JSON.stringify(out));\n})().catch(e => { console.error(e); process.exit(1); });"
    res = subprocess.run([NODE, "-e", src, str(ASSETS / "route_core.js")], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_best_scenario_target_first_then_cost_then_hassle():
    out = run("""
// TR target 3 working days. 3PL is cheaper but takes 10 days; distributor meets the target.
const a = stats([row(1, "TR", "3pl", 5, 0, 10), row(1, "TR", "distributor", 8, 1, 1), row(1, "TR", "owned_warehouse", 20, 0, 1),
                 row(1, "TR", "cif_baseline", 2, 0, 1, {status: ""})]);
// Both meet: the cheaper one (cost + customer pays) wins.
const b = stats([row(1, "TR", "3pl", 5, 1, 1), row(1, "TR", "distributor", 4, 1, 1)]);
// Same total to the cent: the lower hassle wins.
const c = stats([row(1, "TR", "3pl", 5, 1, 1, {hassle: 4}), row(1, "TR", "distributor", 5.001, 1, 1, {hassle: 2})]);
const out = {a: F.bestScenario(a).scenario, aMiss: F.bestScenario(a).missesTarget, b: F.bestScenario(b).scenario, c: F.bestScenario(c).scenario,
  baselineNeverBest: F.bestScenario(stats([row(1, "TR", "cif_baseline", 1, 0, 1)])).scenario};
""")
    assert out["a"] == "distributor" and out["aMiss"] is False
    assert out["b"] == "distributor"
    assert out["c"] == "distributor"
    assert out["baselineNeverBest"] is None


def test_best_scenario_misses_target_and_unserved_orders():
    out = run("""
// GCC target 2: both scenarios take 13 days. Cheapest wins, flagged.
const a = stats([row(1, "SA", "3pl", 8, 0, 13), row(1, "SA", "owned_warehouse", 18, 0, 13)]);
// 3PL meets the target where it serves, but misses order 2 entirely: it does not meet "every order".
const b = stats([row(1, "AE", "3pl", 3, 0, 1), row(2, "AE", "3pl", 3, 0, 1, {row: {available: false}}), row(1, "AE", "distributor", 6, 0, 1), row(2, "AE", "distributor", 6, 0, 1)]);
const out = {a: F.bestScenario(a), b: F.bestScenario(b).scenario};
""")
    assert out["a"]["scenario"] == "3pl" and out["a"]["missesTarget"] is True
    assert out["b"] == "distributor"


def test_best_scenario_switch_on_and_off():
    out = run("""
const rows = [row(1, "MA", "3pl", 5, 0, 1, {status: "candidate"}), row(1, "MA", "distributor", 9, 0, 1, {status: "existing"})];
const rowsCand = [row(1, "MA", "3pl", 5, 0, 1, {status: "candidate"})];
const out = {on: F.bestScenario(stats(rows, true), {includeCandidates: true}).scenario,
  off: F.bestScenario(stats(rows, false), {includeCandidates: false}).scenario,
  offFromAllRows: F.bestScenario(stats(rows, true), {includeCandidates: false}).scenario,
  onlyCand: F.bestScenario(stats(rowsCand, true), {includeCandidates: false}),
  nothing: F.bestScenario(stats([row(1, "MA", "3pl", 5, 0, 1, {row: {available: false, route: null}})]), {includeCandidates: true})};
""")
    assert out["on"] == "3pl"
    assert out["off"] == "distributor" and out["offFromAllRows"] == "distributor"
    assert out["onlyCand"]["scenario"] is None and out["onlyCand"]["reason"] == "candidates-only"
    assert out["nothing"]["scenario"] is None and out["nothing"]["reason"] == "no-partner"


def test_order_weighted_region_aggregation():
    out = run("""
// SA: 3 orders at 10/unit, AE: 1 order at 2/unit. Order-weighted: (3*10 + 1*2) / 4 = 8.
const rows = [1, 2, 3].map(o => row(o, "SA", "3pl", 10, 1, 13)).concat([row(4, "AE", "3pl", 2, 1, 1)]);
const cs = stats(rows), agg = F.combine(cs);
const out = {cost: agg["3pl"].costPerUnit, cust: agg["3pl"].custPerUnit, total: agg["3pl"].total, orders: agg["3pl"].orders, met: agg["3pl"].met,
  missing: agg["3pl"].missing, lead: agg["3pl"].leadWd, sa: cs.find(c => c.country === "SA").scenarios["3pl"].leadWd};
""")
    assert out["cost"] == pytest.approx(8.0) and out["cust"] == pytest.approx(1.0) and out["total"] == pytest.approx(9.0)
    assert out["orders"] == 4 and out["met"] == 1 and out["missing"] == 3
    assert out["lead"] == pytest.approx((3 * out["sa"] + 1 * 1.0) / 4)


def test_coverage_matrix_from_served_countries():
    out = run("""
const dcs = [{dc_id: "HLM", dc_type: "helmond_hub", status: "existing", country: "NL", serves_countries: "TR;SA"},
  {dc_id: "D1", dc_type: "distributor", status: "existing", country: "SA", serves_countries: "SA"},
  {dc_id: "P1", dc_type: "3pl", status: "candidate", country: "AE", serves_countries: "AE;SA;QA"},
  {dc_id: "P2", dc_type: "3pl", status: "existing", country: "QA", serves_countries: ""}];
const m = F.coverageMatrix(dcs, ["SA", "QA", "TR", "MA"]);
const out = Object.fromEntries(m.map(r => [r.country, r.cells]));
""")
    assert out["SA"] == {"cif_baseline": "signed", "distributor": "signed", "3pl": "candidate", "owned_warehouse": "none"}
    assert out["QA"]["3pl"] == "signed"            # the node's own country counts as served
    assert out["TR"]["distributor"] == "none" and out["TR"]["cif_baseline"] == "signed"
    assert out["MA"]["cif_baseline"] == "none"     # Helmond does not list MA in this test


def test_issue_split_keeps_no_coverage_issue_in_risks():
    out = run("""
const list = [{type: "coverage", severity: "warning", title: "No distributor option in Qatar"},
  {type: "duty", severity: "serious", title: "Duty 18% of order value in Egypt"}, {type: "briefing", severity: "critical", title: "Red Sea"},
  {type: "mov", severity: "info", title: "3PL misses 40% of orders"}];
const s = F.splitIssues(list);
const out = {risks: s.risks.map(i => i.title), coverage: s.coverage.length, counts: F.severityCounts(s.risks)};
""")
    assert out["risks"] == ["Red Sea", "Duty 18% of order value in Egypt", "3PL misses 40% of orders"]
    assert out["coverage"] == 1
    assert out["counts"] == {"critical": 1, "serious": 1, "info": 1}


def test_lane_rules_targets_and_working_days():
    out = run("""
const goals = [{name: "Next-day delivery", target: "1", unit: "working day", regions: ["Türkiye", "North Africa"]},
  {name: "Qatar express", target: "24", unit: "hours", regions: ["QA"]}];
const out = {lanes: F.LANES.map(l => [l.lane, l.country, l.target, l.weekend]), tr: F.targetFor("TR", goals), qa: F.targetFor("QA", goals), dz: F.targetFor("DZ", []),
  nl: F.targetFor("NL", []), wd: [F.workingDays(3, 1), F.workingDays(1, 1), F.workingDays(0, 7), F.workingDays(7, 7)],
  bands: [10, 30, 31, 100, 101, 500, 2000, 2001].map(F.bandFor), kg: F.grossKg([{sku: "A", quantity: 10}, {sku: "B", quantity: 2}], [{sku: "A", unit_weight_kg: 1.5}], 2),
  lane: [F.laneFor("SA"), F.laneFor("TN"), F.laneFor("NL")]};
""")
    assert out["lanes"] == [["L01", "SA", 2, 7], ["L02", "AE", 2, 1], ["L03", "KW", 2, 7], ["L04", "QA", 2, 7], ["L05", "TR", 3, 1],
                            ["L06", "MA", 3, 1], ["L07", "DZ", 5, 7], ["L08", "EG", 4, 7], ["L09", "TN", 4, 1]]
    assert out["tr"]["days"] == 3 and out["tr"]["source"] == "lane rules"    # region-level goal does not name the country
    assert out["qa"] == {"days": 1, "source": "service goal", "note": "Qatar express: 24 hours"}
    assert out["dz"]["days"] == 5 and out["nl"] is None
    assert out["wd"] == [2.4, 1, 0, 5]
    assert out["bands"] == ["B1", "B1", "B2", "B2", "B3", "B3", "B4", "B5"]
    assert out["kg"] == pytest.approx(15 + 40)
    assert out["lane"] == ["L01", "L09", None]


def test_rfq_adapter_reads_latest_response_and_falls_back():
    out = run("""
const providers = [{id: "PRV-0001", name: "Fwd", status: "response_received", latestResponseIndex: 1, rfqResponses: [
    {values: {"rate.L01.B1.cost_per_shipment": 999}},
    {values: {"rate.L01.B1.cost_per_shipment": 76.3, "rate.L01.B1.transit_days": 1, "rate.L01.B1.mode": "Express", "rate.L01.B2.cost_per_shipment": "",
              "stock.L02.serve_from_stock": "Yes", "stock.L02.transit_days": 1, "stock.L01.serve_from_stock": "No", "provider.currency": "EUR"},
     summary: {responseDate: "2026-11-02"}}]},
  {id: "PRV-0002", name: "No reply", rfqResponses: []}, {id: "PRV-0003", name: "Out", status: "rejected", latestResponseIndex: 0,
   rfqResponses: [{values: {"rate.L01.B1.cost_per_shipment": 10}}]}];
const A = F.rfqAdapter(() => providers);
const out = {hit: A.getRfqRate("PRV-0001", "L01", "B1"), blank: A.getRfqRate("PRV-0001", "L01", "B2"), none: A.getRfqRate("PRV-0002", "L01", "B1"),
  unknown: A.getRfqRate("PRV-9999", "L01", "B1"), noLane: A.getRfqRate("PRV-0001", null, "B1"),
  stock: A.getRfqStock("PRV-0001", "L02"), stockNo: A.getRfqStock("PRV-0001", "L01"), quotes: A.quotes("L01", "B1").map(q => q.providerId)};
""")
    assert out["hit"]["source"] == "rfq" and out["hit"]["costPerShipment"] == 76.3 and out["hit"]["transitDays"] == 1
    assert out["hit"]["responseDate"] == "2026-11-02"        # the latest response, not the first
    for k in ("blank", "none", "unknown", "noLane", "stockNo"):
        assert out[k] == {"source": "placeholder"}, k
    assert out["stock"]["source"] == "rfq" and out["stock"]["transitDays"] == 1
    assert out["quotes"] == ["PRV-0001"]                    # rejected providers left out
