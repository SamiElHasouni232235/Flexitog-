"""Sales forecast (assets/forecast_core.js): Odoo cleaning rules, validation totals, the four methods,
the back-test and the demand object the route engine reads. Runs the browser module in node.

The validation test against your Excel analytics needs the real export at
workspace/Official_Sales_Orders_MENA_Turkey.xlsx (git ignores workspace/) and skips without it. The
anonymized sample in assets/data/ has perturbed prices, so its revenue figures differ; its counts match.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from flexitog.dashboard import ASSETS
from flexitog.sales_orders import REAL, SAMPLE, sales_orders_table

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
CORE = str(ASSETS / "forecast_core.js")
ROOT = Path(__file__).resolve().parent.parent


def run(body: str, data=None, tmp_path=None):
    """Run JS with F (ForecastCore) and D (data) in scope; prints `out` as JSON."""
    src = ("const F = require(process.argv[1]); const D = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));\n"
           + body + "\nconsole.log(JSON.stringify(out));")
    path = tmp_path / "data.json"
    path.write_text(json.dumps(data if data is not None else {}), encoding="utf-8")
    res = subprocess.run([NODE, "-e", src, CORE, str(path)], capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


VALIDATE = """const {lines, report} = F.clean(F.fromTable(D.headers, D.rows));
const v = F.validation(lines, {asOf: '2026-10-02'});
const out = {report, v};"""


def line(ref="SO-1", created="2026-01-10T10:00:00", entity="Acme", customer="Acme", country="Saudi Arabia", name="Freezer Jacket",
         cat="Clothing", qty=10, uom="Units", tax=0, total=1000, cur="EUR", company="FlexiTog EU", city="Jeddah"):
    return [created, company, entity, customer, country, city, ref, name, cat, qty, uom, tax, total, cur]


HEADERS = ["Order Lines/" + h for h in ["Created on", "Company", "Customer/Company Name Entity", "Customer", "Customer/Country", "Customer/City",
                                        "Order Reference", "Product/Name", "Product Template/Category", "Quantity", "Unit of Measure",
                                        "Total Tax", "Total", "Currency"]]


# ------------------------------------------------------------------ step 3: validation
def test_sample_counts_and_totals(tmp_path):
    out = run(VALIDATE, data=sales_orders_table(SAMPLE), tmp_path=tmp_path)
    v, r = out["v"], out["report"]
    assert (v["orders"], v["order_lines"], v["customers"], v["countries"]) == (79, 464, 32, 9)
    assert r["rows"] == 472 and r["blank_lines"] == 8 and r["goods_lines"] == 413 and r["freight_lines"] == 51
    # The export's one row without Order Reference is empty, so it never reaches the rule.
    # Sample totals (perturbed prices): pinned so a rule change shows up.
    assert v["net_revenue"] == pytest.approx(521300.53, abs=1)
    assert v["by_country"]["Saudi Arabia"] == pytest.approx(321314.99, abs=1)
    assert v["last12"] == pytest.approx(504797.70, abs=1)
    assert v["goods_revenue"] + v["freight_revenue"] == pytest.approx(v["net_revenue"])


@pytest.mark.skipif(not (ROOT / REAL).exists(), reason="real export not in workspace/")
def test_real_export_matches_excel_analytics(tmp_path):
    out = run(VALIDATE, data=sales_orders_table(ROOT / REAL), tmp_path=tmp_path)
    v = out["v"]
    assert round(v["net_revenue"]) == 529622
    assert (v["orders"], v["order_lines"], v["customers"], v["countries"]) == (79, 464, 32, 9)
    assert round(v["by_country"]["Saudi Arabia"]) == 315959
    assert round(v["last12"]) == 513857


def test_python_table_keeps_the_forecast_columns():
    t = sales_orders_table()
    assert t["anonymized"] and t["source"] == SAMPLE.name and len(t["rows"]) == 473
    assert t["headers"][0] == "Created on" and len(t["rows"][0]) == len(t["headers"])
    assert t["rows"][0][0] == "2026-09-29T15:29:00"


# ------------------------------------------------------------------ step 2: rules
def test_cleaning_rules(tmp_path):
    rows = [
        line(ref="SO-1", created="2026-01-10T10:00:00", entity="Horizon Trading (EU)", total=1200, tax=200, cur="GBP"),
        line(ref="SO-1", created="2026-01-09T08:00:00", entity="", customer="Horizon Trading", name="Delivery DHL - ROW", total=50),
        line(ref="SO-1", name=None, cat=None, total=None),                                    # blank: ignored
        line(ref=None, total=999),                                                              # no reference: skipped
        line(ref="SO-2", created="2026-02-01T00:00:00", entity="Turk Hava Yollan Teknik AS", country="Turkey", name="Thermal Gloves",
             cat="Gloves", qty=3, uom="Pack of 10", total=300, cur="USD"),
        line(ref="SO-3", created=46100.5, entity="X", name="UPS SAVER", cat="Clothing", total=20),   # Excel serial date
        line(ref="SO-4", entity="Y", name="Fee", cat="Service", total=15),
    ]
    out = run("""const {lines, report} = F.clean(F.fromTable(D.h, D.r));
      const out = {report, lines: lines.map(l => ({o: l.order, c: l.customer, t: l.type, k: l.product_class, u: l.units, net: l.net, rep: l.net_rep, d: l.date, ctry: l.country}))};""",
              data={"h": HEADERS, "r": rows}, tmp_path=tmp_path)
    r, ls = out["report"], out["lines"]
    assert r["no_reference"] == 1 and r["blank_lines"] == 1 and r["lines"] == 5
    a, b, c, d, e = ls
    assert a["c"] == b["c"] == "Horizon Trading"                       # (EU) stripped, fallback to Customer
    assert a["net"] == 1000 and a["rep"] == pytest.approx(1000 * 1.1555 / 0.8607)   # Total - Tax, GBP -> USD
    assert a["d"] == b["d"] == "2026-01-09"                             # earliest Created on of the order
    assert a["t"] == "goods" and a["k"] == "Jackets" and b["t"] == "freight"
    assert c["c"] == "Turkish Airlines Technic" and c["u"] == 30 and c["k"] == "Gloves" and c["ctry"] == "TR"
    assert c["rep"] == pytest.approx(300)                               # USD stays USD
    assert d["t"] == "freight" and d["d"] == "2026-03-19" and e["t"] == "freight"


def test_product_class_order(tmp_path):
    names = [("Freezer Coverall with jacket hood", "Clothing"), ("Bib Overall", "Clothing"), ("Long John Trousers", "Clothing"),
             ("Thermal Baselayer top", "Clothing"), ("Salopette", "Clothing"), ("Bodywarmer Vest", "Clothing"), ("Parka Coat", "Clothing"),
             ("PU Coated Glove", "Gloves"), ("Freezer Boot", "Footwear"), ("Thermal Hat", "Headwear"), ("Safety Accessory", "Accessories"),
             ("Drying Cabinet", "Drying cabinets"), ("Workwear Item", "Clothing"), ("Something", None)]
    out = run("const out = D.map(([n, c]) => F.productClass(n, c));", data=names, tmp_path=tmp_path)
    assert out == ["Coveralls", "Coveralls", "Baselayers", "Baselayers", "Trousers", "Jackets", "Jackets", "Gloves", "Footwear",
                   "Headwear", "Accessories", "Drying cabinets", "Other clothing", "Other clothing"]


def test_aggregation_by_month_country_class(tmp_path):
    out = run(VALIDATE + "\nout.agg = F.aggregate(lines); out.goods = lines.filter(l => l.type === 'goods').reduce((a, l) => a + l.net_rep, 0);",
              data=sales_orders_table(SAMPLE), tmp_path=tmp_path)
    g, f = out["agg"]["goods"], out["agg"]["freight"]
    assert sum(x["revenue"] for x in g) == pytest.approx(out["goods"])
    assert sum(x["revenue"] for x in f) == pytest.approx(out["v"]["freight_revenue"])
    assert all(x["product_class"] == "Freight" for x in f)
    assert len({(x["month"], x["country"], x["product_class"]) for x in g}) == len(g)


# ------------------------------------------------------------------ step 4: methods on controlled data
def synthetic(months, per_country):
    """Clean lines: per_country {country: [monthly goods value]} from months[0]; one order per month and country."""
    rows = []
    for c, vals in per_country.items():
        for i, v in enumerate(vals):
            if v:
                rows.append(line(ref=f"{c}-{i}", created=f"{months[i]}-10T10:00:00", entity=f"Cust {c}", country=c, total=v))
    return {"h": HEADERS, "r": rows}


MONTHS = [f"2025-{m:02d}" for m in range(7, 13)] + [f"2026-{m:02d}" for m in range(1, 10)]   # Jul 2025 - Sep 2026, 15 months


def test_run_rate_and_project_cap(tmp_path):
    vals = [1000] * 15
    vals[10] = 50000                                                     # one project order
    out = run("""const {lines} = F.clean(F.fromTable(D.h, D.r), {fx: {EUR: 1}, reporting: 'EUR'});
      const H = F.history(lines, {capPercentile: 95}), H2 = F.history(lines, {includeProjects: true});
      const m = F.monthRange('2027-01', '2027-12');
      const out = {cap: H.cap, rr: F.runRate(H, m).MA, rr2: F.runRate(H2, m).MA, proj: H.projectSeries.MA.reduce((a, b) => a + b, 0)};""",
              data=synthetic(MONTHS, {"Morocco": vals}), tmp_path=tmp_path)
    cap = out["cap"]
    assert 1000 < cap < 50000
    assert out["proj"] == pytest.approx(50000 - cap)
    assert out["rr"][0] == pytest.approx((11 * 1000 + cap) / 12)       # trailing 12 months, capped
    assert out["rr2"][0] == pytest.approx((11 * 1000 + 50000) / 12)
    assert len(set(round(x, 6) for x in out["rr"])) == 1                # flat


def test_holt_matches_hand_calculation(tmp_path):
    y = [10, 12, 14, 13, 17, 19, 21, 20, 24, 26]
    out = run("const out = F.holtFit(D, 0.5, 0.3);", data=y, tmp_path=tmp_path)
    level, trend = sum(y[:3]) / 3, 0.0
    for v in y:
        prev = level
        level = 0.5 * v + 0.5 * (level + trend)
        trend = 0.3 * (level - prev) + 0.7 * trend
    assert out["level"] == pytest.approx(level) and out["trend"] == pytest.approx(trend)
    assert out["trend"] > 0


def test_holt_forecast_horizon_and_floor(tmp_path):
    out = run("""const {lines} = F.clean(F.fromTable(D.h, D.r), {fx: {EUR: 1}, reporting: 'EUR'});
      const H = F.history(lines, {includeProjects: true});
      const f = F.holt(H, ['2026-10', '2027-01'], 0.4, 0.2), fit = F.holtFit(H.series.QA, 0.4, 0.2), fall = F.holt(H, ['2030-01'], 0.4, 0.9);
      const out = {f: f.QA, fit, fall: fall.KW, months: H.months};""",
              data=synthetic(MONTHS, {"Qatar": [1000 + 100 * i for i in range(15)], "Kuwait": [5000 - 330 * i for i in range(15)]}), tmp_path=tmp_path)
    assert out["months"][-1] == "2026-09"
    assert out["f"][0] == pytest.approx(out["fit"]["level"] + out["fit"]["trend"])
    assert out["f"][1] == pytest.approx(out["fit"]["level"] + 4 * out["fit"]["trend"])
    assert out["fall"][0] == 0                                           # a falling trend stops at zero


def test_customer_driven_intervals_and_new_customers(tmp_path):
    rows = []
    for i, m in enumerate(["2025-10", "2026-01", "2026-04", "2026-07"]):   # every ~3 months, 4 orders of 2,000
        rows.append(line(ref=f"A{i}", created=f"{m}-01T00:00:00", entity="Quarterly Co", country="Kuwait", total=2000))
    rows.append(line(ref="B0", created="2024-01-15T09:00:00", entity="Gone Co", country="Kuwait", total=9000))
    rows.append(line(ref="C0", created="2026-09-01T09:00:00", entity="New Co", country="Qatar", total=600))
    out = run("""const {lines} = F.clean(F.fromTable(D.h, D.r), {fx: {EUR: 1}, reporting: 'EUR'});
      const H = F.history(lines, {includeProjects: true}), m = F.monthRange('2027-01', '2027-12');
      const r = F.customerDriven(H, m, {QA: 1}), r0 = F.customerDriven(H, m, {});
      const out = {cust: r.customers, kw: r.out.KW, qa: r.out.QA, qa0: r0.out.QA, medFirst: r.median_first_order, medInt: r.median_interval};""",
              data={"h": HEADERS, "r": rows}, tmp_path=tmp_path)
    by = {c["customer"]: c for c in out["cust"]}
    q = by["Quarterly Co"]
    assert q["interval"] == pytest.approx((pd_days("2025-10-01", "2026-10-01")) / 4)
    assert not q["lapsed"] and by["Gone Co"]["lapsed"]
    assert sum(out["kw"]) == pytest.approx(q["expected"] * 2000) and q["expected"] == 4
    assert out["medFirst"] == pytest.approx(2000)                        # median of 2,000, 9,000 and 600 first orders
    assert sum(out["qa"]) > sum(out["qa0"])                              # new customers add revenue
    assert out["qa"][1] - out["qa0"][1] == pytest.approx(2000)          # first new order mid-February


def pd_days(a, b):
    from datetime import date
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def test_target_allocation_and_scenarios(tmp_path):
    out = run("""const {lines} = F.clean(F.fromTable(D.headers, D.rows));
      const all = {};
      F.METHODS.forEach(([m]) => { const f = F.forecast(lines, {method: m}); all[m] = {totals: f.totals, band: f.band, ind: f.indicative, target: f.target}; });
      const t = F.forecast(lines, {method: 'target', weights: {SA: 3, TR: 1}});
      const out = {all, user: Object.fromEntries(Object.entries(t.scenarios.Base).map(([c, a]) => [c, a.reduce((x, y) => x + y, 0)])), userNet: t.totals.Base.net,
                   up: F.forecast(lines, {method: 'runrate', upliftPct: 10}).totals.Base.goods};""",
              data=sales_orders_table(SAMPLE), tmp_path=tmp_path)
    a = out["all"]
    assert a["target"]["totals"]["Base"]["net"] == pytest.approx(2400000)
    assert a["target"]["totals"]["Low"]["net"] == pytest.approx(2300000) and a["target"]["totals"]["High"]["net"] == pytest.approx(2500000)
    for m in ("runrate", "holt", "customer"):
        t = a[m]["totals"]
        assert t["Target"]["net"] == pytest.approx(2400000)
        assert t["Low"]["goods"] == pytest.approx(t["Base"]["goods"] * (1 - a[m]["band"]))
        assert t["High"]["goods"] == pytest.approx(t["Base"]["goods"] * (1 + a[m]["band"]))
        assert 0.10 <= a[m]["band"] <= 0.50
    assert out["userNet"] == pytest.approx(2400000)
    assert set(out["user"]) == {"SA", "TR"} and out["user"]["SA"] / out["user"]["TR"] > 2.9   # 3:1 before freight ratios
    assert out["up"] == pytest.approx(a["runrate"]["totals"]["Base"]["goods"] * 1.1)


# ------------------------------------------------------------------ step 5: back-test
def test_backtest_wape(tmp_path):
    vals = [1000] * 12 + [1300, 700, 1000]                                # hold-out Jul-Sep 2026
    out = run("""const {lines} = F.clean(F.fromTable(D.h, D.r), {fx: {EUR: 1}, reporting: 'EUR'});
      const out = F.backtest(lines, {includeProjects: true, alpha: 0.3, beta: 0.1});""",
              data=synthetic(MONTHS, {"Egypt": vals}), tmp_path=tmp_path)
    assert out["months"] == ["2026-07", "2026-08", "2026-09"] and out["fit_to"] == "2026-06"
    assert out["wape"]["runrate"] == pytest.approx((300 + 300 + 0) / 3000)   # run rate 1,000 a month
    assert out["wape"]["holt"] == pytest.approx(0.2, abs=1e-9)                # flat history: Holt = 1,000 too
    assert out["wape"]["target"] is None


def test_sample_backtest_is_indicative(tmp_path):
    out = run("""const {lines} = F.clean(F.fromTable(D.headers, D.rows));
      const bt = F.backtest(lines), f = F.forecast(lines, {method: 'holt', backtest: bt});
      const out = {bt, ind: f.indicative};""", data=sales_orders_table(SAMPLE), tmp_path=tmp_path)
    w = out["bt"]["wape"]
    assert all(w[m] is not None and w[m] > 0.40 for m in ("runrate", "holt", "customer"))
    assert out["ind"]


# ------------------------------------------------------------------ step 4 output and step 6: demand object
def test_demand_object_units_orders_and_batch(tmp_path):
    out = run("""const {lines} = F.clean(F.fromTable(D.headers, D.rows));
      const f = F.forecast(lines, {method: 'runrate'}), rows = F.demand(f, 'Base', 0.8607);
      const prof = {}; F.CLASSES.forEach(k => { prof[k] = {sku: 'SKU-' + k, units_per_pallet: 100}; });
      const batch = F.forecastBatch(rows, prof, {cities: {SA: 'Jeddah'}});
      const dcs = [{dc_id: 'OWN-AE', dc_type: 'owned_warehouse', country: 'AE', serves_countries: 'AE;SA'}, {dc_id: '3PL-X', dc_type: '3pl', country: 'TR', serves_countries: ''}];
      const vol = F.volumes(batch, dcs, 12);
      const H = f.H, sa = rows.filter(r => r.country === 'SA' && r.product_class === 'Jackets');
      const out = {rows: rows.length, rev: rows.reduce((a, r) => a + r.revenue, 0), goods: f.totals.Base.goods,
        orders: rows.reduce((a, r) => a + r.orders, 0), months: [...new Set(rows.map(r => r.month))].length,
        priceOk: sa.every(r => Math.abs(r.revenue / r.units - H.unitPrice('SA', 'Jackets')) < 1e-6),
        eur: rows.every(r => Math.abs(r.revenue_eur - r.revenue * 0.8607) < 1e-6),
        keys: Object.keys(rows[0]).sort(), batchOrders: batch.orders.length, batchLines: batch.lines.length,
        perCountryRows: Object.fromEntries([...new Set(rows.map(r => r.country))].map(c => [c, rows.filter(r => r.country === c).reduce((a, r) => a + r.orders, 0)])),
        perCountryBatch: batch.orders.reduce((a, o) => { const c = o.customer_id.slice(3); a[c] = (a[c] || 0) + 1; return a; }, {}),
        valueOk: Math.abs(batch.lines.reduce((a, l) => a + l.quantity * l.unit_price_eur, 0) - rows.reduce((a, r) => a + r.revenue_eur, 0)) / rows.reduce((a, r) => a + r.revenue_eur, 0),
        vol, saCity: batch.customers.find(c => c.country === 'SA').city};""", data=sales_orders_table(SAMPLE), tmp_path=tmp_path)
    assert out["rev"] == pytest.approx(out["goods"])
    assert out["months"] == 12 and out["priceOk"] and out["eur"]
    assert out["keys"] == sorted(["month", "country", "product_class", "units", "orders", "revenue", "revenue_eur", "lines", "shipments"])
    for c, n in out["perCountryRows"].items():                           # yearly orders survive rounding per country
        assert abs(out["perCountryBatch"].get(c, 0) - n) <= 1
    assert out["valueOk"] < 0.05                                         # unit rounding keeps value within 5%
    v = out["vol"]
    assert sum(v["shipments_per_year"].values()) == out["batchOrders"]
    assert v["owned_pallets_per_year"]["AE"] == v["pallets_per_country"].get("AE", 0) + v["pallets_per_country"].get("SA", 0)
    assert v["node_load_pallets"]["OWN-AE"] == pytest.approx(v["owned_pallets_per_year"]["AE"] / 12)
    assert out["saCity"] == "Jeddah"
