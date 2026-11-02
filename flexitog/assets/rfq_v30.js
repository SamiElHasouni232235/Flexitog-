/* FlexiTog RFQ MENA-TR v3.0 (modular): pure logic, no DOM.
 *
 * Providers price building blocks (modules), not scenarios:
 *   M1 direct delivery from Helmond (33 test shipments T01 to T33), M2 bulk transport from Helmond to a warehouse
 *   (36 loads B01 to B36: P1, P5, C20, C40 per lane), M3 customs and free-zone fees per country, M4 warehousing
 *   (warehouses A and B, W01 to W23), M5 delivery from the provider's warehouse (27 rows D01 to D27, sizes S, M, L),
 *   M6 another solution (description and five price lines), and 28 questions.
 * The tool assembles five scenarios from the modules, per volume case (A or B), country and order class:
 *   S1 direct from Helmond, S2 distributor holds stock, S3 3PL holds stock (S3b dedicated site), S4 own warehouse,
 *   S5 other (indicative, never ranked).
 * Volumes, targets, distributor loads, the 3PL choice and the own-site costs are FlexiTog's internal settings.
 * A v2.3 Quick Quote answer maps to M1 only; a v1 answer stays legacy and out of every scenario.
 *
 * Runs in the dashboard (window.FlexiRFQ30) and in node (tests/test_rfq_v30.py).
 */
(function (root) {
  "use strict";

  const VERSION = "RFQ-MENA-TR-MODULAR v3.0", V23 = "RFQ-MENA-TR-QUICK v2.3", LEGACY_VERSIONS = ["RFQ-MENA-TR v1.0"];
  const OK_CHECK = "No problems found";
  const LANES = {
    L01: {country: "SA", name: "Saudi Arabia", region: "GCC", gcc: true, alias: ["saudi", "ksa", "riyadh", "jeddah", "dammam"]},
    L02: {country: "AE", name: "United Arab Emirates", short: "UAE", region: "GCC", gcc: true, alias: ["uae", "emirates", "dubai", "abu dhabi", "jebel ali", "sharjah"]},
    L03: {country: "KW", name: "Kuwait", region: "GCC", gcc: true, alias: ["kuwait"]},
    L04: {country: "QA", name: "Qatar", region: "GCC", gcc: true, alias: ["qatar", "doha"]},
    L05: {country: "TR", name: "Türkiye", region: "Türkiye", alias: ["turkiye", "türkiye", "turkey", "istanbul"]},
    L06: {country: "MA", name: "Morocco", region: "North Africa", alias: ["morocco", "casablanca", "tanger"]},
    L07: {country: "DZ", name: "Algeria", region: "North Africa", alias: ["algeria", "algiers"]},
    L08: {country: "EG", name: "Egypt", region: "North Africa", alias: ["egypt", "cairo"]},
    L09: {country: "TN", name: "Tunisia", region: "North Africa", alias: ["tunisia", "tunis", "sousse"]},
  };
  const LANE_IDS = Object.keys(LANES);
  const BANDS = ["B1", "B2", "B3", "B4", "B5"];
  const CLASSES = [
    {band: "B1", size: "S", label: "Parcel"}, {band: "B2", size: "M", label: "Small consignment"}, {band: "B3", size: "L", label: "Pallet"},
    {band: "B4", size: "XL", label: "Multi-pallet"}, {band: "B5", size: "XXL", label: "Full load"},
  ];
  const STOCK_BANDS = ["B1", "B2", "B3"];   // sizes S, M and L go through a warehouse; XL and XXL ship direct
  const LOADS = {P1: {pallets: 1, kg: 250, label: "1 pallet"}, P5: {pallets: 5, kg: 1250, label: "5 pallets"}, C20: {pallets: 11, kg: 2750, label: "20ft container"}, C40: {pallets: 24, kg: 6000, label: "40ft container"}};
  const REGIONS = [["GCC", ["L01", "L02", "L03", "L04"]], ["Türkiye", ["L05"]], ["North Africa", ["L06", "L07", "L08", "L09"]]];
  const SCENARIOS = [
    {id: "S1", label: "Direct from Helmond", line: "Every customer order ships from Helmond to the customer door (M1)."},
    {id: "S2", label: "Distributor holds stock", line: "Bulk loads from Helmond to a distributor (M2), who serves the customers in its country."},
    {id: "S3", label: "3PL holds stock", line: "FlexiTog restocks a 3PL warehouse in the region (M2, M3); the 3PL stores, picks, packs (M4) and delivers (M5)."},
    {id: "S3b", label: "3PL dedicated site", line: "As S3, with a site the 3PL runs for FlexiTog only (W20 to W22)."},
    {id: "S4", label: "Own warehouse", line: "FlexiTog runs its own site in the region; transport and customs from providers (M2, M3, M5)."},
    {id: "S5", label: "Other", line: "A solution a provider advises (M6). Indicative, not ranked."},
  ];
  const TYPES = [["transport", "Transport to region"], ["customs", "Customs"], ["handling", "Warehouse handling"], ["storage", "Storage"],
    ["delivery", "Delivery to customer"], ["fixed", "Fixed"], ["direct", "Direct from Helmond"]];

  // ================================================================== settings (internal, never sent to providers)
  const vol = rows => Object.fromEntries(Object.entries(rows).map(([L, a]) => [L, Object.fromEntries(BANDS.map((b, i) => [b, a[i]]))]));
  const zeroLoads = () => ({P1: 0, P5: 0, C20: 0, C40: 0});
  const newSite = () => ({country: "L02", customs: "Free zone", m2: null, rentPerM2: null, fte: null, costPerFte: null, setup: null, licence: null,
    equipmentMonth: null, wmsMonth: null, insuranceYear: null, carryingCost: null, amortYears: 3, proxyProvider: "", proxyWarehouse: "A"});
  const roleWeights = () => ({cost: 25, service: 25, quality: 25, options: 25});
  const DEFAULT_SETTINGS = () => ({
    volumes: {   // Volume case A and Volume case B: annual customer shipments per lane and band
      A: vol({L01: [22, 8, 10, 8, 2], L02: [32, 0, 4, 0, 0], L03: [2, 0, 8, 2, 0], L04: [4, 6, 0, 0, 0], L05: [6, 4, 6, 0, 0], L06: [3, 1, 1, 1, 0], L07: [2, 1, 1, 0, 0], L08: [3, 1, 1, 1, 0], L09: [1, 0, 0, 0, 0]}),
      B: vol({L01: [51, 19, 23, 19, 5], L02: [75, 0, 9, 0, 0], L03: [5, 0, 19, 5, 0], L04: [9, 14, 0, 0, 0], L05: [14, 9, 14, 0, 0], L06: [7, 2, 3, 1, 0], L07: [5, 1, 2, 1, 0], L08: [7, 2, 3, 1, 0], L09: [2, 1, 1, 0, 0]}),
    },
    avgKg: {B1: 8, B2: 52, B3: 261, B4: 941, B5: 2380},
    cartons: {B1: 1, B2: 4, B3: 18}, pallets: {B1: 0, B2: 0, B3: 1},
    orderLines: {B1: 6, B2: 6, B3: 6, B4: 6, B5: 6},   // update from order history
    kgPerPallet: 250,
    targetDays: {L01: 2, L02: 2, L03: 2, L04: 2, L05: 3, L06: 3, L07: 5, L08: 4, L09: 4},
    volumeYear: 2027,
    s2: Object.fromEntries(LANE_IDS.map(L => [L, {on: false, loads: zeroLoads()}])),   // the distributor discount is internal revenue data (revenueSettings)
    s3: {provider: "", warehouse: "A", country: null, served: null, share: Object.fromEntries(LANE_IDS.map(L => [L, 100])), avgPallets: null, load: "C20",
      labelling: false, amortYears: 3, carryingPct: 0, stockValue: 0, moduleSource: "same"},   // carrying cost and stock value: input from Finance
    s4: {sites: [], moduleSource: "same"},   // per site; sources: free-zone authority quotes, Benten (warehouse), Anna Murphy (finance)
    weights: {forwarder: roleWeights(), threepl: roleWeights()},   // to be agreed with Mies
    rubric: null,
  });
  function withDefaults(s) {
    const d = DEFAULT_SETTINGS(), o = s || {};
    const m2 = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, Object.assign({}, a[k], (b || {})[k] || {})]));
    const s2 = Object.fromEntries(LANE_IDS.map(L => { const x = ((o.s2 || {})[L]) || {}; return [L, {on: !!x.on, loads: Object.assign(zeroLoads(), x.loads || {})}]; }));
    const o2 = Object.assign({}, o); ["revenuePerOrder", "revenueSource", "revenue"].forEach(k => delete o2[k]);   // revenue never rides in these settings
    return Object.assign(d, o2, {
      volumes: {A: m2(d.volumes.A, (o.volumes || {}).A), B: m2(d.volumes.B, (o.volumes || {}).B)},
      avgKg: Object.assign(d.avgKg, o.avgKg || {}), cartons: Object.assign(d.cartons, o.cartons || {}), pallets: Object.assign(d.pallets, o.pallets || {}),
      orderLines: Object.assign(d.orderLines, o.orderLines || {}), targetDays: Object.assign(d.targetDays, o.targetDays || {}),
      s2, s3: Object.assign(d.s3, o.s3 || {}, {share: Object.assign(d.s3.share, (o.s3 || {}).share || {})}),
      s4: Object.assign(d.s4, o.s4 || {}, {sites: ((o.s4 || {}).sites || []).map(x => Object.assign(newSite(), x))}),
      weights: {forwarder: Object.assign(roleWeights(), ((o.weights || {}).forwarder) || {}), threepl: Object.assign(roleWeights(), ((o.weights || {}).threepl) || {})},
      rubric: o.rubric || null,
    });
  }

  // ================================================================== reading the values
  const isBlank = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
  const pad = n => String(n).padStart(2, "0");
  const dateIso = d => { const t = new Date(d.getTime() + 12 * 3600000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  const serialIso = n => dateIso(new Date(Math.round((n - 25569) * 86400000)));
  // A number, or null for anything else. Text counts only when it is plainly a number; "incl", "tbc" or "on request" stay text.
  function strictNumber(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean" || v instanceof Date) return null;
    let s = String(v).trim().replace(/[\s ]/g, "").replace(/^€|€$|^EUR|EUR$/gi, "");
    if (!/^-?[\d.,]+%?$/.test(s)) return null;
    const pctSign = s.endsWith("%"); s = s.replace(/%$/, "");
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? (pctSign ? n / 100 : n) : null;
  }
  // Keys that must hold a number or stay blank; text there is invalid, listed by key and left out of every sum.
  const NUMERIC = [/^m1\.T\d+\.(price_eur|transit_days)$/, /^m2\.B\d+\.(price_eur|transit_days|alt_price_eur|alt_transit_days)$/,
    /^m3\.L\d+\.(clearance_eur|fz_entry_eur|fz_exit_eur|clearance_days)$/, /^m4\.[AB]\.W(0[5-9]|1\d|2[013])$/, /^m5\.D\d+\.(price_eur|transit_days)$/,
    /^m6\.O04$/, /^m6\.P\d\.price_eur$/, /^q\.Q(08|11)\.answer$/, /^ship\.T\d+\.opt[123]_(delivery_)?price_eur$/, /^ship\.T\d+\.opt[123]_transit_days$/];
  const PERCENT = [/^q\.Q(06|13|14|27)\.answer$/, /^m4\.[AB]\.W22$/];
  const isNumericKey = k => NUMERIC.some(re => re.test(k)), isPercentKey = k => PERCENT.some(re => re.test(k));
  function convert(raw, type, key) {
    if (isBlank(raw)) return "";
    if (key && (isNumericKey(key) || isPercentKey(key))) {
      const n = strictNumber(raw); if (n === null) return String(raw).trim();
      if (isPercentKey(key)) return typeof raw === "string" && raw.includes("%") ? n : n > 1.5 ? n / 100 : n;   // fractions; 95 written whole becomes 0.95
      return n;
    }
    switch (type) {
      case "number": { const n = strictNumber(raw); return n === null ? String(raw).trim() : n; }
      case "percent": { const n = strictNumber(raw); return n === null ? String(raw).trim() : n > 1.5 ? n / 100 : n; }
      case "date": {
        if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? "" : dateIso(raw);
        if (typeof raw === "number") return raw > 0 ? serialIso(raw) : "";
        const s = String(raw).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
        if (!m) return /^\d+(\.\d+)?$/.test(s) ? serialIso(Number(s)) : s;
        return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
      }
      case "time": {
        let f = null;
        if (typeof raw === "number") f = raw - Math.floor(raw);
        else if (raw instanceof Date) { const ms = raw.getTime() - Date.UTC(1899, 11, 30); f = ((ms / 86400000) % 1 + 1) % 1; }
        else { const m = String(raw).trim().match(/^(\d{1,2})[:.h](\d{2})/); return m ? `${pad(m[1])}:${m[2]}` : String(raw).trim(); }
        const min = Math.round(f * 1440) % 1440;
        return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
      }
      default: return raw instanceof Date ? dateIso(raw) : String(raw).trim();
    }
  }
  // The converted values of a workbook parsed by FlexiRFQ.parseWorkbook (P.rawValues and P.types).
  function valuesOf(P) {
    const out = {};
    Object.keys(P.rawValues || P.values || {}).forEach(k => { out[k] = convert((P.rawValues || {})[k] !== undefined ? P.rawValues[k] : P.values[k], (P.types || {})[k], k); });
    return out;
  }
  const versionKind = v => (v === VERSION ? "v30" : v === V23 ? "v23" : LEGACY_VERSIONS.includes(v) ? "legacy" : "unknown");
  const minutes = t => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  // The lane a free text names ("Dubai, UAE" -> L02), or null.
  function laneOfText(t) {
    const s = String(t || "").toLowerCase(); if (!s) return null;
    return LANE_IDS.find(L => s.includes(LANES[L].name.toLowerCase()) || LANES[L].alias.some(a => new RegExp(`(^|[^a-z])${a}([^a-z]|$)`).test(s))) || null;
  }
  const lanesOfText = t => { const s = String(t || "").toLowerCase(); if (/all\s*9|all nine|all countries/.test(s)) return LANE_IDS.slice();
    return LANE_IDS.filter(L => s.includes(LANES[L].name.toLowerCase()) || LANES[L].alias.some(a => new RegExp(`(^|[^a-z])${a}([^a-z]|$)`).test(s)) || new RegExp(`\\b${L}\\b`, "i").test(s)); };

  /* quote(values) -> one provider's answer as records (both versions):
       {version, kind, tag, inputCheck, contact, deadline, modules: {M1..M6: "Yes"|"No"|""}, m1, m2, m3, m4: {A, B, comments}, m5, m6,
        q: {Q01: {answer, comment}}, invalid: [{key, value, reason}], moduleNotes, name}
     A blank price is not offered; text in a number field is invalid, listed and left out. */
  function quote(values) {
    const v = values || {}, invalid = [];
    const num = k => { const x = v[k]; if (isBlank(x)) return null; if (typeof x === "number" && Number.isFinite(x)) { if (x < 0) { invalid.push({key: k, value: x, reason: "negative"}); return null; } return x; } invalid.push({key: k, value: x, reason: "text"}); return null; };
    const txt = k => (isBlank(v[k]) ? "" : String(v[k]).trim());
    const ids = re => [...new Set(Object.keys(v).map(k => (k.match(re) || [])[1]).filter(Boolean))].sort();
    const version = txt("meta.rfq_version"), kind = versionKind(version);
    const q = Object.fromEntries(Array.from({length: 28}, (_, i) => "Q" + pad(i + 1)).map(id => {
      const k = `q.${id}.answer`, a = isNumericKey(k) || isPercentKey(k) ? num(k) : (isBlank(v[k]) ? null : v[k]);
      return [id, {answer: a, comment: txt(`q.${id}.comment`)}];
    }));
    let m1 = [], m2 = [], m3 = {}, m4 = {A: {}, B: {}, comments: {}}, m5 = [], m6 = {O01: "", O02: "", O03: "", O04: null, O05: "", lines: []}, modules = {};
    if (kind === "v23") {   // Quick Quote v2.3: Option 1 is M1 (same IDs, lanes and bands); every other module stays empty
      m1 = ids(/^ship\.(T\d+)\.lane$/).map(id => ({id, lane: txt(`ship.${id}.lane`), band: txt(`ship.${id}.band`), size: txt(`ship.${id}.size`), kg: Number(v[`ship.${id}.gross_kg`]) || null,
        cartons: Number(v[`ship.${id}.cartons`]) || null, m3: Number(v[`ship.${id}.m3`]) || null, service: txt(`ship.${id}.opt1_service`), price: num(`ship.${id}.opt1_price_eur`),
        transit: num(`ship.${id}.opt1_transit_days`), comment: txt(`ship.${id}.comment`)}));
      modules = {M1: m1.some(r => r.price != null) ? "Yes" : "", M2: "", M3: "", M4: "", M5: "", M6: ""};
    } else {
      m1 = ids(/^m1\.(T\d+)\.lane$/).map(id => ({id, lane: txt(`m1.${id}.lane`), band: txt(`m1.${id}.band`), size: txt(`m1.${id}.size`), kg: Number(v[`m1.${id}.gross_kg`]) || null,
        cartons: Number(v[`m1.${id}.cartons`]) || null, m3: Number(v[`m1.${id}.m3`]) || null, service: txt(`m1.${id}.service`), price: num(`m1.${id}.price_eur`),
        transit: num(`m1.${id}.transit_days`), comment: txt(`m1.${id}.comment`)}));
      m2 = ids(/^m2\.(B\d+)\.lane$/).map(id => ({id, lane: txt(`m2.${id}.lane`), load: txt(`m2.${id}.load`), pallets: Number(v[`m2.${id}.pallets`]) || null, kg: Number(v[`m2.${id}.gross_kg`]) || null,
        m3: Number(v[`m2.${id}.m3`]) || null, mode: txt(`m2.${id}.mode`), price: num(`m2.${id}.price_eur`), transit: num(`m2.${id}.transit_days`),
        altMode: txt(`m2.${id}.alt_mode`), altPrice: num(`m2.${id}.alt_price_eur`), altTransit: num(`m2.${id}.alt_transit_days`), comment: txt(`m2.${id}.comment`)}));
      ids(/^m3\.(L\d+)\.clearance_eur$/).forEach(L => { m3[L] = {clearance: num(`m3.${L}.clearance_eur`), fzEntry: num(`m3.${L}.fz_entry_eur`), fzExit: num(`m3.${L}.fz_exit_eur`),
        deposit: txt(`m3.${L}.deposit`), days: num(`m3.${L}.clearance_days`), comment: txt(`m3.${L}.comment`)}; });
      ["A", "B"].forEach(w => { for (let i = 1; i <= 23; i++) { const id = "W" + pad(i), k = `m4.${w}.${id}`; m4[w][id] = i <= 4 ? (txt(k) || null) : num(k); } });
      for (let i = 1; i <= 23; i++) m4.comments["W" + pad(i)] = txt(`m4.W${pad(i)}.comment`);
      m5 = ids(/^m5\.(D\d+)\.lane$/).map(id => ({id, lane: txt(`m5.${id}.lane`), band: txt(`m5.${id}.band`), size: txt(`m5.${id}.size`), kg: Number(v[`m5.${id}.gross_kg`]) || null,
        cartons: Number(v[`m5.${id}.cartons`]) || null, warehouse: txt(`m5.${id}.warehouse`).toUpperCase(), price: num(`m5.${id}.price_eur`), transit: num(`m5.${id}.transit_days`),
        nextDay: txt(`m5.${id}.next_day`), comment: txt(`m5.${id}.comment`)}));
      m6 = {O01: txt("m6.O01"), O02: txt("m6.O02"), O03: txt("m6.O03"), O04: num("m6.O04"), O05: txt("m6.O05"),
        lines: ids(/^m6\.(P\d)\.desc$/).map(id => ({id, desc: txt(`m6.${id}.desc`), unit: txt(`m6.${id}.unit`).toLowerCase(), price: num(`m6.${id}.price_eur`)})).filter(l => l.desc || l.price != null)};
      ["M1", "M2", "M3", "M4", "M5", "M6"].forEach(M => { const x = txt(`module.${M}.offered`); modules[M] = /^y/i.test(x) ? "Yes" : /^n/i.test(x) ? "No" : ""; });
    }
    const Q = {version, kind, tag: kind === "v23" ? "v2.3, M1 only" : kind === "v30" ? "v3.0" : kind, inputCheck: isBlank(v["meta.input_check"]) ? null : String(v["meta.input_check"]),
      contact: txt("meta.contact"), deadline: txt("meta.deadline"), modules, m1, m2, m3, m4, m5, m6, q, invalid,
      name: q.Q01.answer || "", validUntil: q.Q05.answer || ""};
    Q.priced = pricedModules(Q);
    // offered but not priced, or marked No but holding prices (prices used)
    Q.moduleNotes = ["M1", "M2", "M3", "M4", "M5", "M6"].flatMap(M => (Q.modules[M] === "Yes" && !Q.priced[M] ? [{module: M, note: "offered but not priced"}]
      : Q.modules[M] === "No" && Q.priced[M] ? [{module: M, note: "marked No but holds prices; the prices are used"}] : []));
    return Q;
  }
  const W_RATES = Array.from({length: 19}, (_, i) => "W" + pad(i + 5));
  function pricedModules(Q) {
    return {M1: Q.m1.some(r => r.price != null), M2: Q.m2.some(r => r.price != null || r.altPrice != null),
      M3: Object.values(Q.m3).some(x => x.clearance != null || x.fzEntry != null || x.fzExit != null),
      M4: ["A", "B"].some(w => W_RATES.some(id => Q.m4[w][id] != null)), M5: Q.m5.some(r => r.price != null), M6: Q.m6.lines.some(l => l.price != null)};
  }
  // Completeness per module: share of the rows (or required fields) that carry a price.
  const M4_REQUIRED = ["W01", "W02", "W03", "W05", "W06", "W07", "W08", "W09", "W11", "W12", "W15", "W18", "W19"];
  function completeness(Q) {
    const share = (a, b) => (b ? a / b : 0), whs = ["A", "B"].filter(w => !isBlank(Q.m4[w].W01) || W_RATES.some(id => Q.m4[w][id] != null));
    const m4 = whs.length ? Math.max(...whs.map(w => share(M4_REQUIRED.filter(id => !isBlank(Q.m4[w][id]) || (id === "W09" && Q.m4[w].W10 != null)).length, M4_REQUIRED.length))) : 0;
    return {M1: share(Q.m1.filter(r => r.price != null).length, Q.m1.length), M2: share(Q.m2.filter(r => r.price != null).length, Q.m2.length),
      M3: share(Object.values(Q.m3).filter(x => x.clearance != null).length, LANE_IDS.length), M4: m4,
      M5: share(Q.m5.filter(r => r.price != null).length, Q.m5.length), M6: Q.m6.O01 && Q.m6.lines.some(l => l.price != null) ? 1 : Q.m6.O01 || Q.m6.lines.length ? 0.5 : 0};
  }

  // ================================================================== module prices with extrapolation and provider choice
  /* list: [{id, name, Q}] (v3.0 and v2.3 answers only). choice: "best" (cheapest provider per module and cell) or a provider id.
     A band without a row in the module takes the next lower band's price per kg x the band's average kg ("extrapolated");
     a row that exists but is blank is not offered. */
  function m1Own(Q, lane, band, S) {
    const rows = Q.m1.filter(r => r.lane === lane), own = rows.find(r => r.band === band);
    if (own) return own.price == null ? null : {price: own.price, transit: own.transit, service: own.service, tag: "quoted", key: `m1.${own.id}.price_eur`, id: own.id};
    const lower = BANDS.slice(0, BANDS.indexOf(band)).reverse().map(b => rows.find(r => r.band === b)).find(Boolean);
    if (!lower || lower.price == null || !(lower.kg > 0)) return null;
    return {price: lower.price / lower.kg * (Number(S.avgKg[band]) || 0), transit: lower.transit, service: lower.service, tag: "extrapolated", key: `m1.${lower.id}.price_eur`, id: lower.id, from: lower.band};
  }
  function m5Own(Q, wh, lane, band, S) {
    const rows = Q.m5.filter(r => r.lane === lane && (!r.warehouse || r.warehouse === wh)), own = rows.find(r => r.band === band && r.price != null) || null;
    if (own) return {price: own.price, transit: own.transit, nextDay: /^y/i.test(own.nextDay), tag: "quoted", key: `m5.${own.id}.price_eur`, id: own.id};
    if (rows.some(r => r.band === band)) return null;
    const lower = STOCK_BANDS.slice(0, STOCK_BANDS.indexOf(band)).reverse().map(b => rows.find(r => r.band === b && r.price != null)).find(Boolean);
    if (!lower || !(lower.kg > 0)) return null;
    return {price: lower.price / lower.kg * (Number(S.avgKg[band]) || 0), transit: lower.transit, nextDay: /^y/i.test(lower.nextDay), tag: "extrapolated", key: `m5.${lower.id}.price_eur`, id: lower.id};
  }
  const m2Own = (Q, lane, load) => { const r = Q.m2.find(x => x.lane === lane && x.load === load); return r && r.price != null ? {price: r.price, transit: r.transit, mode: r.mode, kg: r.kg || LOADS[load].kg, pallets: r.pallets || LOADS[load].pallets, tag: "quoted", key: `m2.${r.id}.price_eur`} : null; };
  const m2Key = (Q, lane, load) => { const r = (Q.m2 || []).find(x => x.lane === lane && x.load === load); return r ? `m2.${r.id}.price_eur` : `m2.${lane}.${load}.price_eur`; };
  function pick(list, choice, fn) {
    const ps = choice && choice !== "best" ? list.filter(p => p.id === choice) : list;
    let best = null;
    ps.forEach(p => { const x = fn(p.Q); if (x && (!best || x.price < best.price)) best = Object.assign({provider: p.id, name: p.name}, x); });
    return best;
  }

  // ================================================================== the scenarios
  // The provider filter: "best" (cheapest per price), one provider id for every module, or {M1, M2, M3, M4, M5, M6} per module.
  const chosen = (ctx, M) => (ctx.choice && typeof ctx.choice === "object" ? ctx.choice[M] || "best" : ctx.choice || "best");
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  function result(id, S, sc) {
    // stock / stockDH: orders through a warehouse and their delivery + handling (for the cost per order of a class)
    const countries = Object.fromEntries(LANE_IDS.map(L => [L, {cost: 0, shipments: 0, covered: 0, measured: 0, onTime: 0, orders: 0, kg: 0, stock: 0, stockDH: 0, missing: [], state: "complete",
      types: Object.fromEntries(TYPES.map(([k]) => [k, 0])), byClass: {}}]));
    return {id, sc, state: "complete", parts: {}, types: Object.fromEntries(TYPES.map(([k]) => [k, 0])), countries, missing: [], filled: 0, required: 0, tags: [], flags: [],
      providers: {M1: [], M2: [], M3: [], M4: [], M5: [], M6: []}, oneOff: 0, nextDay: [], notes: []};
  }
  const tag = (R, t) => { if (!R.tags.includes(t)) R.tags.push(t); };
  const used = (R, M, name) => { if (name && !R.providers[M].includes(name)) R.providers[M].push(name); };
  function add(R, L, part, type, amount) {
    if (!amount) return;
    R.parts[part] = (R.parts[part] || 0) + amount; R.types[type] += amount;
    if (L) { R.countries[L].cost += amount; R.countries[L].types[type] += amount; }
  }
  // Spread a warehouse-wide amount over the served countries by weight (kg or orders).
  function spread(R, weights, part, type, amount) {
    if (!amount) return;
    const tot = sum(Object.values(weights), w => w);
    R.parts[part] = (R.parts[part] || 0) + amount; R.types[type] += amount;
    if (!(tot > 0)) return;
    Object.entries(weights).forEach(([L, w]) => { const a = amount * w / tot; R.countries[L].cost += a; R.countries[L].types[type] += a; });
  }
  const need = (R, ok, key, L) => { R.required++; if (ok) R.filled++; else { if (!R.missing.includes(key)) R.missing.push(key); if (L) { R.countries[L].missing.push(key); R.countries[L].state = "incomplete"; } } return ok; };
  const volume = (S, sc, L, b, mult) => (Number(((S.volumes[sc] || {})[L] || {})[b]) || 0) * (mult == null ? 1 : mult);
  // Direct from Helmond for a share of one lane-band volume (S1, and the rest of S2, S3, S4).
  function direct(R, ctx, L, b, n) {
    if (!(n > 0)) return;
    const c = R.countries[L], x = pick(ctx.list, chosen(ctx, "M1"), Q => m1Own(Q, L, b, ctx.S));
    c.shipments += n; c.kg += n * (Number(ctx.S.avgKg[b]) || 0);
    if (!x) { R.notCovered = (R.notCovered || 0) + n; c.byClass[b] = Object.assign(c.byClass[b] || {}, {direct: null}); return; }
    used(R, "M1", x.name); if (x.tag === "extrapolated") tag(R, "extrapolated");
    add(R, L, "direct", "direct", n * x.price);
    c.covered += n; c.measured += n; c.orders += n;
    const target = Number(ctx.S.targetDays[L]);
    if (x.transit != null && x.transit <= target) c.onTime += n;
    if (LANES[L].gcc && x.transit != null && x.transit <= 1 && !R.nextDay.includes(L)) R.nextDay.push(L);
    c.byClass[b] = Object.assign(c.byClass[b] || {}, {direct: x});
  }
  function s1(ctx, sc, mult) {
    const R = result("S1", ctx.S, sc);
    if (!ctx.list.some(p => p.Q.m1.some(r => r.price != null))) { R.state = "not_configured"; R.notes.push("No provider prices M1."); return finish(R, ctx); }
    LANE_IDS.forEach(L => BANDS.forEach(b => direct(R, ctx, L, b, volume(ctx.S, sc, L, b, mult))));
    tag(R, "quoted");
    return finish(R, ctx);
  }
  function s2(ctx, sc) {
    const R = result("S2", ctx.S, sc), on = LANE_IDS.filter(L => ctx.S.s2[L] && ctx.S.s2[L].on);
    if (!on.length) { R.state = "not_configured"; R.notes.push("No distributor country is set (S2 settings)."); return finish(R, ctx); }
    LANE_IDS.forEach(L => {
      if (!on.includes(L)) { BANDS.forEach(b => direct(R, ctx, L, b, volume(ctx.S, sc, L, b))); return; }
      const cfg = ctx.S.s2[L], c = R.countries[L];
      BANDS.forEach(b => { const n = volume(ctx.S, sc, L, b); c.shipments += n; c.covered += n; c.kg += n * (Number(ctx.S.avgKg[b]) || 0); });   // the distributor serves them
      Object.entries(cfg.loads).forEach(([load, count]) => {
        if (!(Number(count) > 0)) return;
        const x = pick(ctx.list, chosen(ctx, "M2"), Q => m2Own(Q, L, load));
        if (!need(R, !!x, `${(ctx.list[0] && m2Key(ctx.list[0].Q, L, load)) || `m2.${L}.${load}`} (${load} to ${LANES[L].name} not quoted)`, L)) return;
        used(R, "M2", x.name);
        add(R, L, "bulk", "transport", Number(count) * x.price);
      });
    });
    tag(R, "excludes distributor margin");   // the distributor discount lowers net revenue (revenueView), not the cost
    R.distributors = on;
    tag(R, "quoted");
    return finish(R, ctx);
  }
  // The provider and warehouse S3 uses: a fixed M4 provider in the filter, else the setting, else the first with M4 data.
  function s3Choice(ctx) {
    const S = ctx.S.s3, hasM4 = p => ["A", "B"].some(w => !isBlank(p.Q.m4[w].W01) || W_RATES.some(id => p.Q.m4[w][id] != null)) || p.Q.m5.some(r => r.price != null) || p.Q.modules.M4 === "Yes";
    const f = chosen(ctx, "M4"), fixed = f !== "best" ? ctx.list.find(x => x.id === f && hasM4(x)) : null;
    const p = fixed || ctx.list.find(x => x.id === S.provider) || ctx.list.find(hasM4) || null;
    return p ? {p, wh: p.id === S.provider && S.warehouse === "B" ? "B" : "A"} : null;
  }
  // Transport and customs into the warehouse country: a fixed M2 / M3 provider in the filter, else the same provider, or the cheapest per module.
  function inbound(ctx, R, p, source, lane, load, fz) {
    const of = M => { const f = chosen(ctx, M); return f !== "best" ? ctx.list.filter(x => x.id === f) : source === "cheapest" ? ctx.list : [p]; };
    const t = pick(of("M2"), "best", Q => m2Own(Q, lane, load));
    const keyT = m2Key(p.Q, lane, load);
    need(R, !!t, `${keyT} (${load} to ${LANES[lane].name})`);
    const m3 = pick(of("M3"), "best", Q => (Q.m3[lane] && Q.m3[lane].clearance != null ? {price: Q.m3[lane].clearance, fzEntry: Q.m3[lane].fzEntry, fzExit: Q.m3[lane].fzExit} : null));
    need(R, !!m3, `m3.${lane}.clearance_eur`);
    if (fz) { need(R, !!(m3 && m3.fzEntry != null), `m3.${lane}.fz_entry_eur`); need(R, !!(m3 && m3.fzExit != null), `m3.${lane}.fz_exit_eur`); }
    if (t) used(R, "M2", t.name); if (m3) used(R, "M3", m3.name);
    return {t, m3};
  }
  /* S3 3PL holds stock. Orders of sizes S, M, L in served countries go through the warehouse (times the share from stock);
     XL, XXL and unserved countries go direct (S1). See the README for every formula. */
  function s3(ctx, sc, mult, opts) {
    const o = opts || {}, R = result(o.dedicated ? "S3b" : "S3", ctx.S, sc), C = s3Choice(ctx), set = ctx.S.s3;
    if (!C) { R.state = "not_configured"; R.notes.push("No provider has warehouse data (M4)."); return finish(R, ctx); }
    const {p, wh} = C, W = p.Q.m4[wh], whLane = set.country || laneOfText(W.W01);
    R.provider = p.name; R.warehouse = wh; R.whLane = whLane;
    used(R, "M4", p.name);
    const fz = /^(free zone|bonded)$/i.test(String(W.W02 || "").trim());
    if (/^duty paid$/i.test(String(W.W02 || "").trim())) R.flags.push("Import duty on stock not included: get duty rates from Martin Remhof.");
    const served = (set.served && set.served.length ? set.served : LANE_IDS.filter(L => p.Q.m5.some(r => r.lane === L && r.price != null && (!r.warehouse || r.warehouse === wh))));
    R.served = served;
    if (o.dedicated && !(W.W20 != null && W.W21 != null)) { R.state = "not_configured"; R.notes.push("The 3PL quotes no dedicated site (W20, W21)."); return finish(R, ctx); }
    const site = (ctx.S.s4.sites || [])[0] || {};
    need(R, !!whLane, `m4.${wh}.W01 (warehouse country)`);
    need(R, served.length > 0, `m5 prices from warehouse ${wh}`);
    need(R, !isBlank(W.W02), `m4.${wh}.W02`);
    need(R, Number(set.avgPallets) > 0, "setting: average pallets in stock");
    // stock orders and the direct rest
    const orders = {}, kgW = {}, cls = [];
    LANE_IDS.forEach(L => BANDS.forEach(b => {
      const n = volume(ctx.S, sc, L, b, mult); if (!(n > 0)) return;
      const share = served.includes(L) && STOCK_BANDS.includes(b) ? Math.max(0, Math.min(100, Number((set.share || {})[L] ?? 100))) / 100 : 0;
      if (share > 0) { const k = n * share; orders[L] = (orders[L] || 0) + k; kgW[L] = (kgW[L] || 0) + k * (Number(ctx.S.avgKg[b]) || 0); cls.push({L, b, n: k}); }
      direct(R, ctx, L, b, n * (1 - share));
    }));
    const totOrders = sum(Object.values(orders), x => x), totKg = sum(Object.values(kgW), x => x);
    R.stockOrders = totOrders; R.stockKg = totKg;
    // handling rates
    const lines = b => Number(ctx.S.orderLines[b]) || 0, cart = b => Number(ctx.S.cartons[b]) || 0, pal = b => Number(ctx.S.pallets[b]) || 0;
    if (!o.dedicated) {
      need(R, W.W11 != null, `m4.${wh}.W11`); need(R, W.W09 != null || W.W10 != null, `m4.${wh}.W09`);
      if (cls.some(x => pal(x.b) > 0)) need(R, W.W12 != null, `m4.${wh}.W12`);
      if (set.labelling) need(R, W.W13 != null, `m4.${wh}.W13`);
      need(R, W.W05 != null, `m4.${wh}.W05`); need(R, W.W15 != null, `m4.${wh}.W15`);
    }
    const load = LOADS[set.load] ? set.load : "C20";
    if (load === "C20") need(R, W.W07 != null, `m4.${wh}.W07`); else if (load === "C40") need(R, W.W08 != null, `m4.${wh}.W08`); else need(R, W.W06 != null, `m4.${wh}.W06`);
    const io = whLane ? inbound(ctx, R, p, set.moduleSource, whLane, load, fz) : {t: null, m3: null};
    // delivery from the warehouse, per stock order
    cls.forEach(x => {
      const d = m5Own(p.Q, wh, x.L, x.b, ctx.S);
      if (!need(R, !!d, `m5 ${x.L} ${x.b} (warehouse ${wh})`, x.L)) return;
      if (d.tag === "extrapolated") tag(R, "extrapolated");
      const c = R.countries[x.L];
      c.shipments += x.n; c.covered += x.n; c.measured += x.n; c.orders += x.n; c.kg += x.n * (Number(ctx.S.avgKg[x.b]) || 0);
      if (d.transit != null && d.transit <= Number(ctx.S.targetDays[x.L])) c.onTime += x.n;
      if (LANES[x.L].gcc && d.nextDay && !R.nextDay.includes(x.L)) R.nextDay.push(x.L);
      add(R, x.L, "delivery", "delivery", x.n * d.price);
      if (!o.dedicated) {
        const h = (W.W11 || 0) + (W.W10 != null ? W.W10 * cart(x.b) : (W.W09 || 0) * lines(x.b)) + (W.W12 || 0) * pal(x.b) + (set.labelling ? (W.W13 || 0) * cart(x.b) : 0);
        add(R, x.L, "handling", "handling", x.n * h);
        c.byClass[x.b] = Object.assign(c.byClass[x.b] || {}, {delivery: d.price, handling: h, tag: d.tag});
        c.stock += x.n; c.stockDH += x.n * (d.price + h);
      } else { c.byClass[x.b] = Object.assign(c.byClass[x.b] || {}, {delivery: d.price, handling: 0, tag: d.tag}); c.stock += x.n; c.stockDH += x.n * d.price; }
      if (fz && io.m3 && io.m3.fzExit != null) add(R, x.L, "fzExit", "customs", x.n * io.m3.fzExit);
    });
    used(R, "M5", p.name);
    // replenishment, inbound, storage, fixed, minimum, carrying: warehouse-wide, spread by kg or orders
    const loadKg = io.t ? io.t.kg : LOADS[load].kg, loads = totKg > 0 ? Math.ceil(totKg / loadKg - 1e-9) : 0;
    R.loads = loads; R.load = load;
    if (io.t && io.m3) {
      const each = io.t.price + io.m3.price + (fz && io.m3.fzEntry != null ? io.m3.fzEntry : 0);
      R.perLoad = each;
      spread(R, kgW, "replenishment", "transport", loads * io.t.price);
      spread(R, kgW, "replenishment", "customs", loads * (io.m3.price + (fz && io.m3.fzEntry != null ? io.m3.fzEntry : 0)));
    }
    const devan = load === "C20" ? (W.W07 || 0) * loads : load === "C40" ? (W.W08 || 0) * loads : (W.W06 || 0) * LOADS[load].pallets * loads;
    spread(R, kgW, load === "C20" || load === "C40" ? "devanning" : "inbound", "handling", devan);
    const amort = Number(set.amortYears) > 0 ? Number(set.amortYears) : 3;
    if (o.dedicated) {
      need(R, Number(site.m2) > 0, "setting: S4 m2 (for S3b)"); need(R, Number(site.fte) > 0, "setting: S4 FTE (for S3b)");
      const ded = ((Number(site.m2) || 0) * W.W20 * 12 + (Number(site.fte) || 0) * W.W21 * 12) * (1 + (W.W22 || 0));
      spread(R, orders, "dedicated", "fixed", ded);
    } else {
      const storage = (W.W05 || 0) * (Number(set.avgPallets) || 0) * 12;
      spread(R, kgW, "storage", "storage", storage);
      spread(R, orders, "fixed", "fixed", (W.W15 || 0) * 12 + ((W.W16 || 0) + (W.W17 || 0)) / amort);
      const handling = R.parts.handling || 0, top = Math.max(0, (W.W19 || 0) * 12 - (storage + handling + devan));
      spread(R, orders, "minimumTopUp", "fixed", top);
    }
    R.oneOff = (W.W16 || 0) + (W.W17 || 0);
    const carrying = (Number(set.carryingPct) || 0) / 100 * (Number(set.stockValue) || 0);
    spread(R, kgW, "carrying", "storage", carrying);
    if (W.W18 > 12) R.flags.push(`Minimum term ${W.W18} months (W18).`);
    tag(R, "quoted"); tag(R, "assumption");
    return finish(R, ctx);
  }
  /* S4 own warehouse: own fixed costs, replenishment (as S3, no devanning), delivery via a provider's M5 prices in the same
     country as a proxy, free-zone exit, and S1 for the rest. */
  function s4(ctx, sc, mult) {
    const R = result("S4", ctx.S, sc), sites = (ctx.S.s4.sites || []).filter(x => x.country);
    if (!sites.length) { R.state = "not_configured"; R.notes.push("No own site is set (S4 settings)."); return finish(R, ctx); }
    const taken = new Set(), orders = {}, kgW = {}, rest = {};
    LANE_IDS.forEach(L => BANDS.forEach(b => { rest[L + b] = volume(ctx.S, sc, L, b, mult); }));
    sites.forEach((site, si) => {
      const fz = /^(free zone|bonded)$/i.test(String(site.customs || "").trim());
      ["m2", "rentPerM2", "fte", "costPerFte"].forEach(k => need(R, site[k] != null && site[k] !== "", `setting: S4 site ${si + 1} ${k}`));
      const f5 = chosen(ctx, "M5"), hasM5 = p => p.Q.m5.some(r => r.price != null);
      const px = ctx.list.find(p => p.id === site.proxyProvider) || (f5 !== "best" && ctx.list.find(p => p.id === f5 && hasM5(p))) || ctx.list.find(hasM5) || null;
      need(R, !!px, `setting: S4 site ${si + 1} delivery proxy (a provider's M5 prices)`);
      const pwh = site.proxyWarehouse === "B" ? "B" : "A";
      if (px) { const pl = laneOfText(px.Q.m4[pwh].W01); if (pl && pl !== site.country) R.flags.push(`The delivery proxy (${px.name} warehouse ${pwh}) is not in ${LANES[site.country].name}.`); used(R, "M5", px.name + " (proxy)"); }
      const served = px ? LANE_IDS.filter(L => !taken.has(L) && px.Q.m5.some(r => r.lane === L && r.price != null && (!r.warehouse || r.warehouse === pwh))) : [];
      served.forEach(L => taken.add(L));
      const kSite = {}, oSite = {};
      served.forEach(L => STOCK_BANDS.forEach(b => {
        const n = rest[L + b]; if (!(n > 0)) return;
        const d = m5Own(px.Q, pwh, L, b, ctx.S);
        if (!need(R, !!d, `m5 ${L} ${b} (proxy ${px.name} warehouse ${pwh})`, L)) return;
        rest[L + b] = 0;
        const c = R.countries[L];
        c.shipments += n; c.covered += n; c.measured += n; c.orders += n; c.kg += n * (Number(ctx.S.avgKg[b]) || 0);
        if (d.transit != null && d.transit <= Number(ctx.S.targetDays[L])) c.onTime += n;
        if (LANES[L].gcc && d.nextDay && !R.nextDay.includes(L)) R.nextDay.push(L);
        add(R, L, "delivery", "delivery", n * d.price);
        c.byClass[b] = Object.assign(c.byClass[b] || {}, {delivery: d.price, handling: 0, tag: "proxy"});
        c.stock += n; c.stockDH += n * d.price;
        kSite[L] = (kSite[L] || 0) + n * (Number(ctx.S.avgKg[b]) || 0); oSite[L] = (oSite[L] || 0) + n;
      }));
      const totKg = sum(Object.values(kSite), x => x);
      const load = LOADS[ctx.S.s3.load] ? ctx.S.s3.load : "C20";
      const io = px ? inbound(ctx, R, px, ctx.S.s4.moduleSource === "cheapest" ? "cheapest" : "same", site.country, load, fz) : {t: null, m3: null};
      const loads = totKg > 0 ? Math.ceil(totKg / (io.t ? io.t.kg : LOADS[load].kg) - 1e-9) : 0;
      if (io.t && io.m3) {
        spread(R, kSite, "replenishment", "transport", loads * io.t.price);
        spread(R, kSite, "replenishment", "customs", loads * (io.m3.price + (fz && io.m3.fzEntry != null ? io.m3.fzEntry : 0)));
      }
      if (fz && io.m3 && io.m3.fzExit != null) Object.entries(oSite).forEach(([L, n]) => add(R, L, "fzExit", "customs", n * io.m3.fzExit));
      const amort = Number(site.amortYears) > 0 ? Number(site.amortYears) : 3, z = k => Number(site[k]) || 0;
      const own = z("rentPerM2") * z("m2") + z("fte") * z("costPerFte") + (z("setup") + z("licence")) / amort + z("equipmentMonth") * 12 + z("wmsMonth") * 12 + z("insuranceYear") + z("carryingCost");
      spread(R, oSite, "ownFixed", "fixed", own);
      R.oneOff += z("setup") + z("licence");
      Object.assign(kgW, kSite); Object.keys(oSite).forEach(L => { orders[L] = (orders[L] || 0) + oSite[L]; });
    });
    LANE_IDS.forEach(L => BANDS.forEach(b => direct(R, ctx, L, b, rest[L + b])));
    R.stockOrders = sum(Object.values(orders), x => x); R.stockKg = sum(Object.values(kgW), x => x);
    tag(R, "proxy"); tag(R, "assumption");
    return finish(R, ctx);
  }
  // S5 other: the M6 solution, estimated only for lines priced per shipment, per order or per kg, on the countries in O03.
  function s5(ctx, sc) {
    const R = result("S5", ctx.S, sc), f6 = chosen(ctx, "M6"), ps = f6 !== "best" ? ctx.list.filter(p => p.id === f6) : ctx.list;
    R.solutions = ps.filter(p => p.Q.m6.O01 || p.Q.m6.lines.length).map(p => {
      const lanes = lanesOfText(p.Q.m6.O03), m = p.Q.m6;
      let est = 0, usedLines = 0;
      m.lines.forEach(l => {
        if (l.price == null) return;
        const per = /per (shipment|order)/.test(l.unit) ? "n" : /per kg/.test(l.unit) ? "kg" : null; if (!per) return;
        usedLines++;
        lanes.forEach(L => BANDS.forEach(b => { const n = volume(ctx.S, sc, L, b); est += per === "n" ? n * l.price : n * (Number(ctx.S.avgKg[b]) || 0) * l.price; }));
      });
      return {provider: p.id, name: p.name, title: m.O01, description: m.O02, countries: m.O03, lanes, transit: m.O04, nextDay: m.O05, lines: m.lines, estimate: usedLines ? est : null};
    });
    R.state = R.solutions.length ? "indicative" : "not_configured";
    if (!R.solutions.length) R.notes.push("No provider advises another solution (M6).");
    tag(R, "indicative");
    const top = R.solutions.filter(x => x.estimate != null).sort((a, b) => a.estimate - b.estimate)[0];
    R.total = top ? top.estimate : null; R.parts = top ? {indicative: top.estimate} : {};
    return R;
  }
  function finish(R, ctx) {
    if (R.state === "not_configured") { R.total = null; return R; }
    if (R.missing.length) R.state = "incomplete";
    const cs = Object.values(R.countries);
    R.total = R.state === "complete" ? sum(Object.values(R.parts), x => x) : null;
    R.shipments = sum(cs, c => c.shipments); R.covered = sum(cs, c => c.covered); R.measured = sum(cs, c => c.measured); R.onTime = sum(cs, c => c.onTime);
    const allN = sum(LANE_IDS, L => sum(BANDS, b => volume(ctx.S, R.sc, L, b))), allKg = sum(LANE_IDS, L => sum(BANDS, b => volume(ctx.S, R.sc, L, b) * (Number(ctx.S.avgKg[b]) || 0)));
    R.perOrder = R.total != null && allN ? R.total / allN : null; R.perKg = R.total != null && allKg ? R.total / allKg : null;
    R.completeness = R.required ? R.filled / R.required : 1;
    R.regions = REGIONS.map(([region, lanes]) => ({region, lanes, cost: R.total == null ? null : sum(lanes, L => R.countries[L].cost),
      state: lanes.every(L => R.countries[L].state === "complete") ? "complete" : "incomplete"}));
    return R;
  }
  /* Cost per order of a class in a country for one scenario result: the M1 price for direct volume; for stock volume the
     delivery and handling of the class plus the country's share of the warehouse-wide costs per stock order; for a
     distributor country the country's cost per customer shipment. Returns {price, tag} or null. */
  function classCost(R, L, b) {
    if (!R || R.state !== "complete") return null;
    const c = R.countries[L], k = c.byClass[b] || {};
    if (R.id === "S2" && R.distributors && R.distributors.includes(L)) return c.shipments ? {price: c.cost / c.shipments, tag: "derived", via: "distributor"} : null;
    if (k.delivery != null && c.stock > 0) { const shared = (c.cost - c.types.direct - c.stockDH) / c.stock; return {price: k.delivery + (k.handling || 0) + shared, tag: k.tag === "proxy" ? "proxy" : k.tag === "extrapolated" ? "extrapolated" : "derived"}; }
    if (k.direct) return {price: k.direct.price, tag: k.direct.tag};
    return null;
  }
  // Every scenario for one volume case. list: providers; S: settings; choice: "best" or a provider id; mult: volume multiplier.
  function scenarios(list, settingsIn, sc, choice, mult) {
    const ctx = {list: (list || []).filter(p => p.Q && (p.Q.kind === "v30" || p.Q.kind === "v23")), S: withDefaults(settingsIn), choice: choice || "best"};
    const out = {S1: s1(ctx, sc, mult), S2: s2(ctx, sc), S3: s3(ctx, sc, mult), S3b: s3(ctx, sc, mult, {dedicated: true}), S4: s4(ctx, sc, mult), S5: s5(ctx, sc)};
    const ranked = ["S1", "S2", "S3", "S3b", "S4"].filter(k => out[k].state === "complete").sort((a, b) => out[a].total - out[b].total);
    out.cheapest = ranked[0] || null;
    out.byRegion = REGIONS.map(([region, lanes]) => {
      const costOf = k => sum(lanes, L => out[k].countries[L].cost);
      const ok = ["S1", "S2", "S3", "S3b", "S4"].filter(k => out[k].state === "complete");
      const best = ok.sort((a, b) => costOf(a) - costOf(b))[0] || null;
      return {region, lanes, best, cost: best ? costOf(best) : null, s1: out.S1.state === "complete" ? costOf("S1") : null};
    });
    out.byCountry = Object.fromEntries(LANE_IDS.map(L => {
      const ok = ["S1", "S2", "S3", "S3b", "S4"].filter(k => out[k].state === "complete" && out[k].countries[L].state === "complete" && out[k].countries[L].shipments > 0);
      const best = ok.sort((a, b) => out[a].countries[L].cost - out[b].countries[L].cost)[0] || null;
      return [L, best];
    }));
    return out;
  }
  // Volume sensitivity: S1, S3 and S4 at 0.5 to 3 times the customer volumes, and the multiplier from which S3 or S4 is cheaper.
  const MULTS = [0.5, 1, 1.5, 2, 3];
  function sensitivity(list, settingsIn, sc, choice) {
    const at = m => { const o = scenarios(list, settingsIn, sc, choice, m); return {m, S1: o.S1.total, S3: o.S3.total, S4: o.S4.total}; };
    const rows = MULTS.map(at);
    const breakEven = {};
    ["S3", "S4"].forEach(k => {
      let found = null;
      for (let m = 0.25; m <= 5.0001; m += 0.05) { const r = at(Math.round(m * 100) / 100); if (r.S1 != null && r[k] != null && r[k] < r.S1) { found = Math.round(m * 100) / 100; break; } }
      breakEven[k] = found;
    });
    return {rows, breakEven};
  }

  // ================================================================== scores, flags, follow-ups
  const RUBRIC = {
    selfReportedFactor: 0.75, selfReported: ["Q13", "Q14"],
    service: [
      {id: "ontime", label: "On-time share on the lane targets", kind: "ontime", steps: [[0.9, 4], [0.7, 3], [0.5, 2], [0.25, 1]]},
      {id: "Q10", label: "Next-day delivery in the GCC", starts: [["Yes from Helmond", 4], ["Yes from regional stock", 3]]},
      {id: "Q09", label: "Pick-up cut-off time in Helmond", time: [["16:00", 4], ["15:00", 3], ["14:00", 2], ["12:00", 1]]},
      {id: "Q11", label: "Import clearance days", max: [[1, 4], [2, 3], [3, 2], [5, 1]]},
      {id: "Q12", label: "Capacity in the peak month", starts: [["Guaranteed", 4], ["Partly guaranteed", 2]]}],
    quality: [
      {id: "Q13", label: "On-time delivery rate (self-reported)", min: [[0.98, 4], [0.95, 3], [0.90, 2], [0.85, 1]]},
      {id: "Q14", label: "Damage and loss rate (self-reported)", max: [[0.001, 4], [0.005, 3], [0.01, 2], [0.02, 1]]},
      {id: "Q15", label: "Track and trace and e-POD", starts: [["Both", 4], ["One of the two", 2]]},
      {id: "Q16", label: "One contact and one invoice", starts: [["Both", 4], ["One of the two", 2]]},
      {id: "Q17", label: "Saudi SASO / SABER experience", starts: [["Yes", 4], ["Partial", 2]], weight: 2},
      {id: "Q18", label: "Egypt ACID / CargoX", starts: [["Yes", 4]]},
      {id: "Q19", label: "Certifications", starts: [["ISO 9001 and AEO", 4], ["Only ISO 9001", 2], ["Only AEO", 2]]}],
    options: [
      {id: "Q20", label: "Express parcel", starts: [["All 9 countries", 4], ["Some", 2]]}, {id: "Q21", label: "Air freight", starts: [["All 9 countries", 4], ["Some", 2]]},
      {id: "Q22", label: "Road groupage", starts: [["All 9 countries", 4], ["Some", 2]]}, {id: "Q23", label: "Sea freight", starts: [["All 9 countries", 4], ["Some", 2]]},
      {id: "Q24", label: "Import clearance for the consignee", starts: [["All 9 countries", 4], ["Some", 2]]}, {id: "Q25", label: "DDP service", starts: [["All 9 countries", 4], ["Some", 2]]},
      {id: "Q26", label: "EUR.1 / A.TR origin documents", starts: [["Yes free", 4], ["Yes against", 3]]},
      {id: "M4", label: "M4 warehouse completeness", kind: "complete", role: "threepl"}, {id: "M5", label: "M5 delivery completeness", kind: "complete", role: "threepl"}],
  };
  const rubricOf = S => (S && S.rubric && Array.isArray(S.rubric.service) ? S.rubric : RUBRIC);
  const pctS = x => `${Math.round(x * 1000) / 10}%`;
  function scoreAnswer(item, Q) {
    const a = (Q.q[item.id] || {}).answer;
    if (isBlank(a)) return {points: 0, reason: "no answer", missing: true};
    if (item.starts) { const s = String(a).trim().toLowerCase(), hit = item.starts.find(([pfx]) => s.startsWith(String(pfx).toLowerCase())); return {points: hit ? hit[1] : 0, reason: `"${a}"`}; }
    if (item.time) { const m = minutes(a); if (m == null) return {points: 0, reason: `"${a}" is not a time`, missing: true}; const hit = item.time.find(([t]) => m >= minutes(t)); return {points: hit ? hit[1] : 0, reason: `cut-off ${a}`}; }
    if (typeof a !== "number") return {points: 0, reason: `"${a}" is not a number`, missing: true};
    const txt = item.id === "Q13" || item.id === "Q14" ? pctS(a) : item.id === "Q11" ? `${a} working days` : String(a);
    if (item.min) { const hit = item.min.find(([t]) => a >= t - 1e-9); return {points: hit ? hit[1] : 0, reason: txt}; }
    if (item.max) { const hit = item.max.find(([t]) => a <= t + 1e-9); return {points: hit ? hit[1] : 0, reason: txt}; }
    return {points: 0, reason: txt};
  }
  const fmt2 = x => (Math.round(x * 100) / 100).toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  /* Two role scores per provider, 0 to 4: forwarder (cost from S1 and M2) and 3PL (cost from S3), each compared with the other
     providers on what all of them cover; the same service, quality and options areas (the 3PL adds M4 and M5 completeness). */
  function scoreAll(list, settingsIn, sc) {
    const S = withDefaults(settingsIn), rub = rubricOf(S), vc = sc || "A", ps = (list || []).filter(p => p.Q && (p.Q.kind === "v30" || p.Q.kind === "v23"));
    // forwarder cost: M1 on the lane-bands every forwarder prices (volume case shipments x price) + M2 on the lane-loads every one prices (one of each)
    const fw = ps.filter(p => p.Q.priced.M1 || p.Q.priced.M2);
    const cells = LANE_IDS.flatMap(L => BANDS.filter(b => volume(S, vc, L, b) > 0).map(b => [L, b])).filter(([L, b]) => fw.every(p => m1Own(p.Q, L, b, S)));
    const loads = LANE_IDS.flatMap(L => Object.keys(LOADS).map(ld => [L, ld])).filter(([L, ld]) => fw.every(p => m2Own(p.Q, L, ld)));
    const fwCost = p => sum(cells, ([L, b]) => volume(S, vc, L, b) * m1Own(p.Q, L, b, S).price) + sum(loads, ([L, ld]) => m2Own(p.Q, L, ld).price);
    const fwLow = Math.min(...fw.map(fwCost).filter(x => x > 0));
    // 3PL cost: S3 with each provider as the 3PL, on the countries every 3PL serves, stock part only
    const tp = ps.filter(p => p.Q.priced.M4 && p.Q.priced.M5);
    const servedOf = p => { const wh = S.s3.provider === p.id ? S.s3.warehouse : "A"; return LANE_IDS.filter(L => p.Q.m5.some(r => r.lane === L && r.price != null && (!r.warehouse || r.warehouse === wh))); };
    const common = tp.length ? LANE_IDS.filter(L => tp.every(p => servedOf(p).includes(L))) : [];
    const s3Of = p => { const set = Object.assign({}, S, {s3: Object.assign({}, S.s3, {provider: p.id, warehouse: S.s3.provider === p.id ? S.s3.warehouse : "A", served: common, avgPallets: S.s3.avgPallets || 1})});
      const r = scenarios(ps, set, vc, "best").S3; return r.state === "complete" ? r.total - (r.parts.direct || 0) : null; };
    const tpCost = Object.fromEntries(tp.map(p => [p.id, common.length ? s3Of(p) : null]));
    const tpLow = Math.min(...Object.values(tpCost).filter(x => x != null && x > 0));
    return ps.map(p => {
      const comp = completeness(p.Q), missing = [];
      const area = (key, label, items) => { const its = items.map(it => { if (it.missing && !missing.includes(it.id)) missing.push(it.id); return it; });
        const w = sum(its, it => it.weight || 1); return {key, label, items: its, score: w ? sum(its, it => it.points * (it.weight || 1)) / w : 0}; };
      const item = (it, Q) => { const r = scoreAnswer(it, Q); if (rub.selfReported.includes(it.id) && !r.missing) { r.points *= rub.selfReportedFactor; r.reason += `, self-reported x ${rub.selfReportedFactor}`; } return Object.assign({id: it.id, label: it.label, weight: it.weight || 1}, r); };
      // forwarder: S1 with this provider's M1; 3PL: this provider's M5 deliveries (sizes S, M, L with volume)
      const onTime = role => {
        let scen = null;
        if (role === "forwarder") scen = scenarios([p], S, vc, p.id).S1;
        else if (tp.includes(p)) { const wh = S.s3.provider === p.id ? S.s3.warehouse : "A"; let m = 0, ok = 0;
          LANE_IDS.forEach(L => STOCK_BANDS.forEach(b => { const n = volume(S, vc, L, b), d = n > 0 ? m5Own(p.Q, wh, L, b, S) : null; if (!d) return; m += n; if (d.transit != null && d.transit <= Number(S.targetDays[L])) ok += n; }));
          scen = {measured: m, onTime: ok}; }
        if (!scen || !scen.measured) return {id: "ontime", label: "On-time share on the lane targets", points: 0, reason: role === "forwarder" ? "no M1 transit times" : "no 3PL offer"};
        const share = scen.onTime / scen.measured, hit = rub.service[0].steps.find(([t]) => share >= t - 1e-9);
        return {id: "ontime", label: rub.service[0].label, points: hit ? hit[1] : 0, reason: `${fmt2(scen.onTime).replace(/\.00$/, "")} of ${fmt2(scen.measured).replace(/\.00$/, "")} shipments within the lane target (${pctS(share)})`};
      };
      const shared = role => [area("service", "Service", [onTime(role)].concat(rub.service.slice(1).map(it => item(it, p.Q)))), area("quality", "Quality", rub.quality.map(it => item(it, p.Q)))];
      const opts = role => area("options", "Options", rub.options.filter(it => !it.role || it.role === role).map(it => it.kind === "complete" ? {id: it.id, label: it.label, weight: 1, points: 4 * comp[it.id], reason: pctS(comp[it.id]) + " of the module filled"} : item(it, p.Q)));
      const fc = fw.includes(p) ? fwCost(p) : 0, tc = tpCost[p.id];
      const costF = {key: "cost", label: "Cost", items: [{id: "cost", label: "S1 and M2 cost against the lowest", points: fc > 0 && Number.isFinite(fwLow) ? 4 * fwLow / fc : 0,
        reason: fc > 0 ? `EUR ${fmt2(fc)} on ${cells.length} lane-bands and ${loads.length} loads every forwarder prices, lowest EUR ${fmt2(fwLow)}` : "no forwarding prices"}]};
      const costT = {key: "cost", label: "Cost", items: [{id: "cost", label: "S3 stock cost against the lowest", points: tc > 0 && Number.isFinite(tpLow) ? 4 * tpLow / tc : 0,
        reason: tc > 0 ? `EUR ${fmt2(tc)} a year through the warehouse on ${common.length} countries every 3PL serves, lowest EUR ${fmt2(tpLow)}` : "no complete 3PL offer (M4 and M5)"}]};
      [costF, costT].forEach(c => { c.score = c.items[0].points; });
      const total = (areas, w) => { const tw = sum(areas, a => Number(w[a.key]) || 0); return tw ? sum(areas, a => a.score * (Number(w[a.key]) || 0)) / tw : 0; };
      const fAreas = [costF].concat(shared("forwarder"), [opts("forwarder")]), tAreas = [costT].concat(shared("threepl"), [opts("threepl")]);
      return {id: p.id, name: p.name, completeness: comp, missing, forwarder: {areas: fAreas, total: total(fAreas, S.weights.forwarder)}, threepl: {areas: tAreas, total: total(tAreas, S.weights.threepl)}};
    });
  }
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthsIn = s => [...new Set((String(s || "").toLowerCase().match(/\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/g) || []).map(m => m.slice(0, 3)))].filter(m => MONTHS.includes(m));
  function comments(Q) {
    return [].concat(Object.entries(Q.q).map(([id, x]) => [`q.${id}.comment`, x.comment]), Q.m1.map(r => [`m1.${r.id}.comment`, r.comment]), Q.m2.map(r => [`m2.${r.id}.comment`, r.comment]),
      Object.entries(Q.m3).map(([L, x]) => [`m3.${L}.comment`, x.comment]), Object.entries(Q.m4.comments).map(([id, c]) => [`m4.${id}.comment`, c]), Q.m5.map(r => [`m5.${r.id}.comment`, r.comment])).filter(([, c]) => !isBlank(c));
  }
  /* F1 to F11, each {id, key, reason}. */
  function flags(Q, settingsIn) {
    const S = withDefaults(settingsIn), out = [], add2 = (id, key, reason) => out.push({id, key, reason});
    const q = id => (Q.q[id] || {}).answer, qc = id => (Q.q[id] || {}).comment || "";
    if (!isBlank(q("Q05")) && String(q("Q05")) < `${S.volumeYear}-01-01`) add2("F1", "q.Q05.answer", `Prices are valid until ${q("Q05")}, before 1 January ${S.volumeYear}, the volume year.`);
    if (/^some/i.test(String(q("Q07") || "")) && /per[\s-]*(piece|pc|pcs|parcel|carton|box|item|package)|\b70\s*kg/i.test(qc("Q07"))) add2("F2", "q.Q07.comment", "Surcharges on top include a per-piece or 70 kg rule; FlexiTog's crated cabinets weigh about 70 kg.");
    const volc = comments(Q).find(([, c]) => /1\s*:\s*[45][,.]?000\b|\/\s*[45][,.]?000\b/.test(c));
    if (volc) add2("F3", volc[0], `A comment uses a volumetric rule stricter than 1:6000: "${String(volc[1]).slice(0, 80)}".`);
    if (isBlank(q("Q06"))) add2("F4", "q.Q06.answer", "The fuel surcharge included in the prices is not stated.");
    else if (monthsIn(qc("Q06")).length === 1) add2("F4", "q.Q06.comment", `The fuel surcharge is stated for a single month only ("${qc("Q06").slice(0, 60)}").`);
    if (/^yes/i.test(String(q("Q10") || ""))) {
      const fast = Q.m1.some(r => LANES[r.lane] && LANES[r.lane].gcc && r.price != null && r.transit != null && r.transit <= 2) || Q.m5.some(r => LANES[r.lane] && LANES[r.lane].gcc && r.price != null && r.transit != null && r.transit <= 2);
      if (!fast) add2("F5", "q.Q10.answer", `Next-day GCC delivery is claimed ("${q("Q10")}"), but no quoted option reaches 2 days in the GCC.`);
    }
    if (Q.priced.M1 || Q.modules.M1 === "Yes") LANE_IDS.filter(L => !Q.m1.some(r => r.lane === L && r.price != null)).forEach(L => add2("F6", `m1.${L}`, `${LANES[L].name}: no price at all in M1.`));
    if (Q.inputCheck !== OK_CHECK) add2("F7", "meta.input_check", Q.inputCheck ? `The file's own input check says: ${Q.inputCheck}.` : "The file's own input check has no result (the file was not saved in Excel).");
    if (q("Q14") === 0 || q("Q13") === 1) add2("F8", q("Q14") === 0 ? "q.Q14.answer" : "q.Q13.answer", `Self-reported ${q("Q14") === 0 ? "damage rate of 0%" : "on-time rate of 100%"} is not credible without evidence.`);
    Q.moduleNotes.forEach(n => add2("F9", `module.${n.module}.offered`, `${n.module} ${n.note}.`));
    ["A", "B"].forEach(w => { if (/^duty paid$/i.test(String(Q.m4[w].W02 || "").trim())) add2("F10", `m4.${w}.W02`, `Warehouse ${w} holds stock duty paid: import duty on stock is not in the cost; get duty rates from Martin Remhof.`); });
    ["A", "B"].forEach(w => { if (Q.m4[w].W18 > 12) add2("F11", `m4.${w}.W18`, `Warehouse ${w} asks a minimum term of ${Q.m4[w].W18} months.`); });
    return out;
  }
  const QTEXT = {Q09: "your daily pick-up cut-off time in Helmond", Q10: "whether you offer next-day delivery in the GCC", Q11: "your average import clearance time in working days",
    Q12: "whether your capacity is guaranteed in the peak month", Q13: "your on-time delivery rate on these lanes over the last 12 months", Q14: "your damage and loss rate over the last 12 months",
    Q15: "whether you offer track and trace and e-POD", Q16: "whether we get one contact person and one invoice for all lanes", Q17: "your experience with Saudi SASO / SABER",
    Q18: "how you handle Egypt ACID / CargoX pre-registration", Q19: "which certifications you hold", Q20: "where you offer express parcel service", Q21: "where you offer air freight",
    Q22: "where you offer road groupage", Q23: "where you offer sea freight", Q24: "where you offer import customs clearance for the consignee", Q25: "where you offer DDP service",
    Q26: "whether you issue EUR.1 / A.TR origin documents"};
  const FLAG_Q = {F1: "Can you extend the price validity to cover all of {year}?", F2: "Can you confirm how a crated cabinet of about 70 kg is charged, and whether per-piece surcharges apply?",
    F3: "Can you price on a volumetric rule of 1:6000, or confirm the rule you used?", F4: "Which fuel surcharge level is included, and how will it change?",
    F5: "Which services reach the GCC in 2 days or less, since none of the quoted options do?", F6: "Can you quote M1 for {what}?",
    F7: "Can you check the cells the input check marks and send the corrected file?", F8: "Can you share the data behind the self-reported on-time and damage figures?",
    F9: "{what}", F10: "Can you hold the stock in a free zone or bonded, or tell us the duty you expect on the stock?", F11: "Can you offer a minimum term of 12 months or less?"};
  function followUps(Q, F, scored, s3missing, settingsIn) {
    const S = withDefaults(settingsIn), out = [];
    (scored ? scored.missing : []).filter(id => QTEXT[id]).forEach(id => out.push(`Please tell us ${QTEXT[id]} (${id}).`));
    if (Q.priced.M1 || Q.modules.M1 === "Yes") { const gaps = LANE_IDS.flatMap(L => BANDS.filter(b => (volume(S, "A", L, b) + volume(S, "B", L, b)) > 0 && Q.m1.some(r => r.lane === L && r.band === b && r.price == null)).map(b => `${L} ${b}`));
      if (gaps.length) out.push(`Can you quote M1 for ${gaps.join(", ")}? These have volume but no price.`); }
    if ((Q.priced.M2 || Q.modules.M2 === "Yes")) { const g = Q.m2.filter(r => r.price == null).map(r => `${r.lane} ${r.load}`); if (g.length && g.length < Q.m2.length) out.push(`Can you quote M2 for ${g.join(", ")}?`); }
    (s3missing || []).filter(k => !/^setting/.test(k)).forEach(k => out.push(`For the 3PL calculation we still need ${k}.`));
    F.forEach(f => { const what = f.id === "F6" ? LANES[f.key.replace(/^m1\./, "")].name : f.id === "F9" ? `${f.reason.replace(/\.$/, "")}: can you send the prices?` : "";
      out.push(`${f.id}: ${FLAG_Q[f.id].replace("{year}", S.volumeYear).replace("{what}", what)}`); });
    return out;
  }

  // ================================================================== internal revenue
  /* Confidential: revenue lives only inside the tool (its own browser key), never in an RFQ template, a provider file,
     follow-up question text or a default export. Settings: USD, the exchange rate to EUR, net revenue excl. VAT per
     volume case, revenue per country per case (blank: the case total split by the country's share of shipments) and the
     distributor discount % on sales per country (S2). */
  const nulls = () => Object.fromEntries(LANE_IDS.map(L => [L, null]));
  const REVENUE_DEFAULTS = () => ({currency: "USD", fx: 0.8607, total: {A: 1030000, B: 2400000}, last12: 514000,
    byCountry: {A: nulls(), B: nulls()}, discount: Object.fromEntries(LANE_IDS.map(L => [L, 0]))});
  const numOr = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
  function revenueSettings(r) {
    const d = REVENUE_DEFAULTS(), o = r || {}, bc = o.byCountry || {};
    return {currency: "USD", fx: numOr(o.fx, d.fx), total: {A: numOr((o.total || {}).A, d.total.A), B: numOr((o.total || {}).B, d.total.B)}, last12: numOr(o.last12, d.last12),
      byCountry: {A: Object.fromEntries(LANE_IDS.map(L => [L, numOr((bc.A || {})[L], null)])), B: Object.fromEntries(LANE_IDS.map(L => [L, numOr((bc.B || {})[L], null)]))},
      discount: Object.fromEntries(LANE_IDS.map(L => [L, Math.max(0, Math.min(100, numOr((o.discount || {})[L], 0)))]))};
  }
  // Revenue per country of a volume case in USD: the value set, else the case total x the country's share of shipments.
  function revenueByCountry(revIn, settingsIn, sc) {
    const rv = revenueSettings(revIn), S = withDefaults(settingsIn), n = L => sum(BANDS, b => volume(S, sc, L, b)), all = sum(LANE_IDS, n);
    const countries = Object.fromEntries(LANE_IDS.map(L => { const v = rv.byCountry[sc][L];
      return [L, v != null ? {usd: v, allocated: false, shipments: n(L)} : {usd: all ? rv.total[sc] * n(L) / all : 0, allocated: true, shipments: n(L)}]; }));
    return {sc, countries, allocated: LANE_IDS.filter(L => countries[L].allocated), usd: sum(LANE_IDS, L => countries[L].usd), shipments: all, fx: rv.fx};
  }
  /* Cost against revenue for each ranked scenario of a scenarios() result, in total, per region and per country.
     revenue EUR = USD x rate; net = revenue less the distributor discount in S2 distributor countries;
     pct = cost / net revenue EUR; per1000 = cost EUR per USD 1,000 of net revenue; contribution = net revenue EUR - cost
     (before product cost and other overheads). coveredOnly: the scenario does not cover every shipment, so its cost and %
     cover the covered shipments only. mult scales revenue with the volumes (sensitivity). */
  function revenueView(out, revIn, settingsIn, mult) {
    const sc = out.S1.sc, base = revenueByCountry(revIn, settingsIn, sc), rv = revenueSettings(revIn), m = mult == null ? 1 : mult, fx = rv.fx;
    const block = (R, lanes, whole) => {
      const dist = L => R.id === "S2" && R.distributors && R.distributors.includes(L);
      const usd = sum(lanes, L => base.countries[L].usd * m), netUsd = sum(lanes, L => base.countries[L].usd * m * (dist(L) ? 1 - rv.discount[L] / 100 : 1));
      const cost = R.state === "complete" ? (whole ? R.total : sum(lanes, L => R.countries[L].cost)) : null;
      const sh = sum(lanes, L => R.countries[L].shipments), cov = sum(lanes, L => R.countries[L].covered);
      return {usd, eur: usd * fx, netUsd, netEur: netUsd * fx, discountEur: (usd - netUsd) * fx, cost,
        pct: cost != null && netUsd > 0 ? cost / (netUsd * fx) : null, per1000: cost != null && netUsd > 0 ? cost / (netUsd / 1000) : null,
        contribution: cost != null ? netUsd * fx - cost : null, coverage: sh ? cov / sh : 1, coveredOnly: sh > 0 && cov < sh - 1e-9};
    };
    const scen = {};
    ["S1", "S2", "S3", "S3b", "S4"].forEach(id => { const R = out[id];
      scen[id] = {total: block(R, LANE_IDS, true), regions: Object.fromEntries(REGIONS.map(([rg, ls]) => [rg, block(R, ls)])), countries: Object.fromEntries(LANE_IDS.map(L => [L, block(R, [L])]))}; });
    const ok = Object.keys(scen).filter(id => scen[id].total.pct != null).sort((a, b) => scen[a].total.pct - scen[b].total.pct);
    return {sc, fx, mult: m, usd: base.usd * m, eur: base.usd * m * fx, perShipmentUsd: base.shipments ? base.usd / base.shipments : null,
      countries: Object.fromEntries(LANE_IDS.map(L => [L, {usd: base.countries[L].usd * m, eur: base.countries[L].usd * m * fx, allocated: base.countries[L].allocated, discount: rv.discount[L]}])),
      regions: Object.fromEntries(REGIONS.map(([rg, ls]) => [rg, {usd: sum(ls, L => base.countries[L].usd * m), eur: sum(ls, L => base.countries[L].usd * m) * fx}])),
      allocated: base.allocated, scenarios: scen, lowest: ok[0] || null};
  }
  const PHRASE = {S1: "shipping from Helmond", S2: "a distributor holding stock", S3: "holding stock at a 3PL", S3b: "a dedicated 3PL site", S4: "an own warehouse"};
  const pct1 = x => `${(Math.round(x * 1000) / 10).toLocaleString("en-GB", {minimumFractionDigits: 1, maximumFractionDigits: 1})}%`;
  // One sentence per region: logistics cost as % of revenue per complete scenario.
  function revenueAnswers(view) {
    return REGIONS.map(([rg]) => {
      const ids = ["S1", "S2", "S3", "S3b", "S4"].filter(id => view.scenarios[id].regions[rg].pct != null);
      const where = rg === "GCC" ? "the GCC" : rg;
      if (!ids.length) return `In ${where}, no complete scenario to set against revenue yet.`;
      const part = (id, first) => { const b = view.scenarios[id].regions[rg], ph = PHRASE[id];
        return `${first ? ph : ph.charAt(0).toUpperCase() + ph.slice(1)} costs ${pct1(b.pct)} of ${id === "S2" ? "net revenue" : "revenue"}${b.coveredOnly ? " (covered shipments only)" : ""}.`; };
      return `In ${where}, ${ids.map((id, i) => part(id, i === 0)).join(" ")}`;
    });
  }

  // ================================================================== answers (templates, no AI)
  const money0 = x => "EUR " + Math.round(x).toLocaleString("en-GB");
  const sname = id => (SCENARIOS.find(s => s.id === id) || {label: id}).label;
  function answers(out, sens, providers) {
    const res = [];
    out.byRegion.forEach(r => {
      if (!r.best) { res.push(`${r.region}: no complete scenario yet.`); return; }
      const save = r.s1 != null && r.best !== "S1" ? ` It saves ${money0(r.s1 - r.cost)} a year against S1 direct from Helmond (${money0(r.s1)}).` : r.best === "S1" ? " Direct from Helmond is the cheapest complete option here." : "";
      res.push(`${r.region}: the cheapest complete scenario is ${r.best} ${sname(r.best)} at ${money0(r.cost)} a year.${save}`);
    });
    const be = sens ? Object.entries(sens.breakEven).filter(([, m]) => m != null) : [];
    res.push(be.length ? be.map(([k, m]) => `${k} ${sname(k)} becomes cheaper than S1 from about ${m} times volume case ${out.S1.sc}.`).join(" ")
      : `Neither S3 nor S4 becomes cheaper than S1 between 0.25 and 5 times the volumes${["S3", "S4"].some(k => out[k].state !== "complete") ? " (S3 or S4 is not complete yet)" : ""}.`);
    const nd = ["S1", "S3", "S3b", "S4"].filter(k => out[k].state === "complete" && out[k].nextDay.length);
    res.push(nd.length ? `Next-day in the GCC: ${nd.map(k => `${k} reaches ${out[k].nextDay.map(L => LANES[L].short || LANES[L].name).join(", ")}`).join("; ")}.` : "No complete scenario reaches next-day delivery in the GCC.");
    ["S1", "S2", "S3", "S3b", "S4"].forEach(k => { const R = out[k];
      if (R.state === "incomplete") res.push(`${k} ${sname(k)} is incomplete: missing ${R.missing.slice(0, 8).join(", ")}${R.missing.length > 8 ? ` and ${R.missing.length - 8} more` : ""}.`);
      else if (R.state === "not_configured") res.push(`${k} ${sname(k)} is not configured: ${R.notes.join(" ")}`); });
    if (out.S5.solutions && out.S5.solutions.length) res.push(`S5 other: ${out.S5.solutions.map(x => `${x.name} advises "${x.title || "an unnamed solution"}"${x.estimate != null ? `, indicative ${money0(x.estimate)} a year` : ""}`).join("; ")}.`);
    return res;
  }

  const api = {VERSION, V23, LEGACY_VERSIONS, OK_CHECK, LANES, LANE_IDS, BANDS, CLASSES, STOCK_BANDS, LOADS, REGIONS, SCENARIOS, TYPES, MULTS,
    DEFAULT_SETTINGS, withDefaults, newSite, strictNumber, convert, valuesOf, versionKind, laneOfText, lanesOfText, quote, completeness,
    m1Own, m2Own, m5Own, classCost, scenarios, sensitivity, REVENUE_DEFAULTS, revenueSettings, revenueByCountry, revenueView, revenueAnswers, RUBRIC, rubricOf, scoreAnswer, scoreAll, flags, followUps, answers, sname};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FlexiRFQ30 = api;
})(typeof window !== "undefined" ? window : globalThis);
