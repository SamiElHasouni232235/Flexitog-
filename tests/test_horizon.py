"""Time horizon (assets/horizon_core.js) and volume cases (assets/cases_core.js), run in node on the dummy provider.

Year 1 of the horizon books the one-off costs in full (3PL onboarding W16 + W17, own-site setup and licences); the
single-year view in test_rfq_v30.py amortises them. Settings are Prompt 3 Test 1's.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from flexitog.dashboard import ASSETS, RFQ_V30_TEMPLATE, rfq_sources

FIX = Path(__file__).parent / "fixtures"
DUMMY = FIX / "rfq_v30_dummy_reconstructed.xlsx"
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
T1 = {"s2": {"L01": {"on": True, "loads": {"C20": 2, "P5": 4}}}, "s3": {"provider": "P", "warehouse": "A", "avgPallets": 20},
      "s4": {"sites": [{"country": "L02", "customs": "Free zone", "m2": 500, "rentPerM2": 100, "fte": 2, "costPerFte": 30000, "setup": 60000,
                        "amortYears": 3, "equipmentMonth": 500, "wmsMonth": 300, "insuranceYear": 10000, "proxyProvider": "P", "proxyWarehouse": "A"}]}}


def run(body, tmp_path):
    src = tmp_path / "src.json"
    src.write_text(json.dumps(rfq_sources(RFQ_V30_TEMPLATE)))
    js = tmp_path / "t.js"
    js.write_text(f"""const X = require({json.dumps(str(ASSETS / "vendor" / "xlsx.full.min.js"))}), R = require({json.dumps(str(ASSETS / "rfq_core.js"))});
const V = require({json.dumps(str(ASSETS / "rfq_v30.js"))}), C = require({json.dumps(str(ASSETS / "cases_core.js"))}), H = require({json.dumps(str(ASSETS / "horizon_core.js"))}), fs = require('fs');
const Q = V.quote(V.valuesOf(R.parseWorkbook(X.read(fs.readFileSync({json.dumps(str(DUMMY))}), {{cellDates: true}}), X, {{sources: JSON.parse(fs.readFileSync({json.dumps(str(src))}, 'utf8'))}})));
const list = [{{id: 'P', name: 'Dummy provider', Q}}], S = {json.dumps(T1)}, cases = C.seed(S, {{today: '2026-11-10'}}), A = cases[0];
const r0 = x => (x == null ? null : Math.round(x * 100) / 100);
let out = null; {body}
process.stdout.write(JSON.stringify(out));""")
    r = subprocess.run(["node", str(js)], capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_year_one_s1_to_s4_dummy(tmp_path):
    r = run("""const h = H.run(list, S, A, {years: 1, setting: 'low'}), y = h.years[0];
  out = {year: y.year, orders: y.orders, kg: r0(y.kg), cost: Object.fromEntries(['S1', 'S2', 'S3', 'S4'].map(k => [k, r0(y.scen[k].cost)])),
    oneOff: Object.fromEntries(['S3', 'S4'].map(k => [k, y.scen[k].oneOff])), floor: y.scen.S3.floor, cheapest: y.cheapest};""", tmp_path)
    assert r["year"] == 2027 and r["orders"] == 141 and r["kg"] == 25835
    # S1 and S2 as in the single-year view; S3 and S4 book the one-off in year 1 instead of a third of it
    assert r["cost"] == {"S1": 97000, "S2": 56800, "S3": 101210, "S4": 268310}   # 98,210 - 1,500 + 4,500 and 228,310 - 20,000 + 60,000
    assert r["oneOff"] == {"S3": 4500, "S4": 60000}
    assert r["floor"] == 18000 and r["cheapest"] == "S2"


def test_zero_escalation_constant_volume(tmp_path):
    r = run("""const h = H.run(list, S, A, {years: 5, setting: 'low'});
  out = h.years.map(y => Object.fromEntries(['S1', 'S2', 'S3', 'S4'].map(k => [k, [r0(y.scen[k].recurring), r0(y.scen[k].cost)]])));""", tmp_path)
    for k in ("S1", "S2", "S3", "S4"):
        assert len({y[k][0] for y in r}) == 1, k                # recurring cost the same every year
        assert len({y[k][1] for y in r[1:]}) == 1, k            # total the same from year 2 (the one-off sits in year 1)
    assert r[1]["S3"][1] == 96710 and r[1]["S4"][1] == 208310


def test_escalation_formula(tmp_path):
    r = run("""const h = H.run(list, S, A, {years: 3, setting: 'base'});
  out = {s1: h.years.map(y => r0(y.scen.S1.cost)), rates: h.rates};""", tmp_path)
    assert r["rates"] == {"freight": 3, "fuel": 2, "warehouse": 3, "eurusd": 0}
    # S1 is direct freight: base x (1 + 3%)^(y - 1) x (1 + 2%)^(y - 1)
    assert r["s1"] == [97000, pytest.approx(97000 * 1.03 * 1.02, abs=0.01), pytest.approx(97000 * (1.03 * 1.02) ** 2, abs=0.01)]


def test_growth_path_orders_and_kg(tmp_path):
    r = run("""const g = Object.assign(C.blank(S), {method: 'growth', inputs: {growth: [50, 25, 10]}, years: 3});
  out = C.years(g, S, 3).map(y => [y.year, y.orders, y.kg, y.extrapolated]);""", tmp_path)
    base_orders, kg_per_order = 70.5, 25835 / 141
    exp = [base_orders * 1.5, base_orders * 1.5 * 1.25, base_orders * 1.5 * 1.25 * 1.1]
    for (year, orders, kg, ext), e, y in zip(r, exp, (2027, 2028, 2029)):
        assert year == y and orders == pytest.approx(e) and kg == pytest.approx(e * kg_per_order) and not ext


def test_extrapolated_years_and_end_goal(tmp_path):
    r = run("""const two = Object.assign(C.blank(S), {method: 'growth', inputs: {growth: [50, 20]}, years: 2});
  const ys = C.years(two, S, 4), E = C.years(cases[4], S, 5);
  out = {orders: ys.map(y => y.orders), ext: ys.map(y => y.extrapolated), e5: E[4].revenueUsd, eYear: E[4].year};""", tmp_path)
    assert r["ext"] == [False, False, True, True]                         # past the case's 2 years
    assert r["orders"][2] == pytest.approx(r["orders"][1] * 1.2) and r["orders"][3] == pytest.approx(r["orders"][1] * 1.2 ** 2)   # last growth rate
    assert r["eYear"] == 2031 and r["e5"] == pytest.approx(5000000 / 0.8607, rel=1e-9)   # CAGR reaches EUR 5 million in year 5


def test_switch_point_and_recommendation(tmp_path):
    r = run("""const h = H.run(list, S, A, {years: 3, setting: 'low'});
  const grow = Object.assign(C.duplicate(A), {inputs: {multiplier: 2, growth: [0, 60, 60, 60, 60]}}), hg = H.run(list, S, grow, {years: 5, setting: 'low'});
  out = {sp: h.switchPoints, rec: h.recommended, gsp: hg.switchPoints, gS4: hg.years.map(y => [r0(y.scen.S1.cost), r0(y.scen.S4.cost)])};""", tmp_path)
    assert r["sp"]["S2"]["year"] == 2027 and r["sp"]["S3"]["year"] == 2028 and r["sp"]["S3"]["orders"] == 141   # S3 beats S1 once the one-off is paid
    assert r["rec"]["id"] == "S3" and "48 hours" in r["rec"]["reason"]   # S1 takes 3 days, S2 has no distributor lead time
    s4 = r["gsp"]["S4"]
    if s4 and s4["within"]:
        y = s4["i"] - 1
        assert r["gS4"][y][1] < r["gS4"][y][0] and all(a <= b for b, a in [(x[1], x[0]) for x in r["gS4"][:y]])


def test_distributor_terms_and_default_margin(tmp_path):
    r = run("""const S2 = Object.assign({}, S, {s2: {L01: {on: true, loads: {C20: 2, P5: 4}, distributor: 'D1'}},
    distributors: [{id: 'D1', name: 'Gulf Distribution', country: 'L01', marginPct: 25, leadDays: 2, status: 'interested'}]});
  const with_ = V.scenarios(list, S2, 'A'), without = V.scenarios(list, S, 'A');
  const v = V.revenueView(with_, null, S2), v0 = V.revenueView(without, {discount: {L01: 10}}, S);
  out = {cost: [with_.S2.total, without.S2.total], names: with_.S2.distributorNames, flag: without.S2.tags.includes('no distributor data'),
    capWith: with_.S2.capability.label, capWithout: without.S2.capability.label, net: v.scenarios.S2.countries.L01.netUsd / v.scenarios.S2.countries.L01.usd, net0: v0.scenarios.S2.countries.L01.netUsd / v0.scenarios.S2.countries.L01.usd};""", tmp_path)
    assert r["cost"] == [56800, 56800]                 # the margin is on the revenue side: the S2 cost does not move
    assert r["names"] == ["Gulf Distribution"] and r["flag"]
    assert r["net"] == pytest.approx(0.75) and r["net0"] == pytest.approx(0.90)   # distributor terms, else the default margin per country
    # Saudi Arabia by the distributor in 2 days; UAE, Kuwait and Qatar still ship direct from Helmond in 3 days
    assert r["capWith"] == "3 days" and r["capWithout"] == "unconfirmed"   # no distributor: no lead time


def test_horizon_without_revenue(tmp_path):
    r = run("""const h = H.run(list, S, A, {years: 2, setting: 'low'});
  out = {rev: h.years.map(y => y.scen.S1.revenue)};""", tmp_path)
    assert r["rev"] == [None, None]   # revenue is only computed when the revenue toggle asks for it
