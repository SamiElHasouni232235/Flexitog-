"""Modular RFQ MENA-TR v3.0 (assets/rfq_v30.js): parsing, validation, the five scenarios, scores, red flags and the
version handling, run in node on real workbooks.

Test 1 runs on tests/fixtures/rfq_v30_dummy_reconstructed.xlsx (built by tools/build_rfq_v30_fixtures.py from the
bundled template) and, when present, on the provider's own "Dummy provider test fill". Test 2 and the Aramex variant of
Test 4 need "FlexiTog RFQ MENA-TR v3.0 - Aramex test fill.xlsx" in tests/fixtures/ (a provider's real quote, so not in
the repository); without it they skip. Test 5 reads the v2.3 Aramex file when present, else the Export values saved from
it in aramex_v23_values.json.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import openpyxl
import pytest

from flexitog.dashboard import ASSETS, RFQ_LEGACY_TEMPLATE, RFQ_TEMPLATE, RFQ_V23_TEMPLATE, rfq_sources

FIX = Path(__file__).parent / "fixtures"
DUMMY = FIX / "rfq_v30_dummy_reconstructed.xlsx"
DUMMY_REAL = FIX / "FlexiTog RFQ MENA-TR v3.0 - Dummy provider test fill.xlsx"
ERRORS = FIX / "rfq_v30_input_errors.xlsx"
ARAMEX_V30 = FIX / "FlexiTog RFQ MENA-TR v3.0 - Aramex test fill.xlsx"
ARAMEX_V23 = FIX / "FlexiTog RFQ Quick Quote MENA-TR v2.3 - Aramex test fill.xlsx"
ARAMEX_V23_VALUES = FIX / "aramex_v23_values.json"
DUMMY_V1 = FIX / "Sample_RFQ_Response_DUMMY.xlsx"
LIBS = [str(ASSETS / "vendor" / "xlsx.full.min.js"), str(ASSETS / "rfq_core.js"), str(ASSETS / "rfq_v30.js")]

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")

# Test 1 settings: defaults, average pallets 20, S2 distributor in L01 (2 x C20, 4 x P5), S3 warehouse A of the test
# provider, S4 own free-zone site in the UAE with the test provider's M5 prices as the delivery proxy.
T1_SETTINGS = {
    "s2": {"L01": {"on": True, "loads": {"C20": 2, "P5": 4}}},
    "s3": {"provider": "P", "warehouse": "A", "avgPallets": 20},
    "s4": {"sites": [{"country": "L02", "customs": "Free zone", "m2": 500, "rentPerM2": 100, "fte": 2, "costPerFte": 30000, "setup": 60000,
                      "amortYears": 3, "equipmentMonth": 500, "wmsMonth": 300, "insuranceYear": 10000, "proxyProvider": "P", "proxyWarehouse": "A"}]},
}


def run(body: str, tmp_path, *files):
    """Run JS with X (SheetJS), R (rfq core), V (rfq v3.0), fs, F[] (file paths), SRC (template key -> cell maps),
    quoteOf(file, kind) and out(scenarios result) helpers. The body sets `out`."""
    src = tmp_path / "sources.json"
    src.write_text(json.dumps({"v30": rfq_sources(RFQ_TEMPLATE), "v23": rfq_sources(RFQ_V23_TEMPLATE), "v1": rfq_sources(RFQ_LEGACY_TEMPLATE)}))
    script = tmp_path / "t.js"
    script.write_text(f"""const X = require({json.dumps(LIBS[0])}), R = require({json.dumps(LIBS[1])}), V = require({json.dumps(LIBS[2])}), fs = require('fs');
const F = {json.dumps([str(f) for f in files])}, SRC = JSON.parse(fs.readFileSync({json.dumps(str(src))}, 'utf8'));
const load = (f, kind) => R.parseWorkbook(X.read(fs.readFileSync(f), {{cellDates: true}}), X, {{sources: SRC[kind || 'v30']}});
const quoteOf = (f, kind) => V.quote(V.valuesOf(load(f, kind)));
const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
const scen = R0 => ({{state: R0.state, total: r2(R0.total), parts: Object.fromEntries(Object.entries(R0.parts).map(([k, v]) => [k, r2(v)])),
  types: Object.fromEntries(Object.entries(R0.types).map(([k, v]) => [k, r2(v)])), countrySum: r2(Object.values(R0.countries).reduce((a, c) => a + c.cost, 0)),
  tags: R0.tags, missing: R0.missing, notes: R0.notes, notCovered: R0.notCovered || 0, shipments: R0.shipments, stockOrders: r2(R0.stockOrders), stockKg: r2(R0.stockKg),
  loads: R0.loads, perLoad: r2(R0.perLoad), solutions: (R0.solutions || []).map(s => ({{title: s.title, estimate: r2(s.estimate)}})), distributors: R0.distributors || null}});
const all = o => Object.fromEntries(['S1', 'S2', 'S3', 'S3b', 'S4', 'S5'].map(k => [k, scen(o[k])]));
let out = null;
(async () => {{ {body}
  process.stdout.write(JSON.stringify(out)); }})().catch(e => {{ console.error(e); process.exit(1); }});
""")
    r = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def sums_ok(s):
    """Every breakdown sums to its total: parts, cost types and countries."""
    if s["total"] is None:
        return
    assert sum(s["parts"].values()) == pytest.approx(s["total"], abs=0.05)
    assert sum(s["types"].values()) == pytest.approx(s["total"], abs=0.05)
    assert s["countrySum"] == pytest.approx(s["total"], abs=0.05)


# ---------------------------------------------------------------- Test 1, dummy provider
def t1(tmp_path, f):
    return run(f"""const Q = quoteOf(F[0]), list = [{{id: 'P', name: 'Dummy provider', Q}}], S = {json.dumps(T1_SETTINGS)};
  const o = V.scenarios(list, S, 'A', 'best'), sen = V.sensitivity(list, S, 'A', 'best'), sc = V.scoreAll(list, S, 'A')[0];
  out = {{kind: Q.kind, tag: Q.tag, invalid: Q.invalid, inputCheck: Q.inputCheck, priced: Q.priced, notes: Q.moduleNotes, sc: all(o), cheapest: o.cheapest,
    byRegion: o.byRegion.map(r => [r.region, r.best, r2(r.cost)]), byCountry: o.byCountry, breakEven: sen.breakEven,
    sens: sen.rows.map(r => [r.m, r2(r.S1), r2(r.S3), r2(r.S4)]), flags: V.flags(Q, S).map(x => x.id),
    scores: [r2(sc.forwarder.total), r2(sc.threepl.total)], classS3: V.classCost(o.S3, 'L01', 'B1'), classS2: V.classCost(o.S2, 'L01', 'B3'), classS1: V.classCost(o.S1, 'L05', 'B1'),
    answers: V.answers(o, sen, list)}};""", tmp_path, f)


def check_t1(r):
    s = r["sc"]
    assert r["kind"] == "v30" and r["tag"] == "v3.0" and r["invalid"] == [] and r["notes"] == []
    assert s["S1"]["state"] == "complete" and s["S1"]["total"] == 97000.00 and s["S1"]["notCovered"] == 0
    assert s["S2"]["state"] == "complete" and s["S2"]["total"] == 56800.00
    assert s["S2"]["parts"] == {"bulk": 12000, "direct": 44800}
    assert "excludes distributor margin" in s["S2"]["tags"]
    assert s["S3"]["state"] == "complete" and s["S3"]["total"] == 98210.00
    assert s["S3"]["parts"] == {"direct": 62000, "delivery": 5340, "handling": 752, "fzExit": 1920, "replenishment": 9450, "devanning": 900,
                                "storage": 2400, "fixed": 7500, "minimumTopUp": 7948}
    assert s["S3"]["loads"] == 3 and s["S3"]["perLoad"] == 3150 and s["S3"]["stockOrders"] == 96 and s["S3"]["stockKg"] == 6950
    assert s["S4"]["state"] == "complete" and s["S4"]["total"] == 228310.00
    assert s["S4"]["parts"] == {"ownFixed": 149600, "replenishment": 9450, "delivery": 5340, "fzExit": 1920, "direct": 62000}
    assert "proxy" in s["S4"]["tags"]
    assert s["S5"]["state"] == "indicative" and "indicative" in s["S5"]["tags"]
    assert [x["title"] for x in s["S5"]["solutions"]] == ["Test consolidation hub"]
    assert s["S3b"]["state"] == "not_configured"   # the dummy quotes no dedicated site (W20, W21)
    for k in ("S1", "S2", "S3", "S4"):
        sums_ok(s[k])
    assert r["cheapest"] == "S2"   # S5 is never ranked
    assert r["byCountry"]["L01"] == "S2" and r["byCountry"]["L05"] == "S1"
    assert r["flags"] == []


def test_1_dummy_reconstructed(tmp_path):
    r = t1(tmp_path, DUMMY)
    check_t1(r)
    assert r["inputCheck"] == "No problems found"
    assert r["breakEven"] == {"S3": 1.05, "S4": None}
    assert r["sens"][1] == [1, 97000, 98210, 228310]
    assert r["scores"] == [3.41, 3.59]
    assert r["classS1"]["price"] == 100 and r["classS1"]["tag"] == "quoted"
    assert r["classS2"]["via"] == "distributor" and r["classS2"]["price"] == pytest.approx(12000 / 50)
    assert r["classS3"]["price"] > 20   # delivery 20 + handling + the share of the warehouse-wide costs
    assert any("S2 Distributor holds stock" in a for a in r["answers"])


@pytest.mark.skipif(not DUMMY_REAL.exists(), reason=f"{DUMMY_REAL.name} is not in tests/fixtures")
def test_1_dummy_provider_file(tmp_path):
    check_t1(t1(tmp_path, DUMMY_REAL))


# ---------------------------------------------------------------- Test 2, Aramex v3.0
@pytest.mark.skipif(not ARAMEX_V30.exists(), reason=f"{ARAMEX_V30.name} is not in tests/fixtures")
def test_2_aramex(tmp_path):
    r = run("""const Q = quoteOf(F[0]), list = [{id: 'ARX', name: 'Aramex', Q}];
  const o = V.scenarios(list, null, 'A', 'best');
  const p5 = V.scenarios(list, {s2: {L01: {on: true, loads: {P5: 4}}}}, 'A', 'best').S2;
  const c20 = V.scenarios(list, {s2: {L01: {on: true, loads: {C20: 2, P5: 4}}}}, 'A', 'best').S2;
  out = {kind: Q.kind, sc: all(o), T05: Q.m1.find(x => x.id === 'T05').price, B01: Q.m2.find(x => x.id === 'B01'), L01: Q.m3.L01,
    p5: scen(p5), c20: scen(c20), flags: V.flags(Q, null)};""", tmp_path, ARAMEX_V30)
    s = r["sc"]
    assert r["kind"] == "v30"
    assert s["S1"]["total"] == 188208.28 and s["S1"]["notCovered"] == 12 and s["S1"]["shipments"] == 141
    assert r["T05"] == 17894.40
    assert r["B01"]["lane"] == "L01" and r["B01"]["load"] == "P1" and r["B01"]["price"] == 2060.80
    assert r["L01"]["clearance"] == 103.20
    assert r["p5"]["state"] == "complete" and r["p5"]["total"] == 96428.18
    sums_ok(r["p5"])
    assert r["c20"]["state"] == "incomplete" and any("C20" in m for m in r["c20"]["missing"])
    assert s["S3"]["state"] == "incomplete"
    f9 = [f["key"] for f in r["flags"] if f["id"] == "F9"]
    assert "module.M4.offered" in f9 and "module.M5.offered" in f9
    assert any("On-board courier" in (x["title"] or "") for x in s["S5"]["solutions"])


# ---------------------------------------------------------------- Test 3, blank template
def test_3_blank_template(tmp_path):
    r = run("""const Q = quoteOf(F[0]), o = V.scenarios([{id: 'B', name: 'Blank', Q}], null, 'A', 'best');
  out = {kind: Q.kind, modules: Q.modules, priced: Q.priced, invalid: Q.invalid, sc: all(o), prices: Q.m1.map(x => x.price).concat(Q.m2.map(x => x.price), Q.m5.map(x => x.price)),
    flags: V.flags(Q, null).map(f => f.id)};""", tmp_path, RFQ_TEMPLATE)
    assert r["kind"] == "v30" and r["invalid"] == []
    assert set(r["modules"].values()) == {""} and not any(r["priced"].values())
    assert set(r["prices"]) == {None}   # blank is never 0
    for k, s in r["sc"].items():
        assert s["state"] in ("not_configured", "incomplete"), k
        assert s["total"] is None


# ---------------------------------------------------------------- Test 4, input errors
INPUT_CHECK_2 = "2 cells to check, see the Check column on each sheet"


def check_t4(r):
    assert sorted(x["key"] for x in r["invalid"]) == ["m2.B01.price_eur", "m4.A.W05"]
    assert {x["key"]: x["value"] for x in r["invalid"]} == {"m2.B01.price_eur": "incl", "m4.A.W05": "tbc"}
    assert r["B01"] is None and r["W05"] is None   # excluded, never 0
    assert r["inputCheck"] == INPUT_CHECK_2
    assert "F7" in r["flags"]


T4_JS = """const Q = quoteOf(F[0]);
  out = {invalid: Q.invalid, B01: Q.m2.find(x => x.id === 'B01').price, W05: Q.m4.A.W05, inputCheck: Q.inputCheck, flags: V.flags(Q, null).map(f => f.id)};"""


def test_4_input_errors(tmp_path):
    check_t4(run(T4_JS, tmp_path, ERRORS))


@pytest.mark.skipif(not ARAMEX_V30.exists() or shutil.which("soffice") is None, reason="needs the Aramex v3.0 file and LibreOffice")
def test_4_input_errors_aramex(tmp_path):
    src = rfq_sources(RFQ_TEMPLATE)
    wb = openpyxl.load_workbook(ARAMEX_V30)
    for k, v in {"m2.B01.price_eur": "incl", "m4.A.W05": "tbc"}.items():
        sheet, cell = src[k]
        wb[sheet][cell] = v
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "aramex_errors.xlsx"
        wb.save(raw)
        subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(tmp_path), str(raw)],
                       check=True, capture_output=True, timeout=180)
    check_t4(run(T4_JS, tmp_path, tmp_path / "aramex_errors.xlsx"))


# ---------------------------------------------------------------- Test 5, legacy and v2.3
def test_5_v23_is_m1_only(tmp_path):
    if ARAMEX_V23.exists():
        body, files = "const Q = quoteOf(F[0], 'v23');", (ARAMEX_V23,)
    else:
        body, files = f"const Q = V.quote(JSON.parse(fs.readFileSync({json.dumps(str(ARAMEX_V23_VALUES))}, 'utf8')));", ()
    r = run(body + """ const list = [{id: 'ARX', name: 'Aramex', Q}], o = V.scenarios(list, null, 'A', 'best');
  out = {kind: Q.kind, tag: Q.tag, sc: all(o), T05: Q.m1.find(x => x.id === 'T05').price, m2: Q.m2.length, m5: Q.m5.length};""", tmp_path, *files)
    assert r["kind"] == "v23" and r["tag"] == "v2.3, M1 only"
    assert r["sc"]["S1"]["total"] == 188208.28 and r["sc"]["S1"]["notCovered"] == 12   # the same S1 as Test 2
    assert r["T05"] == 17894.40
    assert r["m2"] == 0 and r["m5"] == 0
    for k in ("S2", "S3", "S4", "S5"):
        assert r["sc"][k]["state"] == "not_configured"


def test_5_v1_is_legacy_and_excluded(tmp_path):
    r = run("""const Q = quoteOf(F[0], 'v1'), o = V.scenarios([{id: 'D', name: 'Dummy v1', Q}], null, 'A', 'best');
  out = {version: Q.version, kind: Q.kind, states: Object.fromEntries(['S1', 'S2', 'S3', 'S3b', 'S4', 'S5'].map(k => [k, o[k].state])),
    unknown: V.versionKind('RFQ-MENA-TR-MODULAR v9.9')};""", tmp_path, DUMMY_V1)
    assert r["kind"] == "legacy"
    assert set(r["states"].values()) == {"not_configured"}   # out of every scenario
    assert r["unknown"] == "unknown"
    assert "Legacy v1, not comparable" in (ASSETS / "benchmark.js").read_text()


# ---------------------------------------------------------------- validation and settings
def test_module_flags_and_choice(tmp_path):
    r = run("""const P = load(F[0]), v = V.valuesOf(P);
  const noPrices = Object.assign({}, v, {'module.M6.offered': 'No'});            // marked No but holds prices: prices used, flagged
  Object.keys(v).filter(k => /^m5\\..*\\.price_eur$/.test(k)).forEach(k => { noPrices[k] = null; });   // M5 Yes, no price: flagged
  const Q = V.quote(noPrices), S = %s;
  const Q2 = JSON.parse(JSON.stringify(V.quote(v))); Q2.m1.forEach(x => { if (x.price != null) x.price = x.price / 2; });
  const list = [{id: 'P', name: 'Dummy', Q: V.quote(v)}, {id: 'H', name: 'Half M1', Q: Q2}];
  out = {notes: Q.moduleNotes, f9: V.flags(Q, null).filter(f => f.id === 'F9').map(f => f.key), s5: V.scenarios([{id: 'P', name: 'D', Q}], null, 'A').S5.state,
    best: V.scenarios(list, S, 'A', 'best').S1.total, fixedP: V.scenarios(list, S, 'A', {M1: 'P'}).S1.total, fixedH: V.scenarios(list, S, 'A', 'H').S1.total,
    caseB: V.scenarios(list, S, 'B', 'best').S1.total};""" % json.dumps(T1_SETTINGS), tmp_path, DUMMY)
    assert {"module": "M6", "note": "marked No but holds prices; the prices are used"} in r["notes"]
    assert {"module": "M5", "note": "offered but not priced"} in r["notes"]
    assert sorted(r["f9"]) == ["module.M5.offered", "module.M6.offered"]
    assert r["s5"] == "indicative"
    assert r["best"] == 48500 and r["fixedP"] == 97000 and r["fixedH"] == 48500
    assert r["caseB"] > r["best"]


# ---------------------------------------------------------------- internal revenue (cost against revenue)
REV_JS = """const pick = (v, id) => ({pct: v.scenarios[id].total.pct, coveredOnly: v.scenarios[id].total.coveredOnly, net: v.scenarios[id].total.netUsd,
    contribution: v.scenarios[id].total.contribution, per1000: v.scenarios[id].total.per1000});"""


def aramex_quote_js():
    if ARAMEX_V30.exists():
        return "const Q = quoteOf(F[0]);", (ARAMEX_V30,)
    # the v2.3 Aramex answer gives the same S1 as the v3.0 Aramex test fill (Test 5)
    return f"const Q = V.quote(JSON.parse(fs.readFileSync({json.dumps(str(ARAMEX_V23_VALUES))}, 'utf8')));", ()


def test_revenue_defaults_aramex(tmp_path):
    body, files = aramex_quote_js()
    r = run(body + REV_JS + """ const list = [{id: 'ARX', name: 'Aramex', Q}];
  out = Object.fromEntries(['A', 'B'].map(sc => { const o = V.scenarios(list, null, sc, 'best'), v = V.revenueView(o, null, null);
    return [sc, {eur: r2(v.eur), perShipmentUsd: r2(v.perShipmentUsd), s1: pick(v, 'S1'), sa: r2(v.countries.L01.usd), gcc: r2(v.regions.GCC.eur),
      gccPct: v.scenarios.S1.regions.GCC.pct, allocated: v.allocated, answers: V.revenueAnswers(v)}]; }));""", tmp_path, *files)
    a, b = r["A"], r["B"]
    assert a["eur"] == 886521.00 and b["eur"] == 2065680.00
    assert round(a["s1"]["pct"] * 100, 2) == 21.23 and round(b["s1"]["pct"] * 100, 2) == 21.60
    assert a["s1"]["coveredOnly"] and b["s1"]["coveredOnly"]   # 12 shipments not covered: "covered shipments only"
    assert a["perShipmentUsd"] == 7304.96 and b["perShipmentUsd"] == 7294.83
    assert a["sa"] == 365248.23
    assert a["gcc"] == 679037.36 and round(a["gccPct"] * 100, 2) == 24.17 and round(b["gccPct"] * 100, 2) == 24.71
    assert len(a["allocated"]) == 9   # defaults in use: the warning shows
    assert a["answers"][0].startswith("In the GCC, shipping from Helmond costs 24.2% of revenue.")
    assert a["s1"]["per1000"] == pytest.approx(188208.28 / 1030, abs=0.01) and a["s1"]["contribution"] == pytest.approx(886521 - 188208.28, abs=0.01)


def test_revenue_dummy_and_distributor_discount(tmp_path):
    r = run(REV_JS + """ const Q = quoteOf(F[0]), list = [{id: 'P', name: 'Dummy', Q}], S = %s, o = V.scenarios(list, S, 'A', 'best');
  const v0 = V.revenueView(o, null, S), v20 = V.revenueView(o, {discount: {L01: 20}}, S);
  const own = V.revenueView(o, {byCountry: {A: {L01: 400000}}}, S);
  out = {s1: pick(v0, 'S1'), s3: pick(v0, 'S3'), s2: pick(v0, 'S2'), s2d: pick(v20, 'S2'), s1d: pick(v20, 'S1'), l01: v0.scenarios.S2.countries.L01.netUsd,
    l01d: v20.scenarios.S2.countries.L01.netUsd, s2cost: o.S2.total, lowest: v0.lowest, own: {usd: own.usd, allocated: own.allocated}};""" % json.dumps(T1_SETTINGS), tmp_path, DUMMY)
    assert round(r["s1"]["pct"] * 100, 2) == 10.94 and round(r["s3"]["pct"] * 100, 2) == 11.08
    assert not r["s1"]["coveredOnly"]
    assert r["l01d"] == pytest.approx(r["l01"] * 0.8)                 # net revenue in L01 drops by 20%
    assert r["s2d"]["net"] == pytest.approx(r["s2"]["net"] - 0.2 * r["l01"])
    assert r["s2d"]["pct"] == pytest.approx(r["s2cost"] / (r["s2d"]["net"] * 0.8607))   # the S2 % rises accordingly
    assert r["s2d"]["pct"] > r["s2"]["pct"] and r["s1d"]["pct"] == r["s1"]["pct"]       # only S2 distributor countries change
    assert r["lowest"] == "S2"
    assert "L01" not in r["own"]["allocated"] and r["own"]["usd"] == pytest.approx(1030000 - r["l01"] + 400000)


def test_revenue_stays_out_of_templates_and_settings(tmp_path):
    secrets = ("1030000", "2400000", "0.8607", "Revenue, internal")
    for f in (RFQ_TEMPLATE, DUMMY):
        z = __import__("zipfile").ZipFile(f)
        text = " ".join(z.read(n).decode("utf8", "ignore") for n in z.namelist() if n.endswith(".xml"))
        assert not any(s in text for s in secrets), f.name
    r = run("""out = {s: V.withDefaults({revenuePerOrder: {L01: 1}, revenue: {fx: 1}, s2: {L01: {on: true, discountPct: 20, salesValue: 5}}}), types: V.TYPES.map(t => t[0])};""", tmp_path)
    assert "revenuePerOrder" not in r["s"] and "revenue" not in r["s"]
    assert r["s"]["s2"]["L01"] == {"on": True, "loads": {"P1": 0, "P5": 0, "C20": 0, "C40": 0}}
    assert "commercial" not in r["types"]
