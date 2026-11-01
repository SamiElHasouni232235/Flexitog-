/* FlexiTog RFQ Quick Quote MENA-TR v2.3: pure logic, no DOM.
 *
 * The v2.3 workbook carries a hidden Export sheet (column A key, column B value, column C type). Each value is a
 * pass-through formula of one input cell, cached when the provider saves the file in Excel. rfq_core.js reads
 * the sheet (FlexiRFQ.parseWorkbook, which falls back to the input cells when the cache is empty); this module
 * turns the values into a quote and prices it:
 *   - 33 test shipments T01 to T33, each with a lane, a band (B1 to B5) and a size, read from the file;
 *   - three delivery options per shipment, each an all-in DAP price in EUR used as given:
 *       opt1 from Helmond (required), opt2 delivery from the provider's regional warehouse, opt3 another option;
 *   - 28 questions (q.Q01 to Q28), warehouse rates (wh.W01 to W14), meta.input_check.
 * Volumes, average kg per band, lane targets and the warehouse assumptions are the tool's settings
 * (DEFAULT_SETTINGS). The scoring rubric is one editable object (RUBRIC).
 *
 * Runs in the dashboard (window.FlexiRFQ23) and in node (tests/test_rfq_v23.py).
 */
(function (root) {
  "use strict";

  const VERSION = "RFQ-MENA-TR-QUICK v2.3";
  const LEGACY_VERSIONS = ["RFQ-MENA-TR v1.0"];
  const LANES = {
    L01: {country: "SA", name: "Saudi Arabia", region: "Gulf/GCC", gcc: true}, L02: {country: "AE", name: "United Arab Emirates", region: "Gulf/GCC", gcc: true},
    L03: {country: "KW", name: "Kuwait", region: "Gulf/GCC", gcc: true}, L04: {country: "QA", name: "Qatar", region: "Gulf/GCC", gcc: true},
    L05: {country: "TR", name: "Türkiye", region: "Türkiye"}, L06: {country: "MA", name: "Morocco", region: "North Africa"},
    L07: {country: "DZ", name: "Algeria", region: "North Africa"}, L08: {country: "EG", name: "Egypt", region: "North Africa"},
    L09: {country: "TN", name: "Tunisia", region: "North Africa"},
  };
  const BANDS = ["B1", "B2", "B3", "B4", "B5"];
  const OPTIONS = [["opt1", "Option 1 from Helmond"], ["opt2", "Option 2 from regional stock"], ["opt3", "Option 3 other option"]];
  const OK_CHECK = "No problems found";
  // Order classes: the test shipment sizes and weight bands. pallets: about how many pallets one order fills.
  const CLASSES = [
    {band: "B1", key: "parcel", label: "Parcel", size: "S", kg: 8, cartons: 1, pallets: 0},
    {band: "B2", key: "small", label: "Small consignment", size: "M", kg: 52, cartons: 4, pallets: 0},
    {band: "B3", key: "pallet", label: "Pallet", size: "L", kg: 261, cartons: 18, pallets: 1},
    {band: "B4", key: "multi", label: "Multi-pallet", size: "XL", kg: 941, cartons: 64, pallets: 4},
    {band: "B5", key: "full", label: "Full load", size: "XXL", kg: 2380, cartons: 160, pallets: 10},
  ];
  const classOf = band => CLASSES.find(c => c.band === band);
  const REGIONS = [["GCC", ["L01", "L02", "L03", "L04"]], ["Türkiye", ["L05"]], ["North Africa", ["L06", "L07", "L08", "L09"]]];

  // ================================================================== settings (the old v1 Volumes sheet)
  const vol = rows => Object.fromEntries(Object.entries(rows).map(([L, a]) => [L, Object.fromEntries(BANDS.map((b, i) => [b, a[i]]))]));
  const DEFAULT_SETTINGS = () => ({
    volumes: {
      A: vol({L01: [22, 8, 10, 8, 2], L02: [32, 0, 4, 0, 0], L03: [2, 0, 8, 2, 0], L04: [4, 6, 0, 0, 0], L05: [6, 4, 6, 0, 0], L06: [3, 1, 1, 1, 0], L07: [2, 1, 1, 0, 0], L08: [3, 1, 1, 1, 0], L09: [1, 0, 0, 0, 0]}),
      B: vol({L01: [51, 19, 23, 19, 5], L02: [75, 0, 9, 0, 0], L03: [5, 0, 19, 5, 0], L04: [9, 14, 0, 0, 0], L05: [14, 9, 14, 0, 0], L06: [7, 2, 3, 1, 0], L07: [5, 1, 2, 1, 0], L08: [7, 2, 3, 1, 0], L09: [2, 1, 1, 0, 0]}),
    },
    avgKg: {B1: 8, B2: 52, B3: 261, B4: 941, B5: 2380},
    targetDays: {L01: 2, L02: 2, L03: 2, L04: 2, L05: 3, L06: 3, L07: 5, L08: 4, L09: 4},
    orderLinesByClass: {B1: 6, B2: 6, B3: 6, B4: 6, B5: 6},   // update from order history
    kgPerPallet: 250,
    avgPallets: null,                 // no default: the user enters it
    replenishment: "sea",             // sea (W11) or air (W13)
    carryingPct: 0, stockValue: null, // input from Finance
    volumeYear: 2027,
    weights: {cost: 25, service: 25, quality: 25, options: 25},   // to be agreed with Mies
  });
  // Saved settings over the defaults, field by field, so a setting added later gets its default.
  function withDefaults(s) {
    const d = DEFAULT_SETTINGS(), o = s || {};
    const merge2 = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, Object.assign({}, a[k], (b || {})[k] || {})]));
    return Object.assign(d, o, {
      volumes: {A: merge2(d.volumes.A, (o.volumes || {}).A), B: merge2(d.volumes.B, (o.volumes || {}).B)},
      avgKg: Object.assign(d.avgKg, o.avgKg || {}), targetDays: Object.assign(d.targetDays, o.targetDays || {}),
      // settings saved before order lines were set per class carry one figure for every class
      orderLinesByClass: Object.assign(d.orderLinesByClass, o.orderLines != null && !o.orderLinesByClass ? Object.fromEntries(BANDS.map(b => [b, o.orderLines])) : {}, o.orderLinesByClass || {}),
      weights: Object.assign(d.weights, o.weights || {}), rubric: o.rubric || null,
    });
  }

  // ================================================================== reading the values
  const isBlank = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
  const pad = n => String(n).padStart(2, "0");
  const dateIso = d => { const t = new Date(d.getTime() + 12 * 3600000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  const serialIso = n => dateIso(new Date(Math.round((n - 25569) * 86400000)));
  // A number, or null when the cell holds anything else. Text counts only when it is plainly a number ("125",
  // "1,234.50", "€ 80"); "incl", "on request" or "see comment" are text and stay out of every sum.
  function strictNumber(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean" || v instanceof Date) return null;
    let s = String(v).trim().replace(/[\s ]/g, "").replace(/^€|€$|^EUR|EUR$/gi, "");
    if (!/^-?[\d.,]+%?$/.test(s)) return null;
    const pctSign = s.endsWith("%"); s = s.replace(/%$/, "");
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");   // 1.234,50
    else s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? (pctSign ? n / 100 : n) : null;
  }
  // Keys whose value must be a number or blank. Text there is listed by key and left out.
  const NUMERIC = [/^ship\.T\d+\.opt[123]_(delivery_)?price_eur$/, /^ship\.T\d+\.opt[123]_transit_days$/, /^wh\.W(0[4-9]|1[0-6])\.answer$/, /^q\.Q(08|11)\.answer$/];
  const PERCENT = [/^q\.Q(06|13|14|27)\.answer$/];
  const isNumericKey = k => NUMERIC.some(re => re.test(k));
  const isPercentKey = k => PERCENT.some(re => re.test(k));
  // One Export value converted by its column C type. Numbers and percentages that are text stay text, so the
  // check below can name them. Dates become YYYY-MM-DD; times become "HH:MM".
  function convert(raw, type, key) {
    if (isBlank(raw)) return "";
    if (key && (isNumericKey(key) || isPercentKey(key))) {
      const n = strictNumber(raw); if (n === null) return String(raw).trim();
      if (isPercentKey(key)) return typeof raw === "string" && raw.includes("%") ? n : n > 1.5 ? n / 100 : n;   // fractions; 96 written as a whole number becomes 0.96
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
        else { const m = String(raw).trim().match(/^(\d{1,2})[:.h](\d{2})/); if (m) return `${pad(m[1])}:${m[2]}`; return String(raw).trim(); }
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
  const versionKind = version => (version === VERSION ? "v23" : LEGACY_VERSIONS.includes(version) ? "legacy" : "unknown");
  const minutes = t => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  /* quote(values) -> the response as records:
       {version, inputCheck, shipments: [{id, lane, band, size, kg, cartons, m3, comment, opt1|opt2|opt3: {service, price, transit, status}}],
        q: {Q01: {answer, comment}}, wh: {W01: {answer, comment}}, invalid: [{key, value}], name, contact, validUntil}
     A price or transit day that holds text is listed in invalid and left blank. A blank price is "not_offered". */
  function quote(values) {
    const v = values || {}, invalid = [];
    const numOf = k => { const x = v[k]; if (isBlank(x)) return null; if (typeof x === "number" && Number.isFinite(x)) { if (x < 0) { invalid.push({key: k, value: x, reason: "negative"}); return null; } return x; } invalid.push({key: k, value: x, reason: "text"}); return null; };
    const ids = [...new Set(Object.keys(v).map(k => (k.match(/^ship\.(T\d+)\.lane$/) || [])[1]).filter(Boolean))].sort();
    const shipments = ids.map(id => {
      const g = f => v[`ship.${id}.${f}`];
      const opt = (n, priceKey) => {
        const price = numOf(`ship.${id}.${priceKey}`), transit = numOf(`ship.${id}.${n}_transit_days`);
        return {service: isBlank(g(n + "_service")) ? "" : String(g(n + "_service")), price, transit, status: price == null ? "not_offered" : "quoted", fileStatus: g(n + "_status") || ""};
      };
      return {id, lane: String(g("lane") || "").trim(), band: String(g("band") || "").trim(), size: String(g("size") || ""), kg: Number(g("gross_kg")) || null,
        cartons: Number(g("cartons")) || null, m3: Number(g("m3")) || null, comment: isBlank(g("comment")) ? "" : String(g("comment")),
        opt1: opt("opt1", "opt1_price_eur"), opt2: opt("opt2", "opt2_delivery_price_eur"), opt3: opt("opt3", "opt3_price_eur")};
    });
    const block = (prefix, n) => Object.fromEntries(Array.from({length: n}, (_, i) => prefix + pad(i + 1)).map(id => {
      const k = `${prefix === "Q" ? "q" : "wh"}.${id}.answer`;
      const ans = isNumericKey(k) || isPercentKey(k) ? numOf(k) : (isBlank(v[k]) ? null : v[k]);
      return [id, {answer: ans, comment: isBlank(v[k.replace(/answer$/, "comment")]) ? "" : String(v[k.replace(/answer$/, "comment")])}];
    }));
    const q = block("Q", 28), wh = block("W", 16);   // W15 / W16: pick per full carton, outbound per pallet (a later RFQ version)
    const ic = v["meta.input_check"];
    return {version: String(v["meta.rfq_version"] || ""), shipmentCount: Number(v["meta.shipment_count"]) || ids.length, inputCheck: isBlank(ic) ? null : String(ic),
      shipments, q, wh, invalid, name: q.Q01.answer || "", contact: q.Q02.answer || "", email: q.Q03.answer || "", phone: q.Q04.answer || "", validUntil: q.Q05.answer || ""};
  }

  // ================================================================== costs
  const r2 = x => Math.round(x * 100) / 100;
  // The price of one option for a lane and band: the test shipment with the same lane and band; without one, the price
  // per kg of the next lower band that has a test shipment, times the band's average kg ("extrapolated").
  function cellPrice(Q, lane, band, opt, settings) {
    const list = Q.shipments.filter(s => s.lane === lane);
    const own = list.find(s => s.band === band);
    if (own) return own[opt].price == null ? {covered: false, ship: own.id} : {covered: true, price: own[opt].price, transit: own[opt].transit, tag: "quoted", ship: own.id, service: own[opt].service};
    const lower = BANDS.slice(0, BANDS.indexOf(band)).reverse().map(b => list.find(s => s.band === b)).find(Boolean);
    if (!lower || lower[opt].price == null || !(lower.kg > 0)) return {covered: false, ship: lower ? lower.id : null, noTest: true};
    const kg = Number(settings.avgKg[band]) || 0;
    return {covered: true, price: lower[opt].price / lower.kg * kg, transit: lower[opt].transit, tag: "extrapolated", ship: lower.id, from: lower.band, service: lower[opt].service};
  }
  const WH_REQUIRED = ["W04", "W05", "W06", "W07", "W09"];
  // Option 2 needs delivery prices and W04, W05, W06, W07, W09 and the chosen replenishment price (W11 sea, W13 air).
  function opt2Inputs(Q, settings) {
    const rep = settings.replenishment === "air" ? "W13" : "W11";
    const w = id => (Q.wh[id] || {}).answer, num = id => (typeof w(id) === "number" ? w(id) : null);
    const missing = [];
    if (!Q.shipments.some(s => s.opt2.price != null)) missing.push("ship.Txx.opt2_delivery_price_eur");
    WH_REQUIRED.concat([rep]).forEach(id => { if (num(id) == null) missing.push(`wh.${id}`); });
    const needs = [];
    if (!(Number(settings.avgPallets) >= 0) || isBlank(settings.avgPallets)) needs.push("average pallets in stock");
    if (Number(settings.carryingPct) > 0 && isBlank(settings.stockValue)) needs.push("stock value");
    const started = Q.shipments.some(s => s.opt2.price != null) || ["W01", "W02", "W03", "W04", "W05", "W06", "W07", "W08", "W09", "W10", "W11", "W12", "W13", "W14"].some(id => !isBlank(w(id)));
    // handling by order lines (W06), or by cartons and pallets when the file has W15 / W16 (planned for a later RFQ version)
    const byUnits = num("W15") != null || num("W16") != null;
    return {complete: !missing.length, missing, needs, rep, started, method: byUnits ? "cartons and pallets" : "order lines",
      W: {W04: num("W04"), W05: num("W05"), W06: num("W06"), W07: num("W07"), W08: num("W08") || 0, W09: num("W09"), W15: num("W15") || 0, W16: num("W16") || 0, rep: num(rep)}};
  }
  /* Option 2 rates of one scenario: the shares that spread the warehouse's fixed costs over what goes through it.
       storage per kg = (W04 x average pallets in stock x 12 + carrying % x stock value) / annual kg through the warehouse
       fixed per order = W09 x 12 / annual orders through the warehouse
     Annual orders and kg: the scenario's shipments on lanes and bands with an Option 2 delivery price. */
  function opt2Rates(Q, settingsIn, scenario) {
    const settings = withDefaults(settingsIn), inputs = opt2Inputs(Q, settings), V = settings.volumes[scenario] || {};
    let orders = 0, kg = 0;
    Object.keys(LANES).forEach(L => BANDS.forEach(b => {
      const n = Number((V[L] || {})[b]) || 0; if (!(n > 0)) return;
      if (cellPrice(Q, L, b, "opt2", settings).covered) { orders += n; kg += n * (Number(settings.avgKg[b]) || 0); }
    }));
    const state = inputs.complete && !inputs.needs.length && orders > 0 ? "ok" : inputs.started ? "incomplete" : "not_quoted";
    if (state !== "ok") return {state, inputs, orders, kg};
    const W = inputs.W, carrying = (Number(settings.carryingPct) || 0) / 100 * (Number(settings.stockValue) || 0);
    return {state, inputs, orders, kg, storagePerKg: (W.W04 * Number(settings.avgPallets) * 12 + carrying) / kg, fixedPerOrder: W.W09 * 12 / orders};
  }
  /* Option 2 cost per order of one class on one lane = delivery + handling + storage share + replenishment share + fixed share.
       delivery: opt2_delivery_price_eur of the matching test shipment (extrapolated per kg without one)
       handling: W07 + W06 x order lines of the class + W08; or W07 + W15 x cartons + W16 x pallets + W08 (cartons and pallets)
       replenishment share: (replenishment per pallet + W05) / kg per pallet x class kg
       storage share: storage per kg x class kg; fixed share: fixed per order */
  function opt2Order(Q, settingsIn, rates, lane, band) {
    const settings = withDefaults(settingsIn), c = cellPrice(Q, lane, band, "opt2", settings);
    if (!c.covered || !rates || rates.state !== "ok") return Object.assign({}, c, {price: c.covered ? null : undefined, state: rates ? rates.state : "not_quoted"});
    const W = rates.inputs.W, cls = classOf(band), kg = Number(settings.avgKg[band]) || 0;
    const ship = Q.shipments.find(s => s.lane === lane && s.band === band), cartons = (ship && ship.cartons) || cls.cartons;
    const handling = rates.inputs.method === "cartons and pallets" ? W.W07 + W.W15 * cartons + W.W16 * cls.pallets + W.W08 : W.W07 + W.W06 * (Number(settings.orderLinesByClass[band]) || 0) + W.W08;
    const parts = {delivery: c.price, handling, storage: rates.storagePerKg * kg, replenishment: (W.rep + W.W05) / Number(settings.kgPerPallet) * kg, fixed: rates.fixedPerOrder};
    return Object.assign({}, c, {state: "ok", parts, method: rates.inputs.method, price: parts.delivery + parts.handling + parts.storage + parts.replenishment + parts.fixed,
      tag: c.tag === "extrapolated" ? "extrapolated" : "assumption"});   // rests on the warehouse settings
  }
  /* One option in one scenario. Rows per lane and band with volume; totals in EUR.
     opt1 / opt3: annual cost = shipments x test price. opt2: shipments x cost per order of the class (opt2Order), so the
     storage and fixed shares add up to the warehouse's annual storage and fixed fees. */
  function optionCost(Q, opt, scenario, settingsIn) {
    const settings = withDefaults(settingsIn), V = settings.volumes[scenario] || {};
    const cells = [];
    Object.keys(LANES).forEach(L => BANDS.forEach(b => {
      const n = Number((V[L] || {})[b]) || 0; if (!(n > 0)) return;
      const c = cellPrice(Q, L, b, opt, settings);
      cells.push(Object.assign({lane: L, band: b, n, kg: Number(settings.avgKg[b]) || 0, target: Number(settings.targetDays[L])}, c));
    }));
    const total = cells.reduce((a, c) => a + c.n, 0);
    let state = cells.some(c => c.covered) ? "ok" : "not_quoted", inputs = null, rates = null;
    if (opt === "opt2") {
      rates = opt2Rates(Q, settings, scenario); inputs = rates.inputs; state = rates.state;
      if (state === "ok") cells.forEach(c => { if (!c.covered) return; const o = opt2Order(Q, settings, rates, c.lane, c.band); c.delivery = o.parts.delivery; c.parts = o.parts; c.method = o.method; c.price = o.price; c.tag = o.tag; });
    }
    const priced = state === "ok" ? cells.filter(c => c.covered) : [];
    priced.forEach(c => { c.cost = c.n * c.price; c.onTime = c.transit != null && c.transit <= c.target; });
    const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
    const covered = sum(priced, c => c.n), cost = sum(priced, c => c.cost), kg = sum(priced, c => c.n * c.kg);
    const lanes = Object.keys(LANES).map(L => {
      const cs = cells.filter(c => c.lane === L), ps = priced.filter(c => c.lane === L), sh = sum(cs, c => c.n), cv = sum(ps, c => c.n), tr = ps.filter(c => c.transit != null);
      return {lane: L, name: LANES[L].name, gcc: !!LANES[L].gcc, target: Number(settings.targetDays[L]), shipments: sh, covered: cv, cost: sum(ps, c => c.cost),
        perShipment: cv ? sum(ps, c => c.cost) / cv : null, transit: tr.length ? sum(tr, c => c.n * c.transit) / sum(tr, c => c.n) : null,
        onTime: sum(ps.filter(c => c.onTime), c => c.n), extrapolated: sum(ps.filter(c => c.tag === "extrapolated"), c => c.n)};
    });
    return {opt, scenario, state, cells, lanes, inputs, rates, fixedShare: rates && state === "ok" ? rates.fixedPerOrder : null,
      shipments: total, covered, cost: state === "ok" ? cost : null, perShipment: covered ? cost / covered : null, perKg: kg ? cost / kg : null,
      onTime: sum(priced.filter(c => c.onTime), c => c.n), extrapolated: sum(priced.filter(c => c.tag === "extrapolated"), c => c.n),
      tag: state !== "ok" ? null : opt === "opt2" ? "assumption" : priced.some(c => c.tag === "extrapolated") ? "extrapolated" : "derived"};
  }
  function analyse(Q, settings) {
    const out = {};
    OPTIONS.forEach(([o]) => { out[o] = {A: optionCost(Q, o, "A", settings), B: optionCost(Q, o, "B", settings)}; });
    return out;
  }

  // ================================================================== scoring
  /* The rubric: every item scores 0 to 4. steps: [threshold, points] tried in order ("min": value >= threshold,
     "max": value <= threshold, "time": answer at or after HH:MM). starts: [answer prefix, points] matched on the start of
     the answer, case-insensitive. A missing answer scores 0 and is listed. selfReported items are multiplied by
     selfReportedFactor. weight counts an item more than once in its area's average. */
  const RUBRIC = {
    selfReportedFactor: 0.75, selfReported: ["Q13", "Q14"],
    cost: {coverageBelow: 0.9, penalty: 1},
    areas: [
      {key: "cost", label: "Cost", items: [{id: "cost", label: "Annual cost against the lowest comparable", kind: "cost"}]},
      {key: "service", label: "Service", items: [
        {id: "ontime", label: "On-time share on the lane targets", kind: "ontime", steps: [[0.9, 4], [0.7, 3], [0.5, 2], [0.25, 1]]},
        {id: "Q10", label: "Next-day delivery in the GCC", starts: [["Yes from Helmond", 4], ["Yes from regional stock", 3]]},
        {id: "Q09", label: "Pick-up cut-off time in Helmond", time: [["16:00", 4], ["15:00", 3], ["14:00", 2], ["12:00", 1]]},
        {id: "Q11", label: "Import clearance days", max: [[1, 4], [2, 3], [3, 2], [5, 1]]},
        {id: "Q12", label: "Capacity in the peak month", starts: [["Guaranteed", 4], ["Partly guaranteed", 2]]}]},
      {key: "quality", label: "Quality", items: [
        {id: "Q13", label: "On-time delivery rate (self-reported)", min: [[0.98, 4], [0.95, 3], [0.90, 2], [0.85, 1]]},
        {id: "Q14", label: "Damage and loss rate (self-reported)", max: [[0.001, 4], [0.005, 3], [0.01, 2], [0.02, 1]]},
        {id: "Q15", label: "Track and trace and e-POD", starts: [["Both", 4], ["One of the two", 2]]},
        {id: "Q16", label: "One contact and one invoice", starts: [["Both", 4], ["One of the two", 2]]},
        {id: "Q17", label: "Saudi SASO / SABER experience", starts: [["Yes", 4], ["Partial", 2]], weight: 2},
        {id: "Q18", label: "Egypt ACID / CargoX", starts: [["Yes", 4]]},
        {id: "Q19", label: "Certifications", starts: [["ISO 9001 and AEO", 4], ["Only ISO 9001", 2], ["Only AEO", 2]]}]},
      {key: "options", label: "Options and ease", items: [
        {id: "Q20", label: "Express parcel", starts: [["All 9 countries", 4], ["Some", 2]]},
        {id: "Q21", label: "Air freight", starts: [["All 9 countries", 4], ["Some", 2]]},
        {id: "Q22", label: "Road groupage", starts: [["All 9 countries", 4], ["Some", 2]]},
        {id: "Q23", label: "Sea freight", starts: [["All 9 countries", 4], ["Some", 2]]},
        {id: "Q24", label: "Import clearance for the consignee", starts: [["All 9 countries", 4], ["Some", 2]]},
        {id: "Q25", label: "DDP service", starts: [["All 9 countries", 4], ["Some", 2]]},
        {id: "Q26", label: "EUR.1 / A.TR origin documents", starts: [["Yes free", 4], ["Yes against", 3]]},
        {id: "opt2", label: "Option 2 regional stock", kind: "opt2"},
        {id: "opt3", label: "Option 3 other option", kind: "opt3"}]},
    ],
  };
  const rubricOf = settings => (settings && settings.rubric && Array.isArray(settings.rubric.areas) ? settings.rubric : RUBRIC);
  const pctS = x => `${Math.round(x * 1000) / 10}%`;
  // Score one question item. Returns {points, reason, missing}.
  function scoreAnswer(item, Q) {
    const a = (Q.q[item.id] || {}).answer;
    if (isBlank(a)) return {points: 0, reason: "no answer", missing: true};
    if (item.starts) {
      const s = String(a).trim().toLowerCase(), hit = item.starts.find(([p]) => s.startsWith(String(p).toLowerCase()));
      return {points: hit ? hit[1] : 0, reason: `"${a}"`};
    }
    if (item.time) {
      const m = minutes(a); if (m == null) return {points: 0, reason: `"${a}" is not a time`, missing: true};
      const hit = item.time.find(([t]) => m >= minutes(t));
      return {points: hit ? hit[1] : 0, reason: `cut-off ${a}`};
    }
    const n = typeof a === "number" ? a : null;
    if (n == null) return {points: 0, reason: `"${a}" is not a number`, missing: true};
    const pct = item.id === "Q13" || item.id === "Q14" ? pctS(n) : String(n);
    if (item.min) { const hit = item.min.find(([t]) => n >= t - 1e-9); return {points: hit ? hit[1] : 0, reason: pct}; }
    if (item.max) { const hit = item.max.find(([t]) => n <= t + 1e-9); return {points: hit ? hit[1] : 0, reason: item.id === "Q11" ? `${n} working days` : pct}; }
    return {points: 0, reason: String(a)};
  }
  const lanesWith = (Q, opt) => new Set(Q.shipments.filter(s => s[opt].price != null).map(s => s.lane)).size;
  /* The option the Cost and Service scores use: the cheapest complete option in Scenario A, compared on the lanes and
     bands all complete options cover. Complete: costed (opt1 or opt3 quoted, opt2 with every input) and covering at
     least the rubric's coverage bar (90%) of the shipments, so a road quote on two lanes never stands in for the whole
     network. When no option clears the bar, the costed option with the highest coverage. */
  function bestOption(A, bar) {
    const ok = ["opt1", "opt2", "opt3"].filter(o => A[o] && A[o].A.state === "ok");
    if (!ok.length) return null;
    const cov = o => (A[o].A.shipments ? A[o].A.covered / A[o].A.shipments : 0);
    const cands = ok.filter(o => cov(o) >= (bar == null ? RUBRIC.cost.coverageBelow : bar) - 1e-9);
    if (!cands.length) return ok.slice().sort((x, y) => cov(y) - cov(x))[0];
    if (cands.length === 1) return cands[0];
    const key = c => c.lane + c.band, sets = cands.map(o => new Set(A[o].A.cells.filter(c => c.covered).map(key)));
    const common = [...sets[0]].filter(k => sets.every(s => s.has(k)));
    const costOn = o => A[o].A.cells.filter(c => c.covered && common.includes(key(c))).reduce((a, c) => a + c.cost, 0);
    return common.length ? cands.slice().sort((x, y) => costOn(x) - costOn(y))[0] : cands.slice().sort((x, y) => A[x].A.perShipment - A[y].A.perShipment)[0];
  }
  /* Scores for a set of v2.3 providers: [{id, Q, A (analyse)}]. The cost score compares each provider's chosen option on
     the lanes and bands every provider's chosen option covers, in Scenario A: 4 x lowest / this; minus 1 point below
     90% coverage. Area score = average of its items; total = weighted average of the areas. */
  function scoreAll(list, settingsIn) {
    const settings = withDefaults(settingsIn), rub = rubricOf(settings), W = settings.weights;
    const chosen = list.map(x => bestOption(x.A, rub.cost.coverageBelow));
    const key = c => c.lane + c.band;
    const sets = list.map((x, i) => chosen[i] ? new Set(x.A[chosen[i]].A.cells.filter(c => c.covered).map(key)) : null).filter(Boolean);
    const common = sets.length ? [...sets[0]].filter(k => sets.every(s => s.has(k))) : [];
    const comparable = list.map((x, i) => chosen[i] ? x.A[chosen[i]].A.cells.filter(c => c.covered && common.includes(key(c))).reduce((a, c) => a + c.cost, 0) : null);
    const lowest = Math.min(...comparable.filter(c => c != null && c > 0));
    return list.map((x, i) => {
      const Q = x.Q, opt = chosen[i], O = opt ? x.A[opt].A : null, missing = [];
      const areas = rub.areas.map(area => {
        const items = area.items.map(item => {
          let r;
          if (item.kind === "cost") {
            if (!O || !(comparable[i] > 0)) r = {points: 0, reason: "no complete option to cost", missing: false};
            else {
              const cov = O.shipments ? O.covered / O.shipments : 0, base = 4 * lowest / comparable[i], pen = cov < rub.cost.coverageBelow ? rub.cost.penalty : 0;
              r = {points: Math.max(0, base - pen), reason: `${labelOf(opt)}: EUR ${fmt2(comparable[i])} on ${common.length} lanes and bands every provider covers, lowest EUR ${fmt2(lowest)}; coverage ${O.covered} of ${O.shipments}${pen ? `, below ${pctS(rub.cost.coverageBelow)}: minus ${pen}` : ""}`};
            }
          } else if (item.kind === "ontime") {
            if (!O) r = {points: 0, reason: "no complete option"};
            else { const sh = O.shipments ? O.onTime / O.shipments : 0, hit = item.steps.find(([t]) => sh >= t - 1e-9); r = {points: hit ? hit[1] : 0, reason: `${labelOf(opt)}: ${O.onTime} of ${O.shipments} shipments within the lane target (${pctS(sh)})`}; }
          } else if (item.kind === "opt2") {
            const inp = opt2Inputs(Q, settings), w1 = !isBlank((Q.wh.W01 || {}).answer);
            r = inp.complete ? {points: 4, reason: "delivery prices and warehouse rates complete"} : w1 ? {points: 1, reason: `only the location (W01); missing ${inp.missing.join(", ")}`} : {points: 0, reason: "not offered"};
          } else if (item.kind === "opt3") {
            const n = lanesWith(Q, "opt3");
            r = {points: n >= Math.ceil(Object.keys(LANES).length / 2) ? 4 : n >= 1 ? 2 : 0, reason: n ? `quoted on ${n} of 9 lanes` : "not quoted"};
          } else r = scoreAnswer(item, Q);
          if (rub.selfReported.includes(item.id) && !r.missing) { r.raw = r.points; r.points = r.points * rub.selfReportedFactor; r.reason += `, self-reported x ${rub.selfReportedFactor}`; }
          if (r.missing) missing.push(item.id);
          return Object.assign({id: item.id, label: item.label, weight: item.weight || 1}, r);
        });
        const wsum = items.reduce((a, it) => a + it.weight, 0);
        return {key: area.key, label: area.label, items, score: wsum ? items.reduce((a, it) => a + it.points * it.weight, 0) / wsum : 0};
      });
      const tw = areas.reduce((a, ar) => a + (Number(W[ar.key]) || 0), 0);
      const total = tw ? areas.reduce((a, ar) => a + ar.score * (Number(W[ar.key]) || 0), 0) / tw : 0;
      return {id: x.id, option: opt, comparableCost: comparable[i], commonCells: common.length, areas, total, missing};
    });
  }
  const labelOf = o => (OPTIONS.find(x => x[0] === o) || [o, o])[1];
  const fmt2 = x => (Math.round(x * 100) / 100).toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2});

  // ================================================================== red flags and follow-up questions
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthsIn = s => [...new Set((String(s || "").toLowerCase().match(/\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/g) || []).map(m => m.slice(0, 3)))].filter(m => MONTHS.includes(m));
  const comments = Q => [].concat(Object.entries(Q.q).map(([id, x]) => [`q.${id}.comment`, x.comment]), Object.entries(Q.wh).map(([id, x]) => [`wh.${id}.comment`, x.comment]),
    Q.shipments.map(s => [`ship.${s.id}.comment`, s.comment])).filter(([, c]) => !isBlank(c));
  /* F1 to F8, each {id, key, reason}. A (analyse) gives coverage per lane. */
  function flags(Q, A, settingsIn) {
    const settings = withDefaults(settingsIn), out = [], add = (id, key, reason) => out.push({id, key, reason});
    const q = id => (Q.q[id] || {}).answer, qc = id => (Q.q[id] || {}).comment || "";
    if (!isBlank(q("Q05")) && String(q("Q05")) < `${settings.volumeYear}-01-01`) add("F1", "q.Q05.answer", `Prices are valid until ${q("Q05")}, before 1 January ${settings.volumeYear}, the volume year.`);
    if (/^some/i.test(String(q("Q07") || "")) && /per[\s-]*(piece|pc|pcs|parcel|carton|box|item|package)|\b70\s*kg/i.test(qc("Q07")))
      add("F2", "q.Q07.comment", "Surcharges on top include a per-piece or 70 kg rule; FlexiTog's crated cabinets weigh about 70 kg.");
    const vol = comments(Q).find(([, c]) => /1\s*:\s*[45][,.]?000\b|\/\s*[45][,.]?000\b/.test(c));
    if (vol) add("F3", vol[0], `A comment uses a volumetric rule stricter than 1:6000: "${String(vol[1]).slice(0, 80)}".`);
    if (isBlank(q("Q06"))) add("F4", "q.Q06.answer", "The fuel surcharge included in the prices is not stated.");
    else if (monthsIn(qc("Q06")).length === 1) add("F4", "q.Q06.comment", `The fuel surcharge is stated for a single month only ("${qc("Q06").slice(0, 60)}"), so prices may move with fuel.`);
    if (/^yes/i.test(String(q("Q10") || ""))) {
      const gcc = Q.shipments.filter(s => LANES[s.lane] && LANES[s.lane].gcc);
      const fast = gcc.some(s => ["opt1", "opt2", "opt3"].some(o => s[o].price != null && s[o].transit != null && s[o].transit <= 2));
      if (!fast) add("F5", "q.Q10.answer", `Next-day GCC delivery is offered ("${q("Q10")}"), but no quoted option reaches 2 days on any GCC lane.`);
    }
    Object.keys(LANES).forEach(L => {
      const any = ["opt1", "opt2", "opt3"].some(o => ["A", "B"].some(s => A[o][s].cells.some(c => c.lane === L && c.covered)));
      const hasVol = ["A", "B"].some(s => BANDS.some(b => Number(((settings.volumes[s] || {})[L] || {})[b]) > 0));
      if (hasVol && !any) add("F6", `ship.${L}`, `${L} ${LANES[L].name}: no option is offered for any band with volume.`);
    });
    if (Q.inputCheck !== OK_CHECK) add("F7", "meta.input_check", Q.inputCheck ? `The file's own input check says: ${Q.inputCheck}.` : "The file's own input check has no result (the file was not saved in Excel).");
    if (q("Q14") === 0 || q("Q13") === 1) add("F8", q("Q14") === 0 ? "q.Q14.answer" : "q.Q13.answer", `Self-reported ${q("Q14") === 0 ? "damage rate of 0%" : "on-time rate of 100%"} is not credible without evidence.`);
    return out;
  }
  const QTEXT = {Q09: "your daily pick-up cut-off time in Helmond", Q10: "whether you offer next-day delivery in the GCC", Q11: "your average import clearance time in working days",
    Q12: "whether your capacity is guaranteed in the peak month", Q13: "your on-time delivery rate on these lanes over the last 12 months", Q14: "your damage and loss rate over the last 12 months",
    Q15: "whether you offer track and trace and e-POD", Q16: "whether we get one contact person and one invoice for all lanes", Q17: "your experience with Saudi SASO / SABER",
    Q18: "how you handle Egypt ACID / CargoX pre-registration", Q19: "which certifications you hold", Q20: "where you offer express parcel service", Q21: "where you offer air freight",
    Q22: "where you offer road groupage", Q23: "where you offer sea freight", Q24: "where you offer import customs clearance for the consignee", Q25: "where you offer DDP service",
    Q26: "whether you issue EUR.1 / A.TR origin documents"};
  const FLAG_Q = {F1: "Can you extend the price validity to cover all of {year}?", F2: "Can you confirm how a crated cabinet of about 70 kg is charged, and whether per-piece surcharges apply?",
    F3: "Can you price on a volumetric rule of 1:6000, or confirm the rule you used for each test shipment?", F4: "Which fuel surcharge level is included, and how will it change after that month?",
    F5: "Which lanes and services reach the GCC in 2 days or less, since none of the quoted options do?", F6: "Can you offer any service on {lane}?",
    F7: "Can you check the rows the input check marks and send the corrected file?", F8: "Can you share the data behind the self-reported on-time and damage figures?"};
  // One plain sentence per item: missing scored answers, not-offered bands with volume, Option 2 gaps, each red flag.
  function followUps(Q, A, S, F, settingsIn) {
    const settings = withDefaults(settingsIn), out = [];
    (S ? S.missing : []).filter(id => QTEXT[id]).forEach(id => out.push(`Please tell us ${QTEXT[id]} (${id}).`));
    const gaps = A.opt1.B.cells.filter(c => !c.covered).map(c => `${c.lane} ${LANES[c.lane].name} ${c.band}`);
    if (gaps.length) out.push(`Can you quote Option 1 for ${gaps.join(", ")}? These bands have volume but no price.`);
    const inp = opt2Inputs(Q, settings);
    if (!inp.complete && (Q.shipments.some(s => s.opt2.price != null) || !isBlank((Q.wh.W01 || {}).answer)))
      out.push(`Option 2 is incomplete: please fill in ${inp.missing.join(", ")}.`);
    F.forEach(f => {
      const lane = f.id === "F6" ? f.key.replace(/^ship\./, "") : "";
      out.push(`${f.id}: ${FLAG_Q[f.id].replace("{year}", settings.volumeYear).replace("{lane}", lane ? `${lane} ${LANES[lane].name}` : "")}`);
    });
    return out;
  }

  // ================================================================== the Dashboard: one model from the Benchmarking results
  /* list: the evaluated providers as Benchmarking ranks them, [{id, name, Q, A, S, flags, follow}] (A from analyse).
     Every figure is read from optionCost, cellPrice and opt2Order, so the Dashboard and the Benchmarking tab show the
     same totals. filters: {provider: "all" | id, scenario: "A" | "B", option: "opt1" | "opt2" | "opt3" | "cheapest"}. */
  const OPT_IDS = ["opt1", "opt2", "opt3"];
  const optsOf = f => (!f || f.option === "cheapest" || !f.option ? OPT_IDS : [f.option]);
  const provsOf = (list, f) => (!f || f.provider === "all" || !f.provider ? list : list.filter(e => e.id === f.provider));
  const shortOpt = o => ({opt1: "Option 1", opt2: "Option 2", opt3: "Option 3"})[o] || o;
  const ratesOf = (e, settings, sc) => { e._rates = e._rates || {}; return e._rates[sc] || (e._rates[sc] = opt2Rates(e.Q, settings, sc)); };
  const missingOf = r => r.inputs.missing.concat(r.inputs.needs.map(x => "setting: " + x));
  /* Cost per order of one class on one lane, for one provider and option:
     {state: "ok" | "not_quoted" | "incomplete" | "no_test", price, tag, transit, target, meets, service, ship, parts, missing}.
     A band with no test shipment and no volume in the scenario is "no_test"; with volume it is extrapolated, as in the totals. */
  function classCost(e, opt, scenario, lane, band, settingsIn) {
    const settings = withDefaults(settingsIn), target = Number(settings.targetDays[lane]);
    const n = Number(((settings.volumes[scenario] || {})[lane] || {})[band]) || 0;
    const own = e.Q.shipments.some(s => s.lane === lane && s.band === band);
    if (!own && !(n > 0)) return {state: "no_test", price: null, target, n};
    let c;
    if (opt === "opt2") {
      const r = ratesOf(e, settings, scenario);
      if (r.state !== "ok") return {state: r.state, price: null, target, n, missing: missingOf(r)};
      c = opt2Order(e.Q, settings, r, lane, band);
    } else c = cellPrice(e.Q, lane, band, opt, settings);
    if (!c.covered || c.price == null) return {state: "not_quoted", price: null, target, n, ship: c.ship};
    return Object.assign({}, c, {state: "ok", target, n, meets: c.transit != null && c.transit <= target});
  }
  // Annual cost, coverage and on-time share per region and in total (volume-weighted sums of the lanes).
  function regionTotals(e, opt, scenario) {
    const O = e.A[opt][scenario], sum = (ls, f) => ls.reduce((a, l) => a + f(l), 0);
    const rows = REGIONS.map(([region, lanes]) => { const ls = O.lanes.filter(l => lanes.includes(l.lane));
      return {region, lanes, state: O.state, cost: O.state === "ok" ? sum(ls, l => l.cost) : null, covered: sum(ls, l => l.covered), shipments: sum(ls, l => l.shipments), onTime: sum(ls, l => l.onTime)}; });
    return {state: O.state, tag: O.tag, rows, total: {cost: O.cost, covered: O.covered, shipments: O.shipments, onTime: O.onTime}, missing: O.state === "incomplete" && O.inputs ? missingOf(O.rates) : []};
  }
  // Cost of shipping one pallet: the Pallet class price, and the Multi-pallet price / 4 (own test shipments only, never extrapolated).
  function palletCost(e, opt, scenario, lane, settingsIn) {
    const own = band => e.Q.shipments.some(s => s.lane === lane && s.band === band);
    const one = own("B3") ? classCost(e, opt, scenario, lane, "B3", settingsIn) : {state: "no_test", price: null};
    const m = own("B4") ? classCost(e, opt, scenario, lane, "B4", settingsIn) : {state: "no_test", price: null};
    return {pallet: one, multi: Object.assign({}, m, {price: m.price == null ? null : m.price / 4})};
  }
  // Holding stock with a provider: every Q3 figure, or null ("not quoted").
  function warehouse(e, settingsIn) {
    const settings = withDefaults(settingsIn), w = id => (e.Q.wh[id] || {}).answer, inp = opt2Inputs(e.Q, settings), W = inp.W;
    const handling = CLASSES.map(c => ({band: c.band, label: c.label, value: W.W07 == null || (inp.method === "order lines" && W.W06 == null) ? null
      : inp.method === "cartons and pallets" ? W.W07 + W.W15 * c.cartons + W.W16 * c.pallets + W.W08 : W.W07 + W.W06 * (Number(settings.orderLinesByClass[c.band]) || 0) + W.W08}));
    return {location: w("W01"), customs: w("W02"), countries: w("W03"), storage: W.W04, inbound: W.W05, pick: W.W06, pack: W.W07, clearance: w("W08"), fixed: W.W09,
      seaPallet: typeof w("W11") === "number" ? w("W11") : null, seaDays: w("W12"), airPallet: typeof w("W13") === "number" ? w("W13") : null, airDays: w("W14"),
      handling, method: inp.method, complete: inp.complete, missing: inp.missing};
  }
  // Option 1 against Option 2 per class on one lane, and the class from which regional stock is cheaper for it and every larger class.
  function breakEven(e, scenario, lane, settingsIn) {
    const r = ratesOf(e, withDefaults(settingsIn), scenario);
    const rows = CLASSES.map(c => { const a = classCost(e, "opt1", scenario, lane, c.band, settingsIn), b = classCost(e, "opt2", scenario, lane, c.band, settingsIn);
      return {band: c.band, label: c.label, opt1: a, opt2: b, diff: a.price != null && b.price != null ? b.price - a.price : null}; });
    if (r.state !== "ok") return {state: r.state, missing: missingOf(r), rows, from: null};
    const both = rows.filter(x => x.diff != null);
    const i = both.findIndex((x, k) => both.slice(k).every(y => y.diff < 0));
    return {state: "ok", rows, from: i >= 0 ? both[i].band : null};
  }
  // The red flags that concern one country: a test shipment comment on its lane, a lane with nothing offered, F5 on GCC lanes.
  function countryFlags(e, lane) {
    return e.flags.filter(f => f.key === `ship.${lane}` || (f.id === "F5" && LANES[lane].gcc) || (/^ship\.T\d+\./.test(f.key) && (e.Q.shipments.find(s => f.key.startsWith(`ship.${s.id}.`)) || {}).lane === lane));
  }
  // The cheapest quote for one cell over the providers and options the filters allow; or why there is none.
  function cheapestCell(list, f, lane, band, settingsIn) {
    const sc = (f && f.scenario) || "A", all = [];
    provsOf(list, f).forEach(e => optsOf(f).forEach(o => all.push(Object.assign({provider: e.id, name: e.name, opt: o}, classCost(e, o, sc, lane, band, settingsIn)))));
    const ok = all.filter(x => x.state === "ok").sort((a, b) => a.price - b.price);
    // no price: "not quoted" (a provider left it blank) before "incomplete" (Option 2 inputs missing) before "no test shipment"
    return ok[0] || all.find(x => x.state === "not_quoted") || all.find(x => x.state === "incomplete") || all[0] || {state: "not_quoted", price: null};
  }
  const coverageOf = O => (O.shipments ? O.covered / O.shipments : 0);
  // Like for like: among entries, the highest coverage first, then the lowest cost.
  const likeForLike = xs => xs.filter(x => x.cost != null).sort((a, b) => (b.covered / (b.shipments || 1)) - (a.covered / (a.shipments || 1)) || a.cost - b.cost)[0] || null;
  function keyFigures(list, f, settingsIn) {
    const settings = withDefaults(settingsIn), bar = rubricOf(settings).cost.coverageBelow, sc = (f && f.scenario) || "A", ps = provsOf(list, f);
    const cands = [];
    ps.forEach(e => optsOf(f).forEach(o => { const A = e.A[o].A; if (A.state === "ok") cands.push({e, opt: o, A, B: e.A[o].B, complete: coverageOf(A) >= bar - 1e-9}); }));
    const pick = cands.filter(c => c.complete).sort((a, b) => a.A.cost - b.A.cost)[0] || cands.sort((a, b) => coverageOf(b.A) - coverageOf(a.A) || a.A.cost - b.A.cost)[0] || null;
    const best = ps.slice().sort((a, b) => b.S.total - a.S.total)[0] || null;
    let gcc = null;
    if (pick) { const O = pick.e.A[pick.opt][sc], ls = O.lanes.filter(l => LANES[l.lane].gcc); gcc = {onTime: ls.reduce((a, l) => a + l.onTime, 0), shipments: ls.reduce((a, l) => a + l.shipments, 0)}; }
    return {providers: list.length, best, pick: pick ? {provider: pick.e.id, name: pick.e.name, opt: pick.opt, complete: pick.complete, A: pick.A.cost, B: pick.B.cost,
      tagA: pick.A.tag, tagB: pick.B.tag, coverage: {covered: pick.e.A[pick.opt][sc].covered, shipments: pick.e.A[pick.opt][sc].shipments}, gcc} : null};
  }
  // Region cards: per option the like-for-like cheapest provider's annual cost, coverage and on-time share; and the cheapest overall.
  function regionCards(list, f, settingsIn) {
    const sc = (f && f.scenario) || "A", ps = provsOf(list, f);
    return REGIONS.map(([region, lanes]) => {
      const per = OPT_IDS.map(o => {
        const xs = ps.map(e => { const t = regionTotals(e, o, sc), r = t.rows.find(x => x.region === region); return Object.assign({provider: e.id, name: e.name, opt: o, state: t.state, tag: t.tag, missing: t.missing}, r); });
        const best = likeForLike(xs.filter(x => x.state === "ok"));
        return {opt: o, best, states: xs};
      });
      const overall = likeForLike(per.filter(p => optsOf(f).includes(p.opt)).map(p => p.best).filter(Boolean));
      return {region, lanes, per, overall};
    });
  }

  // ================================================================== answers to the management questions (templates, no AI)
  const money0 = x => "EUR " + Math.round(x).toLocaleString("en-GB");
  const moneyS = x => "EUR " + fmt2(x);
  const listAnd = xs => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);
  const lname = L => (L === "L02" ? "the UAE" : LANES[L].name);
  function answers(list, f, settingsIn) {
    const settings = withDefaults(settingsIn), sc = (f && f.scenario) || "A", ps = provsOf(list, f), out = [];
    if (!ps.length) return {answers: [{q: "Q1", text: "No Quick Quote v2.3 answers yet, so there is nothing to compare."}], gaps: [], followUps: []};
    const oname = o => (f && f.option !== "cheapest" ? shortOpt(o) : shortOpt(o));
    const L9 = Object.keys(LANES);
    // Q1: cost per class per country
    const cells = L9.flatMap(L => CLASSES.map(c => Object.assign({lane: L, cls: c}, cheapestCell(list, f, L, c.band, settings))));
    const ok = cells.filter(x => x.state === "ok"), lo = ok.slice().sort((a, b) => a.price - b.price)[0], hi = ok.slice().sort((a, b) => b.price - a.price)[0];
    const nq = cells.filter(x => x.state === "not_quoted" && x.n > 0);
    const byCls = {}; nq.forEach(x => { (byCls[x.cls.label] = byCls[x.cls.label] || []).push(lname(x.lane)); });
    out.push({q: "Q1", text: ok.length ? `Per order, quotes run from ${moneyS(lo.price)} (${lo.cls.label} to ${lname(lo.lane)}, ${oname(lo.opt)}, ${lo.name}) to ${moneyS(hi.price)} (${hi.cls.label} to ${lname(hi.lane)}, ${oname(hi.opt)}, ${hi.name}).` +
      (Object.keys(byCls).length ? ` Not quoted although they have volume: ${Object.entries(byCls).map(([k, v]) => `${k.toLowerCase()}s to ${listAnd(v)}`).join("; ")}.` : " Every class with volume is quoted.") : "No class is quoted for the options and providers selected."});
    // Q2: one pallet
    const pal = L9.map(L => ({L, c: cheapestCell(list, f, L, "B3", settings)})).filter(x => x.c.state === "ok");
    if (pal.length) {
      const s = pal.slice().sort((a, b) => a.c.price - b.c.price), big = pal.slice().sort((a, b) => (Number(settings.volumes[sc][b.L].B3) || 0) - (Number(settings.volumes[sc][a.L].B3) || 0))[0];
      const svc = big.c.service ? ` ${String(big.c.service).replace(/^./, ch => ch.toLowerCase())}` : "";
      out.push({q: "Q2", text: `Shipping one pallet costs ${moneyS(s[0].c.price)} to ${lname(s[0].L)} up to ${moneyS(s[s.length - 1].c.price)} to ${lname(s[s.length - 1].L)}. Shipping one pallet to ${lname(big.L)} costs ${moneyS(big.c.price)} with ${big.c.name}${svc}${big.c.opt === "opt2" ? " from regional stock" : big.c.opt === "opt1" ? " from Helmond" : ""}${big.c.transit != null ? `, in ${fmt2(big.c.transit).replace(/\.00$/, "")} days against a target of ${big.c.target}` : ""}.`});
    } else out.push({q: "Q2", text: "No pallet shipment is quoted for the options and providers selected."});
    // Q3: holding stock
    out.push({q: "Q3", text: ps.map(e => { const w = warehouse(e, settings), rates = [["storage", w.storage, "per pallet per month"], ["inbound", w.inbound, "per pallet"], ["fixed fee", w.fixed, "per month"], ["sea replenishment", w.seaPallet, "per pallet"], ["air replenishment", w.airPallet, "per pallet"]];
      const q = rates.filter(r => r[1] != null), loc = w.location ? `warehouse in ${w.location}${w.customs ? ` (${String(w.customs).toLowerCase()})` : ""}` : "no warehouse location";
      return `${e.name}: ${loc}; ${q.length ? q.map(r => `${r[0]} ${moneyS(r[1])} ${r[2]}`).join(", ") + (q.length < rates.length ? `; not quoted: ${rates.filter(r => r[1] == null).map(r => r[0]).join(", ")}` : "") : "storage, inbound, handling, fixed fee and replenishment are not quoted"}.`; }).join(" ")});
    // Q4: Helmond against regional stock
    out.push({q: "Q4", text: ps.map(e => {
      const r = ratesOf(e, settings, sc);
      if (r.state !== "ok") return `${e.name}: Option 2 is ${r.state === "incomplete" ? "incomplete" : "not quoted"}${r.state === "incomplete" ? ` (missing ${missingOf(r).join(", ")})` : ""}, so Helmond and regional stock cannot be compared.`;
      const bes = L9.map(L => ({L, b: breakEven(e, sc, L, settings)})).filter(x => x.b.rows.some(y => y.diff != null));
      if (!bes.length) return `${e.name}: no class has both an Option 1 and an Option 2 price.`;
      const pays = bes.filter(x => x.b.from), never = bes.filter(x => !x.b.from);
      return `${e.name}: regional stock pays off ${pays.length ? pays.map(x => { const row = x.b.rows.find(y => y.band === x.b.from); return `in ${lname(x.L)} from ${classOf(x.b.from).label.toLowerCase()} on (saves ${moneyS(-row.diff)} per order)`; }).join("; ") : "in no country"}${never.length ? `; Helmond stays cheaper in ${listAnd(never.map(x => lname(x.L)))}` : ""}.`; }).join(" ")});
    // Q5: delivery target
    const meets = L9.map(L => ({L, opts: OPT_IDS.filter(o => optsOf(f).includes(o)).map(o => { const cs = ps.flatMap(e => CLASSES.map(c => classCost(e, o, sc, L, c.band, settings))).filter(c => c.state === "ok");
      return {o, n: cs.length, met: cs.filter(c => c.meets).length, fastest: cs.filter(c => c.transit != null).reduce((m, c) => Math.min(m, c.transit), Infinity)}; })}));
    const meetAll = meets.filter(x => x.opts.some(o => o.n && o.met === o.n)).map(x => lname(x.L));
    const gccFast = meets.filter(x => LANES[x.L].gcc).flatMap(x => x.opts).filter(o => o.n).reduce((m, o) => Math.min(m, o.fastest), Infinity);
    out.push({q: "Q5", text: `${meetAll.length ? `An option meets the delivery target on every quoted class in ${listAnd(meetAll)}` : "No option meets the delivery target on every quoted class in any country"}. In the GCC (target 2 working days) ${Number.isFinite(gccFast) ? (gccFast <= 2 ? "at least one quoted class reaches 2 days" : `no quoted option reaches 2 days; the fastest takes ${fmt2(gccFast).replace(/\.00$/, "")}`) : "nothing is quoted"}.`});
    // Q6: annual cost per region and in total
    out.push({q: "Q6", text: ps.map(e => OPT_IDS.filter(o => optsOf(f).includes(o)).map(o => { const t = regionTotals(e, o, sc);
      return t.state !== "ok" ? `${e.name}, ${shortOpt(o)}, Scenario ${sc}: ${t.state === "incomplete" ? "incomplete" : "not quoted"}.`
        : `${e.name}, ${shortOpt(o)}, Scenario ${sc}: ${money0(t.total.cost)} a year (${t.rows.map(r => `${r.region} ${r.cost == null ? "n/a" : money0(r.cost)}`).join(", ")}), ${t.total.covered} of ${t.total.shipments} shipments covered, ${t.total.onTime} on time.`; }).join(" ")).join(" ")});
    // Q7: best provider, why, and the gaps
    const best = ps.slice().sort((a, b) => b.S.total - a.S.total)[0], ar = best.S.areas.slice().sort((a, b) => b.score - a.score);
    const gaps = [];
    ps.forEach(e => {
      if (e.S.missing.length) gaps.push(`${e.name}: no answer to ${listAnd(e.S.missing)}, scored 0.`);
      const nqv = L9.flatMap(L => CLASSES.filter(c => (Number(settings.volumes[sc][L][c.band]) || 0) > 0 && classCost(e, "opt1", sc, L, c.band, settings).state === "not_quoted").map(c => `${c.label.toLowerCase()} to ${lname(L)}`));
      if (nqv.length) gaps.push(`${e.name}: Option 1 not quoted for ${listAnd(nqv)}, which have volume in Scenario ${sc}.`);
      const r = ratesOf(e, settings, sc); if (r.state === "incomplete") gaps.push(`${e.name}: Option 2 incomplete, missing ${missingOf(r).join(", ")}.`);
      if (e.Q.invalid.length) gaps.push(`${e.name}: text where a number belongs in ${e.Q.invalid.map(x => x.key).join(", ")}, left out.`);
    });
    if (list.length < 2) gaps.unshift(`Only ${list.length} provider has a Quick Quote v2.3 answer, so the cost score has nothing to compare against.`);
    out.push({q: "Q7", text: `${best.name} scores best with ${best.S.total.toFixed(2)} of 4: strongest on ${ar[0].label.toLowerCase()} (${ar[0].score.toFixed(2)})${ar[1] ? ` and ${ar[1].label.toLowerCase()} (${ar[1].score.toFixed(2)})` : ""}, weakest on ${ar[ar.length - 1].label.toLowerCase()} (${ar[ar.length - 1].score.toFixed(2)}). ${gaps.length ? `${gaps.length} data gap${gaps.length === 1 ? " limits" : "s limit"} this conclusion (listed below).` : "No data gaps limit this conclusion."}`});
    return {answers: out, gaps, followUps: ps.map(e => ({provider: e.name, items: e.follow || []}))};
  }

  // ================================================================== one call for a provider
  /* evaluate(values, settings) -> {Q, A, flags}. Scores need every provider at once: scoreAll. */
  function evaluate(values, settings) {
    const Q = quote(values), A = analyse(Q, settings);
    return {Q, A, flags: flags(Q, A, settings)};
  }
  // Coverage per lane from the priced test shipments of any option (the provider's countries).
  const lanesCovered = Q => Object.keys(LANES).filter(L => Q.shipments.some(s => s.lane === L && (s.opt1.price != null || s.opt2.price != null || s.opt3.price != null)));
  // The Option 1 price for a lane and band, as given (Landed Cost quotes, the Route Dashboard and the Helmond comparison).
  const priceFor = (Q, lane, band, opt) => { const s = Q.shipments.find(x => x.lane === lane && x.band === band); const o = s && s[opt || "opt1"]; return o && o.price != null ? {price: o.price, transit: o.transit, service: o.service, ship: s.id, kg: s.kg} : null; };

  const api = {VERSION, LEGACY_VERSIONS, LANES, BANDS, OPTIONS, OK_CHECK, DEFAULT_SETTINGS, withDefaults, RUBRIC, rubricOf, strictNumber, convert, valuesOf, versionKind,
    quote, cellPrice, opt2Inputs, opt2Rates, opt2Order, optionCost, analyse, bestOption, scoreAll, scoreAnswer, flags, followUps, evaluate, lanesCovered, priceFor, labelOf, r2,
    CLASSES, REGIONS, classOf, classCost, regionTotals, palletCost, warehouse, breakEven, countryFlags, cheapestCell, keyFigures, regionCards, answers, shortOpt};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FlexiRFQ23 = api;
})(typeof window !== "undefined" ? window : globalThis);
