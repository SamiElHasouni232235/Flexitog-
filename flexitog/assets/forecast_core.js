/* FlexiTog sales forecast: pure logic, no DOM.
 *
 * Input: Odoo sales order lines (sheet "Sheet1", headers "Order Lines/..."), either embedded at build
 * time (tools/build_dashboard.py) or uploaded in the browser with SheetJS. The cleaning rules below are
 * the single implementation of the rules in the README (Forecast > Data rules).
 *
 * Output: a 2027 demand object, one row per month x country x product class with units, orders and
 * revenue, which the route engine reads as demand (FC.forecastBatch, FC.volumes).
 *
 * Runs in the dashboard (window.ForecastCore) and in node (tests/test_forecast.py).
 */
(function (root) {
  "use strict";

  // ================================================================== defaults (all editable in the UI)
  const DEFAULTS = {
    // EUR per unit of currency. Revenue converts to the reporting currency through EUR.
    fx: { EUR: 1, GBP: 1.1555, USD: 0.8607 },
    reporting: "USD",
    // "Last 12 months to" date. The last full month is the month before this date's month.
    asOf: "2026-10-02",
    forecastYear: 2027,
    targetLow: 2300000, targetHigh: 2500000,       // reporting currency, total net revenue (goods + freight billed)
    capPercentile: 95,                              // single orders above this percentile of order value are capped
    includeProjects: false,                         // false: the excess over the cap is reported apart, not forecast
    alpha: 0.3, beta: 0.1,                          // Holt smoothing
    upliftPct: 0,                                   // growth uplift on methods 1-3
    holdoutMonths: 3,                               // back-test
    indicativeWape: 0.40,
    bandMin: 0.10, bandMax: 0.50,                   // Low/High band = back-test WAPE clipped to this range
    // Customer names: strip " (EU)", then map aliases (exact, case-insensitive).
    customerAliases: {
      "Turk Hava Yollan Teknik AS": "Turkish Airlines Technic",
      "Anatolia Aero Teknik AS": "Anatolia Aero Technic",   // the same customer in the anonymized sample
    },
    freightCategory: "Service",
    freightWords: ["Delivery", "Freight", "Fedex", "UPS SAVER", "Collection UK"],
  };

  // Rule 7: product class from the product name, first match wins. Word-start matching keeps
  // "Coated glove" out of Jackets and "Investment" out of Vest.
  const CLASS_RULES = [
    ["Coveralls", /\b(coverall|overall)/i],
    ["Baselayers", /\b(baselayer|long john|undershirt)/i],
    ["Trousers", /\b(trouser|salopette)/i],
    ["Jackets", /\b(jacket|coats?\b|vest)/i],
  ];
  // Otherwise the product template category.
  const CATEGORY_CLASS = { "gloves": "Gloves", "footwear": "Footwear", "headwear": "Headwear", "accessories": "Accessories",
    "drying cabinets": "Drying cabinets" };
  const CLASSES = ["Jackets", "Trousers", "Coveralls", "Baselayers", "Other clothing", "Gloves", "Footwear", "Headwear", "Accessories", "Drying cabinets"];
  const METHODS = [["runrate", "Run rate"], ["holt", "Holt smoothing"], ["customer", "Customer-driven"], ["target", "Target allocation"]];
  const SCENARIOS = ["Low", "Base", "Target"];
  // Customer country names as Odoo writes them -> ISO 2.
  const COUNTRY_ISO = { "turkey": "TR", "türkiye": "TR", "turkiye": "TR", "saudi arabia": "SA", "united arab emirates": "AE", "uae": "AE",
    "kuwait": "KW", "qatar": "QA", "bahrain": "BH", "oman": "OM", "morocco": "MA", "algeria": "DZ", "tunisia": "TN", "egypt": "EG",
    "libya": "LY", "jordan": "JO", "lebanon": "LB", "iraq": "IQ", "israel": "IL", "netherlands": "NL", "united kingdom": "GB",
    "germany": "DE", "france": "FR", "belgium": "BE" };
  const FIELDS = ["Created on", "Company", "Customer/Company Name Entity", "Customer", "Customer/Country", "Customer/City", "Order Reference",
    "Product/Name", "Product Template/Category", "Quantity", "Unit of Measure", "Total Tax", "Total", "Currency"];

  // ================================================================== helpers
  const isBlank = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
  const num = v => { if (isBlank(v)) return 0; const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.,-]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
  const DAY = 86400000;
  const pad = n => String(n).padStart(2, "0");
  const monthKey = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
  const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
  const parseDay = s => Date.parse(String(s).slice(0, 10) + "T00:00:00Z");
  // Months from a to b inclusive, "YYYY-MM".
  function monthRange(a, b) {
    const out = []; let [y, m] = a.split("-").map(Number); const [yb, mb] = b.split("-").map(Number);
    while (y < yb || (y === yb && m <= mb)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }
  const addMonths = (k, n) => { let [y, m] = k.split("-").map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; };
  const monthsBetween = (a, b) => { const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number); return (yb - ya) * 12 + (mb - ma); };
  // Odoo date-times: ISO text from the build, Excel serial numbers from a SheetJS upload, or Date objects.
  function parseDateTime(v) {
    if (isBlank(v)) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime() - v.getTimezoneOffset() * 60000;
    if (typeof v === "number") return v > 20000 && v < 80000 ? Math.round((v - 25569) * DAY) : null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (/^\d{5}(\.\d+)?$/.test(s)) return parseDateTime(Number(s));
    return null;
  }
  function percentile(values, p) {
    const a = values.slice().sort((x, y) => x - y); if (!a.length) return 0;
    const r = (p / 100) * (a.length - 1), lo = Math.floor(r), hi = Math.ceil(r);
    return a[lo] + (a[hi] - a[lo]) * (r - lo);                      // linear interpolation, as Excel PERCENTILE.INC
  }
  const median = a => percentile(a, 50);

  // ================================================================== step 2: read and clean
  // Rows as objects keyed by header, with the "Order Lines/" prefix removed.
  function fromTable(headers, rows) {
    const h = headers.map(x => String(x == null ? "" : x).replace(/^Order Lines\//, "").trim());
    return rows.filter(r => r && r.some(c => !isBlank(c))).map(r => { const o = {}; h.forEach((k, i) => { if (k) o[k] = r[i]; }); return o; });
  }
  // Customer: Company Name Entity, else Customer; strip " (EU)"; aliases.
  function customerName(r, aliases) {
    let c = isBlank(r["Customer/Company Name Entity"]) ? r["Customer"] : r["Customer/Company Name Entity"];
    c = String(c == null ? "" : c).replace(/\s*\(EU\)\s*$/i, "").trim();
    const hit = Object.keys(aliases || {}).find(k => k.toLowerCase() === c.toLowerCase());
    return hit ? aliases[hit] : c;
  }
  function lineType(r, o) {
    const name = r["Product/Name"];
    if (isBlank(name)) return "blank";                                // rule 6: no product name = blank, ignored
    if (String(r["Product Template/Category"] || "").trim().toLowerCase() === o.freightCategory.toLowerCase()) return "freight";
    const n = String(name).toLowerCase();
    return o.freightWords.some(w => n.includes(w.toLowerCase())) ? "freight" : "goods";
  }
  function productClass(name, category) {
    for (const [cls, re] of CLASS_RULES) if (re.test(String(name || ""))) return cls;
    return CATEGORY_CLASS[String(category || "").trim().toLowerCase()] || "Other clothing";
  }
  const packSize = uom => { const m = String(uom || "").match(/pack of\s*(\d+)/i); return m ? Number(m[1]) : 1; };

  // Returns {lines, report}. Every kept line has net revenue in EUR and in the reporting currency.
  function clean(records, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const fx = Object.assign({ EUR: 1 }, o.fx);
    const countryOf = o.countryOf || (n => COUNTRY_ISO[String(n || "").trim().toLowerCase()] || String(n || "").trim().toUpperCase() || null);
    const rep = { rows: records.length, no_reference: 0, blank_lines: 0, goods_lines: 0, freight_lines: 0, unknown_currency: {}, no_date: 0 };
    const kept = [];
    records.forEach(r => {
      if (isBlank(r["Order Reference"])) { rep.no_reference++; return; }      // rule 1
      const type = lineType(r, o);
      if (type === "blank") { rep.blank_lines++; return; }
      const created = parseDateTime(r["Created on"]);
      if (created === null) { rep.no_date++; return; }
      const cur = String(r["Currency"] || "EUR").trim().toUpperCase();
      if (fx[cur] == null) rep.unknown_currency[cur] = (rep.unknown_currency[cur] || 0) + 1;
      const net = num(r["Total"]) - num(r["Total Tax"]);                       // rule 2: UK lines carry 20% VAT
      const netEur = net * (fx[cur] == null ? 1 : fx[cur]);
      const qty = num(r["Quantity"]), pack = packSize(r["Unit of Measure"]);
      kept.push({
        order: String(r["Order Reference"]).trim(), created, company: String(r["Company"] || ""),
        customer: customerName(r, o.customerAliases), country_name: String(r["Customer/Country"] || "").trim(),
        country: countryOf(r["Customer/Country"]), city: String(r["Customer/City"] || "").trim(),
        product: String(r["Product/Name"]).trim(), category: String(r["Product Template/Category"] || "").trim(),
        type, product_class: type === "goods" ? productClass(r["Product/Name"], r["Product Template/Category"]) : "Freight",
        quantity: qty, pack, units: qty * pack, currency: cur, total: num(r["Total"]), tax: num(r["Total Tax"]),
        net, net_eur: netEur, net_rep: netEur / (fx[o.reporting] || 1),
      });
      rep[type + "_lines"]++;
    });
    // Rule 4: order date = earliest Created on of all lines in the order.
    const first = {};
    kept.forEach(l => { if (first[l.order] === undefined || l.created < first[l.order]) first[l.order] = l.created; });
    kept.forEach(l => { l.order_date = first[l.order]; l.date = isoDay(l.order_date); l.month = monthKey(l.order_date); });
    const dates = kept.map(l => l.order_date).sort((a, b) => a - b);
    Object.assign(rep, { lines: kept.length, orders: new Set(kept.map(l => l.order)).size, customers: new Set(kept.map(l => l.customer)).size,
      countries: new Set(kept.map(l => l.country)).size, date_from: dates.length ? isoDay(dates[0]) : null, date_to: dates.length ? isoDay(dates[dates.length - 1]) : null });
    return { lines: kept, report: rep };
  }

  // ================================================================== step 3: validation figures
  // Net revenue counts goods and freight billed (all non-blank lines), in the reporting currency.
  function validation(lines, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const end = parseDay(o.asOf) + DAY, start = end - 365 * DAY;
    const byCountry = {};
    lines.forEach(l => { byCountry[l.country_name || l.country] = (byCountry[l.country_name || l.country] || 0) + l.net_rep; });
    return {
      net_revenue: sum(lines, l => l.net_rep), goods_revenue: sum(lines.filter(l => l.type === "goods"), l => l.net_rep),
      freight_revenue: sum(lines.filter(l => l.type === "freight"), l => l.net_rep),
      orders: new Set(lines.map(l => l.order)).size, order_lines: lines.length, customers: new Set(lines.map(l => l.customer)).size,
      countries: new Set(lines.map(l => l.country)).size, by_country: byCountry,
      last12: sum(lines.filter(l => l.order_date >= start && l.order_date < end), l => l.net_rep),
      last12_from: isoDay(start), last12_to: isoDay(end - DAY),
    };
  }

  // ================================================================== step 2.8: history aggregates
  // Orders with goods value (reporting currency), freight billed, lines and units per class.
  function buildOrders(lines) {
    const m = new Map();
    lines.forEach(l => {
      let o = m.get(l.order);
      if (!o) { o = { order: l.order, date: l.order_date, month: l.month, customer: l.customer, country: l.country, city: l.city, goods: 0, freight: 0, goods_lines: 0, units: 0, classes: {} }; m.set(l.order, o); }
      if (l.type === "goods") {
        o.goods += l.net_rep; o.goods_lines++; o.units += l.units;
        const c = o.classes[l.product_class] || (o.classes[l.product_class] = { revenue: 0, units: 0 });
        c.revenue += l.net_rep; c.units += l.units;
      } else o.freight += l.net_rep;
    });
    return [...m.values()].sort((a, b) => a.date - b.date);
  }
  // Project-order cap: single orders above the percentile of goods order value are capped; the excess
  // is a "project" amount. Each order gets capped (recurring) and project parts.
  function applyCap(orders, pct) {
    const vals = orders.filter(o => o.goods > 0).map(o => o.goods);
    const cap = vals.length ? percentile(vals, pct) : Infinity;
    orders.forEach(o => { o.capped = Math.min(o.goods, cap); o.project = Math.max(0, o.goods - cap); o.scale = o.goods > 0 ? o.capped / o.goods : 1; });
    return cap;
  }
  // Monthly aggregation by month, country and product class (goods), plus the freight series.
  function aggregate(lines) {
    const goods = {}, freight = {};
    lines.forEach(l => {
      const tgt = l.type === "goods" ? goods : freight;
      const k = l.month + "|" + l.country + "|" + l.product_class;
      const c = tgt[k] || (tgt[k] = { month: l.month, country: l.country, product_class: l.product_class, revenue: 0, units: 0, orders: new Set() });
      c.revenue += l.net_rep; c.units += l.units; c.orders.add(l.order);
    });
    const out = t => Object.values(t).map(c => ({ month: c.month, country: c.country, product_class: c.product_class, revenue: c.revenue, units: c.units, orders: c.orders.size }))
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.country < b.country ? -1 : a.country > b.country ? 1 : a.product_class < b.product_class ? -1 : 1));
    return { goods: out(goods), freight: out(freight) };
  }

  // Everything the methods need, from the lines before `cutoffMonth` (exclusive) and up to the last full month.
  // opts: asOf, capPercentile, includeProjects. cutoffMonth defaults to the asOf month.
  function history(lines, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const asOfMonth = monthKey(parseDay(o.asOf));
    const cutoff = o.cutoffMonth || asOfMonth;
    const ls = lines.filter(l => l.month < cutoff);
    const orders = buildOrders(ls);
    const cap = applyCap(orders, o.capPercentile);
    const goodsOrders = orders.filter(x => x.goods > 0);
    const first = ls.length ? ls.reduce((a, l) => (l.month < a ? l.month : a), ls[0].month) : addMonths(cutoff, -1);
    const months = monthRange(first, addMonths(cutoff, -1));
    const countries = [...new Set(goodsOrders.map(x => x.country))].sort();
    const val = x => (o.includeProjects ? x.goods : x.capped);
    // Monthly goods revenue per country (with or without project excess).
    const series = {}, projectSeries = {};
    countries.forEach(c => { series[c] = months.map(() => 0); projectSeries[c] = months.map(() => 0); });
    goodsOrders.forEach(x => { const i = months.indexOf(x.month); if (i >= 0) { series[x.country][i] += val(x); projectSeries[x.country][i] += x.project; } });
    // Class mix per country (share of goods revenue), unit prices per class and country, order profile.
    const mix = {}, price = {}, priceClass = {}, profile = {};
    const all = { revenue: 0, units: 0 };
    countries.forEach(c => {
      const os = goodsOrders.filter(x => x.country === c), tot = sum(os, x => x.goods) || 1;
      mix[c] = {}; price[c] = {};
      os.forEach(x => Object.entries(x.classes).forEach(([k, v]) => {
        mix[c][k] = (mix[c][k] || 0) + v.revenue / tot;
        const p = price[c][k] || (price[c][k] = { revenue: 0, units: 0 }); p.revenue += v.revenue; p.units += v.units;
        const pc = priceClass[k] || (priceClass[k] = { revenue: 0, units: 0 }); pc.revenue += v.revenue; pc.units += v.units;
        all.revenue += v.revenue; all.units += v.units;
      }));
      const fr = sum(orders.filter(x => x.country === c), x => x.freight);
      profile[c] = { orders: os.length, aov: sum(os, val) / os.length, lines_per_order: sum(os, x => x.goods_lines) / os.length,
        units_per_order: sum(os, x => x.units) / os.length, freight_ratio: tot > 1 ? fr / tot : 0,
        city: mode(os.map(x => x.city)), customers: new Set(os.map(x => x.customer)).size };
    });
    const unitPrice = (c, k) => {                                     // net price per unit: country+class, class, overall
      const p = (price[c] || {})[k];
      if (p && p.units > 0 && p.revenue > 0) return p.revenue / p.units;
      const q = priceClass[k];
      if (q && q.units > 0 && q.revenue > 0) return q.revenue / q.units;
      return all.units > 0 ? all.revenue / all.units : 1;
    };
    const overallMix = {};
    goodsOrders.forEach(x => Object.entries(x.classes).forEach(([k, v]) => { overallMix[k] = (overallMix[k] || 0) + v.revenue; }));
    const om = sum(Object.values(overallMix)) || 1; Object.keys(overallMix).forEach(k => { overallMix[k] /= om; });
    return { opts: o, cutoff, months, countries, orders, goodsOrders, cap, series, projectSeries, mix, overallMix, unitPrice, profile,
      freightRatio: sum(orders, x => x.freight) / (sum(goodsOrders, x => x.goods) || 1), lines: ls, val };
  }
  function mode(a) { const c = {}; a.forEach(x => { if (x) c[x] = (c[x] || 0) + 1; }); return Object.keys(c).sort((x, y) => c[y] - c[x])[0] || ""; }

  // ================================================================== step 4: methods
  // Each method returns {country: [revenue per target month]} for the months in `target` ("YYYY-MM"),
  // goods revenue in the reporting currency, before uplift.

  // 1. Run rate: trailing 12 full months per country, spread evenly.
  function runRate(H, target) {
    const out = {}, n = Math.min(12, H.months.length);
    H.countries.forEach(c => { const ttm = sum(H.series[c].slice(-n)) * 12 / n; out[c] = target.map(() => ttm / 12); });
    return out;
  }
  // 2. Holt linear exponential smoothing, no seasonality. Level starts at the mean of the first three
  // months, trend at 0 (the lumpy start would otherwise set a wild trend). Forecasts never go below 0.
  function holtFit(y, alpha, beta) {
    if (!y.length) return { level: 0, trend: 0 };
    let level = sum(y.slice(0, 3)) / Math.min(3, y.length), trend = 0;
    for (let t = 0; t < y.length; t++) {
      const prev = level;
      level = alpha * y[t] + (1 - alpha) * (level + trend);
      trend = beta * (level - prev) + (1 - beta) * trend;
    }
    return { level, trend };
  }
  function holt(H, target, alpha, beta) {
    const out = {}, last = H.months[H.months.length - 1];
    H.countries.forEach(c => {
      const f = holtFit(H.series[c], alpha, beta);
      out[c] = target.map(m => Math.max(0, f.level + monthsBetween(last, m) * f.trend));
    });
    return out;
  }
  // 3. Customer-driven: each customer repeats at its average days between orders with its average order
  // value. Days between orders = days from the customer's first order to the cut-off / number of orders,
  // at least 30: orders split over a few days (one project, several SOs) would otherwise read as a
  // weekly buyer. A one-order customer so repeats once per period since its first order. Lapsed: a
  // one-order customer whose order is over a year old, or a repeat customer silent for more than twice
  // its interval and over a year. New customers per quarter per country place a first order
  // in the middle month of the quarter at the median first-order value, then repeat at the median interval.
  const MIN_INTERVAL = 30;
  function customerDriven(H, target, newPerQuarter) {
    const end = parseDay(H.cutoff + "-01"), startHist = H.goodsOrders.length ? H.goodsOrders[0].date : end;
    const span = Math.max(MIN_INTERVAL, (end - startHist) / DAY);
    const out = {}; H.countries.forEach(c => { out[c] = target.map(() => 0); });
    const tStart = parseDay(target[0] + "-01"), tEnd = parseDay(addMonths(target[target.length - 1], 1) + "-01");
    const put = (c, ms, v) => { const i = target.indexOf(monthKey(ms)); if (i >= 0 && out[c]) out[c][i] += v; };
    const byCust = {};
    H.goodsOrders.forEach(x => { (byCust[x.customer + "|" + x.country] = byCust[x.customer + "|" + x.country] || []).push(x); });
    const customers = [], intervals = [], firsts = [];
    Object.values(byCust).forEach(os => {
      os.sort((a, b) => a.date - b.date);
      const n = os.length, interval = Math.max(MIN_INTERVAL, (end - os[0].date) / DAY / n);
      if (n > 1) intervals.push(interval);
      firsts.push(H.val(os[0]));
      const aov = sum(os, H.val) / n, last = os[n - 1].date, idle = (end - last) / DAY;
      const lapsed = n === 1 ? idle > 365 : idle > 2 * interval && idle > 365;
      const c = { customer: os[0].customer, country: os[0].country, orders: n, interval, aov, last: isoDay(last), lapsed, expected: 0, revenue: 0 };
      if (!lapsed) for (let t = last + interval * DAY; t < tEnd; t += interval * DAY) if (t >= tStart) { put(c.country, t, aov); c.expected++; c.revenue += aov; }
      customers.push(c);
    });
    const medInterval = intervals.length ? median(intervals) : span, medFirst = firsts.length ? median(firsts) : 0;
    const newRows = [];
    Object.entries(newPerQuarter || {}).forEach(([c, n]) => {
      n = Number(n) || 0; if (n <= 0) return;
      if (!out[c]) out[c] = target.map(() => 0);
      for (let q = 0; q < 4; q++) {
        const mid = parseDay(`${target[0].slice(0, 4)}-${pad(q * 3 + 2)}-15`);
        for (let t = mid; t < tEnd; t += medInterval * DAY) if (t >= tStart) put(c, t, n * medFirst);
      }
      newRows.push({ country: c, per_quarter: n });
    });
    return { out, customers, median_interval: medInterval, median_first_order: medFirst, new_customers: newRows };
  }
  // 4. Target allocation, top down: split the target (total net revenue) across countries by historical
  // share of the trailing 12 months, or by user weights, flat over the months. Freight billed is taken
  // out first so goods + freight = target.
  function targetAllocation(H, target, total, weights) {
    const n = Math.min(12, H.months.length), share = {};
    let w = weights && Object.values(weights).some(v => Number(v) > 0) ? weights : null;
    if (!w) { w = {}; H.countries.forEach(c => { w[c] = sum(H.series[c].slice(-n)); }); }
    const tw = sum(Object.values(w).map(Number)) || 1;
    Object.keys(w).forEach(c => { share[c] = Number(w[c]) / tw; });
    const out = {};
    Object.keys(share).forEach(c => { const fr = (H.profile[c] || {}).freight_ratio ?? H.freightRatio; out[c] = target.map(() => total * share[c] / (1 + fr) / target.length); });
    return { out, share };
  }

  // Back-test: fit on everything before the last `holdout` full months, forecast those months, and compare
  // with the actuals (same project treatment). WAPE = sum |actual - forecast| / sum actual over country-months.
  function backtest(lines, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const full = history(lines, o);
    const hold = full.months.slice(-o.holdoutMonths);
    if (hold.length < o.holdoutMonths || full.months.length < o.holdoutMonths + 6) return { months: hold, wape: {}, note: "Not enough history for a back-test" };
    const fit = history(lines, Object.assign({}, o, { cutoffMonth: hold[0] }));
    // Actuals for the hold-out months, capped at the fit-period cap when projects are excluded.
    const act = {};
    full.goodsOrders.filter(x => hold.includes(x.month)).forEach(x => {
      const v = o.includeProjects ? x.goods : Math.min(x.goods, fit.cap);
      const a = act[x.country] || (act[x.country] = hold.map(() => 0)); a[hold.indexOf(x.month)] += v;
    });
    const fc = { runrate: runRate(fit, hold), holt: holt(fit, hold, o.alpha, o.beta), customer: customerDriven(fit, hold, {}).out };
    // wape: per country and month (the level the forecast feeds the engine; drives the indicative label).
    // wape_total: on total revenue per month, all countries together.
    const wape = {}, wapeTotal = {}, detail = {};
    Object.entries(fc).forEach(([k, f]) => {
      let err = 0, tot = 0;
      const cs = new Set(Object.keys(act).concat(Object.keys(f)));
      const ma = hold.map(() => 0), mf = hold.map(() => 0);
      cs.forEach(c => hold.forEach((m, i) => { const a = (act[c] || [])[i] || 0, p = (f[c] || [])[i] || 0; err += Math.abs(a - p); tot += a; ma[i] += a; mf[i] += p; }));
      wape[k] = tot > 0 ? err / tot : null;
      wapeTotal[k] = tot > 0 ? sum(hold.map((_, i) => Math.abs(ma[i] - mf[i]))) / tot : null;
      detail[k] = { actual: tot, forecast: sum(mf), actual_by_month: ma, forecast_by_month: mf };
    });
    wape.target = null; wapeTotal.target = null;                       // top down: no statistical fit to test
    return { months: hold, fit_to: addMonths(hold[0], -1), wape, wape_total: wapeTotal, detail };
  }

  // ================================================================== forecast with scenarios
  // opts: method, alpha, beta, upliftPct, newPerQuarter {country: n}, targetLow, targetHigh, weights {country: w}, includeProjects.
  // Returns per scenario (Low, Base, High, Target) goods revenue per country per 2027 month, plus freight.
  function forecast(lines, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const H = history(lines, o);
    const year = String(o.forecastYear);
    const months = monthRange(`${year}-01`, `${year}-12`);
    const bt = o.backtest || backtest(lines, o);
    const up = 1 + (Number(o.upliftPct) || 0) / 100;
    const tMid = (Number(o.targetLow) + Number(o.targetHigh)) / 2;
    let base, extra = {};
    if (o.method === "runrate") base = runRate(H, months);
    else if (o.method === "holt") base = holt(H, months, o.alpha, o.beta);
    else if (o.method === "customer") { const r = customerDriven(H, months, o.newPerQuarter); base = r.out; extra = r; }
    else { const r = targetAllocation(H, months, tMid, o.weights); base = r.out; extra = r; }
    if (o.method !== "target") Object.keys(base).forEach(c => { base[c] = base[c].map(v => v * up); });
    const totalNet = rev => sum(Object.entries(rev).map(([c, a]) => sum(a) * (1 + ((H.profile[c] || {}).freight_ratio ?? H.freightRatio))));
    // Low/High band: the method's back-test WAPE, clipped. For target allocation: the target range.
    const w = bt.wape[o.method];
    const band = o.method === "target" ? (Number(o.targetHigh) - Number(o.targetLow)) / 2 / (tMid || 1)
      : Math.min(o.bandMax, Math.max(o.bandMin, w == null ? o.bandMax : w));
    const scale = (rev, f) => { const r = {}; Object.keys(rev).forEach(c => { r[c] = rev[c].map(v => v * f); }); return r; };
    // Target scenario: the Base mix (countries and months) scaled so total net revenue = target midpoint.
    const baseNet = totalNet(base);
    const target = baseNet > 0 ? scale(base, tMid / baseNet) : targetAllocation(H, months, tMid, o.weights).out;
    const scen = { Low: scale(base, 1 - band), Base: base, High: scale(base, 1 + band), Target: target };
    const freight = {};
    Object.entries(scen).forEach(([k, rev]) => { freight[k] = {}; Object.keys(rev).forEach(c => { freight[k][c] = rev[c].map(v => v * ((H.profile[c] || {}).freight_ratio ?? H.freightRatio)); }); });
    const ttmProjects = sum(H.countries.map(c => sum(H.projectSeries[c].slice(-12))));
    return { H, months, scenarios: scen, freight, band, backtest: bt, method: o.method, opts: o, extra,
      totals: Object.fromEntries(Object.entries(scen).map(([k, rev]) => [k, { goods: sum(Object.values(rev).map(a => sum(a))), net: totalNet(rev) }])),
      target: { low: Number(o.targetLow), high: Number(o.targetHigh), mid: tMid },
      projects: { cap: H.cap, ttm: ttmProjects, count: H.goodsOrders.filter(x => x.project > 0).length, included: !!o.includeProjects },
      indicative: w == null ? o.method !== "target" : w > o.indicativeWape };
  }

  // Demand object: one row per month x country x product class. Revenue (reporting currency and EUR)
  // splits by the country's class mix; units from the net unit price per class and country; orders from
  // the country's average order value (spread over classes by revenue share); lines from lines per order.
  function demand(F, scenario, fxEur) {
    const H = F.H, rev = F.scenarios[scenario || "Base"], rows = [];
    const toEur = fxEur || 1;
    Object.keys(rev).forEach(c => {
      const mix = Object.keys(H.mix[c] || {}).length ? H.mix[c] : H.overallMix;
      const p = H.profile[c] || { aov: sum(Object.values(H.profile).map(x => x.aov)) / (Object.keys(H.profile).length || 1), lines_per_order: 1 };
      F.months.forEach((m, i) => {
        const r = rev[c][i]; if (!(r > 0)) return;
        Object.entries(mix).forEach(([k, s]) => {
          if (!(s > 0)) return;
          const revenue = r * s, orders = p.aov > 0 ? (r / p.aov) * s : 0;
          rows.push({ month: m, country: c, product_class: k, revenue, revenue_eur: revenue * toEur, units: revenue / H.unitPrice(c, k),
            orders, lines: orders * (p.lines_per_order || 1), shipments: orders });
        });
      });
    });
    return rows;
  }
  // Sum demand rows by keys.
  function rollup(rows, keys) {
    const m = new Map();
    rows.forEach(r => {
      const k = keys.map(x => r[x]).join("|");
      const t = m.get(k) || (m.set(k, Object.assign(Object.fromEntries(keys.map(x => [x, r[x]])), { revenue: 0, revenue_eur: 0, units: 0, orders: 0, lines: 0, shipments: 0 })), m.get(k));
      ["revenue", "revenue_eur", "units", "orders", "lines", "shipments"].forEach(f => { t[f] += r[f] || 0; });
    });
    return [...m.values()];
  }

  // ================================================================== step 6: demand into the route engine
  // classProfile: {class: {sku, units_per_pallet}}. Returns {orders, lines, customers} in the engine's batch
  // shape. Orders per country-month are rounded so each country's yearly total holds (running remainder).
  // A month that rounds to no order passes its revenue and units on to the next order, so the batch
  // carries the whole forecast value; the last month places at least one order when anything is pending.
  function forecastBatch(rows, classProfile, opts) {
    const o = opts || {}, prefix = o.prefix || "FC";
    const byCM = {};
    rows.forEach(r => { (byCM[r.country] = byCM[r.country] || {})[r.month] = (byCM[r.country][r.month] || []).concat([r]); });
    const orders = [], lines = [], customers = [];
    Object.keys(byCM).sort().forEach(c => {
      const cid = `${prefix}-${c}`;
      customers.push({ customer_id: cid, name: `Forecast demand ${c}`, country: c, city: (o.cities || {})[c] || null, data_source: "forecast" });
      let carry = 0, pending = {}, lastId = null, lastOrder = null, lastPal = 0;
      const months = Object.keys(byCM[c]).sort();
      months.forEach((m, mi) => {
        const want = sum(byCM[c][m], r => r.orders) + carry;
        byCM[c][m].forEach(r => { const p = pending[r.product_class] || (pending[r.product_class] = { product_class: r.product_class, units: 0, revenue_eur: 0 }); p.units += r.units; p.revenue_eur += r.revenue_eur; });
        let n = Math.round(want); carry = want - n;
        const lastMonth = mi === months.length - 1;
        if (n <= 0 && lastMonth && !lastOrder) n = 1;
        if (n <= 0 && lastMonth) {                                       // year-end leftovers join the last order
          Object.values(pending).forEach(r => {
            const prof = classProfile[r.product_class] || classProfile["Other clothing"] || {};
            if (!prof.sku || !(r.units > 0)) return;
            const q = Math.max(1, Math.round(r.units));
            lines.push({ order_id: lastId, sku: prof.sku, quantity: q, unit_price_eur: r.revenue_eur / q, product_class: r.product_class });
            lastPal += q / (Number(prof.units_per_pallet) || 100);
            lastOrder.pallet_count = Math.max(lastOrder.pallet_count, Math.ceil(lastPal - 1e-9));
          });
          pending = {};
        }
        if (n <= 0) return;
        const rs = Object.values(pending); pending = {};
        for (let i = 0; i < n; i++) {
          const id = `${prefix}-${m}-${c}-${pad(i + 1)}`;
          let pallets = 0;
          rs.forEach(r => {
            const prof = classProfile[r.product_class] || classProfile["Other clothing"] || {};
            if (!prof.sku) return;
            const q = Math.max(1, Math.round(r.units / n));
            pallets += q / (Number(prof.units_per_pallet) || 100);
            lines.push({ order_id: id, sku: prof.sku, quantity: q, unit_price_eur: (r.revenue_eur / n) / q, product_class: r.product_class });
          });
          lastOrder = { order_id: id, customer_id: cid, pallet_count: Math.max(1, Math.ceil(pallets - 1e-9)), pallet_type: "EUR",
            order_date: m + "-15", batch: "forecast", data_source: "forecast" };
          orders.push(lastOrder); lastId = id; lastPal = pallets;
        }
      });
    });
    return { orders, lines, customers };
  }
  // Yearly volumes for Data.volume: shipments per country (one per order), refill load per node
  // (pallets per year of the countries it serves / refills per year), owned warehouse pallets per year.
  function volumes(batch, dcs, refillsPerYear) {
    const ship = {}, pal = {}, country = {};
    batch.customers.forEach(c => { country[c.customer_id] = c.country; });
    batch.orders.forEach(x => { const c = country[x.customer_id]; ship[c] = (ship[c] || 0) + 1; pal[c] = (pal[c] || 0) + x.pallet_count; });
    const load = {}, owned = {};
    (dcs || []).forEach(d => {
      if (!["distributor", "3pl", "owned_warehouse"].includes(d.dc_type)) return;
      const serves = new Set(String(d.serves_countries || "").split(";").map(s => s.trim()).filter(Boolean).concat([d.country]));
      const p = sum([...serves].map(c => pal[c] || 0));
      if (p > 0) load[d.dc_id] = p / (refillsPerYear || 12);
      if (d.dc_type === "owned_warehouse" && p > 0) owned[d.country] = (owned[d.country] || 0) + p;
    });
    return { shipments_per_year: ship, node_load_pallets: load, owned_pallets_per_year: owned, pallets_per_country: pal };
  }

  const api = { DEFAULTS, CLASS_RULES, CATEGORY_CLASS, CLASSES, METHODS, SCENARIOS, COUNTRY_ISO, FIELDS,
    parseDateTime, percentile, monthRange, addMonths, fromTable, customerName, lineType, productClass, packSize, clean, validation,
    buildOrders, applyCap, aggregate, history, holtFit, runRate, holt, customerDriven, targetAllocation, backtest, forecast, demand, rollup,
    forecastBatch, volumes };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ForecastCore = api;
})(typeof window !== "undefined" ? window : globalThis);
