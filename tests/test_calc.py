"""Calculation engine (assets/calc.js) and data templates (assets/data_core.js): landed cost against a hand
calculation, chargeable weight, rate units, currency, quote benchmark, strict upload validation, coverage and
target countries. Runs the browser modules in node."""
import json
import shutil
import subprocess

import pytest

from flexitog.dashboard import ASSETS

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

HELPERS = r"""
const C = require(process.argv[1]), D = require(process.argv[2]);
const product = {sku: "T-JKT", unit_weight_kg: 2, carton_l_cm: 60, carton_w_cm: 40, carton_h_cm: 40, units_per_carton: 8, unit_price_eur: 100};
const country = {country: "SA", duty_rate_pct: 5, clearance_fee_eur: 250, compliance_cost_eur: 6000, expected_yearly_units: 9000};
const settings = {eur_usd_rate: 1.16, insurance_rate_pct: 0.3, margin_pct: 25};
const quote = (o) => Object.assign({quote_id: "Q", provider_id: "P", lane_id: "L", base_rate: 3, rate_unit: "per kg", fuel_surcharge: 50,
  peak_surcharge: 20, war_risk_surcharge: 10, currency: "EUR"}, o || {});
"""


def run(body: str):
    src = HELPERS + "(async () => {\n" + body + "\nconsole.log(JSON.stringify(out));\n})().catch(e => { console.error(e); process.exit(1); });"
    res = subprocess.run([NODE, "-e", src, str(ASSETS / "calc.js"), str(ASSETS / "data_core.js")], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def close(a, b, tol=0.01):
    """Within tol (1%) of the expected value."""
    return abs(a - b) <= tol * abs(b)


def test_landed_cost_matches_the_hand_calculation():
    # Hand calculation, 400 garments of 2 kg, carton 60 x 40 x 40 cm with 8 garments, EXW EUR 100, air to Saudi Arabia:
    #   cartons = ceil(400 / 8) = 50; volume = 50 x 0.096 m3 = 4.8 m3; actual weight = 400 x 2 = 800 kg
    #   volume weight = 4.8 x 167 = 801.6 kg -> chargeable 801.6 kg (volume is higher)
    #   freight = 3.00 x 801.6 + 50 fuel + 20 peak + 10 war risk = 2,484.80 EUR -> 6.212 per garment
    #   insurance = 0.30% x (100 + 6.212) = 0.318636
    #   CIF = 100 + 6.212 + 0.318636 = 106.530636
    #   duty = 5% x 106.530636 = 5.326532
    #   clearance = 250 / 400 = 0.625; compliance = 6,000 / 9,000 = 0.666667
    #   landed = 106.530636 + 5.326532 + 0.625 + 0.666667 = 113.148835
    #   DAP = 113.148835 x 1.25 = 141.436043
    out = run("const r = C.landedCost({product, units: 400, quote: quote(), lane: {mode: 'air'}, country, settings}); const out = r;")
    g = out["perGarment"]
    assert out["shipment"]["cartons"] == 50 and close(out["shipment"]["m3"], 4.8) and close(out["shipment"]["kg"], 800)
    assert close(out["freight"]["chargeableKg"], 801.6) and out["freight"]["byVolume"] is True
    assert close(out["freight"]["totalEUR"], 2484.80)
    assert close(g["freight"], 6.212) and close(g["insurance"], 0.318636) and close(g["cif"], 106.530636)
    assert close(g["duty"], 5.326532) and close(g["clearance"], 0.625) and close(g["compliance"], 0.666667)
    assert close(g["landed"], 113.148835) and close(g["dap"], 141.436043)
    shares = {p["key"]: p["share"] for p in out["parts"]}
    assert close(sum(shares.values()), 1.0) and close(shares["exw"], 100 / 113.148835)


def test_chargeable_weight_factors_rate_units_minimum_and_usd():
    out = run("""const ship = C.shipmentOf(product, 400), out = {
      factors: ['air', 'road', 'sea', 'express'].map(m => C.chargeable(800, 4.8, m).chargeableKg),
      perM3: C.freight(quote({rate_unit: 'per m3', base_rate: 100, fuel_surcharge: 0, peak_surcharge: 0, war_risk_surcharge: 0}), ship, 'sea', settings),
      perShip: C.freight(quote({rate_unit: 'per shipment', base_rate: 900, fuel_surcharge: 0, peak_surcharge: 0, war_risk_surcharge: 0}), ship, 'road', settings),
      min: C.freight(quote({base_rate: 0.1, min_charge: 300, fuel_surcharge: 0, peak_surcharge: 0, war_risk_surcharge: 0}), ship, 'road', settings),
      usd: C.freight(quote({currency: 'USD', base_rate: 1, fuel_surcharge: 0, peak_surcharge: 0, war_risk_surcharge: 0}), ship, 'road', settings),
      gbp: C.landedCost({product, units: 400, quote: quote({currency: 'GBP'}), lane: {mode: 'air'}, country, settings}),
      missing: C.landedCost({product: Object.assign({}, product, {units_per_carton: null}), units: 400, quote: quote(), lane: {mode: 'air'}, country, settings}),
    };""")
    assert [round(x, 1) for x in out["factors"]] == [801.6, 1598.4, 4800.0, 960.0]   # air 167, road 333, sea 1000, express 200
    assert close(out["perM3"]["chargeableQty"], 4.8) and close(out["perM3"]["totalEUR"], 480)   # W/M: max(4.8 m3, 800 kg / 1000)
    assert out["perShip"]["chargeableQty"] == 1 and close(out["perShip"]["totalEUR"], 900)
    assert out["min"]["minApplied"] is True and close(out["min"]["totalEUR"], 300)
    assert close(out["usd"]["totalEUR"], 1598.4 / 1.16)
    assert "exchange rate" in out["gbp"]["error"] and "units_per_carton" in out["missing"]["error"]


def test_best_quote_skips_expired_and_other_bands():
    out = run("""const lanes = [{lane_id: 'L1', destination_id: 'SA', mode: 'air'}, {lane_id: 'L2', destination_id: 'SA', mode: 'sea'}];
      const quotes = [quote({quote_id: 'A', lane_id: 'L1', base_rate: 3, quote_date: '2026-09-01'}),
        quote({quote_id: 'B', lane_id: 'L1', base_rate: 1, quote_date: '2026-01-01', valid_until: '2026-06-30'}),
        quote({quote_id: 'C', lane_id: 'L2', base_rate: 50, rate_unit: 'per m3', quote_date: '2026-09-01', weight_from_kg: 0, weight_to_kg: 500}),
        quote({quote_id: 'D', lane_id: 'L2', base_rate: 60, rate_unit: 'per m3', quote_date: '2026-09-01', weight_from_kg: 500, weight_to_kg: null})];
      const best = m => C.bestLanded({product, units: 400, country, settings, quotes, lanes, mode: m, provider: 'all', today: '2026-10-26'});
      const out = {air: best('air').quoteId, sea: best('sea').quoteId, all: best('all').quoteId, none: best('road').error};""")
    assert out["air"] == "A"            # B is cheaper but expired
    assert out["sea"] == "D"            # 4,800 chargeable kg on sea: only the band above 500 kg applies
    assert out["all"] == "D" and "no valid quote" in out["none"]


def test_quote_benchmark_per_lane_and_provider():
    out = run("""const lanes = [{lane_id: 'L1', origin_id: 'HLM', destination_id: 'SA', mode: 'sea'}, {lane_id: 'L2', origin_id: 'HLM', destination_id: 'MA', mode: 'road'}];
      const q = (id, p, lane, rate, date, extra) => Object.assign({quote_id: id, provider_id: p, lane_id: lane, base_rate: rate, rate_unit: 'per m3', currency: 'EUR', quote_date: date, transit_days: 10}, extra || {});
      const quotes = [q('1', 'F1', 'L1', 100, '2026-10-01'), q('2', 'F2', 'L1', 116, '2026-09-01', {currency: 'USD'}), q('3', 'T1', 'L1', 130, '2026-10-10', {transit_days: 20}),
        q('4', 'F1', 'L1', 90, '2026-03-01'),                                  // older quote of F1 on L1: the newest counts
        q('5', 'F1', 'L2', 80, '2026-10-01'), q('6', 'T1', 'L2', 70, '2026-10-01'),
        q('7', 'F2', 'L2', 10, '2026-01-01', {valid_until: '2026-05-01'}),     // expired
        q('8', 'T1', 'L2', 75, '2026-06-01')];                                 // inside 6 months, outside 3; older than T1's quote 6
      const typeOf = id => (id[0] === 'T' ? '3PL' : 'forwarder');
      const st = (months, type) => C.quoteStats({quotes, lanes, today: '2026-10-26', months, type, typeOf, settings: {eur_usd_rate: 1.16}});
      const out = {all: st(0, 'all'), m3: st(3, 'all').quotes, m6: st(6, 'all').quotes, tpl: st(0, '3PL').quotes};""")
    lanes = {l["laneId"]: l for l in out["all"]["lanes"]}
    assert out["all"]["quotes"] == 7                      # quote 7 expired
    l1 = lanes["L1"]
    assert l1["quotes"] == 3 and close(l1["low"], 100) and close(l1["median"], 100) and close(l1["high"], 130)   # F2 116 USD = 100 EUR
    l2 = lanes["L2"]
    assert close(l2["low"], 70) and close(l2["median"], 75) and close(l2["high"], 80)
    prov = {p["providerId"]: p for p in out["all"]["providers"]}
    assert prov["F1"]["lanes"] == 2 and prov["F1"]["aboveMedian"] == 1 and close(prov["F1"]["shareAbove"], 0.5)
    assert prov["T1"]["aboveMedian"] == 1 and close(prov["T1"]["avgTransit"], 15)
    # 6 months (from 2026-04-26) drops quote 4; 3 months (from 2026-07-26) also drops quote 8; 3PL = T1's quotes 3, 6, 8
    assert out["m6"] == 6 and out["m3"] == 5 and out["tpl"] == 3


def test_upload_validation_lists_row_and_column_and_maps_rows():
    out = run("""const ctx = {toIso2: v => ({morocco: 'MA', ma: 'MA', jordan: 'JO'})[String(v).toLowerCase()] || String(v).toUpperCase(),
        isCountry: c => ['MA', 'SA', 'JO', 'NL'].includes(c), providers: [{dc_id: 'PRV-0001', name: 'Fwd Co', dc_type: 'freight_forwarder'}, {dc_id: 'DIST-SA', name: 'Dist', dc_type: 'distributor'}],
        lanes: [{lane_id: 'L-HLM-MA'}], quotes: [{quote_id: 'Q-0004'}], today: '2026-10-26', fileName: 'f.csv'};
      const P = ['category', 'brand', 'sku', 'weightKg', 'cartonLcm', 'cartonWcm', 'cartonHcm', 'unitsPerCarton', 'exwPriceEUR', 'hsCode'];
      const products = D.validateFile('products', {headers: P, rows: [
        ['jackets', 'FT', 'A-1', '2.1 kg', '60', '40', '40', '8', '139', '6201'],
        ['Hats', 'FT', '', 'x', '60', '40', '40', '8.5', '-3', ''],
        ['Coveralls', 'FT', 'A-1', '3', '60', '40', '40', '6', '199', '']]}, ctx);
      const missing = D.validateFile('products', {headers: ['sku', 'weightKg', 'colour'], rows: [['A', '1', 'red']]}, ctx);
      const quotes = D.validateFile('quotes', {headers: ['provider', 'laneId', 'quoteDate', 'validUntil', 'baseRate', 'rateUnit', 'currency', 'transitDaysDoorToDoor', 'status'], rows: [
        ['Fwd Co', 'L-HLM-MA', '2026-10-01', '2027-01-31', '0,55', 'Per KG', 'eur', '7', 'confirmed'],
        ['Nobody', 'L-NONE', '31-02-2026', '2026-01-01', '1', 'per pallet', 'GBP', '0', 'maybe']]}, ctx);
      const good = D.validateFile('quotes', {headers: ['provider', 'laneId', 'quoteDate', 'baseRate', 'rateUnit', 'currency', 'transitDaysDoorToDoor'], rows: [['PRV-0001', 'L-HLM-MA', '2026-10-01', '0.55', 'per kg', 'EUR', '7']]}, ctx);
      const goodRows = D.toTableRows('quotes', good.rows, ctx);
      const countries = D.validateFile('countries', {headers: ['name', 'dutyRate', 'preferenceCert', 'vatRate', 'clearanceFeeEUR', 'complianceCostEUR', 'expectedYearlyUnits'], rows: [
        ['Jordan', '5', 'EUR.1', '16', '190', '900', '2000'], ['Atlantis', '150', 'ATR', '20', '1', '1', '0']]}, ctx);
      const lanes = D.validateFile('lanes', {headers: ['origin', 'destinationCountry', 'mode'], rows: [['HLM', 'Morocco', 'road']]}, ctx);
      const prov = D.validateFile('logisticsProviders', {headers: ['name', 'type', 'customsBrokerage', 'freeZone', 'warehousing', 'complianceSupport', 'handoffsPerShipment', 'documentsPerShipment'], rows: [
        ['Fwd Co', 'forwarder', 'yes', 'no', 'false', 'true', '4', '5'], ['New 3PL', '3pl', 'true', 'true', 'true', 'maybe', '3', '4'], ['Dist', 'forwarder', 'true', 'true', 'true', 'true', '1', '1']]}, ctx);
      const merged = D.mergeInto('quotes', [{quote_id: 'Q-0004', base_rate: 1}], goodRows, false);
      const out = {products, missing, quotes, good, goodRows, countries, lanes, prov, merged};""")
    errs = [(e["row"], e["column"]) for e in out["products"]["errors"]]
    assert out["products"]["ok"] is False and out["products"]["rows"] == []      # nothing passes when anything fails
    assert (3, "category") in errs and (3, "sku") in errs and (3, "weightKg") in errs and (3, "unitsPerCarton") in errs and (3, "exwPriceEUR") in errs
    assert (4, "sku") in errs                                                     # duplicate of row 2
    assert not any(r == 2 for r, _ in errs)                                       # '2.1 kg' and 'jackets' are fine
    miss = [e["message"] for e in out["missing"]["errors"]]
    assert any('Unknown column "colour"' in m for m in miss) and any('Required column "category"' in m for m in miss)
    q = {(e["row"], e["column"]) for e in out["quotes"]["errors"]}
    assert {(3, "provider"), (3, "quoteDate"), (3, "rateUnit"), (3, "currency"), (3, "transitDaysDoorToDoor"), (3, "status")} <= q
    assert not any(r == 2 for r, _ in q)                                          # '0,55', 'Per KG' and 'eur' are read
    assert out["good"]["ok"] and out["goodRows"][0]["quote_id"] == "Q-0005" and out["goodRows"][0]["provider_id"] == "PRV-0001"
    g = out["goodRows"][0]
    assert g["data_status"] == "estimate" and g["source_ref"] == "upload: f.csv" and g["source_date"] == "2026-10-26" and g["fuel_surcharge"] == 0
    c = {(e["row"], e["column"]) for e in out["countries"]["errors"]}
    assert {(3, "name"), (3, "dutyRate"), (3, "expectedYearlyUnits")} <= c and not any(r == 2 for r, _ in c)
    assert out["lanes"]["rows"][0]["lane_id"] == "L-HLM-MA-ROAD" and out["lanes"]["rows"][0]["destination_id"] == "MA"
    p = {(e["row"], e["column"]) for e in out["prov"]["errors"]}
    assert (3, "complianceSupport") in p and (4, "name") in p                     # a distributor is not a forwarder
    assert out["merged"]["added"] == 1 and out["merged"]["updated"] == 0


def test_coverage_and_targets():
    out = run("""const tables = {
        countries: [{country: 'MA', duty_rate_pct: 0, preference_cert: 'EUR.1', vat_rate_pct: 20, clearance_fee_eur: 200, compliance_cost_eur: 800, expected_yearly_units: 5000, data_status: 'confirmed'},
                    {country: 'SA', duty_rate_pct: 5, preference_cert: 'none', vat_rate_pct: 15, clearance_fee_eur: 250, compliance_cost_eur: 6000, expected_yearly_units: 9000, data_status: 'estimate'},
                    {country: 'JO', target: false, duty_rate_pct: 5}],
        lanes: [{lane_id: 'L1', origin_id: 'HLM', destination_id: 'MA', mode: 'road', data_status: 'estimate'}],
        quotes: [], customers: [], sales_history: [], distribution_centers: []};
      const out = {cov: D.coverage(tables, ['MA', 'SA']), targets: D.targets(tables.countries)};""")
    ma, sa = out["cov"]["MA"], out["cov"]["SA"]
    assert ma["fields"] == 11 and ma["confirmed"] == 7 and close(ma["share"], 7 / 11)   # 7 country fields confirmed, 4 lane fields estimate
    assert sa["confirmed"] == 0 and sa["share"] == 0
    assert out["targets"] == ["MA", "SA"]                                             # target = false drops JO
