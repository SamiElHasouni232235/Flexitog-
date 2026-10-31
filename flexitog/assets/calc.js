/* FlexiTog calculation engine: every cost formula the views show, in one place. No DOM.
 * Browser: window.FlexiCalc. Node: module.exports (tests).
 *
 * Landed cost of one shipment (country, product, units, quote):
 *   1. Chargeable weight = max(actual kg, m3 x factor). Factors (kg per m3): air 167, road 333, sea LCL 1000, express 200.
 *   2. Freight total = max(rate x chargeable units, minimum) + fuel + peak + war risk + other surcharges (per shipment).
 *      Freight per garment = freight total / units.
 *   3. CIF = EXW + freight + insurance, insurance = insurance rate x (EXW + freight).
 *   4. Duty = CIF x duty rate.
 *   5. Landed cost = CIF + duty + clearance fee / units + yearly compliance cost / expected yearly units.
 *   6. DAP price = landed cost x (1 + margin).
 * Rates are in %. Quote amounts are in the quote currency (EUR or USD); USD -> EUR = USD / eurUsdRate.
 * The route engine (engine.js, mirrored by engine.py) prices whole orders per scenario; this module prices
 * garments and holds the provider, quote and forecast formulas.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FlexiCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FACTORS = {air: 167, road: 333, sea: 1000, express: 200, multimodal: 333};
  const n = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const z = v => n(v) || 0;
  const SURCHARGES = [["fuel_surcharge", "Fuel"], ["peak_surcharge", "Peak"], ["war_risk_surcharge", "War risk"], ["other_surcharge", "Other fees"]];

  // ---- small cache: results keyed by name and inputs, cleared when data changes (invalidate)
  const CACHE = new Map();
  let VERSION = 0;
  function memo(name, key, fn){
    const k = name + "|" + VERSION + "|" + key;
    if (CACHE.has(k)) return CACHE.get(k);
    const v = fn(); CACHE.set(k, v);
    if (CACHE.size > 400) CACHE.delete(CACHE.keys().next().value);
    return v;
  }
  function invalidate(){ VERSION++; CACHE.clear(); }

  // ---- money
  function toEUR(amount, currency, settings){
    const a = n(amount); if (a === null) return null;
    const c = String(currency || "EUR").toUpperCase();
    if (c === "EUR") return a;
    if (c === "USD") { const r = n(settings && settings.eur_usd_rate); return r > 0 ? a / r : null; }
    return null;
  }
  const fromEUR = (eur, currency, settings) => (String(currency).toUpperCase() === "USD" ? eur * z(settings && settings.eur_usd_rate) : eur);

  // ---- shipment geometry
  function shipmentOf(product, units){
    const u = z(units), upc = z(product.units_per_carton);
    const cm3 = z(product.carton_l_cm) * z(product.carton_w_cm) * z(product.carton_h_cm);
    const cartons = upc > 0 ? Math.ceil(u / upc) : 0;
    return {units: u, cartons, cartonM3: cm3 / 1e6, m3: cartons * cm3 / 1e6, kg: u * z(product.unit_weight_kg)};
  }
  function chargeable(kg, m3, mode){
    const factor = FACTORS[String(mode || "").toLowerCase()] || FACTORS.road;
    const volKg = m3 * factor;
    return {factor, volumeKg: volKg, chargeableKg: Math.max(kg, volKg), chargeableM3: Math.max(m3, kg / factor), byVolume: volKg > kg};
  }
  // Weight band (from, to]: a band 30-100 kg takes above 30 up to and including 100, like the RFQ bands.
  const inBand = (q, kg) => { const f = n(q.weight_from_kg), t = n(q.weight_to_kg); return (f === null || kg > f || (f === 0 && kg >= 0)) && (t === null || kg <= t); };

  /* Freight for one shipment on one quote. Amounts in the quote currency and in EUR. */
  function freight(quote, ship, mode, settings){
    const ch = chargeable(ship.kg, ship.m3, mode), unit = quote.rate_unit;
    const qty = unit === "per kg" ? ch.chargeableKg : unit === "per m3" ? ch.chargeableM3 : 1;
    const rate = z(quote.base_rate), byRate = rate * qty, min = z(quote.min_charge);
    const base = Math.max(byRate, min);
    const sur = SURCHARGES.map(([k, label]) => ({key: k, label, amount: z(quote[k])}));
    const total = base + sur.reduce((a, s) => a + s.amount, 0);
    const cur = String(quote.currency || "EUR").toUpperCase(), eur = v => toEUR(v, cur, settings);
    return {mode, rateUnit: unit, chargeableQty: qty, rate, byRate, minCharge: min, minApplied: min > byRate, base, surcharges: sur, total, currency: cur,
      baseEUR: eur(base), surchargesEUR: sur.map(s => Object.assign({}, s, {eur: eur(s.amount)})), totalEUR: eur(total), ...ch};
  }

  /* Landed cost per garment. product: Master Data product; country: countries row; settings: settings row;
     quote + lane (for the mode). Returns every intermediate value, or {error}. */
  function landedCost({product, units, quote, lane, country, settings}){
    if (!product) return {error: "no product"};
    if (!country) return {error: "no country data"};
    if (!quote) return {error: "no valid quote"};
    const u = z(units); if (!(u > 0)) return {error: "units must be above 0"};
    const missing = ["unit_weight_kg", "carton_l_cm", "carton_w_cm", "carton_h_cm", "units_per_carton", "unit_price_eur"].filter(k => !(z(product[k]) > 0) && !(k === "unit_price_eur" && n(product[k]) === 0));
    if (missing.length) return {error: "product misses " + missing.join(", ")};
    const ship = shipmentOf(product, u), mode = (lane && lane.mode) || "road";
    const fr = freight(quote, ship, mode, settings);
    if (fr.totalEUR === null) return {error: `no exchange rate for ${fr.currency}`};
    const exw = z(product.unit_price_eur), freightPer = fr.totalEUR / u;
    const insRate = z(settings && settings.insurance_rate_pct), insurance = insRate / 100 * (exw + freightPer);
    const cif = exw + freightPer + insurance;
    const dutyRate = z(country.duty_rate_pct), duty = cif * dutyRate / 100;
    const clearance = z(country.clearance_fee_eur) / u;
    const years = z(country.expected_yearly_units), compliance = years > 0 ? z(country.compliance_cost_eur) / years : 0;
    const landed = cif + duty + clearance + compliance;
    const marginPct = z(settings && settings.margin_pct), dap = landed * (1 + marginPct / 100);
    const parts = [["exw", "EXW", exw], ["freight", "Freight", freightPer], ["insurance", "Insurance", insurance], ["duty", "Duty", duty],
      ["clearance", "Clearance", clearance], ["compliance", "Compliance", compliance]].map(([key, label, eur]) => ({key, label, eur, share: landed ? eur / landed : 0}));
    return {sku: product.sku, country: country.country, units: u, quoteId: quote.quote_id, providerId: quote.provider_id, laneId: quote.lane_id, mode,
      shipment: ship, freight: fr, perGarment: {exw, freight: freightPer, insurance, cif, duty, clearance, compliance, landed, dap},
      rates: {insurancePct: insRate, dutyPct: dutyRate, marginPct, standardDutyPct: n(country.standard_duty_rate_pct)}, parts, transitDays: n(quote.transit_days)};
  }

  // ---- quotes
  const isExpired = (q, today) => !!q.valid_until && String(q.valid_until).slice(0, 10) < today;
  function monthsBefore(today, months){ const d = new Date(today + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); }
  /* Quotes in force: not expired, inside the recency window (months 0 = all), provider type filter. */
  function liveQuotes(quotes, {today, months, typeOf, type}){
    const from = months ? monthsBefore(today, months) : null;
    return (quotes || []).filter(q => !isExpired(q, today) && (!from || String(q.quote_date || "").slice(0, 10) >= from) &&
      (!type || type === "all" || typeOf(q.provider_id) === type));
  }
  /* Quotes usable for one shipment: lanes to the country, mode and provider filters, weight band. */
  function candidateQuotes({quotes, lanes, country, mode, provider, today, kgFor}){
    const laneOf = Object.fromEntries((lanes || []).map(l => [l.lane_id, l]));
    return liveQuotes(quotes, {today, months: 0, typeOf: () => null}).filter(q => {
      const l = laneOf[q.lane_id]; if (!l || String(l.destination_id).toUpperCase() !== country) return false;
      if (mode && mode !== "all" && String(l.mode) !== mode) return false;
      if (provider && provider !== "all" && q.provider_id !== provider) return false;
      return !kgFor || inBand(q, kgFor(l.mode));
    }).map(q => ({quote: q, lane: laneOf[q.lane_id]}));
  }
  /* Lowest landed cost per product over the candidate quotes. */
  function bestLanded(args){
    const {product, units, country, settings} = args;
    const ship = shipmentOf(product, units);
    const cands = candidateQuotes(Object.assign({}, args, {country: country && String(country.country).toUpperCase(), kgFor: m => chargeable(ship.kg, ship.m3, m).chargeableKg}));
    let best = null;
    cands.forEach(({quote, lane}) => {
      const r = landedCost({product, units, quote, lane, country, settings});
      if (!r.error && (!best || r.perGarment.landed < best.perGarment.landed)) best = r;
    });
    return best || {error: cands.length ? "quotes cannot price this product" : "no valid quote for these filters", sku: product.sku};
  }

  const median = xs => { const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
  /* Benchmark of the quotes in force. Groups = lane x rate unit x weight band; one quote per provider and group
     (the newest). Per group low, median, high base rate in EUR. Per provider: groups quoted, share of groups
     (with 2 or more providers) above the median, average transit days. */
  function quoteStats({quotes, lanes, today, months, type, typeOf, settings}){
    const live = liveQuotes(quotes, {today, months, type, typeOf});
    const laneOf = Object.fromEntries((lanes || []).map(l => [l.lane_id, l]));
    const groups = {};
    live.forEach(q => {
      const band = n(q.weight_from_kg) === null && n(q.weight_to_kg) === null ? "" : `${n(q.weight_from_kg) ?? 0}-${n(q.weight_to_kg) ?? ""} kg`;
      const key = [q.lane_id, q.rate_unit, band].join("|");
      const g = groups[key] = groups[key] || {key, laneId: q.lane_id, lane: laneOf[q.lane_id] || null, rateUnit: q.rate_unit, band, byProvider: {}};
      const cur = g.byProvider[q.provider_id];
      if (!cur || String(q.quote_date) > String(cur.quote_date)) g.byProvider[q.provider_id] = q;
    });
    const lanesOut = Object.values(groups).map(g => {
      const qs = Object.values(g.byProvider).map(q => ({q, eur: toEUR(q.base_rate, q.currency, settings)})).filter(x => x.eur !== null);
      const vals = qs.map(x => x.eur);
      return {key: g.key, laneId: g.laneId, origin: g.lane ? g.lane.origin_id : "", country: g.lane ? String(g.lane.destination_id).toUpperCase() : "", mode: g.lane ? g.lane.mode : "",
        rateUnit: g.rateUnit, band: g.band, quotes: qs.length, low: vals.length ? Math.min(...vals) : null, median: median(vals), high: vals.length ? Math.max(...vals) : null,
        entries: qs.map(x => ({providerId: x.q.provider_id, quoteId: x.q.quote_id, eur: x.eur, transit: n(x.q.transit_days), date: x.q.quote_date}))};
    }).sort((a, b) => a.country.localeCompare(b.country) || String(a.mode).localeCompare(String(b.mode)) || a.laneId.localeCompare(b.laneId));
    const prov = {};
    lanesOut.forEach(L => L.entries.forEach(e => {
      const p = prov[e.providerId] = prov[e.providerId] || {providerId: e.providerId, groups: 0, compared: 0, above: 0, transit: []};
      p.groups++;
      if (L.quotes >= 2) { p.compared++; if (e.eur > L.median + 1e-9) p.above++; }
      if (e.transit !== null) p.transit.push(e.transit);
    }));
    const provOut = Object.values(prov).map(p => ({providerId: p.providerId, lanes: p.groups, compared: p.compared, aboveMedian: p.above,
      shareAbove: p.compared ? p.above / p.compared : null, avgTransit: p.transit.length ? p.transit.reduce((a, b) => a + b, 0) / p.transit.length : null}))
      .sort((a, b) => (a.shareAbove ?? 2) - (b.shareAbove ?? 2) || a.providerId.localeCompare(b.providerId));
    return {lanes: lanesOut, providers: provOut, quotes: live.length};
  }

  // ---- RFQ answers (Rate Card): one shipment = MAX(minimum, rate x kg) x (1 + fuel) + docs + other
  function rfqShipmentCost(row, kg){
    if (!row || (row.perKg == null && row.minCharge == null)) return null;
    return Math.max(row.minCharge || 0, (row.perKg || 0) * (Number(kg) || 0)) * (1 + (row.fuel || 0)) + (row.docs || 0) + (row.other || 0);
  }
  /* Providers against the Helmond baseline on a test order set.
     orders: [{units, country, weight_kg}]; helmond[i]: {cost, leadWd} or null; providers: [{p, rates, cur, fx} (v1 Rate Card) or
     {p, priceFor(lane, band, kg) -> {price, transit} | null, cur, fx} (v2.3: the all-in test price as given) or {p, none} or {p, legacy} or {p, cur, noFx}];
     laneFor(country), bandFor(kg). Rows: baseline first, then providers by cost per order. */
  function helmondComparison({orders, helmond, providers, laneFor, bandFor}){
    const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
    const agg = idx => { const units = sum(idx, i => orders[i].units), tot = sum(idx, i => helmond[i].cost);
      return {n: idx.length, total: tot, perOrder: idx.length ? tot / idx.length : null, perUnit: units ? tot / units : null, lead: idx.length ? sum(idx, i => helmond[i].leadWd) / idx.length : null}; };
    const helmIdx = orders.map((o, i) => i).filter(i => helmond[i]);
    const rows = [];
    providers.forEach(x => {
      if (x.none) { rows.push({p: x.p, kind: "none"}); return; }
      if (x.noFx) { rows.push({p: x.p, kind: "fx", cur: x.cur}); return; }
      if (x.legacy) { rows.push({p: x.p, kind: "legacy"}); return; }
      const priced = [];
      orders.forEach((o, i) => {
        const lane = laneFor(o.country), band = bandFor(o.weight_kg);
        if (x.priceFor) { const q = lane && band ? x.priceFor(lane, band, o.weight_kg) : null; if (q) priced.push({i, cost: q.price * x.fx, lead: q.transit}); return; }
        const r = x.rates.find(y => y.lane === lane && y.band === band);
        const c = r && r.served ? rfqShipmentCost(r, o.weight_kg) : null;
        if (c != null) priced.push({i, cost: c * x.fx, lead: r.transit});
      });
      const units = sum(priced, y => orders[y.i].units), total = sum(priced, y => y.cost), withLead = priced.filter(y => y.lead != null);
      const row = {p: x.p, kind: "rfq", cur: x.cur, n: priced.length, total, perOrder: priced.length ? total / priced.length : null, perUnit: units ? total / units : null,
        lead: withLead.length ? sum(withLead, y => y.lead) / withLead.length : null};
      const both = priced.filter(y => helmond[y.i]), hb = agg(both.map(y => y.i)), bu = sum(both, y => orders[y.i].units), bt = sum(both, y => y.cost), bl = both.filter(y => y.lead != null);
      row.dOrder = both.length && hb.perOrder != null ? bt / both.length - hb.perOrder : null;
      row.dUnit = bu && hb.perUnit != null ? bt / bu - hb.perUnit : null;
      row.dLead = bl.length && hb.lead != null ? sum(bl, y => y.lead) / bl.length - agg(bl.map(y => y.i)).lead : null;
      rows.push(row);
    });
    const order = {rfq: 1, fx: 2, legacy: 3, none: 4};
    rows.sort((a, b) => order[a.kind] - order[b.kind] || (a.kind === "rfq" ? (a.perOrder ?? Infinity) - (b.perOrder ?? Infinity) : a.p.name.localeCompare(b.p.name, "en")));
    return {baseline: agg(helmIdx), rows};
  }

  // ---- forecast: route scenarios on the forecast volume (goods cost from the gross margin per class)
  function scenarioImpact({scenarios, rows, lines, profile, feasibleDays, regionKey, scorecard}){
    const byOrder = {}; lines.forEach(l => { (byOrder[l.order_id] = byOrder[l.order_id] || []).push(l); });
    return scenarios.map(s => {
      const all = rows.filter(r => r.scenario === s), rs = all.filter(r => r.available);
      const units = rs.reduce((a, r) => a + r.units, 0) || 1, value = rs.reduce((a, r) => a + r.order_value_eur, 0);
      let cogs = 0; const freight = {}, fUnits = {};
      rs.forEach(r => {
        const ls = byOrder[r.order_id] || [], u = ls.reduce((a, l) => a + l.quantity, 0) || 1;
        const fr = r.route.steps.filter(x => x.category === "freight" || x.category === "inbound").reduce((a, x) => a + x.cost_eur, 0);
        ls.forEach(l => { cogs += l.quantity * l.unit_price_eur * (1 - (Number((profile[l.product_class] || {}).gross_margin_pct) || 0) / 100);
          freight[l.product_class] = (freight[l.product_class] || 0) + fr * l.quantity / u; fUnits[l.product_class] = (fUnits[l.product_class] || 0) + l.quantity; });
      });
      const feas = rs.filter(r => r.lead_time_days <= (feasibleDays[regionKey(r.region)] ?? 2)).length;
      const card = scorecard.find(x => x.scenario === s) || {};
      return {s, orders: all.length, covered: rs.length, units, value, cost: rs.reduce((a, r) => a + r.cost_to_serve_eur, 0), flex: rs.reduce((a, r) => a + r.flexitog_pays_eur, 0),
        cust: rs.reduce((a, r) => a + r.customer_pays_eur, 0), cogs, freight, fUnits, feas, hassle: card.hassle, lead: card.lead_time_days,
        margin: value - cogs - rs.reduce((a, r) => a + r.flexitog_pays_eur, 0)};
    });
  }

  // ================================================================== operations overview (Helmond DC)
  // Inputs are Master Data rows from the Odoo exports, or the sample fixture resolved against today. Periods are
  // month to date: this month up to the as-of day against the same days of last month. A source that ends before
  // today is measured at its last day (asOf), and the view says so.
  const OPS = (() => {
    const DAY = 86400000;
    const iso = d => d.toISOString().slice(0, 10);
    const addDays = (day, k) => iso(new Date(Date.parse(day + "T00:00:00Z") + k * DAY));
    const month = d => String(d).slice(0, 7);
    const prevMonth = m => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
    const monthsBack = (m, k) => { let x = m; for (let i = 0; i < k; i++) x = prevMonth(x); return x; };
    const daysIn = m => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
    const monthLabel = m => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", {month: "long", year: "numeric", timeZone: "UTC"});
    const isDone = r => !r.state || r.state === "done";

    /* The sample file with day offsets turned into dates from today. */
    function resolveSample(fx, today){
      const at = (o, t) => addDays(today, o) + (t ? "T" + t : "");
      return {
        moveLines: (fx.moveLines || []).map((r, i) => Object.assign({}, r, {date: at(r.dayOffset, r.time || "12:00"), state: "done", line_id: "S" + i})),
        quants: fx.quants || [],
        counts: (fx.counts || []).map(r => Object.assign({}, r, {count_date: at(r.dayOffset)})),
        pickings: (fx.pickings || []).map(r => Object.assign({}, r, {scheduled_date: at(r.dayOffset, r.start)}))
          .filter(r => ![0, 6].includes(new Date(r.scheduled_date.slice(0, 10) + "T12:00:00Z").getUTCDay())),   // no weekend slots
        certificates: (fx.certificates || []).map(r => Object.assign({}, r, {expires: at(r.expiresInDays)})),
        pickTime: fx.pickTime || null, relabeling: fx.relabeling || null,
      };
    }
    // The day a source is measured at: today, unless its last record falls in an earlier month (an export that
    // ends before this month), then that last day.
    const asOfOf = (dates, today) => { const last = dates.filter(Boolean).map(d => String(d).slice(0, 10)).sort().pop(); return !last || month(last) >= month(today) ? today : last; };
    /* Month to date against the same days of last month. items: [{date, value}] (value 1 for a count). */
    function mtd(items, asOf){
      const m = month(asOf), pm = prevMonth(m), day = Number(asOf.slice(8, 10)), pday = Math.min(day, daysIn(pm));
      let cur = 0, prev = 0;
      items.forEach(x => { const d = String(x.date).slice(0, 10), mm = month(d), dd = Number(d.slice(8, 10));
        if (mm === m && dd <= day) cur += x.value; else if (mm === pm && dd <= pday) prev += x.value; });
      return {value: cur, prev, delta: cur - prev, deltaPct: prev ? (cur - prev) / prev : null, month: m, label: monthLabel(m), asOf, window: `1 to ${day} ${monthLabel(m)} against 1 to ${pday} ${monthLabel(pm)}`};
    }
    /* Orders this month: distinct orders by order date (the Forecast's cleaned Odoo sales order lines). */
    function ordersKpi(lines, today){
      const first = {}; (lines || []).forEach(l => { const d = l.date || String(l.order_date || "").slice(0, 10); if (l.order && d && (!first[l.order] || d < first[l.order])) first[l.order] = d; });
      const asOf = asOfOf(Object.values(first), today);
      return mtd(Object.values(first).map(d => ({date: d, value: 1})), asOf);
    }
    /* Units shipped: done outgoing move lines. */
    const shipped = lines => (lines || []).filter(r => r.picking_code === "outgoing" && isDone(r));
    function unitsKpi(lines, today){
      const out = shipped(lines), asOf = asOfOf(out.map(r => r.date), today);
      return mtd(out.map(r => ({date: r.date, value: z(r.quantity)})), asOf);
    }
    /* Location accuracy: a location counted on a day is accurate when every product counted there matches the
       system quantity. Share of accurate location counts this month (to date) against all of last month. */
    function accuracyKpi(counts, today){
      const by = {};
      (counts || []).forEach(r => { const d = String(r.count_date).slice(0, 10), k = r.location + "|" + d; const o = by[k] = by[k] || {date: d, ok: true}; if (z(r.counted_quantity) !== z(r.system_quantity)) o.ok = false; });
      const all = Object.values(by), asOf = asOfOf(all.map(x => x.date), today), m = month(asOf), pm = prevMonth(m), day = asOf.slice(8, 10);
      const share = xs => (xs.length ? xs.filter(x => x.ok).length / xs.length : null);
      const cur = all.filter(x => month(x.date) === m && x.date.slice(8, 10) <= day), prev = all.filter(x => month(x.date) === pm);
      const v = share(cur), p = share(prev);
      return {value: v, prev: p, delta: v != null && p != null ? v - p : null, counted: cur.length, accurate: cur.filter(x => x.ok).length, prevCounted: prev.length,
        month: m, label: monthLabel(m), asOf, window: `counts 1 to ${Number(day)} ${monthLabel(m)} against all of ${monthLabel(pm)}`};
    }
    /* Orders by market, last 12 months to the as-of day: distinct orders per country, largest first. */
    function ordersByMarket(lines, today){
      const first = {}, country = {};
      (lines || []).forEach(l => { const d = l.date || String(l.order_date || "").slice(0, 10); if (!l.order || !d) return; if (!first[l.order] || d < first[l.order]) first[l.order] = d; country[l.order] = country[l.order] || l.country || "??"; });
      const asOf = asOfOf(Object.values(first), today), from = addDays(asOf, -365), n = {};
      Object.entries(first).forEach(([o, d]) => { if (d > from && d <= asOf) n[country[o]] = (n[country[o]] || 0) + 1; });
      const rows = Object.entries(n).map(([c, k]) => ({country: c, orders: k})).sort((a, b) => b.orders - a.orders || a.country.localeCompare(b.country));
      return {rows, total: rows.reduce((a, r) => a + r.orders, 0), from: addDays(from, 1), asOf};
    }
    /* Units shipped per month for the last 12 months, all brands or one (brand from Master Data products). */
    function unitsByMonth(lines, products, brand, today){
      const brandOf = Object.fromEntries((products || []).map(p => [p.sku, p.brand || "Other"]));
      const out = shipped(lines), asOf = asOfOf(out.map(r => r.date), today), last = month(asOf);
      const months = []; for (let i = 11; i >= 0; i--) months.push(monthsBack(last, i));
      const units = Object.fromEntries(months.map(m => [m, 0]));
      out.forEach(r => { const m = month(r.date); if (m in units && (!brand || brand === "all" || brandOf[r.sku] === brand)) units[m] += z(r.quantity); });
      const brands = [...new Set(out.map(r => brandOf[r.sku]).filter(Boolean))].sort();
      return {months: months.map(m => ({month: m, label: new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", {month: "short", timeZone: "UTC"}), units: units[m]})), brands, asOf};
    }
    /* Stock by temperature zone: units on hand (quants whose category matches a zone rule), daily use = done
       outgoing units of those SKUs over the last 90 days / 90, days of cover = on hand / daily use. */
    const ZONES = [["freezer", "Freezer", "-5 to -50°C"], ["chiller", "Chiller", "+10 to -5°C"], ["ppe", "PPE and safety", "Safety footwear, gloves and eye protection"]];
    function stockByZone(quants, zones, lines, today, warnDays){
      const rules = (zones || []).map(r => [String(r.category_match || "").toLowerCase(), r.zone]).filter(([m]) => m);
      const zoneOf = cat => { const c = String(cat || "").toLowerCase(); const hit = rules.find(([m]) => c.includes(m)); return hit ? hit[1] : null; };
      const skuZone = {}, onHand = {}, unmatched = new Set();
      (quants || []).forEach(q => { const zn = zoneOf(q.category); if (!zn) { unmatched.add(q.category); return; } skuZone[q.sku] = zn; onHand[zn] = (onHand[zn] || 0) + z(q.quantity); });
      const out = shipped(lines), asOf = asOfOf(out.map(r => r.date), today), from = addDays(asOf, -90), use = {};
      out.forEach(r => { const d = String(r.date).slice(0, 10), zn = skuZone[r.sku]; if (zn && d > from && d <= asOf) use[zn] = (use[zn] || 0) + z(r.quantity); });
      const warn = warnDays || 21;
      return {zones: ZONES.map(([key, label, range]) => { const daily = (use[key] || 0) / 90, oh = onHand[key] || 0, cover = daily > 0 ? oh / daily : null;
        return {key, label, range, onHand: oh, dailyUse: daily, daysCover: cover, warn: cover != null && cover < warn}; }), warnDays: warn, unmatched: [...unmatched], asOf};
    }
    /* Dock schedule of one day: slots per dock with start and end in minutes after midnight. */
    function dockDay(pickings, day){
      const slots = (pickings || []).filter(p => String(p.scheduled_date).slice(0, 10) === day && p.state !== "cancel").map(p => {
        const t = String(p.scheduled_date).slice(11, 16) || "00:00", start = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        const type = p.slot_type || (p.picking_type_code === "incoming" ? "inbound" : p.picking_type_code === "outgoing" ? "outbound" : "quality");
        return {name: p.name, dock: p.dock || "Unassigned", type, start, end: start + (z(p.slot_minutes) || 60), state: p.state, origin: p.origin || "", country: p.partner_country || ""};
      }).sort((a, b) => a.dock.localeCompare(b.dock, "en", {numeric: true}) || a.start - b.start);
      const docks = [...new Set(slots.map(s => s.dock))];
      return {day, slots, docks, from: slots.length ? Math.min(6 * 60, ...slots.map(s => s.start)) : 6 * 60, to: slots.length ? Math.max(18 * 60, ...slots.map(s => s.end)) : 18 * 60,
        counts: ["inbound", "outbound", "quality"].map(k => [k, slots.filter(s => s.type === k).length])};
    }
    const dockDays = pickings => [...new Set((pickings || []).map(p => String(p.scheduled_date).slice(0, 10)).filter(Boolean))].sort();
    /* Data sheets to update: certificates expiring within the horizon (days), the next one first. */
    function certificatesDue(certs, today, horizon){
      const h = addDays(today, horizon || 90), list = (certs || []).filter(c => c.expires).slice().sort((a, b) => String(a.expires).localeCompare(String(b.expires)));
      const due = list.filter(c => c.expires <= h);
      return {next: list.find(c => c.expires >= today) || null, due: due.length, overdue: list.filter(c => c.expires < today).length, horizon: horizon || 90,
        daysToNext: list.find(c => c.expires >= today) ? Math.round((Date.parse(list.find(c => c.expires >= today).expires) - Date.parse(today)) / DAY) : null, list};
    }
    /* Pick time gauge and relabeling progress from their figures. */
    const pickGauge = p => (p ? {value: z(p.minutesPerLine), prev: n(p.lastMonth), target: n(p.targetMinutes), max: z(p.scaleMaxMinutes) || 4,
      share: Math.min(1, z(p.minutesPerLine) / (z(p.scaleMaxMinutes) || 4)), onTarget: p.targetMinutes != null ? z(p.minutesPerLine) <= z(p.targetMinutes) : null} : null);
    const progress = r => (r && z(r.total) > 0 ? {done: z(r.done), total: z(r.total), share: Math.min(1, z(r.done) / z(r.total)), left: Math.max(0, z(r.total) - z(r.done)), what: r.what} : null);
    /* Search: SKUs, orders and locations that contain the text. */
    function search(q, {products, orders, pickings, quants}){
      const t = String(q || "").trim().toLowerCase(); if (t.length < 2) return [];
      const hit = s => String(s || "").toLowerCase().includes(t), out = [];
      (products || []).forEach(p => { if (hit(p.sku) || hit(p.description)) out.push({kind: "SKU", id: p.sku, label: p.description || p.sku}); });
      [...new Set(orders || [])].forEach(o => { if (hit(o)) out.push({kind: "Order", id: o, label: "Sales order"}); });
      (pickings || []).forEach(p => { if (hit(p.name) || hit(p.origin)) out.push({kind: "Transfer", id: p.name, label: [p.slot_type, String(p.scheduled_date).slice(0, 16).replace("T", " ")].filter(Boolean).join(" · ")}); });
      [...new Set((quants || []).map(x => x.location))].forEach(l => { if (hit(l)) out.push({kind: "Location", id: l, label: "Stock location"}); });
      return out.slice(0, 12);
    }
    /* Per card source: the Odoo export in Master Data when it has rows, else the sample (flagged sample).
       md: {odoo_move_lines, odoo_quants, odoo_location_counts, odoo_pickings, temperature_zones, products};
       orderLines: the Forecast's cleaned Odoo sales order lines (orderSample: they are the bundled sample). */
    function sources({md, orderLines, orderSample, fixture, today}){
      const S = resolveSample(fixture || {}, today), pick = (rows, sample) => (rows && rows.length ? {rows, sample: false} : {rows: sample, sample: true});
      return {
        orders: {rows: orderLines || [], sample: !!orderSample},
        moveLines: pick(md.odoo_move_lines, S.moveLines), quants: pick(md.odoo_quants, S.quants), counts: pick(md.odoo_location_counts, S.counts),
        pickings: pick(md.odoo_pickings, S.pickings), zones: {rows: md.temperature_zones || [], sample: false},
        certificates: {rows: S.certificates, sample: true}, pickTime: {value: S.pickTime, sample: true}, relabeling: {value: S.relabeling, sample: true},
      };
    }
    return {resolveSample, sources, mtd, ordersKpi, unitsKpi, accuracyKpi, ordersByMarket, unitsByMonth, stockByZone, ZONES, dockDay, dockDays, certificatesDue,
      pickGauge, progress, search, addDays, monthLabel};
  })();

  return {FACTORS, SURCHARGES, memo, invalidate, ops: OPS, version: () => VERSION, toEUR, fromEUR, shipmentOf, chargeable, freight, landedCost, isExpired, liveQuotes,
    candidateQuotes, bestLanded, quoteStats, median, rfqShipmentCost, helmondComparison, scenarioImpact};
});
