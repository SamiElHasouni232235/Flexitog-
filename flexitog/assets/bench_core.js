/* FlexiTog benchmarking: pure logic for the Benchmarking view (no DOM).
 * Sales data cleaning, analysis (seasonality, profiles, findings), the test order generator,
 * packing estimates, and the provider response template (build and parse).
 * Runs in the browser dashboard and in node (tests/test_benchmark.py).
 */
(function (root) {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const CATEGORIES = ["jackets", "trousers", "coveralls", "other"];
  const CATEGORY_LABELS = { jackets: "Jackets", trousers: "Trousers", coveralls: "Coveralls", other: "Other items (gloves, headwear, footwear, socks)" };
  const REGION_CODES = { "Türkiye": "TR", "North Africa": "NAF", "Gulf/GCC": "GCC" };
  // Main port or gateway per target country, used when a customer has no city or port on file.
  const DEFAULT_PORTS = { TR: "Istanbul (Ambarlı)", MA: "Casablanca", DZ: "Algiers", TN: "Radès", EG: "Alexandria", LY: "Tripoli",
    SA: "Dammam", AE: "Jebel Ali", QA: "Hamad", KW: "Shuwaikh", BH: "Khalifa Bin Salman", OM: "Sohar" };
  // Packing assumptions per garment category when the product master has nothing better.
  const PACKING = {
    jackets: { units_per_carton: 10, kg_per_unit: 2.0 },
    trousers: { units_per_carton: 15, kg_per_unit: 1.6 },
    coveralls: { units_per_carton: 8, kg_per_unit: 3.0 },
    other: { units_per_carton: 30, kg_per_unit: 0.4 },
    carton_m3: 0.096,            // 60 x 40 x 40 cm export carton
    carton_tare_kg: 1.0,
    cartons_per_pallet: 16,      // EUR pallet, 4 per layer x 4 layers, 1.8 m high
  };

  // Columns a sales export is mapped to. Aliases cover English and Dutch ERP headers.
  const SALES_FIELDS = [
    { key: "order_date", label: "Order date", type: "date", required: true, aliases: ["date", "orderdate", "invoicedate", "orderdatum", "datum", "documentdate", "shipdate"] },
    { key: "order_number", label: "Order number", type: "text", required: true, aliases: ["order", "orderno", "ordernr", "orderid", "salesorder", "so", "ordernummer", "invoice", "invoiceno", "documentno"] },
    { key: "customer", label: "Customer", type: "text", required: true, aliases: ["customername", "customerid", "client", "klant", "klantnaam", "debiteur", "account", "soldto", "shipto"] },
    { key: "destination_country", label: "Destination country", type: "country", required: true, aliases: ["country", "land", "shiptocountry", "destination", "countrycode", "bestemming"] },
    { key: "sku", label: "SKU", type: "text", required: false, aliases: ["item", "itemno", "article", "artikel", "artikelnummer", "productcode", "material", "partnumber"] },
    { key: "description", label: "Product description", type: "text", required: false, aliases: ["productdescription", "itemdescription", "omschrijving", "productname", "name", "product"] },
    { key: "category", label: "Garment category", type: "text", required: false, aliases: ["garmentcategory", "productfamily", "family", "productgroup", "group", "artikelgroep", "categorie"] },
    { key: "brand", label: "Brand", type: "text", required: false, aliases: ["merk", "label", "brandname"] },
    { key: "quantity", label: "Quantity", type: "number", required: true, aliases: ["qty", "units", "aantal", "pieces", "pcs", "quantityshipped", "qtyshipped"] },
    { key: "order_value", label: "Order value", type: "number", required: true, aliases: ["value", "amount", "netvalue", "netamount", "revenue", "sales", "bedrag", "waarde", "omzet", "linevalue", "netvalueeur"] },
    { key: "currency", label: "Currency", type: "text", required: false, aliases: ["cur", "curr", "valuta", "currencycode"] },
    { key: "weight_kg", label: "Weight (kg)", type: "number", required: false, aliases: ["weight", "grossweight", "gewicht", "kg"] },
    { key: "cartons", label: "Cartons", type: "number", required: false, aliases: ["boxes", "dozen", "colli", "cartonqty"] },
    { key: "pallets", label: "Pallets", type: "number", required: false, aliases: ["pallet", "palletqty", "pallets"] },
    { key: "incoterm", label: "Incoterm", type: "text", required: false, aliases: ["incoterms", "deliveryterms", "leveringsvoorwaarde"] },
  ];

  // ------------------------------------------------------------------ small helpers
  const isBlank = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9À-ɏ]/g, "");
  const round = (v, dp = 0) => { const f = Math.pow(10, dp); return Math.round(v * f) / f; };
  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

  // Seeded random numbers (mulberry32): the same seed always gives the same test orders.
  function rng(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // Split a whole number across weights so the parts add up exactly (largest remainder).
  function apportion(total, weights) {
    const w = weights.map(x => (x > 0 ? x : 0)), s = sum(w);
    if (!s || total <= 0) return w.map(() => 0);
    const raw = w.map(x => total * x / s), base = raw.map(Math.floor);
    let left = total - sum(base);
    raw.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
    return base;
  }

  // ------------------------------------------------------------------ parsing
  function cleanNumberText(v) { return String(v).trim().replace(/[\s  ]/g, "").replace(/€|EUR|USD|US\$|\$|%/gi, ""); }
  function detectDecimal(values) {
    let comma = 0, dot = 0;
    values.forEach(v => {
      if (isBlank(v) || typeof v === "number") return;
      const s = cleanNumberText(v);
      if (s.includes(",") && s.includes(".")) { if (s.lastIndexOf(",") > s.lastIndexOf(".")) comma++; else dot++; }
      else if (s.includes(",")) { if (s.split(",").pop().length !== 3) comma++; }
      else if (s.includes(".")) { if (s.split(".").pop().length !== 3) dot++; }
    });
    return comma > dot ? "," : ".";
  }
  function parseNumber(v, dec) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (isBlank(v)) return null;
    let s = cleanNumberText(v);
    if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
    const th = dec === "," ? "." : ",";
    s = s.split(th).join("");
    if (dec === ",") s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const pad2 = n => String(n).padStart(2, "0");
  function validYmd(y, m, d) {
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  // ISO first, then day-first (European exports). A first part above 12 with a second part of
  // 12 or less is day-first; a second part above 12 means month-first.
  function parseDate(v) {
    if (isBlank(v)) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : validYmd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
    if (typeof v === "number") {
      if (v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
      return null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return validYmd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s|$|T)/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (m[3].length === 2) y += 2000;
      if (b > 12 && a <= 12) { const t = a; a = b; b = t; }
      return validYmd(y, b, a);
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(Number(s));
    const t = Date.parse(s);
    if (Number.isFinite(t)) { const d = new Date(t); return validYmd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
    return null;
  }

  // Garment category from category, family or description text.
  function categoryOf(...texts) {
    const t = texts.filter(x => !isBlank(x)).map(x => String(x).toLowerCase()).join(" ");
    if (!t) return "other";
    if (/coverall|overall|boiler ?suit|freezer ?suit|one[- ]?piece/.test(t)) return "coveralls";
    if (/trouser|pant|bib|salopette|broek|dungaree/.test(t)) return "trousers";
    if (/jacket|parka|coat|jas|anorak|vest|bodywarmer|gilet/.test(t)) return "jackets";
    return "other";
  }
  const regionCode = r => REGION_CODES[r] || "OTH";

  // ------------------------------------------------------------------ column mapping
  function similarity(a, b) {
    if (a === b) return 1;
    const m = a.length, n = b.length; if (!m || !n) return 0;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - d[m][n] / Math.max(m, n);
  }
  // headers -> {field key: column index}. Exact names and aliases first, then close matches.
  function guessMapping(headers, fields) {
    fields = fields || SALES_FIELDS;
    const cand = {};
    fields.forEach(f => { [f.key, f.label].concat(f.aliases || []).forEach(a => { const k = norm(a); if (!(k in cand)) cand[k] = f.key; }); });
    const map = {}, used = new Set();
    headers.forEach((h, i) => { const f = cand[norm(h)]; if (f && !(f in map)) { map[f] = i; used.add(i); } });
    headers.forEach((h, i) => {
      if (used.has(i)) return;
      const k = norm(h); let best = null, bs = 0.82;
      Object.entries(cand).forEach(([c, f]) => { if (f in map) return; const s = similarity(k, c); if (s >= bs) { bs = s; best = f; } });
      if (best) { map[best] = i; used.add(i); }
    });
    return map;
  }
  // The header is the row (first 15) whose cells match the most fields.
  function headerRow(sheet, fields) {
    let best = 0, bs = 0;
    (sheet || []).slice(0, 15).forEach((r, i) => {
      const cells = (r || []).map(c => (isBlank(c) ? "" : String(c)));
      const sc = Object.keys(guessMapping(cells, fields)).length;
      if (sc > bs) { bs = sc; best = i; }
    });
    return best;
  }
  // Apply a mapping to sheet rows: [{field: raw value}].
  function applyMapping(body, map) {
    return body.filter(r => r && r.some(c => !isBlank(c))).map(r => {
      const o = {}; Object.entries(map).forEach(([f, i]) => { if (i != null && i >= 0) o[f] = r[i]; }); return o;
    });
  }

  // ------------------------------------------------------------------ cleaning
  // raw: [{field: value}] after mapping. opts: {countryOf(text) -> ISO2|null, regionOf(iso) -> region,
  // fx: {CUR: EUR per unit}, defaultCurrency, source, skuInfo: {sku: {description, category, brand}}}
  function cleanSales(raw, opts) {
    opts = opts || {};
    const fx = Object.assign({ EUR: 1 }, opts.fx || {});
    const countryOf = opts.countryOf || (c => (isBlank(c) ? null : String(c).trim().toUpperCase()));
    const regionOf = opts.regionOf || (() => "Other");
    const skuInfo = opts.skuInfo || {};
    const decQ = detectDecimal(raw.map(r => r.quantity)), decV = detectDecimal(raw.map(r => r.order_value));
    const decW = detectDecimal(raw.map(r => r.weight_kg));
    const fields = SALES_FIELDS.map(f => f.key);
    const missing = Object.fromEntries(fields.map(f => [f, 0]));
    const dropped = {}, drop = reason => { dropped[reason] = (dropped[reason] || 0) + 1; };
    const lines = [], seen = new Set();
    let duplicates = 0, unknownCurrency = 0, outside = 0;
    raw.forEach(r => {
      fields.forEach(f => { if (isBlank(r[f])) missing[f]++; });
      const date = parseDate(r.order_date);
      if (!date) { drop(isBlank(r.order_date) ? "no order date" : "date not readable"); return; }
      const order = isBlank(r.order_number) ? null : String(r.order_number).trim();
      if (!order) { drop("no order number"); return; }
      const qty = parseNumber(r.quantity, decQ);
      if (qty === null || qty <= 0) { drop(qty === null ? "no quantity" : "quantity zero or negative"); return; }
      const country = countryOf(r.destination_country);
      if (!country) { drop("no destination country"); return; }
      const cur = isBlank(r.currency) ? String(opts.defaultCurrency || "EUR").toUpperCase() : String(r.currency).trim().toUpperCase();
      const val = parseNumber(r.order_value, decV);
      let rate = fx[cur];
      if (rate == null) { rate = 1; unknownCurrency++; }
      const sku = isBlank(r.sku) ? "" : String(r.sku).trim();
      const info = skuInfo[sku] || {};
      const desc = isBlank(r.description) ? (info.description || "") : String(r.description).trim();
      const catText = isBlank(r.category) ? (info.category || "") : String(r.category);
      const key = [opts.source || "", order, sku, qty, date, val, norm(r.customer)].join("|");
      if (seen.has(key)) { duplicates++; return; }
      seen.add(key);
      const region = regionOf(country) || "Other";
      if (!REGION_CODES[region]) outside++;
      lines.push({
        source: opts.source || "", order_number: order, order_key: (opts.source || "") + "#" + order, date, year: +date.slice(0, 4), month: +date.slice(5, 7),
        customer: isBlank(r.customer) ? "unknown" : String(r.customer).trim(), country, region,
        sku, description: desc, category: categoryOf(catText, desc), brand: isBlank(r.brand) ? (info.brand || "") : String(r.brand).trim(),
        quantity: qty, value: val, currency: cur, value_eur: val === null ? 0 : val * rate,
        weight_kg: parseNumber(r.weight_kg, decW), cartons: parseNumber(r.cartons, "."), pallets: parseNumber(r.pallets, "."),
        incoterm: isBlank(r.incoterm) ? "" : String(r.incoterm).trim(), city: r.city || "", port: r.port || "",
      });
    });
    const dates = lines.map(l => l.date).sort();
    return {
      lines,
      report: {
        rows_loaded: raw.length, rows_kept: lines.length, rows_dropped: raw.length - lines.length - duplicates, dropped, duplicates,
        missing, unknown_currency: unknownCurrency, outside_target: outside,
        date_from: dates[0] || null, date_to: dates[dates.length - 1] || null,
        orders: new Set(lines.map(l => l.order_key)).size,
      },
    };
  }

  // ------------------------------------------------------------------ analysis
  // Orders from lines: one entry per order, with its lines merged per SKU.
  function buildOrders(lines) {
    const map = new Map();
    lines.forEach(l => {
      let o = map.get(l.order_key);
      if (!o) { o = { key: l.order_key, order_number: l.order_number, date: l.date, year: l.year, month: l.month, customer: l.customer, country: l.country,
                     region: l.region, city: l.city, port: l.port, lines: [], units: 0, value_eur: 0 }; map.set(l.order_key, o); }
      if (l.date < o.date) { o.date = l.date; o.year = l.year; o.month = l.month; }
      o.lines.push(l); o.units += l.quantity; o.value_eur += l.value_eur;
    });
    return [...map.values()];
  }
  // Calendar months the data covers (year-month pairs) and, per month of the year, how many years cover it.
  function coverage(lines) {
    const ym = new Set(lines.map(l => l.year * 100 + l.month));
    const perMonth = Array(12).fill(0);
    ym.forEach(k => { perMonth[(k % 100) - 1]++; });
    return { yearMonths: ym.size, perMonth, years: [...new Set(lines.map(l => l.year))].sort() };
  }
  // Orders, units and value per calendar month for each year.
  function monthly(lines) {
    const years = [...new Set(lines.map(l => l.year))].sort();
    const by = {};
    years.forEach(y => { by[y] = MONTHS.map(() => ({ orders: new Set(), units: 0, value: 0 })); });
    lines.forEach(l => { const c = by[l.year][l.month - 1]; c.orders.add(l.order_key); c.units += l.quantity; c.value += l.value_eur; });
    const out = {};
    years.forEach(y => { out[y] = by[y].map(c => ({ orders: c.orders.size, units: c.units, value: c.value })); });
    const totals = {};
    years.forEach(y => { totals[y] = { orders: sum(out[y], c => c.orders), units: sum(out[y], c => c.units), value: sum(out[y], c => c.value), months: out[y].filter(c => c.orders).length }; });
    return { years, months: out, totals };
  }
  // Seasonality index per month (mean of the months with data = 100). Average volume per calendar
  // month over the years that cover it, so a part year does not distort the shape.
  function seasonality(lines, metric, groupBy) {
    metric = metric || "units"; groupBy = groupBy || "region";
    const cov = coverage(lines);
    const val = l => (metric === "value" ? l.value_eur : metric === "units" ? l.quantity : 0);
    const index = subset => {
      const tot = Array(12).fill(0);
      if (metric === "orders") { const seen = MONTHS.map(() => new Set()); subset.forEach(l => seen[l.month - 1].add(l.order_key)); seen.forEach((s, i) => { tot[i] = s.size; }); }
      else subset.forEach(l => { tot[l.month - 1] += val(l); });
      const avg = tot.map((t, i) => (cov.perMonth[i] ? t / cov.perMonth[i] : null));
      const known = avg.filter(x => x !== null), mean = known.length ? sum(known) / known.length : 0;
      return { avg, index: avg.map(a => (a === null || !mean ? null : 100 * a / mean)) };
    };
    const groups = {};
    [...new Set(lines.map(l => l[groupBy]))].forEach(g => { groups[g] = index(lines.filter(l => l[groupBy] === g)); });
    return { metric, coverage: cov, overall: index(lines), groups };
  }
  // Best run of three consecutive months (wrapping round the year) by share of yearly volume.
  function peakWindow(avg) {
    const a = avg.map(x => x || 0), tot = sum(a);
    let best = { start: 0, share: 0 };
    for (let s = 0; s < 12; s++) { const v = a[s] + a[(s + 1) % 12] + a[(s + 2) % 12]; if (tot && v / tot > best.share) best = { start: s, share: v / tot }; }
    return { start: best.start, months: [best.start, (best.start + 1) % 12, (best.start + 2) % 12], share: best.share };
  }
  function volumeBy(lines, dim) {
    const map = new Map();
    lines.forEach(l => {
      const k = l[dim] || "unknown";
      let g = map.get(k); if (!g) { g = { key: k, orders: new Set(), units: 0, value: 0, region: l.region }; map.set(k, g); }
      g.orders.add(l.order_key); g.units += l.quantity; g.value += l.value_eur;
    });
    const totU = sum(lines, l => l.quantity) || 1, totV = sum(lines, l => l.value_eur) || 1;
    return [...map.values()].map(g => ({ key: g.key, region: g.region, orders: g.orders.size, units: g.units, value: g.value, unit_share: g.units / totU, value_share: g.value / totV }))
      .sort((a, b) => b.units - a.units);
  }
  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  // Order size, lines and frequency per customer.
  function orderProfile(lines) {
    const orders = buildOrders(lines), cov = coverage(lines), years = Math.max(cov.yearMonths / 12, 1 / 12);
    const prof = os => {
      const customers = new Set(os.map(o => o.customer));
      return {
        orders: os.length, customers: customers.size,
        avg_units: os.length ? sum(os, o => o.units) / os.length : 0, median_units: median(os.map(o => o.units)),
        avg_value: os.length ? sum(os, o => o.value_eur) / os.length : 0, median_value: median(os.map(o => o.value_eur)),
        avg_lines: os.length ? sum(os, o => new Set(o.lines.map(l => l.sku || l.description)).size) / os.length : 0,
        orders_per_customer_year: customers.size ? os.length / customers.size / years : 0,
      };
    };
    const buckets = [[0, 100], [100, 250], [250, 500], [500, 1000], [1000, 2500], [2500, 5000], [5000, 10000], [10000, Infinity]];
    const dist = buckets.map(([lo, hi]) => ({ label: hi === Infinity ? `${lo.toLocaleString("en-GB")}+` : `${lo.toLocaleString("en-GB")}–${hi.toLocaleString("en-GB")}`, lo, hi, orders: orders.filter(o => o.units >= lo && o.units < hi).length }));
    const regions = {};
    [...new Set(orders.map(o => o.region))].forEach(r => { regions[r] = prof(orders.filter(o => o.region === r)); });
    return { overall: prof(orders), regions, size_distribution: dist, years };
  }
  function peakMonths(lines, n) {
    const t = Array(12).fill(0); lines.forEach(l => { t[l.month - 1] += l.quantity; });
    return t.map((v, i) => [v, i]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, n || 2).map(x => x[1]);
  }
  function topCustomers(lines, n) {
    const out = {};
    [...new Set(lines.map(l => l.region))].forEach(r => {
      const rl = lines.filter(l => l.region === r), tot = sum(rl, l => l.quantity) || 1;
      out[r] = volumeBy(rl, "customer").slice(0, n || 5).map(c => Object.assign(c, { region_share: c.units / tot, peak_months: peakMonths(rl.filter(l => l.customer === c.key), 2) }));
    });
    return out;
  }
  function peakLow(lines) {
    const s = seasonality(lines, "units", "region"), out = {};
    const one = idx => {
      const ranked = idx.index.map((v, i) => [v, i]).filter(x => x[0] !== null);
      const peak = ranked.slice().sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
      const low = ranked.slice().sort((a, b) => a[0] - b[0]).slice(0, 3).map(x => x[1]);
      return { peak, low, window: peakWindow(idx.avg), index: idx.index };
    };
    Object.entries(s.groups).forEach(([g, idx]) => { out[g] = one(idx); });
    return { overall: one(s.overall), regions: out };
  }
  const monthRange = w => `${MONTHS_LONG[w.months[0]]} to ${MONTHS_LONG[w.months[2]]}`;
  const pctText = v => `${Math.round(v * 100)} percent`;
  // Short findings in plain language, from the numbers.
  function findings(lines) {
    if (!lines.length) return ["No sales lines in the selection."];
    const out = [], pl = peakLow(lines), regions = volumeBy(lines, "region"), cats = volumeBy(lines, "category");
    const prof = orderProfile(lines), mon = monthly(lines);
    const study = regions.filter(r => REGION_CODES[r.key]);
    if (study.length) out.push(`${study.map(r => `${r.key} ${pctText(r.unit_share)}`).join(", ")} of units shipped.`);
    Object.entries(pl.regions).filter(([r]) => REGION_CODES[r]).sort((a, b) => b[1].window.share - a[1].window.share).forEach(([r, p]) => {
      out.push(`${r} orders peak in ${monthRange(p.window)}, ${pctText(p.window.share)} of yearly volume. Lowest months: ${p.low.slice(0, 2).map(i => MONTHS_LONG[i]).join(" and ")}.`);
    });
    if (cats.length) out.push(`${CATEGORY_LABELS[cats[0].key] || cats[0].key} are the largest category at ${pctText(cats[0].unit_share)} of units${cats[1] ? `, followed by ${(CATEGORY_LABELS[cats[1].key] || cats[1].key).toLowerCase()} at ${pctText(cats[1].unit_share)}` : ""}.`);
    out.push(`An average order holds ${Math.round(prof.overall.avg_units).toLocaleString("en-GB")} units in ${prof.overall.avg_lines.toFixed(1)} lines, worth EUR ${Math.round(prof.overall.avg_value).toLocaleString("en-GB")}. Customers order ${prof.overall.orders_per_customer_year.toFixed(1)} times a year on average.`);
    const top = volumeBy(lines, "customer"), top5 = sum(top.slice(0, 5), c => c.unit_share);
    if (top.length > 5) out.push(`The five largest customers take ${pctText(top5)} of units.`);
    const full = mon.years.filter(y => mon.totals[y].months === 12);
    if (full.length >= 2) {
      const a = full[full.length - 2], b = full[full.length - 1], g = mon.totals[a].units ? mon.totals[b].units / mon.totals[a].units - 1 : 0;
      out.push(`Units ${g >= 0 ? "grew" : "fell"} ${Math.abs(Math.round(g * 100))} percent from ${a} to ${b}.`);
    }
    const cov = coverage(lines);
    if (cov.yearMonths < 12) out.push(`The data covers ${cov.yearMonths} months, so the seasonal shape is indicative only.`);
    return out;
  }
  function analyse(lines) {
    return { monthly: monthly(lines), seasonality: seasonality(lines, "units", "region"), regions: volumeBy(lines, "region"), countries: volumeBy(lines, "country"),
             customers: volumeBy(lines, "customer"), categories: volumeBy(lines, "category"), profile: orderProfile(lines), top: topCustomers(lines, 5),
             peaks: peakLow(lines), findings: findings(lines) };
  }

  // ------------------------------------------------------------------ packing estimates
  // skuInfo: {sku: {unit_weight_kg, units_per_pallet}}. Values from the sales export win when present.
  function packLine(l, skuInfo, packing) {
    const p = packing || PACKING, cat = p[l.category] || p.other, info = (skuInfo || {})[l.sku] || {};
    const cartons = l.cartons > 0 ? l.cartons : Math.max(1, Math.ceil(l.quantity / cat.units_per_carton));
    const kgUnit = info.unit_weight_kg > 0 ? info.unit_weight_kg : cat.kg_per_unit;
    const weight = l.weight_kg > 0 ? l.weight_kg : l.quantity * kgUnit + cartons * p.carton_tare_kg;
    const palletFloat = l.pallets > 0 ? l.pallets : info.units_per_pallet > 0 ? l.quantity / info.units_per_pallet : cartons / p.cartons_per_pallet;
    return { cartons, weight_kg: weight, volume_m3: cartons * p.carton_m3, pallet_float: palletFloat };
  }

  // ------------------------------------------------------------------ test order generator
  // lines: clean sales lines. opts: {baseYears, scale, targetValueEur, seed, skuInfo, ports: {customer: {city, port}}, packing}
  function generateTestOrders(lines, opts) {
    opts = opts || {};
    const base = (opts.baseYears && opts.baseYears.length) ? lines.filter(l => opts.baseYears.includes(l.year)) : lines.slice();
    const orders = buildOrders(base);
    const cov = coverage(base), years = Math.max(cov.yearMonths / 12, 1 / 12);
    const hist = { orders: orders.length / years, units: sum(base, l => l.quantity) / years, value: sum(base, l => l.value_eur) / years,
                   lines: sum(orders, o => o.lines.length) / years };
    let scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
    if (Number(opts.targetValueEur) > 0 && hist.value > 0) scale = Number(opts.targetValueEur) / hist.value;
    const target = Math.max(0, Math.round(hist.orders * scale));
    // Orders per calendar month, averaged over the years covering that month.
    const perMonth = MONTHS.map((_, i) => orders.filter(o => o.month === i + 1));
    const weights = perMonth.map((os, i) => (cov.perMonth[i] ? os.length / cov.perMonth[i] : 0));
    const counts = apportion(target, weights);
    const rand = rng(opts.seed == null ? 1 : opts.seed);
    const picked = [];
    counts.forEach((n, i) => {
      const pool = perMonth[i].length ? perMonth[i] : orders;
      let deck = shuffle(pool, rand), k = 0;
      for (let j = 0; j < n; j++) { if (k >= deck.length) { deck = shuffle(pool, rand); k = 0; } picked.push({ month: i + 1, order: deck[k++] }); }
    });
    // Anonymous customer IDs per region, largest customer first.
    const unitsByCust = {};
    picked.forEach(p => { const k = p.order.region + "|" + p.order.customer; unitsByCust[k] = (unitsByCust[k] || 0) + p.order.units; });
    const anon = {}, perRegion = {};
    Object.entries(unitsByCust).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).forEach(([k]) => {
      const code = regionCode(k.split("|")[0]); perRegion[code] = (perRegion[code] || 0) + 1;
      anon[k] = `Customer ${code}-${String(perRegion[code]).padStart(2, "0")}`;
    });
    const ports = opts.ports || {};
    const test = picked.map(p => {
      const o = p.order, byKey = new Map();
      o.lines.forEach(l => {
        const k = l.sku || l.description || l.category;
        let x = byKey.get(k);
        if (!x) { x = { sku: l.sku, description: l.description, category: l.category, brand: l.brand, quantity: 0, value_eur: 0, cartons: 0, weight_kg: 0, pallets: 0 }; byKey.set(k, x); }
        x.quantity += l.quantity; x.value_eur += l.value_eur;
        x.cartons += l.cartons > 0 ? l.cartons : 0; x.weight_kg += l.weight_kg > 0 ? l.weight_kg : 0; x.pallets += l.pallets > 0 ? l.pallets : 0;
      });
      const tl = [...byKey.values()].map(x => {
        const pk = packLine({ sku: x.sku, category: x.category, quantity: x.quantity, cartons: x.cartons, weight_kg: x.weight_kg, pallets: x.pallets }, opts.skuInfo, opts.packing);
        return { sku: x.sku, description: x.description, category: x.category, brand: x.brand, quantity: x.quantity, cartons: pk.cartons,
                 weight_kg: round(pk.weight_kg, 1), volume_m3: round(pk.volume_m3, 3), pallet_float: pk.pallet_float, value_eur: round(x.value_eur, 2) };
      });
      const loc = ports[o.customer] || {};
      return {
        month: p.month, country: o.country, region: o.region, city: loc.city || o.city || "", port: loc.port || o.port || DEFAULT_PORTS[o.country] || "",
        customer: anon[o.region + "|" + o.customer], customer_real: o.customer, source_order: o.order_number,
        lines: tl, units: sum(tl, x => x.quantity), cartons: sum(tl, x => x.cartons), pallets: Math.max(1, Math.ceil(sum(tl, x => x.pallet_float) - 1e-9)),
        weight_kg: round(sum(tl, x => x.weight_kg), 1), volume_m3: round(sum(tl, x => x.volume_m3), 2), value_eur: round(sum(tl, x => x.value_eur), 2),
      };
    }).sort((a, b) => a.month - b.month || (a.region < b.region ? -1 : a.region > b.region ? 1 : 0) || (a.country < b.country ? -1 : a.country > b.country ? 1 : 0) || b.units - a.units);
    test.forEach((t, i) => { t.id = `TO-${String(i + 1).padStart(3, "0")}`; t.month_name = MONTHS_LONG[t.month - 1]; });
    return { orders: test, lanes: lanes(test), check: check(base, test, hist, scale, weights), hist, scale, base_years: cov.years, seed: opts.seed == null ? 1 : opts.seed };
  }
  // Lanes from Helmond per destination country, with yearly volume.
  function lanes(test) {
    const map = new Map();
    test.forEach(t => {
      let l = map.get(t.country);
      if (!l) { l = { lane_id: `HLM-${t.country}`, origin: "Helmond, NL", country: t.country, region: t.region, ports: new Set(), orders: 0, pallets: 0, cartons: 0, weight_kg: 0, volume_m3: 0, months: Array(12).fill(0) }; map.set(t.country, l); }
      l.orders++; l.pallets += t.pallets; l.cartons += t.cartons; l.weight_kg += t.weight_kg; l.volume_m3 += t.volume_m3; l.months[t.month - 1]++;
      if (t.port) l.ports.add(t.port);
    });
    return [...map.values()].map(l => Object.assign(l, { ports: [...l.ports].join("; "), weight_kg: round(l.weight_kg, 0), volume_m3: round(l.volume_m3, 1),
      peak_month: MONTHS_LONG[l.months.indexOf(Math.max(...l.months))] })).sort((a, b) => b.pallets - a.pallets);
  }
  // How close the test set is to the history: totals per year (scaled) and monthly, region and category shares.
  function check(base, test, hist, scale, monthWeights) {
    const share = (arr, keyFn, valFn) => { const m = {}, t = sum(arr, valFn) || 1; arr.forEach(x => { const k = keyFn(x); m[k] = (m[k] || 0) + valFn(x); }); Object.keys(m).forEach(k => { m[k] /= t; }); return m; };
    const wt = sum(monthWeights) || 1;
    const histMonth = monthWeights.map(w => w / wt);
    const testMonth = MONTHS.map((_, i) => test.filter(t => t.month === i + 1).length / (test.length || 1));
    const testLines = [];
    test.forEach(t => t.lines.forEach(l => testLines.push({ region: t.region, category: l.category, quantity: l.quantity })));
    const histRegion = share(base, l => l.region, l => l.quantity), testRegion = share(testLines, l => l.region, l => l.quantity);
    const histCat = share(base, l => l.category, l => l.quantity), testCat = share(testLines, l => l.category, l => l.quantity);
    const dev = (a, b) => Math.max(0, ...[...new Set(Object.keys(a).concat(Object.keys(b)))].map(k => Math.abs((a[k] || 0) - (b[k] || 0))));
    const totals = {
      orders: { history: hist.orders * scale, test: test.length },
      lines: { history: hist.lines * scale, test: sum(test, t => t.lines.length) },
      units: { history: hist.units * scale, test: sum(test, t => t.units) },
      value: { history: hist.value * scale, test: sum(test, t => t.value_eur) },
    };
    Object.values(totals).forEach(t => { t.diff = t.history ? t.test / t.history - 1 : 0; });
    const monthDev = Math.max(...histMonth.map((h, i) => Math.abs(h - testMonth[i])));
    const result = { totals, months: { history: histMonth, test: testMonth, max_dev: monthDev },
      regions: { history: histRegion, test: testRegion, max_dev: dev(histRegion, testRegion) },
      categories: { history: histCat, test: testCat, max_dev: dev(histCat, testCat) } };
    result.ok = monthDev <= 0.03 && result.regions.max_dev <= 0.05 && result.categories.max_dev <= 0.05 && Math.abs(totals.units.diff) <= 0.15;
    return result;
  }

  // ------------------------------------------------------------------ provider response template
  // Data model for the later side-by-side comparison. A completed template parses into a
  // ProviderResponse: {package_id, provider_id, provider_name, currency, received, lines: [ResponseLine], goals: [GoalScore]}
  //   ResponseLine: {kind: "order"|"lane", ref (test order ID or lane ID), transport_mode, transit_days, lead_time_days,
  //                  freight_rate, fuel_surcharge, customs_fee, warehousing_cost, other_surcharges, incoterm, currency, comment}
  //   GoalScore: {goal_id, goal, meets: "yes"|"no"|"partly"|"", comment}
  const TEMPLATE_VERSION = 1;
  const COST_COLUMNS = [
    ["transport_mode", "Transport mode (road / sea / air / multimodal)"], ["transit_days", "Transit time (days)"], ["lead_time_days", "Total lead time (days)"],
    ["freight_rate", "Freight rate"], ["fuel_surcharge", "Fuel surcharge"], ["customs_fee", "Customs clearance fee"], ["warehousing_cost", "Warehousing cost"],
    ["other_surcharges", "Other surcharges"], ["incoterm", "Incoterm offered"], ["currency", "Currency"], ["comment", "Comments"],
  ];
  const NUMERIC_COLUMNS = new Set(["transit_days", "lead_time_days", "freight_rate", "fuel_surcharge", "customs_fee", "warehousing_cost", "other_surcharges"]);
  // {sheets: {name: rows}, columns}. pkg: {id, created, orders, lanes}; provider: {id, name} or null; goals: [{id, name, target, unit, priority}]
  function responseTemplate(pkg, provider, goals) {
    const head = ["Test order ID", "Month", "Destination country", "City / port", "Region", "Cartons", "Pallets", "Gross weight (kg)", "Volume (m3)"];
    const meta = [["key", "value"], ["template", "flexitog-benchmark-response"], ["template_version", TEMPLATE_VERSION], ["package_id", pkg.id],
      ["provider_id", provider ? provider.id : ""], ["provider_name", provider ? provider.name : ""], ["generated", pkg.created], ["orders", pkg.orders.length]];
    const sheets = {
      "Instructions": [
        ["FlexiTog EU logistics benchmark: response template"], [],
        ["1. Fill in your company details on the sheet Provider."],
        ["2. Quote per test order on Rates per order, or per lane on Rates per lane. One of the two is enough; both is better."],
        ["3. Leave the grey reference columns as they are. Do not rename sheets or column headers: we import this file automatically."],
        ["4. Transport mode: road, sea, air or multimodal. Meets goal: yes, no or partly."],
        ["5. Amounts per shipment, without VAT. Put the currency on every row."],
        ["6. Origin for every shipment: FlexiTog EU, Helmond, the Netherlands."],
      ],
      "Provider": [["Field", "Your answer"], ["Company name", provider ? provider.name : ""], ["Contact person", ""], ["Contact email", ""], ["Phone", ""],
        ["Quote valid until (date)", ""], ["Default currency", ""], ["Payment terms", ""], ["General comments", ""]],
      "Rates per order": [head.concat(COST_COLUMNS.map(c => c[1]))].concat(pkg.orders.map(t => [t.id, t.month_name, t.country, t.port || t.city, t.region, t.cartons, t.pallets, t.weight_kg, t.volume_m3].concat(COST_COLUMNS.map(() => "")))),
      "Rates per lane": [["Lane ID", "Origin", "Destination country", "Ports / cities", "Orders per year", "Pallets per year", "Weight per year (kg)", "Peak month"].concat(COST_COLUMNS.map(c => c[1]))]
        .concat(pkg.lanes.map(l => [l.lane_id, l.origin, l.country, l.ports, l.orders, l.pallets, l.weight_kg, l.peak_month].concat(COST_COLUMNS.map(() => "")))),
      "Service goals": [["Goal ID", "Goal", "Target", "Unit", "Mandatory or preferred", "Meets goal (yes / no / partly)", "Comments"]]
        .concat((goals || []).map(g => [g.id, g.name, g.target, g.unit, g.priority, "", ""])),
      "_meta": meta,
    };
    return { sheets, columns: { orders: head.length, lanes: 8, cost: COST_COLUMNS.map(c => c[0]) } };
  }
  // sheets: {name: rows}. Returns a ProviderResponse, or throws with a readable message.
  function parseResponse(sheets) {
    const meta = {};
    (sheets._meta || []).slice(1).forEach(r => { if (r && !isBlank(r[0])) meta[String(r[0])] = r[1]; });
    if (meta.template !== "flexitog-benchmark-response") throw new Error("This is not a FlexiTog benchmark response template (sheet _meta missing).");
    const provSheet = {};
    (sheets.Provider || []).slice(1).forEach(r => { if (r && !isBlank(r[0])) provSheet[String(r[0])] = r[1]; });
    const defaultCur = isBlank(provSheet["Default currency"]) ? "" : String(provSheet["Default currency"]).trim().toUpperCase();
    const parseRows = (rows, kind, refCols) => (rows || []).slice(1).filter(r => r && !isBlank(r[0])).map(r => {
      const o = { kind, ref: String(r[0]).trim() };
      COST_COLUMNS.forEach(([k], i) => {
        const v = r[refCols + i];
        o[k] = NUMERIC_COLUMNS.has(k) ? parseNumber(v, typeof v === "string" ? detectDecimal([v]) : ".") : (isBlank(v) ? "" : String(v).trim());
      });
      if (!o.currency) o.currency = defaultCur;
      o.transport_mode = String(o.transport_mode || "").toLowerCase();
      return o;
    }).filter(o => COST_COLUMNS.some(([k]) => k !== "currency" && o[k] !== null && o[k] !== ""));
    const goals = (sheets["Service goals"] || []).slice(1).filter(r => r && !isBlank(r[0])).map(r => {
      const m = isBlank(r[5]) ? "" : String(r[5]).trim().toLowerCase();
      return { goal_id: String(r[0]), goal: r[1] || "", meets: ["yes", "no", "partly"].includes(m) ? m : (m.startsWith("y") ? "yes" : m.startsWith("n") ? "no" : m.startsWith("p") ? "partly" : ""), comment: isBlank(r[6]) ? "" : String(r[6]) };
    });
    return {
      package_id: meta.package_id || "", provider_id: meta.provider_id || "", provider_name: provSheet["Company name"] || meta.provider_name || "",
      currency: defaultCur, valid_until: provSheet["Quote valid until (date)"] || "", template_version: Number(meta.template_version) || 0,
      lines: parseRows(sheets["Rates per order"], "order", 9).concat(parseRows(sheets["Rates per lane"], "lane", 8)), goals,
    };
  }

  const api = { MONTHS, MONTHS_LONG, CATEGORIES, CATEGORY_LABELS, REGION_CODES, DEFAULT_PORTS, PACKING, SALES_FIELDS, TEMPLATE_VERSION, COST_COLUMNS,
    rng, shuffle, apportion, detectDecimal, parseNumber, parseDate, categoryOf, regionCode, guessMapping, headerRow, applyMapping,
    cleanSales, buildOrders, coverage, monthly, seasonality, peakWindow, volumeBy, orderProfile, topCustomers, peakLow, findings, analyse,
    packLine, generateTestOrders, lanes, check, responseTemplate, parseResponse };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BenchCore = api;
})(typeof window !== "undefined" ? window : globalThis);
