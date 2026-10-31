"""RFQ workflow (assets/rfq_core.js): parsing the Export sheet of a returned RFQ, the prefill of the
template's Provider Profile cells, and the merge of a response into a provider record. Runs the browser
module in node with the vendored SheetJS and JSZip."""
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

from flexitog.dashboard import ASSETS, RFQ_LEGACY_TEMPLATE as RFQ_TEMPLATE   # the v1 tests run on the v1 template

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "Sample_RFQ_Response_DUMMY.xlsx"
LIBS = [str(ASSETS / "vendor" / "xlsx.full.min.js"), str(ASSETS / "vendor" / "jszip.min.js"), str(ASSETS / "rfq_core.js")]


def run(body: str, tmp_path, *files):
    """Run async JS with X (SheetJS), JSZip, R (rfq core), fs, and F[] (file paths); prints `out`."""
    src = ("const X = require(process.argv[1]), JSZip = require(process.argv[2]), R = require(process.argv[3]), fs = require('fs');\n"
           "const F = process.argv.slice(4);\n(async () => {\n" + body + "\nconsole.log(JSON.stringify(out));\n})().catch(e => { console.error(e); process.exit(1); });")
    res = subprocess.run([NODE, "-e", src, *LIBS, *map(str, files)], capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


PARSE = "const P = R.parseWorkbook(X.read(fs.readFileSync(F[0]), {cellDates: true}), X);\n"


# ------------------------------------------------------------------ parsing the fixture
def test_parse_fixture(tmp_path):
    out = run(PARSE + """const out = {version: P.version, declared: P.declaredRows, keys: P.keyRows, v: P.values, types: P.types, uncached: R.isUncached(P),
      validate: R.validate(P, {id: 'PRV-0001', name: 'Example Forwarding Co. (dummy)'}), summary: R.summarize(P.values),
      sheets: P.sheetNames, hidden: P.hidden, unmapped: R.unmappedKeys(P.values)};""", tmp_path, FIXTURE)
    v = out["v"]
    assert out["version"] == "RFQ-MENA-TR v1.0" and out["declared"] == 734 and out["keys"] == 734
    assert v["provider.provider_id"] == "PRV-0001" and v["provider.name"] == "Example Forwarding Co. (dummy)"
    assert v["region.gulf_gcc"] == "Yes" and v["kpi.R1"] == pytest.approx(0.94)
    assert v["cost.A.total"] == pytest.approx(111608.98, abs=0.01) and v["cost.B.total"] == pytest.approx(243169.23, abs=0.01)
    assert v["provider.response_date"] == "2026-11-02" and v["provider.quote_valid_until"] == "2027-03-31"   # dates as calendar days
    assert v["kpi.R4"] in ("Yes", "Partial", "No") and v["kpi.R1.details"] == ""                            # ypn, empty answer = ""
    assert set(out["types"].values()) == {"text", "number", "percent", "date", "yesno", "ypn"}
    assert out["validate"] == {"ok": True, "errors": [], "warnings": [], "confirm": []} and not out["uncached"]
    s = out["summary"]
    assert s["costA"] == pytest.approx(111608.98, abs=0.01) and s["costB"] == pytest.approx(243169.23, abs=0.01)
    assert s["perKgB"] == pytest.approx(v["cost.B.per_kg"]) and s["onTargetB"] == pytest.approx(v["timeline.B.on_target_pct"])
    assert s["bandsWithoutRate"] == 0 and s["kpiWithEvidence"] == sum(1 for k, x in v.items() if k.endswith(".evidence") and x == "Yes")
    assert out["sheets"][-1] == "Export" and out["hidden"][-1] and not any(out["hidden"][:-1])
    assert out["unmapped"] == []                                         # every key belongs to a known prefix


def test_value_conversion(tmp_path):
    out = run("""const out = [R.convert(new Date(Date.UTC(2026, 10, 2)), 'date'), R.convert(46328, 'date'), R.convert('02-11-2026', 'date'),
      R.convert(94, 'percent'), R.convert('94%', 'percent'), R.convert(0.94, 'percent'), R.convert('yes', 'yesno'), R.convert('partly', 'ypn'),
      R.convert('', 'number'), R.convert(null, 'text'), R.convert('1.234,50', 'number'), R.convert('12', 'number')];""", tmp_path)
    assert out == ["2026-11-02", "2026-11-02", "2026-11-02", 0.94, 0.94, 0.94, "Yes", "Partial", "", "", 1234.5, 12]


def test_validation_rejects_wrong_version_and_row_count(tmp_path):
    out = run(PARSE + """const bad = Object.assign({}, P, {version: 'RFQ-OTHER v9'}), short = Object.assign({}, P, {keyRows: 700});
      const out = [R.validate(bad, null), R.validate(short, null), R.validate(P, {id: 'PRV-0009', name: 'X'}), R.validate(Object.assign({}, P, {values: Object.assign({}, P.values, {'provider.provider_id': ''})}), {id: 'PRV-0009', name: 'Other Name'})];""",
              tmp_path, FIXTURE)
    assert not out[0]["ok"] and "not supported" in out[0]["errors"][0]
    assert not out[1]["ok"] and "734" in out[1]["errors"][0]
    assert out[2]["ok"] and "PRV-0001" in out[2]["confirm"][0]
    assert out[3]["ok"] and "Other Name" in out[3]["confirm"][0]


# ------------------------------------------------------------------ prefill round trip
def test_prefill_round_trip(tmp_path):
    out_file = tmp_path / "prefilled.xlsx"
    out = run("""const bytes = fs.readFileSync(F[0]);
      const prov = {id: 'PRV-0042', name: 'Testing & Sons <Logistics>', website: 'www.testing.example.com', contactName: 'Ann Tester', contactPhone: '+31 40 123', contactEmail: 'ann@testing.example.com'};
      const res = await R.prefill(bytes, prov, JSZip);
      fs.writeFileSync(F[1], res);
      const wb = X.read(res, {cellDates: true}), P = R.parseWorkbook(wb, X), names = R.definedNames(wb);
      const pp = Object.fromEntries(R.PP_FIELDS.map(([n]) => [n, wb.Sheets[names[n].sheet][names[n].cell].v]));
      const out = {pp, sheets: wb.SheetNames, hidden: (wb.Workbook.Sheets || []).map(s => !!s.Hidden), version: P.version, uncached: R.isUncached(P),
        effective: R.effectiveValues(P)['provider.name'], validate: R.validate(P, {id: 'PRV-0042', name: prov.name}), name: R.fileName(prov, '2026-10-13')};""",
              tmp_path, RFQ_TEMPLATE, out_file)
    assert out["pp"] == {"PP_provider_id": "PRV-0042", "PP_name": "Testing & Sons <Logistics>", "PP_website": "www.testing.example.com",
                         "PP_contact_name": "Ann Tester", "PP_contact_phone": "+31 40 123", "PP_contact_email": "ann@testing.example.com"}
    orig = zipfile.ZipFile(RFQ_TEMPLATE)
    names = ["Read Me", "Provider Profile", "Volumes", "Timeline Rules", "Schedule A", "Schedule B", "Timeline Summary", "Rate Card", "Cost Overview",
             "Reliability & Quality", "Optional Regional Stock", "Export"]
    assert out["sheets"] == names and out["hidden"] == [False] * 11 + [True]
    assert out["version"] == "RFQ-MENA-TR v1.0" and out["name"] == "FlexiTog_RFQ_Testing_Sons_Logistics_2026-10-13.xlsx"
    # Not saved in Excel yet: identity comes from the PP cells, the upload warns that totals are missing.
    assert out["uncached"] and out["effective"] == "Testing & Sons <Logistics>" and out["validate"]["warnings"]
    # Every entry except the patched Provider Profile sheet is byte-identical, in the same order.
    new = zipfile.ZipFile(out_file)
    assert [i.filename for i in new.infolist()] == [i.filename for i in orig.infolist()]
    changed = [n for n in orig.namelist() if orig.read(n) != new.read(n)]
    assert changed == ["xl/worksheets/sheet2.xml"]
    for part in ("xl/charts/chart1.xml", "xl/charts/chart2.xml", "xl/drawings/drawing1.xml", "xl/media/image1.png", "xl/styles.xml", "xl/workbook.xml"):
        assert part in orig.namelist() and orig.read(part) == new.read(part)
    wb_xml = new.read("xl/workbook.xml").decode()
    assert 'fullCalcOnLoad="1"' in wb_xml
    sheet = new.read("xl/worksheets/sheet2.xml").decode()
    assert '<c r="B7" s="135" t="inlineStr"><is><t xml:space="preserve">Testing &amp; Sons &lt;Logistics&gt;</t></is></c>' in sheet
    assert "<sheetProtection" in sheet and "<dataValidations" in sheet
    # Other Python readers open the file too.
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.load_workbook(out_file)
    assert wb.sheetnames == names and wb["Provider Profile"]["B6"].value == "PRV-0042" and wb["Export"].sheet_state == "hidden"


def test_prefill_adds_full_calc_and_missing_cells(tmp_path):
    """A replaced template saved without fullCalcOnLoad, and without the B7 cell, still prefills."""
    src = tmp_path / "t.xlsx"
    with zipfile.ZipFile(RFQ_TEMPLATE) as zin, zipfile.ZipFile(src, "w", zipfile.ZIP_DEFLATED) as zout:
        for i in zin.infolist():
            data = zin.read(i.filename)
            if i.filename == "xl/workbook.xml":
                data = data.replace(b' fullCalcOnLoad="1"', b"")
            if i.filename == "xl/worksheets/sheet2.xml":
                data = data.replace(b'<c r="B7" s="135" t="n"></c>', b"")
            zout.writestr(i, data)
    out = run("""const res = await R.prefill(fs.readFileSync(F[0]), {id: 'PRV-0001', name: 'Fresh Co'}, JSZip);
      const wb = X.read(res, {cellDates: true}); const z = await JSZip.loadAsync(res);
      const out = {name: wb.Sheets['Provider Profile'].B7.v, wbxml: await z.file('xl/workbook.xml').async('string')};""", tmp_path, src)
    assert out["name"] == "Fresh Co" and 'fullCalcOnLoad="1"' in out["wbxml"]


# ------------------------------------------------------------------ mapping
def test_mapping_merges_and_never_removes(tmp_path):
    out = run(PARSE + """const prov = {id: 'PRV-0001', name: 'Example Forwarding Co. (dummy)', website: '', contactName: 'Alex Example', contactPhone: '',
        contactEmail: 'other@forwarder.example.com', hqCountry: '', providerTypes: ['Distributor'], servicesOffered: ['Road', 'Import customs brokerage'],
        regionsCovered: ['Türkiye'], countriesCovered: ['BH'], status: 'rfq_sent', rfqResponses: [], latestResponseIndex: -1};
      const M = R.mapResponse(prov, P, {fileName: 'resp.xlsx', today: '2026-10-13', uploadedAt: '2026-10-13T10:00:00Z', countryOf: n => ({Netherlands: 'NL'})[n]});
      const keep = R.applyResponse(prov, M, {}), take = R.applyResponse(keep.provider, R.mapResponse(keep.provider, P, {fileName: 'resp2.xlsx'}), {contactEmail: 'file'});
      const out = {M: {fill: M.fill, conflicts: M.conflicts, add: M.add, status: M.status, date: M.dateResponseReceived}, keep: keep.provider, changes: keep.changes,
        take: {email: take.provider.contactEmail, n: take.provider.rfqResponses.length, latest: take.provider.latestResponseIndex, first: take.provider.rfqResponses[0].fileName},
        metrics: R.getComparableMetrics(take.provider), v: P.values, labels: P.labels};""", tmp_path, FIXTURE)
    M, p, v, labels = out["M"], out["keep"], out["v"], out["labels"]
    # Identity: empty fields fill, differing fields become conflicts (default keep mine).
    assert M["fill"] == {"website": "forwarder.example.com", "contactPhone": "+31 40 000 0001", "hqCountry": "NL"}
    assert M["conflicts"] == [{"field": "contactEmail", "key": "provider.contact_email", "mine": "other@forwarder.example.com", "file": "alex@forwarder.example.com"}]
    assert p["contactEmail"] == "other@forwarder.example.com" and out["take"]["email"] == "alex@forwarder.example.com"
    # Types, services, regions: union with the Yes answers (labels from the description column), nothing removed.
    yes = lambda prefix: [labels[k] for k in v if k.startswith(prefix) and v[k] == "Yes"]
    assert set(p["providerTypes"]) == {"Distributor"} | set(yes("type.")) and p["providerTypes"][0] == "Distributor"
    assert set(p["servicesOffered"]) == {"Road", "Import customs brokerage"} | set(yes("service."))
    assert p["servicesOffered"][:2] == ["Road", "Import customs brokerage"] and len(p["servicesOffered"]) == len(set(p["servicesOffered"]))
    assert p["regionsCovered"] == ["Türkiye", "North Africa", "Gulf/GCC"] and "BH" in p["countriesCovered"]
    # Status, date and stored response.
    assert p["status"] == "response_received" and p["dateResponseReceived"] == "2026-11-02"
    assert len(p["rfqResponses"]) == 1 and p["latestResponseIndex"] == 0 and p["rfqResponses"][0]["rfqVersion"] == "RFQ-MENA-TR v1.0"
    assert len(p["rfqResponses"][0]["values"]) == 736 and p["rfqResponses"][0]["summary"]["costB"] == pytest.approx(243169.23, abs=0.01)
    assert p["rfqResponses"][0]["labels"]["kpi.R1"].startswith("On-time delivery") and p["rfqResponses"][0]["types"]["kpi.R1"] == "percent"
    # A re-upload adds a response and keeps the history.
    assert out["take"]["n"] == 2 and out["take"]["latest"] == 1 and out["take"]["first"] == "resp.xlsx"
    m = out["metrics"]
    assert m["costB"] == pytest.approx(243169.23, abs=0.01) and m["r1OnTime"] == pytest.approx(0.94) and m["h2Parties"] == v["kpi.H2"]
    assert m["q1Damage"] == pytest.approx(v["kpi.Q1"]) and set(m["lanes"]) == {f"L0{i}" for i in range(1, 10)} and len(m["kpi"]) == 31
    assert any("type" in c for c in out["changes"]) and any("response 1 stored" in c for c in out["changes"])


def test_detail_tables(tmp_path):
    out = run(PARSE + "const D = R.detail(P.values, P.labels); const out = {rates: D.rates.length, bands: D.bands, kpi: D.kpi.length, cov: D.coverage.length, costs: D.costs, t: D.timeline.length};",
              tmp_path, FIXTURE)
    assert out["rates"] == 45 and out["bands"] == ["B1", "B2", "B3", "B4", "B5"] and out["kpi"] == 31 and out["cov"] == 9 and out["t"] == 9
    assert out["costs"][1]["total"] == pytest.approx(243169.23, abs=0.01)


# ------------------------------------------------------------------ metadata sheet, validation per cell, rates
def _sources(tmp_path):
    from flexitog.dashboard import rfq_sources
    f = tmp_path / "sources.json"
    f.write_text(json.dumps(rfq_sources(RFQ_TEMPLATE)))
    return f


def test_template_source_map():
    from flexitog.dashboard import rfq_sources
    m = rfq_sources(RFQ_TEMPLATE)
    assert len(m) >= 700
    assert m["rate.L01.B1.rate_per_kg"] == ["Rate Card", "I5"] and m["rate.L09.B5.transit_days"] == ["Rate Card", "H49"]
    assert m["provider.currency"] == ["Provider Profile", "B16"] and m["provider.provider_id"] == ["Provider Profile", "B6"]


def test_prefill_adds_hidden_metadata_sheet(tmp_path):
    out_file = tmp_path / "meta.xlsx"
    out = run("""const res = await R.prefill(fs.readFileSync(F[0]), {id: 'PRV-0007', name: 'Meta Co'}, JSZip, {version: 'RFQ-MENA-TR v1.0'});
      fs.writeFileSync(F[1], res);
      const wb = X.read(res, {cellDates: true}), again = await R.prefill(res, {id: 'PRV-0008', name: 'Meta Co'}, JSZip, {version: 'RFQ-MENA-TR v1.0'});
      const out = {meta: R.readMeta(wb), sheets: wb.SheetNames, hidden: (wb.Workbook.Sheets || []).map(s => !!s.Hidden), cells: Object.keys(wb.Sheets._rfqmeta).filter(k => k[0] !== '!'),
        again: R.readMeta(X.read(again)), againSheets: X.read(again).SheetNames.length, none: R.readMeta(X.read(fs.readFileSync(F[2])))};""",
              tmp_path, RFQ_TEMPLATE, out_file, FIXTURE)
    assert out["meta"] == {"version": "RFQ-MENA-TR v1.0", "providerId": "PRV-0007"}
    assert out["sheets"][-1] == "_rfqmeta" and out["hidden"][-1] is True and len(out["sheets"]) == 13
    assert sorted(out["cells"]) == ["A1", "A2", "B1", "B2"]          # template version and provider ID, nothing else
    assert out["again"]["providerId"] == "PRV-0008" and out["againSheets"] == 13   # prefilling a prefilled file rewrites, never duplicates
    assert out["none"] is None                                         # files sent before the sheet existed
    orig, new = zipfile.ZipFile(RFQ_TEMPLATE), zipfile.ZipFile(out_file)
    changed = sorted(n for n in orig.namelist() if orig.read(n) != new.read(n))
    added = sorted(set(new.namelist()) - set(orig.namelist()))
    assert changed == ["[Content_Types].xml", "xl/_rels/workbook.xml.rels", "xl/workbook.xml", "xl/worksheets/sheet2.xml"] and added == ["xl/worksheets/sheet13.xml"]
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.load_workbook(out_file)
    assert wb["_rfqmeta"].sheet_state == "hidden" and wb["_rfqmeta"]["B2"].value == "PRV-0007" and wb["_rfqmeta"].max_row == 2


def _broken(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.load_workbook(FIXTURE)
    rc = wb["Rate Card"]
    rc["H12"] = None          # L02 B3 transit missing
    rc["I13"] = "abc"         # L02 B4 rate not a number
    rc["K14"] = -0.2          # L02 B5 fuel negative
    rc["I15"] = None; rc["J15"] = None   # L03 B1 neither rate nor minimum
    wb["Provider Profile"]["B16"] = None  # currency
    f = tmp_path / "broken.xlsx"
    wb.save(f)                # saved by openpyxl: no cached formula results, like a file never opened in Excel
    return f


def test_validate_rates_lists_every_problem_with_its_cell(tmp_path):
    src = _sources(tmp_path)
    out = run("""const S = JSON.parse(fs.readFileSync(F[3], 'utf8')), go = f => { const wb = X.read(fs.readFileSync(f), {cellDates: true}); const P = R.parseWorkbook(wb, X, {sources: S}); return R.validateRates(wb, P); };
      const out = {ok: go(F[0]), broken: go(F[1]).map(x => [x.sheet, x.cell, x.message]), empty: go(F[2]).map(x => [x.sheet, x.cell, x.message])};""",
              tmp_path, FIXTURE, _broken(tmp_path), RFQ_TEMPLATE, src)
    assert out["ok"] == []                                             # the answered sample passes (L01 is marked Not served)
    refs = {(s, c): m for s, c, m in out["broken"]}
    assert set(refs) == {("Provider Profile", "B16"), ("Rate Card", "H12"), ("Rate Card", "I13"), ("Rate Card", "K14"), ("Rate Card", "I15")}
    assert "currency" in refs[("Provider Profile", "B16")] and "transit time is missing" in refs[("Rate Card", "H12")]
    assert '"abc" is not a number' in refs[("Rate Card", "I13")] and "negative" in refs[("Rate Card", "K14")]
    assert "rate per kg or minimum charge is missing" in refs[("Rate Card", "I15")]
    # The blank template: one line per lane, pointing at its Rate Card rows and the Not served cell.
    lanes = [m for s, c, m in out["empty"] if "has no rates" in m]
    assert len(lanes) == 9 and "Fill in rows 15 to 19" in lanes[2] and "Provider Profile D55" in lanes[2]


def test_unsaved_file_reads_input_cells_and_prices_a_shipment(tmp_path):
    src = _sources(tmp_path)
    out = run("""const S = JSON.parse(fs.readFileSync(F[1], 'utf8')), wb = X.read(fs.readFileSync(F[0]), {cellDates: true});
      const P = R.parseWorkbook(wb, X, {sources: S}), v = R.effectiveValues(P), t = R.rateTable(v), row = t.find(r => r.lane === 'L02' && r.band === 'B3');
      const out = {fromInputs: P.fromInputs, uncached: R.isUncached(P), row, n: t.length, served: t.filter(r => r.served).length,
        c200: R.shipmentCost(row, 200), c10: R.shipmentCost(row, 10), none: R.shipmentCost({perKg: null, minCharge: null}, 50)};""", tmp_path, _broken(tmp_path), src)
    assert out["uncached"] and out["fromInputs"] > 400                 # no cached results: values come from the input cells
    r = out["row"]
    assert (r["mode"], r["perKg"], r["minCharge"], r["fuel"], r["docs"], r["other"], r["transit"]) == ("Air", 4.43, 120, 0.18, 25, 10, None)
    assert out["n"] == 45 and out["served"] == 40                       # L01 not served
    assert out["c200"] == pytest.approx(max(120, 4.43 * 200) * 1.18 + 25 + 10)
    assert out["c10"] == pytest.approx(120 * 1.18 + 35)                 # the minimum charge applies
    assert out["none"] is None
