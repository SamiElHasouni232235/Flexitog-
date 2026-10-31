"""Operations overview logic (assets/calc.js, FlexiCalc.ops) and the Odoo export templates (assets/data_core.js):
month-to-date KPIs, location accuracy, orders by market, units by month per brand, stock by temperature zone
with days of cover, dock schedule, certificates due, the sample fixture and the source picker. Runs in node."""
import json
import shutil
import subprocess

import pytest

from flexitog.dashboard import ASSETS

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")


def run(body: str):
    src = ("const C = require(process.argv[1]), D = require(process.argv[2]), FX = require(process.argv[3]), O = C.ops;\n(async () => {\n"
           + body + "\nconsole.log(JSON.stringify(out));\n})().catch(e => { console.error(e); process.exit(1); });")
    res = subprocess.run([NODE, "-e", src, str(ASSETS / "calc.js"), str(ASSETS / "data_core.js"), str(ASSETS / "data" / "ops_sample.json")],
                         capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_month_to_date_kpis_compare_the_same_days_of_last_month():
    out = run("""const lines = [
        {order: 'S1', date: '2026-10-02', country: 'NL'}, {order: 'S1', date: '2026-10-05', country: 'NL'},   // one order, two lines
        {order: 'S2', date: '2026-10-28', country: 'DE'}, {order: 'S3', date: '2026-09-10', country: 'DE'},
        {order: 'S4', date: '2026-09-29', country: 'MA'}, {order: 'S5', date: '2026-09-30', country: 'MA'}];  // 29 and 30 Sep fall after day 28
      const moves = [{sku: 'A', quantity: 10, date: '2026-10-03T09:00', picking_code: 'outgoing', state: 'done'},
        {sku: 'A', quantity: 99, date: '2026-10-03T09:00', picking_code: 'incoming', state: 'done'},
        {sku: 'B', quantity: 5, date: '2026-10-04T09:00', picking_code: 'outgoing', state: 'assigned'},
        {sku: 'B', quantity: 20, date: '2026-09-15T09:00', picking_code: 'outgoing'}];
      const out = {orders: O.ordersKpi(lines, '2026-10-28'), units: O.unitsKpi(moves, '2026-10-28'), stale: O.ordersKpi(lines.filter(l => l.date < '2026-10-01'), '2026-10-28')};""")
    o = out["orders"]
    assert o["value"] == 2 and o["prev"] == 1 and o["delta"] == 1 and o["label"] == "October 2026"
    u = out["units"]
    assert u["value"] == 10 and u["prev"] == 20 and abs(u["deltaPct"] + 0.5) < 1e-9   # incoming and not-done lines left out
    s = out["stale"]                                                                  # source ends 30 Sep: measured at its last day
    assert s["asOf"] == "2026-09-30" and s["month"] == "2026-09" and s["value"] == 3


def test_location_accuracy_counts_a_location_once_per_day():
    out = run("""const counts = [
        {location: 'L1', sku: 'A', count_date: '2026-10-05', system_quantity: 10, counted_quantity: 10},
        {location: 'L1', sku: 'B', count_date: '2026-10-05', system_quantity: 4, counted_quantity: 3},     // L1 on 5 Oct is off
        {location: 'L2', sku: 'A', count_date: '2026-10-06', system_quantity: 7, counted_quantity: 7},
        {location: 'L3', sku: 'C', count_date: '2026-10-07', system_quantity: 0, counted_quantity: 0},
        {location: 'L1', sku: 'A', count_date: '2026-09-20', system_quantity: 1, counted_quantity: 2},
        {location: 'L2', sku: 'A', count_date: '2026-09-21', system_quantity: 1, counted_quantity: 1}];
      const out = O.accuracyKpi(counts, '2026-10-29');""")
    assert out["counted"] == 3 and out["accurate"] == 2 and abs(out["value"] - 2 / 3) < 1e-9
    assert abs(out["prev"] - 0.5) < 1e-9 and abs(out["delta"] - (2 / 3 - 0.5)) < 1e-9


def test_markets_units_by_month_and_stock_by_zone():
    out = run("""const lines = [{order: 'S1', date: '2026-10-02', country: 'NL'}, {order: 'S2', date: '2026-08-02', country: 'NL'},
        {order: 'S3', date: '2026-07-02', country: 'DE'}, {order: 'S4', date: '2025-09-01', country: 'FR'}];   // S4 is older than 12 months
      const products = [{sku: 'F1', brand: 'FlexiTog'}, {sku: 'G1', brand: 'Gold Freeze'}, {sku: 'C1', brand: 'FlexiTog'}];
      const moves = [{sku: 'F1', quantity: 90, date: '2026-10-10T10:00', picking_code: 'outgoing'}, {sku: 'G1', quantity: 45, date: '2026-09-10T10:00', picking_code: 'outgoing'},
        {sku: 'C1', quantity: 180, date: '2026-09-01T10:00', picking_code: 'outgoing'}, {sku: 'F1', quantity: 900, date: '2026-01-10T10:00', picking_code: 'outgoing'}];
      const quants = [{sku: 'F1', category: 'All / Freezer wear', location: 'F-1', quantity: 30}, {sku: 'F1', category: 'All / Freezer wear', location: 'F-2', quantity: 30},
        {sku: 'G1', category: 'All / PPE and safety', location: 'P-1', quantity: 100}, {sku: 'C1', category: 'All / Chiller wear', location: 'C-1', quantity: 20},
        {sku: 'X1', category: 'All / Office', location: 'O-1', quantity: 5}];
      const zones = [{category_match: 'Freezer', zone: 'freezer'}, {category_match: 'Chiller', zone: 'chiller'}, {category_match: 'PPE', zone: 'ppe'}];
      const out = {mk: O.ordersByMarket(lines, '2026-10-29'), all: O.unitsByMonth(moves, products, 'all', '2026-10-29'), ft: O.unitsByMonth(moves, products, 'FlexiTog', '2026-10-29'),
        zones: O.stockByZone(quants, zones, moves, '2026-10-29')};""")
    assert out["mk"]["rows"] == [{"country": "NL", "orders": 2}, {"country": "DE", "orders": 1}] and out["mk"]["total"] == 3
    months = {m["month"]: m["units"] for m in out["all"]["months"]}
    assert len(months) == 12 and months["2026-10"] == 90 and months["2026-09"] == 225 and months["2026-01"] == 900 and "2025-10" not in months
    ft = {m["month"]: m["units"] for m in out["ft"]["months"]}
    assert ft["2026-09"] == 180 and out["all"]["brands"] == ["FlexiTog", "Gold Freeze"]
    z = {x["key"]: x for x in out["zones"]["zones"]}
    # freezer: 60 on hand, 90 shipped in the last 90 days -> 1 per day -> 60 days of cover
    assert z["freezer"]["onHand"] == 60 and abs(z["freezer"]["daysCover"] - 60) < 1e-9 and z["freezer"]["warn"] is False
    # chiller: 20 on hand, 180 in 90 days -> 2 per day -> 10 days, under the 21-day warning
    assert abs(z["chiller"]["daysCover"] - 10) < 1e-9 and z["chiller"]["warn"] is True
    assert abs(z["ppe"]["daysCover"] - 200) < 1e-9 and out["zones"]["unmatched"] == ["All / Office"]
    assert z["freezer"]["range"] == "-5 to -50°C" and z["chiller"]["range"] == "+10 to -5°C"


def test_dock_day_certificates_gauge_and_search():
    out = run("""const pk = [{name: 'HLM/IN/1', picking_type_code: 'incoming', scheduled_date: '2026-10-29T07:30', dock: 'Dock 2', state: 'assigned', slot_minutes: 45},
        {name: 'HLM/OUT/9', picking_type_code: 'outgoing', scheduled_date: '2026-10-29T06:00', dock: 'Dock 1', state: 'assigned', origin: 'S0042'},
        {name: 'HLM/QC/3', picking_type_code: 'internal', slot_type: 'quality', scheduled_date: '2026-10-29T17:30', dock: 'Dock 10', state: 'assigned', slot_minutes: 90},
        {name: 'HLM/OUT/8', picking_type_code: 'outgoing', scheduled_date: '2026-10-29T09:00', state: 'cancel'},
        {name: 'HLM/OUT/7', picking_type_code: 'outgoing', scheduled_date: '2026-10-30T09:00', state: 'assigned'}];
      const certs = [{sku: 'A', expires: '2026-11-16'}, {sku: 'B', expires: '2027-03-01'}, {sku: 'C', expires: '2026-10-01'}];
      const out = {day: O.dockDay(pk, '2026-10-29'), days: O.dockDays(pk), certs: O.certificatesDue(certs, '2026-10-29', 90),
        gauge: O.pickGauge({minutesPerLine: 1.8, lastMonth: 2.1, targetMinutes: 2, scaleMaxMinutes: 4}), prog: O.progress({done: 1840, total: 2600}),
        find: O.search('s004', {products: [], orders: ['S0042', 'S0101'], pickings: pk, quants: []}).map(r => r.kind + ':' + r.id)};""")
    d = out["day"]
    assert [s["name"] for s in d["slots"]] == ["HLM/OUT/9", "HLM/IN/1", "HLM/QC/3"]          # dock order 1, 2, 10; cancelled left out
    assert d["slots"][1]["start"] == 450 and d["slots"][1]["end"] == 495 and d["slots"][0]["type"] == "outbound" and d["slots"][2]["type"] == "quality"
    assert d["from"] == 360 and d["to"] == 1140 and dict(d["counts"]) == {"inbound": 1, "outbound": 1, "quality": 1}
    assert out["days"] == ["2026-10-29", "2026-10-30"]
    c = out["certs"]
    assert c["next"]["sku"] == "A" and c["daysToNext"] == 18 and c["due"] == 2 and c["overdue"] == 1   # C is overdue and counts as due
    assert abs(out["gauge"]["share"] - 0.45) < 1e-9 and out["gauge"]["onTarget"] is True
    assert out["prog"]["left"] == 760 and abs(out["prog"]["share"] - 1840 / 2600) < 1e-9
    assert out["find"] == ["Order:S0042", "Transfer:HLM/OUT/9"]


def test_sample_resolves_against_today_and_sources_prefer_odoo_rows():
    out = run("""const S = O.resolveSample(FX, '2026-10-29');
      const src = O.sources({md: {odoo_move_lines: [], odoo_quants: [{sku: 'A', category: 'Freezer', location: 'L', quantity: 1}], odoo_location_counts: [], odoo_pickings: [], temperature_zones: []},
        orderLines: [], orderSample: true, fixture: FX, today: '2026-10-29'});
      const out = {dates: [...new Set(S.moveLines.map(r => r.date.slice(0, 10)))].sort().slice(-1), weekend: S.pickings.filter(p => [0, 6].includes(new Date(p.scheduled_date.slice(0, 10) + 'T12:00:00Z').getUTCDay())).length,
        cert: S.certificates[0].expires, flags: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v.sample])), quants: src.quants.rows.length,
        facts: FX.certificates.map(c => c.document + ' ' + c.fact)};""")
    assert out["dates"] == ["2026-10-29"] and out["weekend"] == 0 and out["cert"] == "2026-11-16"
    assert out["flags"]["quants"] is False and out["quants"] == 1                               # uploaded Odoo rows win
    assert out["flags"]["moveLines"] and out["flags"]["certificates"] and out["flags"]["pickTime"] and out["flags"]["orders"]
    assert any("EN 342:2017" in f and "-50°C" in f for f in out["facts"])


def test_odoo_templates_accept_labels_and_codes():
    out = run("""const ctx = {toIso2: v => ({netherlands: 'NL'})[String(v).toLowerCase()] || String(v).toUpperCase(), isCountry: c => ['NL', 'DE'].includes(c), providers: [], lanes: [], quotes: [], today: '2026-10-29', fileName: 'odoo.xlsx'};
      const pick = D.validateFile('odooPickings', {headers: ['Reference', 'Type of Operation', 'Scheduled Date', 'Status', 'Contact/Country', 'Dock'], rows: [
        ['HLM/IN/00001', 'Receipt', '2026-10-30 08:30:00', 'Ready', 'Netherlands', 'Dock 1'], ['HLM/OUT/00002', 'Delivery', '30-10-2026 14:00', 'Done', 'DE', ''],
        ['HLM/OUT/00003', 'Dropship', '2026-10-30 25:00', 'Maybe', 'Narnia', '']]}, ctx);
      const ok = D.validateFile('odooPickings', {headers: ['name', 'picking_type_code', 'scheduled_date', 'state'], rows: [['HLM/IN/00001', 'incoming', '2026-10-30T08:30', 'assigned']]}, ctx);
      const ml = D.validateFile('odooMoveLines', {headers: ['Transfer', 'Product/Internal Reference', 'Quantity', 'Date', 'Type of Operation'], rows: [
        ['HLM/OUT/1', 'FT-JKT-100', '12', '2026-10-14 11:05', 'Delivery'], ['HLM/OUT/1', 'FT-JKT-100', '12', '2026-10-14 11:05', 'Delivery']]}, ctx);
      const q = D.validateFile('odooQuants', {headers: ['Product/Internal Reference', 'Product Category', 'Location', 'On Hand Quantity'], rows: [['FT-JKT-100', 'All / Freezer wear', 'HLM/Stock/F-01', '120']]}, ctx);
      const cnt = D.validateFile('odooCounts', {headers: ['Location', 'Product/Internal Reference', 'Last Count Date', 'On Hand Quantity', 'Counted Quantity'], rows: [['HLM/Stock/F-01', 'FT-JKT-100', '2026-10-12', '120', '-3']]}, ctx);
      const out = {pick, ok: ok.rows, ml: ml.rows.map(r => r.line_id), q: q.rows, cnt: cnt.errors};""")
    errs = {(e["row"], e["column"]) for e in out["pick"]["errors"]}
    assert {(4, "picking_type_code"), (4, "scheduled_date"), (4, "state"), (4, "partner_id/country_id")} <= errs
    assert not any(r in (2, 3) for r, _ in errs)                                  # labels Receipt, Delivery, Ready, Done are read
    assert out["ok"][0]["slot_type"] == "inbound" and out["ok"][0]["slot_minutes"] == 60 and out["ok"][0]["scheduled_date"] == "2026-10-30T08:30"
    assert len(set(out["ml"])) == 2                                               # two equal lines stay two lines
    assert out["q"][0]["quantity"] == 120 and out["q"][0]["category"] == "All / Freezer wear"
    assert [(e["row"], e["column"]) for e in out["cnt"]] == [(2, "inventory_quantity")]
