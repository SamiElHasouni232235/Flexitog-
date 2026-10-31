"""Benchmarking logic (assets/bench_core.js): sales cleaning, seasonality, test order generator and
the provider response template. Runs the browser module in node."""
import json
import shutil
import subprocess

import pytest

from flexitog.dashboard import ASSETS, build_payload
from flexitog.store import Workspace

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
CORE = str(ASSETS / "bench_core.js")
XLSX = str(ASSETS / "vendor" / "xlsx.full.min.js")


def run(body: str, data=None, tmp_path=None):
    """Run JS with B (BenchCore) and D (data) in scope; the script's last value is `out`."""
    src = "const B = require(process.argv[1]); const D = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));\n"
    src += body + "\nconsole.log(JSON.stringify(out));"
    path = tmp_path / "data.json"
    path.write_text(json.dumps(data or {}), encoding="utf-8")
    res = subprocess.run([NODE, "-e", src, CORE, str(path), XLSX], capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


@pytest.fixture(scope="module")
def demo(tmp_path_factory):
    """The built-in sales history mapped the way the dashboard maps it."""
    p = build_payload(Workspace(tmp_path_factory.mktemp("ws") / "ws"))
    d = p["data"]
    return {
        "raw": [{"order_date": s["order_date"], "order_number": s["order_id"], "customer": s["customer_id"], "destination_country": s["country"],
                 "sku": s["sku"], "quantity": s["quantity"], "order_value": s["net_value_eur"], "currency": "EUR", "pallets": s["pallets"],
                 "incoterm": s["incoterm"]} for s in d["sales_history"]],
        "sku": {x["sku"]: {"description": x["description"], "category": x["product_family"], "brand": x["brand"],
                           "unit_weight_kg": x["unit_weight_kg"], "units_per_pallet": x["units_per_pallet"]} for x in d["products"]},
        "region": d["country_region"],
        "names": {c["customer_id"]: c["name"] for c in d["customers"]},
    }


CLEAN_DEMO = "const {lines, report} = B.cleanSales(D.raw, {source: 'demo', skuInfo: D.sku, regionOf: c => D.region[c] || 'Other'});\n"


# ------------------------------------------------------------------ parsing and cleaning
def test_parse_dates_and_numbers(tmp_path):
    out = run("""const out = {
      iso: B.parseDate('2024-03-07'), isoTime: B.parseDate('2024-03-07T00:00:00.000'), dayFirst: B.parseDate('07-03-2024'),
      monthFirst: B.parseDate('03/27/2024'), short: B.parseDate('7.3.24'), serial: B.parseDate(45358), bad: B.parseDate('31-02-2024'),
      empty: B.parseDate(''), comma: B.parseNumber('1.250,50', ','), dot: B.parseNumber('1,250.50', '.'), neg: B.parseNumber('(12)', '.'),
      eur: B.parseNumber('€ 99', '.'), detect: B.detectDecimal(['1.250,50', '12,5', '3']), detectDot: B.detectDecimal(['1,250.50', '0.5'])};""",
              tmp_path=tmp_path)
    assert out == {"iso": "2024-03-07", "isoTime": "2024-03-07", "dayFirst": "2024-03-07", "monthFirst": "2024-03-27", "short": "2024-03-07",
                   "serial": "2024-03-07", "bad": None, "empty": None, "comma": 1250.5, "dot": 1250.5, "neg": -12, "eur": 99,
                   "detect": ",", "detectDot": "."}


def test_garment_category_from_text(tmp_path):
    out = run("const out = ['Freezer jacket', 'Insulated vest', 'Jassen', 'Bib trousers', 'Broeken', 'Overalls', 'Freezer suit one-piece', 'Thermal socks', '']"
              ".map(t => B.categoryOf(t));", tmp_path=tmp_path)
    assert out == ["jackets", "jackets", "jackets", "trousers", "trousers", "coveralls", "coveralls", "other", "other"]


def test_column_mapping_guesses_dutch_and_english_headers(tmp_path):
    out = run("""const out = [
      B.guessMapping(['Orderdatum', 'Ordernummer', 'Klantnaam', 'Land', 'Artikel', 'Omschrijving', 'Artikelgroep', 'Merk', 'Aantal', 'Bedrag', 'Valuta']),
      B.guessMapping(['Invoice date', 'Sales order', 'Customer name', 'Ship-to country', 'Item no', 'Qty', 'Net amount', 'Currency code', 'Gross weight']),
      B.headerRow([['Sales export 2024'], [], ['Date', 'Order', 'Customer', 'Country', 'Qty', 'Value'], ['2024-01-01', 'A1', 'X', 'TR', 5, 10]])];""",
              tmp_path=tmp_path)
    nl, en, head = out
    assert nl == {"order_date": 0, "order_number": 1, "customer": 2, "destination_country": 3, "sku": 4, "description": 5, "category": 6,
                  "brand": 7, "quantity": 8, "order_value": 9, "currency": 10}
    assert {k: en[k] for k in ("order_date", "order_number", "customer", "quantity", "order_value", "currency", "weight_kg")} == \
        {"order_date": 0, "order_number": 1, "customer": 2, "quantity": 5, "order_value": 6, "currency": 7, "weight_kg": 8}
    assert head == 2


def test_cleaning_drops_rows_with_reasons_and_removes_duplicates(tmp_path):
    raw = [
        {"order_date": "03-01-2024", "order_number": "A1", "customer": "K1", "destination_country": "KW", "sku": "J", "quantity": "120", "order_value": "16.680,00", "currency": "EUR"},
        {"order_date": "03-01-2024", "order_number": "A1", "customer": "K1", "destination_country": "KW", "sku": "J", "quantity": "120", "order_value": "16.680,00", "currency": "EUR"},
        {"order_date": "", "order_number": "A2", "customer": "K1", "destination_country": "KW", "quantity": "5", "order_value": "1"},
        {"order_date": "not a date", "order_number": "A3", "customer": "K1", "destination_country": "KW", "quantity": "5", "order_value": "1"},
        {"order_date": "2024-02-01", "order_number": "", "customer": "K1", "destination_country": "KW", "quantity": "5", "order_value": "1"},
        {"order_date": "2024-02-01", "order_number": "A5", "customer": "K1", "destination_country": "KW", "quantity": "0", "order_value": "1"},
        {"order_date": "2024-02-01", "order_number": "A6", "customer": "K1", "destination_country": "", "quantity": "5", "order_value": "1"},
        {"order_date": "2024-07-20", "order_number": "A7", "customer": "K2", "destination_country": "SA", "quantity": "300", "order_value": "45.000,00", "currency": "USD"},
        {"order_date": "2024-07-21", "order_number": "A8", "customer": "K3", "destination_country": "DE", "quantity": "10", "order_value": "1.000,00", "currency": "XYZ"},
    ]
    out = run("const r = B.cleanSales(D, {fx: {USD: 0.9}, regionOf: c => ({KW: 'Gulf/GCC', SA: 'Gulf/GCC'})[c] || 'EU'}); const out = r;",
              data=raw, tmp_path=tmp_path)
    rep, lines = out["report"], out["lines"]
    assert rep["rows_loaded"] == 9 and rep["rows_kept"] == 3 and rep["duplicates"] == 1 and rep["rows_dropped"] == 5
    assert rep["dropped"] == {"no order date": 1, "date not readable": 1, "no order number": 1, "quantity zero or negative": 1, "no destination country": 1}
    assert rep["missing"]["order_date"] == 1 and rep["missing"]["currency"] == 5 and rep["missing"]["sku"] == 7
    assert rep["date_from"] == "2024-01-03" and rep["date_to"] == "2024-07-21" and rep["orders"] == 3
    assert rep["unknown_currency"] == 1 and rep["outside_target"] == 1
    kw, sa = lines[0], lines[1]
    assert kw["value_eur"] == 16680 and kw["month"] == 1 and kw["region"] == "Gulf/GCC"
    assert sa["value_eur"] == pytest.approx(40500)


def test_cleaning_the_demo_history(demo, tmp_path):
    out = run(CLEAN_DEMO + "const out = {report, cats: [...new Set(lines.map(l => l.category))].sort(), brands: [...new Set(lines.map(l => l.brand))].sort()};",
              data=demo, tmp_path=tmp_path)
    rep = out["report"]
    assert rep["rows_loaded"] == rep["rows_kept"] == 385 and rep["orders"] == 192 and rep["rows_dropped"] == 0
    assert set(out["cats"]) <= {"jackets", "trousers", "coveralls", "other"} and "jackets" in out["cats"]
    assert "" not in out["brands"]


# ------------------------------------------------------------------ seasonality
def _lines(spec):
    """spec: [(year, month, units)] -> minimal clean lines."""
    return [{"order_key": f"{y}-{m}-{i}", "year": y, "month": m, "quantity": u, "value_eur": u * 10, "region": "Gulf/GCC" if i % 2 else "Türkiye",
             "customer": "C", "category": "other"} for i, (y, m, u) in enumerate(spec)]


def test_seasonality_index_is_100_on_average(tmp_path):
    base = [50, 50, 100, 100, 100, 100, 150, 200, 60, 50, 100, 100]
    spec = [(y, m + 1, base[m]) for y in (2023, 2024) for m in range(12)]
    out = run("const s = B.seasonality(D, 'units', 'region'); const out = {idx: s.overall.index, win: B.peakWindow(s.overall.avg)};",
              data=_lines(spec), tmp_path=tmp_path)
    mean = sum(base) / 12
    assert out["idx"] == pytest.approx([100 * b / mean for b in base])
    assert sum(out["idx"]) / 12 == pytest.approx(100)
    assert out["win"]["months"] == [5, 6, 7] and out["win"]["share"] == pytest.approx((100 + 150 + 200) / sum(base))


def test_seasonality_handles_a_part_year(tmp_path):
    # Full 2023 plus January to June 2024, the same volume every month: the shape is flat, not front-loaded.
    spec = [(2023, m, 100) for m in range(1, 13)] + [(2024, m, 100) for m in range(1, 7)]
    out = run("const s = B.seasonality(D); const out = {idx: s.overall.index, per: s.coverage.perMonth};", data=_lines(spec), tmp_path=tmp_path)
    assert out["per"] == [2] * 6 + [1] * 6
    assert out["idx"] == pytest.approx([100] * 12)


def test_peak_window_wraps_round_the_year(tmp_path):
    out = run("const out = B.peakWindow([90, 80, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100]);", tmp_path=tmp_path)
    assert out["months"] == [11, 0, 1]


def test_findings_name_the_peak_with_its_share(demo, tmp_path):
    out = run(CLEAN_DEMO + "const out = {f: B.findings(lines), pk: B.peakLow(lines).regions};", data=demo, tmp_path=tmp_path)
    w = out["pk"]["Gulf/GCC"]["window"]
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    expected = f"Gulf/GCC orders peak in {months[w['months'][0]]} to {months[w['months'][2]]}, {round(w['share'] * 100)} percent of yearly volume."
    assert any(f.startswith(expected) for f in out["f"]), out["f"]


# ------------------------------------------------------------------ test order generator
GEN = CLEAN_DEMO + "const gen = o => B.generateTestOrders(lines, Object.assign({skuInfo: D.sku}, o));\n"


def test_generator_is_repeatable_with_a_seed(demo, tmp_path):
    out = run(GEN + """const a = gen({seed: 7, scale: 0.6}), b = gen({seed: 7, scale: 0.6}), c = gen({seed: 8, scale: 0.6});
      const sig = t => JSON.stringify(t.orders.map(o => [o.id, o.month, o.country, o.customer, o.units]));
      const out = {same: sig(a) === sig(b), differs: sig(a) !== sig(c), n: a.orders.length};""", data=demo, tmp_path=tmp_path)
    assert out["same"] and out["differs"] and out["n"] == round(192 * 0.6)


def test_generator_follows_the_history_at_scale_one(demo, tmp_path):
    out = run(GEN + "const t = gen({seed: 2026}); const out = {check: t.check, n: t.orders.length, ids: t.orders.map(o => o.id), months: t.orders.map(o => o.month)};",
              data=demo, tmp_path=tmp_path)
    c = out["check"]
    assert out["n"] == 192 and c["ok"]
    assert out["ids"][0] == "TO-001" and out["ids"][-1] == "TO-192" and len(set(out["ids"])) == 192
    assert out["months"] == sorted(out["months"])
    assert abs(c["totals"]["units"]["diff"]) < 0.15 and c["months"]["max_dev"] <= 0.03


def test_generator_scales_and_keeps_the_shape(demo, tmp_path):
    out = run(GEN + "const t = gen({seed: 3, scale: 3}); const out = {n: t.orders.length, check: t.check};", data=demo, tmp_path=tmp_path)
    assert out["n"] == 576
    assert out["check"]["months"]["max_dev"] <= 0.03 and out["check"]["regions"]["max_dev"] <= 0.06


def test_generator_hits_a_revenue_target(demo, tmp_path):
    out = run(GEN + "const t = gen({seed: 5, targetValueEur: 20e6}); const out = {scale: t.scale, value: t.check.totals.value, hist: t.hist.value};",
              data=demo, tmp_path=tmp_path)
    assert out["scale"] == pytest.approx(20e6 / out["hist"])
    assert out["value"]["history"] == pytest.approx(20e6)
    assert abs(out["value"]["diff"]) < 0.15


def test_generator_anonymises_customers(demo, tmp_path):
    out = run(GEN + """const t = gen({seed: 11});
      const out = {cust: [...new Set(t.orders.map(o => o.customer))], real: [...new Set(t.orders.map(o => o.customer_real))],
                   perReal: t.orders.reduce((a, o) => { (a[o.customer_real] = a[o.customer_real] || new Set()).add(o.customer); return a; }, {}),
                   lanes: t.lanes};
      out.perReal = Object.values(out.perReal).map(s => s.size);""", data=demo, tmp_path=tmp_path)
    import re
    assert all(re.fullmatch(r"Customer (TR|NAF|GCC)-\d{2}", c) for c in out["cust"])
    assert len(out["cust"]) == len(out["real"]) and set(out["perReal"]) == {1}
    names = set(demo["names"].values()) | set(demo["names"])
    blob = json.dumps(out["lanes"]) + json.dumps(out["cust"])
    assert not any(n in blob for n in names)


def test_test_orders_carry_packing_estimates(demo, tmp_path):
    out = run(GEN + "const t = gen({seed: 1}); const out = t.orders.slice(0, 20);", data=demo, tmp_path=tmp_path)
    for o in out:
        assert o["cartons"] >= len(o["lines"]) and o["pallets"] >= 1 and o["weight_kg"] > 0 and o["volume_m3"] > 0
        assert o["port"] and o["region"] in ("Türkiye", "North Africa", "Gulf/GCC")
        assert o["units"] == sum(l["quantity"] for l in o["lines"])
        assert o["volume_m3"] == pytest.approx(o["cartons"] * 0.096, abs=0.02)


def test_base_year_filter(tmp_path):
    spec = [(2023, m, 10) for m in range(1, 13)] + [(2024, m, 30) for m in range(1, 13)]
    out = run("const t = B.generateTestOrders(D, {seed: 1, baseYears: [2024]}); const out = {years: t.base_years, units: t.check.totals.units.test};",
              data=_lines(spec), tmp_path=tmp_path)
    assert out == {"years": [2024], "units": 360}


# ------------------------------------------------------------------ response template
def test_response_template_round_trip(demo, tmp_path):
    out = run(GEN + """const XLSX = require(process.argv[3]);
      const t = gen({seed: 2});
      const goals = [{id: 'G01', name: 'Next-day delivery', target: '1', unit: 'working day', priority: 'Mandatory'}, {id: 'G02', name: 'Tracking', target: '100', unit: '%', priority: 'Preferred'}];
      const tpl = B.responseTemplate({id: 'FTB-TEST', created: '2026-10-07', orders: t.orders, lanes: t.lanes}, {id: 'LP-1', name: 'Example Forwarding Co.'}, goals);
      const wb = XLSX.utils.book_new();
      Object.entries(tpl.sheets).forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n));
      XLSX.utils.sheet_add_aoa(wb.Sheets['Provider'], [['EUR']], {origin: 'B7'});
      XLSX.utils.sheet_add_aoa(wb.Sheets['Rates per order'], [['Road', 3, 5, '1.250,50', 80, 45, 0, 12.5, 'DAP', '', 'via Istanbul']], {origin: 'J2'});
      XLSX.utils.sheet_add_aoa(wb.Sheets['Rates per lane'], [['sea', 9, 14, 900, 60, 45, 20, 0, 'DDP', 'USD', '']], {origin: 'I2'});
      XLSX.utils.sheet_add_aoa(wb.Sheets['Service goals'], [['Partly', 'TR yes, NAF 2 days'], ['YES', '']], {origin: 'F2'});
      const back = XLSX.read(XLSX.write(wb, {type: 'buffer', bookType: 'xlsx'}));
      const sheets = Object.fromEntries(back.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(back.Sheets[n], {header: 1, defval: ''})]));
      const out = {resp: B.parseResponse(sheets), first: t.orders[0].id, lane: t.lanes[0].lane_id, heads: tpl.sheets['Rates per order'][0], names: Object.keys(tpl.sheets),
                   bad: (() => { try { B.parseResponse({Sheet1: [['x']]}); return null; } catch (e) { return e.message; } })()};""",
              data=demo, tmp_path=tmp_path)
    r = out["resp"]
    assert out["names"] == ["Instructions", "Provider", "Rates per order", "Rates per lane", "Service goals", "_meta"]
    assert r["package_id"] == "FTB-TEST" and r["provider_id"] == "LP-1" and r["template_version"] == 1 and r["currency"] == "EUR"
    order, lane = r["lines"]
    assert order == {"kind": "order", "ref": out["first"], "transport_mode": "road", "transit_days": 3, "lead_time_days": 5, "freight_rate": 1250.5,
                     "fuel_surcharge": 80, "customs_fee": 45, "warehousing_cost": 0, "other_surcharges": 12.5, "incoterm": "DAP", "currency": "EUR",
                     "comment": "via Istanbul"}
    assert lane["kind"] == "lane" and lane["ref"] == out["lane"] and lane["currency"] == "USD" and lane["incoterm"] == "DDP"
    assert [(g["goal_id"], g["meets"], g["comment"]) for g in r["goals"]] == [("G01", "partly", "TR yes, NAF 2 days"), ("G02", "yes", "")]
    assert "Freight rate" in out["heads"] and "Meets goal" not in out["heads"]
    assert out["bad"] and "not a FlexiTog" in out["bad"]
