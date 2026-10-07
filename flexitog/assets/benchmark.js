/* FlexiTog dashboard: Benchmarking view. Logistics providers, sales data and analysis, service
 * goals, the standard test order package and its report (PDF, Word, Excel response template).
 * Runs after workspace.js and shares its globals (STORE, chunks, saveFile, toast, readFile, toIso2,
 * norm, wbBytes, storeErrorText, VIEW, PAYLOAD, MD, REGIONS, regionOf, CNAME, esc, fmt, pct, clone, $).
 * The logic without DOM (cleaning, seasonality, generator, template) is in bench_core.js.
 */
(function () {
"use strict";
const C = window.BenchCore;
const BKEY = "flexitog-bench-v1:";
const UIKEY = "flexitog-bench-ui";
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "long", year: "numeric"});
const uid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const rc = r => C.regionCode(r);
const catLabel = k => ({jackets: "Jackets", trousers: "Trousers", coveralls: "Coveralls", other: "Other items"})[k] || k;
const slug = s => String(s || "").normalize("NFKD").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "generic";
const TARGETS = Object.keys(PAYLOAD.data.country_region).filter(c => REGIONS.includes(regionOf(c)));
const WORLD = (() => {
  const m = new Map();
  (PAYLOAD.geo.basemap.countries || []).forEach(c => { if (c.iso && /^[A-Z]{2}$/.test(c.iso) && !m.has(c.iso)) m.set(c.iso, PAYLOAD.names.countries[c.iso] || c.name); });
  Object.entries(PAYLOAD.names.countries).forEach(([k, v]) => { if (!m.has(k)) m.set(k, v); });
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "en"));
})();

// ============================================================ schemas
// One object per record type drives the form, the table, search, filters, import and storage.
// Add a field here and it appears everywhere.
const PROVIDER_TYPES = [["freight_forwarder", "Freight forwarder"], ["3pl", "3PL"], ["carrier", "Carrier"], ["distributor", "Distributor"], ["other", "Other"]];
const SERVICES = [["road", "Road"], ["sea", "Sea"], ["air", "Air"], ["warehousing", "Warehousing"], ["customs", "Customs clearance"], ["last_mile", "Last-mile"], ["returns", "Returns handling"]];
const STATUSES = [["prospect", "Prospect"], ["contacted", "Contacted"], ["test_order_sent", "Test order sent"], ["response_received", "Response received"], ["shortlisted", "Shortlisted"], ["rejected", "Rejected"]];
const PROVIDER_FIELDS = [
  {key: "name", label: "Provider name", type: "text", required: true, table: true, search: true},
  {key: "contact_person", label: "Contact person", type: "text", required: true, table: true, search: true},
  {key: "email", label: "Contact email", type: "email", required: true, table: true, search: true},
  {key: "phone", label: "Phone", type: "tel"},
  {key: "website", label: "Website", type: "url", search: true},
  {key: "hq_country", label: "Headquarters country", type: "select", options: () => WORLD},
  {key: "type", label: "Provider type", type: "select", options: PROVIDER_TYPES, table: true, filter: true, default: "freight_forwarder"},
  {key: "regions", label: "Regions covered", type: "multi", options: () => REGIONS.map(r => [r, r]), table: true, filter: true, full: true},
  {key: "countries", label: "Countries covered", type: "multi", options: () => TARGETS.map(c => [c, CNAME(c)]), groupBy: c => regionOf(c), full: true},
  {key: "services", label: "Services offered", type: "multi", options: SERVICES, table: true, full: true},
  {key: "status", label: "Status", type: "select", options: STATUSES, table: true, filter: true, default: "prospect"},
  {key: "test_sent", label: "Date test order sent", type: "date", table: true},
  {key: "notes", label: "Notes", type: "textarea", search: true, full: true},
];
const GOAL_FIELDS = [
  {key: "name", label: "Goal", type: "text", required: true},
  {key: "description", label: "Description", type: "textarea"},
  {key: "target", label: "Target", type: "text"},
  {key: "unit", label: "Unit", type: "text"},
  {key: "priority", label: "Mandatory or preferred", type: "select", options: [["mandatory", "Mandatory"], ["preferred", "Preferred"]], default: "mandatory"},
  {key: "regions", label: "Regions (none ticked = all)", type: "multi", options: () => REGIONS.map(r => [r, r])},
];
const DEFAULT_GOALS = [
  {id: "G01", name: "Next-day delivery", description: "Orders released before the daily cut-off reach the customer the next working day, from regional stock or direct.", target: "1", unit: "working day", priority: "mandatory", regions: ["Türkiye", "North Africa"]},
  {id: "G02", name: "Delivery within 48 hours", description: "Orders released before the daily cut-off reach the customer within 48 hours.", target: "48", unit: "hours", priority: "mandatory", regions: ["Gulf/GCC"]},
  {id: "G03", name: "All customs paperwork handled by the provider", description: "Export declaration, import clearance, EUR.1 (North Africa), A.TR (Türkiye), SASO/SABER (Saudi Arabia) and certificates of origin where relevant. The customer files nothing.", target: "100", unit: "% of shipments", priority: "mandatory", regions: []},
  {id: "G04", name: "No hassle for the customer", description: "One point of contact for the customer, no duties, taxes or fees collected at delivery, delivery booked with the customer.", target: "0", unit: "fees collected at delivery", priority: "mandatory", regions: []},
  {id: "G05", name: "Damage rate", description: "Broken or crushed boxes at delivery, reported with photos on the proof of delivery.", target: "0.5", unit: "% of cartons", priority: "preferred", regions: []},
  {id: "G06", name: "Returns handling and return rate", description: "Collection of returns from the customer within 5 working days and return to Helmond or regional stock. Target return rate below.", target: "2", unit: "% of orders returned", priority: "preferred", regions: []},
  {id: "G07", name: "Tracking and proof of delivery", description: "Track and trace for every shipment and an electronic proof of delivery with name, date and time.", target: "100", unit: "% of shipments", priority: "mandatory", regions: []},
];
const SEED_PROVIDERS = [
  {name: "Example Forwarding Co. (dummy)", contact_person: "Alex Example", email: "alex@forwarder.example.com", phone: "+31 40 000 0001", website: "https://forwarder.example.com", hq_country: "NL",
   type: "freight_forwarder", regions: ["Türkiye", "North Africa"], countries: ["TR", "MA", "TN", "EG"], services: ["road", "sea", "customs"], status: "prospect", test_sent: "", notes: "Dummy record to try the tool. Replace or delete it."},
  {name: "Sample Gulf 3PL (dummy)", contact_person: "Sam Sample", email: "sam@gulf3pl.example.com", phone: "+971 4 000 0002", website: "https://gulf3pl.example.com", hq_country: "AE",
   type: "3pl", regions: ["Gulf/GCC"], countries: ["AE", "SA", "QA", "KW", "BH", "OM"], services: ["warehousing", "customs", "last_mile", "returns"], status: "contacted", test_sent: "", notes: "Dummy record to try the tool. Replace or delete it."},
  {name: "Demo Road Carrier (dummy)", contact_person: "Dana Demo", email: "dana@roadcarrier.example.com", phone: "+90 212 000 0003", website: "", hq_country: "TR",
   type: "carrier", regions: ["Türkiye"], countries: ["TR"], services: ["road", "customs", "last_mile"], status: "prospect", test_sent: "", notes: "Dummy record to try the tool. Replace or delete it."},
];
// EUR per unit of each currency. Placeholder rates: replace with the rates finance uses.
const DEFAULT_FX = {EUR: 1, USD: 0.86, GBP: 1.15, CHF: 1.07, TRY: 0.021, AED: 0.234, SAR: 0.229, QAR: 0.236, KWD: 2.8, BHD: 2.28, OMR: 2.23, MAD: 0.093, DZD: 0.0066, TND: 0.29, EGP: 0.0177, LYD: 0.16};
const DEFAULT_SETTINGS = () => ({
  scope: "target", builtin: true, fx: clone(DEFAULT_FX),
  gen: {baseYears: [], mode: "factor", scale: 1, targetUsd: 2400000, seed: 2026, showValues: true, lineDetail: "sku"},
  report: {deadline: addDays(today(), 21), contact_name: "", contact_role: "Supply chain", contact_email: "", contact_phone: ""},
});
const optsOf = f => (typeof f.options === "function" ? f.options() : f.options || []);
const optLabel = (f, v) => { const o = optsOf(f).find(x => x[0] === v); return o ? o[1] : (v ?? ""); };

// ============================================================ storage (artifact db when published, else this browser)
const BS = {
  chunks: {},
  async get(name){
    if (STORE.db) {
      const m = await STORE.db.doc("bench/" + name).get();
      if (!m.exists) return undefined;
      const meta = m.data();
      if (meta.chunks == null) return meta.value;
      BS.chunks[name] = meta.chunks;
      let rows = [];
      for (let i = 0; i < meta.chunks; i++) { const d = await STORE.db.doc(`benchrows/${name}__${i}`).get(); if (d.exists) rows = rows.concat(d.data().rows || []); }
      return rows;
    }
    try { const v = localStorage.getItem(BKEY + name); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; }
  },
  async set(name, value){
    const updated = new Date().toISOString();
    if (STORE.db) {
      if (Array.isArray(value)) {
        const parts = chunks(value), old = BS.chunks[name] || 0;
        for (let i = 0; i < parts.length; i++) await STORE.db.doc(`benchrows/${name}__${i}`).set({rows: parts[i]});
        for (let i = parts.length; i < old; i++) await STORE.db.doc(`benchrows/${name}__${i}`).delete();
        BS.chunks[name] = parts.length;
        await STORE.db.doc("bench/" + name).set({chunks: parts.length, rows: value.length, updated});
      } else await STORE.db.doc("bench/" + name).set({value, updated});
      return "artifact";
    }
    localStorage.setItem(BKEY + name, JSON.stringify(value));
    return "browser";
  },
  async del(name){
    if (STORE.db) {
      for (let i = 0; i < (BS.chunks[name] || 0); i++) await STORE.db.doc(`benchrows/${name}__${i}`).delete();
      delete BS.chunks[name]; await STORE.db.doc("bench/" + name).delete();
    } else { try { localStorage.removeItem(BKEY + name); } catch (e) {} }
  },
};
async function save(name, value, okMsg){
  try { const where = await BS.set(name, value); if (okMsg) toast(okMsg + (where === "artifact" ? " (saved with the dashboard)" : " (saved in this browser)")); return true; }
  catch (e) { toast(storeErrorText(e), "bad"); return false; }
}
let settingsTimer = null;
function saveSettingsSoon(){ clearTimeout(settingsTimer); settingsTimer = setTimeout(() => save("settings", B.settings), 500); }
let goalsTimer = null;
function saveGoalsSoon(){ clearTimeout(goalsTimer); goalsTimer = setTimeout(() => save("goals", B.goals), 600); }
const storeReady = () => new Promise(res => { const t = () => (STORE.ready ? res() : setTimeout(t, 60)); t(); });

// ============================================================ state
const B = {
  ready: false, tab: "providers", ver: 0,
  providers: [], goals: [], settings: DEFAULT_SETTINGS(), packages: [], sources: [],
  ui: {q: "", status: "all", type: "all", region: "all", metric: "units", dim: "region", showReal: false, sel: new Set(["generic"]), formats: {pdf: true, docx: true, xlsx: true}, busy: false},
  upload: null, clean: null, analysis: null, test: null, testKey: "", stale: {}, mdRef: null,
};
try { const u = JSON.parse(localStorage.getItem(UIKEY) || "{}"); if (u.tab) B.tab = u.tab; } catch (e) {}
const rememberTab = () => { try { localStorage.setItem(UIKEY, JSON.stringify({tab: B.tab})); } catch (e) {} };

// ============================================================ sales sources
const FIELD_KEYS = C.SALES_FIELDS.map(f => f.key);
function skuInfo(){
  const o = {};
  (MD.t.products || []).forEach(p => { o[p.sku] = {description: p.description || "", category: p.product_family || "", brand: p.brand || "", unit_weight_kg: p.unit_weight_kg, units_per_pallet: p.units_per_pallet}; });
  return o;
}
function custLoc(){
  const o = {};
  (MD.t.customers || []).forEach(c => { const v = {city: c.city || "", port: c.destination_port || ""}; o[c.customer_id] = v; if (c.name) o["n:" + norm(c.name)] = v; });
  return o;
}
function builtinRaw(){
  return (MD.t.sales_history || []).map(s => ({order_date: s.order_date, order_number: s.order_id, customer: s.customer_id, destination_country: s.country, sku: s.sku,
    quantity: s.quantity, order_value: s.net_value_eur, currency: "EUR", pallets: s.pallets, incoterm: s.incoterm}));
}
const builtinDummy = () => { const r = MD.t.sales_history || []; return r.length > 0 && r.filter(x => String(x.data_source || "placeholder") === "placeholder").length * 2 >= r.length; };
function activeSources(){
  const out = [];
  if (B.settings.builtin) out.push({id: "builtin", name: "Sales history (master data)", currency: "EUR", raw: builtinRaw()});
  B.sources.filter(s => s.enabled).forEach(s => out.push({id: s.id, name: s.name, currency: s.currency, raw: s.rows.map(r => Object.fromEntries(FIELD_KEYS.map((k, i) => [k, r[i]])))}));
  return out;
}
function recompute(){
  const info = skuInfo(), loc = custLoc(), all = [], reports = [];
  activeSources().forEach(s => {
    const res = C.cleanSales(s.raw, {source: s.id, defaultCurrency: s.currency, fx: B.settings.fx, skuInfo: info, regionOf,
      countryOf: v => (isBlank(v) ? null : toIso2(v))});
    res.lines.forEach(l => { const p = loc[l.customer] || loc["n:" + norm(l.customer)]; if (p) { l.city = p.city; l.port = p.port; } });
    all.push(...res.lines); reports.push({id: s.id, name: s.name, report: res.report});
  });
  const lines = B.settings.scope === "target" ? all.filter(l => REGIONS.includes(l.region)) : all;
  B.clean = {all, lines, reports};
  B.analysis = lines.length ? C.analyse(lines) : null;
  B.ver++; B.test = null; B.testKey = "";
  B.mdRef = [MD.t.sales_history, MD.t.products, MD.t.customers];
  B.stale = {providers: true, sales: true, goals: true, test: true};
}
function years(){ return B.clean ? [...new Set(B.clean.lines.map(l => l.year))].sort() : []; }
function currentTest(){
  if (!B.clean || !B.clean.lines.length) return null;
  const g = B.settings.gen, ys = years();
  const base = (g.baseYears || []).filter(y => ys.includes(y));
  const opts = {baseYears: base.length ? base : null, seed: Number(g.seed) || 1, skuInfo: skuInfo()};
  if (g.mode === "target") opts.targetValueEur = Number(g.targetUsd) * (Number(B.settings.fx.USD) || 1); else opts.scale = Number(g.scale) > 0 ? Number(g.scale) : 1;
  const key = B.ver + "|" + JSON.stringify([opts.baseYears, opts.seed, opts.scale, opts.targetValueEur]);
  if (B.test && B.testKey === key) return B.test;
  B.test = C.generateTestOrders(B.clean.lines, opts); B.testKey = key;
  return B.test;
}
const isDummy = () => (B.settings.builtin && builtinDummy()) || B.providers.some(p => p.dummy);

// ============================================================ charts (SVG, screen and print palettes)
const PAL = {
  screen: {ink: "var(--ink)", muted: "var(--muted)", rule: "var(--rule)", TR: "var(--r-TR)", NAF: "var(--r-NAF)", GCC: "var(--r-GCC)", OTH: "var(--r-OTH)",
           q: ["var(--q1)", "var(--q2)", "var(--q3)", "var(--q4)", "var(--q5)"], accent: "var(--accent)", font: "var(--mono)", bg: null},
  print: {ink: "#14212c", muted: "#56636f", rule: "#d9dfe4", TR: "#2a78d6", NAF: "#eb6834", GCC: "#1baf7a", OTH: "#8a8984",
          q: ["#b9b0ea", "#8070d6", "#6553c7", "#4f3db0", "#281d66"], accent: "#1f3a55", font: "Arial, Helvetica, sans-serif", bg: "#ffffff"},
};
function sfmt(v){ const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e4 ? Math.round(v / 1e3) + "k" : a >= 1e3 ? (v / 1e3).toFixed(1) + "k" : String(Math.round(v * 10) / 10); }
function axis(max, n){
  if (!(max > 0)) max = 1;
  const raw = max / (n || 4), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag, top = Math.ceil(max / step - 1e-9) * step, list = [];
  for (let v = 0; v <= top + step * 1e-6; v += step) list.push(v);
  return {max: top, list};
}
const svgOpen = (w, h, pal, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label || "chart")}">` + (pal.bg ? `<rect width="${w}" height="${h}" fill="${pal.bg}"/>` : "");
const tx = (pal, x, y, s, o = {}) => `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" text-anchor="${o.a || "start"}" style="fill:${o.fill || pal.muted};font-family:${pal.font};font-size:${o.size || 10.5}px${o.w ? ";font-weight:" + o.w : ""}">${esc(s)}</text>`;
function legendSvg(pal, items, x, y, w){
  let s = "", cx = x, cy = y;
  items.forEach(it => {
    const tw = 22 + String(it.name).length * 6.2;
    if (cx + tw > x + w) { cx = x; cy += 16; }
    s += it.line ? `<line x1="${cx}" x2="${cx + 14}" y1="${cy - 3.5}" y2="${cy - 3.5}" style="stroke:${it.color};stroke-width:3"${it.dash ? ` stroke-dasharray="${it.dash}"` : ""}/>` : `<rect x="${cx}" y="${cy - 9}" width="11" height="11" rx="2" style="fill:${it.color}"/>`;
    s += tx(pal, cx + 18, cy, it.name, {fill: pal.ink, size: 11}); cx += tw + 10;
  });
  return {svg: s, height: cy - y + 16};
}
function frame(pal, o, max, m, w, h){
  const t = axis(max, 4), ih = h - m.t - m.b, y = v => m.t + ih - ih * v / t.max;
  let s = "";
  t.list.forEach(v => { s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" style="stroke:${pal.rule};stroke-width:1"/>` + tx(pal, m.l - 6, y(v) + 3.5, o.fmt ? o.fmt(v) : sfmt(v), {a: "end"}); });
  if (o.yLabel) s += tx(pal, 4, m.t - 12, o.yLabel, {size: 10});
  return {s, y, t};
}
function lineChart(o){
  const pal = o.pal || PAL.screen, w = o.w || 980;
  const leg = o.legend ? legendSvg(pal, o.series.map(se => ({name: se.name, color: se.color, line: true, dash: se.dash})), 54, 14, w - 70) : {svg: "", height: 0};
  const m = {l: 54, r: 14, t: 14 + leg.height + (o.yLabel ? 16 : 0), b: 26}, h = (o.h || 250) + leg.height;
  const vals = o.series.flatMap(se => se.values.filter(v => v != null));
  const F = frame(pal, o, Math.max(o.ref || 0, ...vals, 0) * 1.06, m, w, h), n = o.labels.length, iw = w - m.l - m.r;
  const x = i => m.l + iw * (i + 0.5) / n;
  let s = svgOpen(w, h, pal, o.label) + leg.svg + F.s;
  o.labels.forEach((l, i) => { s += tx(pal, x(i), h - 9, l, {a: "middle"}); });
  if (o.ref != null) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${F.y(o.ref).toFixed(1)}" y2="${F.y(o.ref).toFixed(1)}" stroke-dasharray="5 4" style="stroke:${pal.muted};stroke-width:1.2"/>`;
  o.series.forEach(se => {
    let d = "", pen = false;
    se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + F.y(v).toFixed(1); pen = true; });
    s += `<path d="${d}" fill="none" stroke-linejoin="round" stroke-linecap="round"${se.dash ? ` stroke-dasharray="${se.dash}"` : ""} style="stroke:${se.color};stroke-width:${se.width || 2}"/>`;
    se.values.forEach((v, i) => { if (v != null) s += `<circle cx="${x(i).toFixed(1)}" cy="${F.y(v).toFixed(1)}" r="${se.width > 2 ? 3.2 : 2.6}" style="fill:${se.color}"><title>${esc(se.name)} · ${esc(o.labels[i])}: ${esc(o.tip ? o.tip(v) : fmt(v))}</title></circle>`; });
  });
  return s + "</svg>";
}
function barsV(o){
  const pal = o.pal || PAL.screen, w = o.w || 980;
  const leg = o.legend ? legendSvg(pal, o.series.map(se => ({name: se.name, color: se.color})), 54, 14, w - 70) : {svg: "", height: 0};
  const m = {l: 54, r: 14, t: 14 + leg.height + (o.yLabel ? 16 : 0), b: 26}, h = (o.h || 250) + leg.height, n = o.labels.length, iw = w - m.l - m.r;
  const max = o.stacked ? Math.max(0, ...o.labels.map((_, i) => o.series.reduce((a, se) => a + (se.values[i] || 0), 0))) : Math.max(0, ...o.series.flatMap(se => se.values.map(v => v || 0)));
  const F = frame(pal, o, max * 1.06, m, w, h), band = iw / n, pad = band * 0.16, inner = band - 2 * pad;
  let s = svgOpen(w, h, pal, o.label) + leg.svg + F.s;
  o.labels.forEach((l, i) => {
    const x0 = m.l + band * i + pad;
    s += tx(pal, m.l + band * (i + 0.5), h - 9, l, {a: "middle"});
    let acc = 0;
    o.series.forEach((se, k) => {
      const v = se.values[i] || 0; if (!v) return;
      const bw = o.stacked ? inner : inner / o.series.length, bx = o.stacked ? x0 : x0 + bw * k;
      const y1 = F.y(acc + v), y0 = F.y(o.stacked ? acc : 0);
      s += `<rect x="${bx.toFixed(1)}" y="${y1.toFixed(1)}" width="${Math.max(1, bw - (o.stacked ? 0 : 1.5)).toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" style="fill:${se.color}"><title>${esc(se.name)} · ${esc(l)}: ${esc(o.tip ? o.tip(v) : fmt(v))}</title></rect>`;
      if (o.stacked) acc += v;
    });
  });
  return s + "</svg>";
}
function barsH(o){
  const pal = o.pal || PAL.screen, w = o.w || 980, lw = o.labelW || 190, row = 22, m = {l: lw, r: 16 + 6.6 * Math.max(6, ...o.items.map(i => String(i.text || "").length)), t: 8, b: 8};
  const h = m.t + m.b + o.items.length * row, max = Math.max(0, ...o.items.map(i => i.value)) || 1, iw = w - m.l - m.r;
  let s = svgOpen(w, h, pal, o.label);
  o.items.forEach((it, i) => {
    const y = m.t + i * row, bw = iw * it.value / max, lab = String(it.label);
    s += tx(pal, m.l - 8, y + 15, lab.length > 30 ? lab.slice(0, 29) + "…" : lab, {a: "end", fill: pal.ink});
    s += `<rect x="${m.l}" y="${y + 4}" width="${Math.max(1, bw).toFixed(1)}" height="${row - 8}" rx="2" style="fill:${it.color}"><title>${esc(lab)}: ${esc(it.tip || fmt(it.value))}</title></rect>`;
    s += tx(pal, m.l + bw + 6, y + 15, it.text || sfmt(it.value));
  });
  return s + "</svg>";
}
const regionColor = (pal, r) => pal[rc(r)] || pal.OTH;
const legendHtml = items => `<div class="blegend">${items.map(i => `<span><i class="${i.sq ? "sq" : ""}" style="background:${i.color}"></i>${esc(i.name)}</span>`).join("")}</div>`;
function svgToPng(svg, w, h, scale){
  scale = scale || 2;
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = w * scale; c.height = h * scale;
        const g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/png"), bin = atob(url.split(",")[1]), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        res({url, bytes, w, h});
      } catch (e) { rej(e); }
    };
    img.onerror = () => rej(new Error("chart image failed"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}
const svgSize = svg => { const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return m ? [+m[1], +m[2]] : [760, 260]; };

// ============================================================ shell, tabs, chips
const TABS = [["providers", "Logistics Providers"], ["sales", "Sales Data and Analysis"], ["goals", "Service Goals"], ["test", "Test Order and Report"]];
function renderTabs(){
  const n = {providers: B.providers.length, sales: B.clean ? B.clean.lines.length : 0, goals: B.goals.length, test: B.test ? B.test.orders.length : null};
  $("benchTabs").innerHTML = TABS.map(([k, l]) => `<button type="button" data-t="${k}" aria-pressed="${B.tab === k}">${esc(l)}${n[k] != null ? `<span class="cnt">${fmt(n[k])}</span>` : ""}</button>`).join("");
}
function renderChips(){
  const why = [];
  if (B.settings.builtin && builtinDummy()) why.push("the built-in sales history is placeholder data");
  if (B.providers.some(p => p.dummy)) why.push("example providers are dummy records");
  const srcs = (B.clean ? B.clean.reports : []).map(r => r.name);
  $("benchChips").innerHTML = (why.length ? `<span class="chip demo" title="${esc("Placeholder data: " + why.join("; "))}">Dummy data · read the tool, not the numbers</span>` : "") +
    `<span class="chip">${fmt(B.clean ? B.clean.lines.length : 0)} sales lines · ${esc(srcs.length ? srcs.length + " source" + (srcs.length > 1 ? "s" : "") : "no source")}</span>` +
    `<span class="chip">${B.providers.length} providers</span><span class="chip">${STORE.where === "artifact" ? "Saved with this dashboard" : "Saved in this browser"}</span>`;
}
function render(){
  if (!B.ready) { $("bp-" + B.tab).innerHTML = `<div class="card"><p class="muted">Loading saved benchmarking data…</p></div>`; return; }
  const ref = [MD.t.sales_history, MD.t.products, MD.t.customers];
  if (!B.mdRef || ref.some((r, i) => r !== B.mdRef[i])) recompute();
  TABS.forEach(([k]) => { $("bp-" + k).hidden = k !== B.tab; });
  if (B.tab === "test") currentTest();
  renderTabs(); renderChips();
  ({providers: renderProviders, sales: renderSales, goals: renderGoals, test: renderTest})[B.tab]();
  B.stale[B.tab] = false;
}
$("benchTabs").addEventListener("click", e => {
  const b = e.target.closest("button[data-t]"); if (!b) return;
  B.tab = b.dataset.t; rememberTab(); render();
});

// ============================================================ 1. logistics providers
function provFiltered(){
  const q = norm(B.ui.q);
  return B.providers.filter(p => (B.ui.status === "all" || p.status === B.ui.status) && (B.ui.type === "all" || p.type === B.ui.type) &&
    (B.ui.region === "all" || (p.regions || []).includes(B.ui.region)) &&
    (!q || PROVIDER_FIELDS.some(f => f.search && norm(p[f.key]).includes(q))));
}
const safeUrl = u => { const s = String(u || "").trim(); return /^https?:\/\//i.test(s) ? s : "https://" + s; };
function provCell(f, p){
  const v = p[f.key];
  if (f.key === "name") return `<b>${esc(v)}</b>${p.dummy ? ' <span class="srcb ph" title="Dummy record for trying the tool">dummy</span>' : ""}${p.website ? `<br><a class="faint" href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener noreferrer">${esc(String(p.website).replace(/^https?:\/\//i, "").replace(/\/$/, ""))}</a>` : ""}`;
  if (f.key === "contact_person") return `${esc(v)}${p.phone ? `<br><span class="faint num">${esc(p.phone)}</span>` : ""}`;
  if (f.type === "email") return v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : "";
  if (f.key === "status") return `<span class="st ${esc(v)}">${esc(optLabel(f, v))}</span>`;
  if (f.type === "multi") return `<div class="tags">${(v || []).map(x => `<span class="tag${f.key === "regions" ? " r-" + rc(x) : ""}">${esc(f.key === "regions" ? x : optLabel(f, x))}</span>`).join("")}</div>`;
  if (f.type === "select") return esc(optLabel(f, v));
  if (f.type === "date") return `<span class="num">${esc(v || "")}</span>`;
  return esc(v ?? "");
}
function renderProvTable(){
  const cols = PROVIDER_FIELDS.filter(f => f.table), rows = provFiltered();
  const el = $("bxProvBody"); if (!el) return;
  el.innerHTML = rows.map(p => `<tr data-id="${esc(p.id)}">${cols.map(f => `<td class="${f.type === "multi" ? "wrap" : ""}">${provCell(f, p)}</td>`).join("")}
    <td><div class="bacts"><button type="button" class="btn ghost sm" data-a="edit">Edit</button><button type="button" class="btn ghost sm" data-a="del">Delete</button></div></td></tr>`).join("") ||
    `<tr><td colspan="${cols.length + 1}" class="empty">${B.providers.length ? "No provider matches the search or filters." : "No providers yet. Add one or import a JSON file."}</td></tr>`;
  $("bxProvCount").textContent = `${rows.length} of ${B.providers.length} shown`;
}
function renderProviders(){
  const P = $("bp-providers"), cols = PROVIDER_FIELDS.filter(f => f.table);
  const sel = (id, label, all, opts, v) => `<select id="${id}" aria-label="${esc(label)}"><option value="all">${esc(all)}</option>${opts.map(([k, l]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  P.innerHTML = `<div class="card">
    <div class="cardhead"><h2>Logistics providers</h2><span class="faint" style="font-size:12px" id="bxProvCount"></span></div>
    <p class="muted bcard-lead">Freight forwarders, 3PLs, carriers and distributors who get the standard test order package. Generating a report for a provider on Test Order and Report sets its status to Test order sent and fills the date.</p>
    <div class="mdbar">
      <input type="search" id="bxQ" placeholder="Search name, contact, email, notes" value="${esc(B.ui.q)}" aria-label="Search providers">
      ${sel("bxFStatus", "Filter by status", "All statuses", STATUSES, B.ui.status)}
      ${sel("bxFType", "Filter by type", "All types", PROVIDER_TYPES, B.ui.type)}
      ${sel("bxFRegion", "Filter by region", "All regions", REGIONS.map(r => [r, r]), B.ui.region)}
      <span class="sp"></span>
      <button type="button" class="btn" data-a="add">Add logistics provider</button>
      <button type="button" class="btn ghost" data-a="export">Export providers</button>
      <label class="btn ghost filebtn">Import providers<input type="file" id="bxImport" accept=".json,application/json" aria-label="Import providers from JSON"></label>
    </div>
    <div class="tablewrap mdgrid"><table><thead><tr>${cols.map(f => `<th>${esc(f.label)}</th>`).join("")}<th><span class="faint">Actions</span></th></tr></thead><tbody id="bxProvBody"></tbody></table></div>
    <p class="faint bnote">Export providers writes a JSON file with every field. Import it on another machine or after clearing the browser. Import adds new providers, updates providers with the same ID and skips duplicates (same name and email).</p>
  </div>`;
  renderProvTable();
  $("bxQ").addEventListener("input", e => { B.ui.q = e.target.value; renderProvTable(); });
  [["bxFStatus", "status"], ["bxFType", "type"], ["bxFRegion", "region"]].forEach(([id, k]) => $(id).addEventListener("change", e => { B.ui[k] = e.target.value; renderProvTable(); }));
  P.querySelector('[data-a="add"]').addEventListener("click", () => openProviderForm(null));
  P.querySelector('[data-a="export"]').addEventListener("click", exportProviders);
  $("bxImport").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importProviders(f); });
  $("bxProvBody").addEventListener("click", e => {
    const b = e.target.closest("button[data-a]"); if (!b) return;
    const id = b.closest("tr").dataset.id;
    if (b.dataset.a === "edit") openProviderForm(id);
    if (b.dataset.a === "del") {
      const p = B.providers.find(x => x.id === id); if (!p) return;
      if (b.dataset.armed !== "1") {
        b.dataset.armed = "1"; b.textContent = "Confirm delete"; b.classList.remove("ghost"); toast(`Click Confirm delete to remove ${p.name}`);
        setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Delete"; b.classList.add("ghost"); } }, 4000);
        return;
      }
      B.providers = B.providers.filter(x => x.id !== id); B.ui.sel.delete(id);
      save("providers", B.providers, `${p.name} deleted`); renderTabs(); renderChips(); renderProvTable();
    }
  });
}
function fieldHtml(f, v, pre){
  const id = pre + f.key, req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : "", cls = `fld${f.full ? " full" : ""}`;
  if (f.type === "multi") {
    const vals = new Set(v || []);
    let last = null, inner = "";
    optsOf(f).forEach(([k, l]) => {
      if (f.groupBy) { const g = f.groupBy(k); if (g !== last) { inner += `<span class="grp">${esc(g)}</span>`; last = g; } }
      inner += `<label><input type="checkbox" name="${f.key}" value="${esc(k)}"${vals.has(k) ? " checked" : ""}>${esc(l)}</label>`;
    });
    return `<div class="${cls}" data-k="${f.key}"><span class="flab" id="${id}_l">${esc(f.label)}${req}</span><div class="mchecks" role="group" aria-labelledby="${id}_l">${inner}</div><span class="err"></span></div>`;
  }
  let input;
  if (f.type === "select") input = `<select id="${id}" name="${f.key}">${f.required || f.default ? "" : '<option value="">Not set</option>'}${optsOf(f).map(([k, l]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  else if (f.type === "textarea") input = `<textarea id="${id}" name="${f.key}">${esc(v ?? "")}</textarea>`;
  else input = `<input type="${f.type === "email" ? "email" : f.type === "tel" ? "tel" : f.type === "url" ? "url" : f.type === "date" ? "date" : "text"}" id="${id}" name="${f.key}" value="${esc(v ?? "")}"${f.required ? ' aria-required="true"' : ""}${f.type === "email" ? ' autocomplete="off"' : ""}>`;
  return `<div class="${cls}" data-k="${f.key}"><label for="${id}">${esc(f.label)}${req}</label>${input}<span class="err"></span></div>`;
}
function readForm(form, fields){
  const o = {};
  fields.forEach(f => {
    if (f.type === "multi") o[f.key] = [...form.querySelectorAll(`input[name="${f.key}"]:checked`)].map(i => i.value);
    else { const el = form.elements[f.key]; o[f.key] = el ? String(el.value).trim() : ""; }
  });
  return o;
}
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
function validateProvider(o, selfId){
  const err = {};
  PROVIDER_FIELDS.forEach(f => { if (f.required && (f.type === "multi" ? !o[f.key].length : !o[f.key])) err[f.key] = `${f.label} is required.`; });
  if (o.email && !EMAIL_RE.test(o.email)) err.email = "Enter a valid email address, for example name@company.com.";
  if (o.website && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(o.website)) err.website = "Enter a web address such as www.company.com.";
  if (o.test_sent && !C.parseDate(o.test_sent)) err.test_sent = "Enter a valid date.";
  const dup = B.providers.find(p => p.id !== selfId && norm(p.name) === norm(o.name) && String(p.email || "").toLowerCase() === String(o.email || "").toLowerCase());
  if (dup && o.name && o.email) err._dup = `A provider with this name and email already exists: ${dup.name}.`;
  return err;
}
function openProviderForm(id){
  const dlg = $("bxDlg"), p = id ? B.providers.find(x => x.id === id) : null;
  const vals = p ? clone(p) : Object.fromEntries(PROVIDER_FIELDS.map(f => [f.key, f.type === "multi" ? [] : (f.default || "")]));
  dlg.innerHTML = `<form class="bform" novalidate>
    <div class="dhead"><div><span class="eyebrow">Logistics provider</span><h2>${p ? "Edit " + esc(p.name) : "Add logistics provider"}</h2></div><button type="button" class="btn ghost" data-a="cancel">Close</button></div>
    <div class="fbody">${PROVIDER_FIELDS.map(f => fieldHtml(f, vals[f.key], "bxf_")).join("")}</div>
    <div class="dfoot"><span class="ferr" id="bxFormErr" role="alert"></span><button type="button" class="btn ghost" data-a="cancel">Cancel</button><button type="submit" class="btn">${p ? "Save changes" : "Add provider"}</button></div>
  </form>`;
  const form = dlg.querySelector("form");
  dlg.querySelectorAll('[data-a="cancel"]').forEach(b => b.addEventListener("click", () => dlg.close()));
  // Ticking a region ticks its countries when none of them is ticked yet.
  form.querySelectorAll('input[name="regions"]').forEach(cb => cb.addEventListener("change", () => {
    if (!cb.checked) return;
    const boxes = [...form.querySelectorAll('input[name="countries"]')].filter(i => regionOf(i.value) === cb.value);
    if (!boxes.some(i => i.checked)) boxes.forEach(i => { i.checked = true; });
  }));
  form.addEventListener("input", e => { const f = e.target.closest(".fld.bad"); if (f) { f.classList.remove("bad"); f.querySelector(".err").textContent = ""; } });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const o = readForm(form, PROVIDER_FIELDS), err = validateProvider(o, p ? p.id : null);
    form.querySelectorAll(".fld").forEach(el => { const m = err[el.dataset.k]; el.classList.toggle("bad", !!m); el.querySelector(".err").textContent = m || ""; });
    $("bxFormErr").textContent = err._dup || (Object.keys(err).length ? "Check the marked fields." : "");
    if (Object.keys(err).length) { const first = form.querySelector(".fld.bad input, .fld.bad select, .fld.bad textarea"); if (first) first.focus(); return; }
    const now = new Date().toISOString();
    if (p) Object.assign(p, o, {updated: now, dummy: p.dummy && norm(p.name) === norm(o.name) && p.email === o.email});
    else B.providers.unshift(Object.assign({id: uid("LP")}, o, {created: now, updated: now, dummy: false}));
    dlg.close();
    await save("providers", B.providers, p ? "Provider updated" : "Provider added");
    renderTabs(); renderChips(); renderProvTable();
  });
  dlg.showModal();
  const first = form.querySelector("input,select"); if (first) first.focus();
}
function exportProviders(){
  const out = {format: "flexitog-benchmark-providers", version: 1, exported: new Date().toISOString(), fields: PROVIDER_FIELDS.map(f => f.key), providers: B.providers};
  saveFile(`FlexiTog_logistics_providers_${today()}.json`, JSON.stringify(out, null, 2));
}
function normProvider(r){
  const o = {id: r.id ? String(r.id) : uid("LP"), created: r.created || new Date().toISOString(), updated: r.updated || new Date().toISOString(), dummy: !!r.dummy};
  PROVIDER_FIELDS.forEach(f => {
    const v = r[f.key];
    if (f.type === "multi") o[f.key] = Array.isArray(v) ? v.map(String) : isBlank(v) ? [] : String(v).split(/[;,|]/).map(s => s.trim()).filter(Boolean);
    else o[f.key] = isBlank(v) ? (f.default || "") : String(v).trim();
  });
  Object.keys(r).forEach(k => { if (!(k in o) && !k.startsWith("_")) o[k] = r[k]; });   // keep fields added later
  return o;
}
async function importProviders(file){
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast("This file is not valid JSON", "bad"); return; }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.providers) ? data.providers : null;
  if (!list) { toast("No providers found in this file", "bad"); return; }
  let added = 0, updated = 0, skipped = 0, invalid = 0;
  list.forEach(r => {
    if (!r || typeof r !== "object") { invalid++; return; }
    const o = normProvider(r);
    if (!o.name || !o.email) { invalid++; return; }
    const same = B.providers.findIndex(p => p.id === o.id);
    if (same >= 0) { B.providers[same] = o; updated++; return; }
    if (B.providers.some(p => norm(p.name) === norm(o.name) && String(p.email).toLowerCase() === o.email.toLowerCase())) { skipped++; return; }
    B.providers.push(o); added++;
  });
  await save("providers", B.providers);
  toast(`Imported ${added} new, updated ${updated}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}${invalid ? `, ${invalid} without name or email` : ""}`);
  renderTabs(); renderChips(); renderProvTable();
}

// ============================================================ 2. sales data and analysis
function srcList(){
  const reps = Object.fromEntries((B.clean ? B.clean.reports : []).map(r => [r.id, r.report]));
  const item = (id, name, sub, on, removable) => {
    const r = reps[id];
    return `<li class="${on ? "" : "off"}" data-id="${esc(id)}"><label class="toggle" style="align-items:center"><input type="checkbox" data-a="toggle"${on ? " checked" : ""}><span><b>${esc(name)}</b><small>${esc(sub)}</small></span></label>
      <span class="sp"></span>${r ? `<span class="num faint">${fmt(r.rows_kept)} lines · ${fmt(r.orders)} orders · ${esc(r.date_from || "")} to ${esc(r.date_to || "")}</span>` : ""}
      ${removable ? `<button type="button" class="btn ghost sm" data-a="remove">Remove</button>` : ""}</li>`;
  };
  const builtinRows = (MD.t.sales_history || []).length;
  return `<ul class="srclist">${item("builtin", "Sales history (master data)", `${fmt(builtinRows)} rows from Master data > Sales history${builtinDummy() ? ", placeholder data" : ""}. Upload real history there or add files below.`, B.settings.builtin, false)}
    ${B.sources.map(s => item(s.id, s.name, `${s.file}${s.sheet && s.sheet !== s.file ? " · " + s.sheet : ""} · ${fmt(s.rows.length)} rows · default currency ${s.currency} · added ${String(s.added || "").slice(0, 10)}`, s.enabled, true)).join("")}</ul>`;
}
function qualityHtml(){
  if (!B.clean) return "";
  const reps = B.clean.reports.map(r => r.report);
  const tot = k => reps.reduce((a, r) => a + (r[k] || 0), 0);
  const dropped = {}; reps.forEach(r => Object.entries(r.dropped).forEach(([k, v]) => { dropped[k] = (dropped[k] || 0) + v; }));
  const missing = {}; reps.forEach(r => Object.entries(r.missing).forEach(([k, v]) => { missing[k] = (missing[k] || 0) + v; }));
  const from = reps.map(r => r.date_from).filter(Boolean).sort()[0], to = reps.map(r => r.date_to).filter(Boolean).sort().pop();
  const loaded = tot("rows_loaded"), outside = B.clean.all.length - B.clean.lines.length;
  const unk = tot("unknown_currency");
  return `<div class="card"><div class="cardhead"><h2>Data quality</h2><span class="faint" style="font-size:12px">All active sources together</span></div>
    <div class="bstat">
      <div><b>${fmt(loaded)}</b><span>rows loaded</span></div><div><b>${fmt(B.clean.lines.length)}</b><span>lines in the analysis</span></div>
      <div><b>${fmt(tot("rows_dropped"))}</b><span>rows dropped</span></div><div><b>${fmt(tot("duplicates"))}</b><span>duplicate rows removed</span></div>
      <div><b>${fmt(outside)}</b><span>lines outside the target countries${B.settings.scope === "target" ? " (left out)" : " (included)"}</span></div>
      <div><b>${esc(from || "n/a")}</b><span>first order date</span></div><div><b>${esc(to || "n/a")}</b><span>last order date</span></div>
      <div><b>${fmt(new Set(B.clean.lines.map(l => l.order_key)).size)}</b><span>orders</span></div>
    </div>
    <div class="bgrid2">
      <div><h3 style="margin-bottom:6px">Rows dropped and why</h3>${Object.keys(dropped).length ? `<div class="tablewrap"><table><thead><tr><th>Reason</th><th>Rows</th></tr></thead><tbody>${Object.entries(dropped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${fmt(v)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No rows dropped.</p>`}
        ${unk ? `<p class="warnc" style="margin-top:8px;font-size:13px">${fmt(unk)} rows have a currency without an exchange rate. They count at rate 1. Add the rate under Exchange rates.</p>` : ""}
        <p class="faint bnote" style="margin-top:8px">A row is dropped without an order date, order number, quantity above zero or destination country. Duplicates are rows with the same source, order, SKU, quantity, date, value and customer.</p></div>
      <div><h3 style="margin-bottom:6px">Missing values per column</h3><div class="tablewrap btable" style="max-height:300px"><table><thead><tr><th>Column</th><th>Missing</th><th>Share</th></tr></thead><tbody>
        ${C.SALES_FIELDS.map(f => `<tr><td>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</td><td class="n">${fmt(missing[f.key] || 0)}</td><td class="n">${loaded ? pct((missing[f.key] || 0) / loaded) : "n/a"}</td></tr>`).join("")}</tbody></table></div>
        <p class="faint bnote" style="margin-top:6px">Description, category and brand come from Master data > Products when the export has a SKU only.</p></div>
    </div>
    ${B.clean.reports.length > 1 ? `<div class="tablewrap"><table><thead><tr><th>Source</th><th>Rows loaded</th><th>Kept</th><th>Dropped</th><th>Duplicates</th><th>From</th><th>To</th></tr></thead><tbody>${B.clean.reports.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${fmt(r.report.rows_loaded)}</td><td class="n">${fmt(r.report.rows_kept)}</td><td class="n">${fmt(r.report.rows_dropped)}</td><td class="n">${fmt(r.report.duplicates)}</td><td class="num">${esc(r.report.date_from || "")}</td><td class="num">${esc(r.report.date_to || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}
  </div>`;
}
const yearColor = (pal, ys, y) => pal.q[Math.max(0, 5 - (ys.length - ys.indexOf(y)))];
const metricVal = (c, m) => (m === "orders" ? c.orders : m === "value" ? c.value : c.units);
const metricName = m => ({orders: "Orders", units: "Units", value: "Value (EUR)"})[m];
function segHtml(id, opts, v){ return `<div class="seg" id="${id}">${opts.map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${v === k}">${esc(l)}</button>`).join("")}</div>`; }
function analysisHtml(){
  const A = B.analysis, pal = PAL.screen, mon = A.monthly, ys = mon.years, M = B.ui.metric;
  // 1. per month and year
  const s1 = lineChart({label: `${metricName(M)} per month and year`, labels: C.MONTHS, series: ys.map(y => ({name: String(y), color: yearColor(pal, ys, y), values: mon.months[y].map(c => (c.orders ? metricVal(c, M) : null))})),
    fmt: v => sfmt(v), yLabel: metricName(M)});
  const t1 = `<table><thead><tr><th>Year</th>${C.MONTHS.map(m => `<th>${m}</th>`).join("")}<th>Total</th><th>Months</th><th>vs previous year</th></tr></thead><tbody>${ys.map((y, i) => {
    const tot = metricVal(mon.totals[y], M), prev = i ? metricVal(mon.totals[ys[i - 1]], M) : null;
    const comparable = i && mon.totals[y].months === 12 && mon.totals[ys[i - 1]].months === 12;
    return `<tr><td class="num"><span class="rdot" style="background:${yearColor(pal, ys, y)}"></span>${y}</td>${mon.months[y].map(c => `<td class="n">${c.orders ? fmt(metricVal(c, M)) : ""}</td>`).join("")}<td class="n"><b>${fmt(tot)}</b></td><td class="n">${mon.totals[y].months}</td><td class="n">${prev ? (comparable ? "" : "~") + pct(tot / prev - 1) : ""}</td></tr>`;
  }).join("")}</tbody></table>`;
  // 2. seasonality
  const se = A.seasonality, regs = REGIONS.filter(r => se.groups[r]);
  const s2 = lineChart({label: "Seasonality index per month", labels: C.MONTHS, ref: 100, fmt: v => Math.round(v),
    series: [{name: "All regions", color: pal.ink, width: 3, values: se.overall.index}].concat(regs.map(r => ({name: r, color: regionColor(pal, r), values: se.groups[r].index}))), tip: v => Math.round(v)});
  const t2 = `<table><thead><tr><th>Index (average month = 100)</th>${C.MONTHS.map(m => `<th>${m}</th>`).join("")}</tr></thead><tbody>${[["All regions", se.overall]].concat(regs.map(r => [r, se.groups[r]])).map(([n, g]) =>
    `<tr><td>${n === "All regions" ? "<b>All regions</b>" : `<span class="rdot r-${rc(n)}"></span>${esc(n)}`}</td>${g.index.map(v => `<td class="n">${v == null ? "" : Math.round(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  // 3. volume by dimension
  const D = B.ui.dim, vol = {region: A.regions, country: A.countries, customer: A.customers, category: A.categories}[D];
  const keyLabel = k => (D === "country" ? CNAME(k) : D === "category" ? catLabel(k) : k);
  const s3 = barsH({label: "Units by " + D, items: vol.slice(0, 15).map(v => ({label: keyLabel(v.key), value: v.units, color: D === "category" ? pal.accent : regionColor(pal, v.region), text: `${sfmt(v.units)} · ${pct(v.unit_share)}`}))});
  const t3 = `<table><thead><tr><th>${esc({region: "Region", country: "Country", customer: "Customer", category: "Garment category"}[D])}</th>${D !== "region" && D !== "category" ? "<th>Region</th>" : ""}<th>Orders</th><th>Units</th><th>Unit share</th><th>Value EUR</th><th>Value share</th></tr></thead><tbody>${vol.map(v =>
    `<tr><td>${esc(keyLabel(v.key))}</td>${D !== "region" && D !== "category" ? `<td><span class="rdot r-${rc(v.region)}"></span>${esc(v.region)}</td>` : ""}<td class="n">${fmt(v.orders)}</td><td class="n">${fmt(v.units)}</td><td class="n">${pct(v.unit_share)}</td><td class="n">${fmt(v.value)}</td><td class="n">${pct(v.value_share)}</td></tr>`).join("")}</tbody></table>`;
  // 4. order profile
  const P = A.profile;
  const s4 = barsV({label: "Orders by order size in units", labels: P.size_distribution.map(b => b.label), series: [{name: "Orders", color: pal.q[3], values: P.size_distribution.map(b => b.orders)}], yLabel: "Orders", fmt: v => sfmt(v), h: 230});
  const prow = (n, p) => `<tr><td>${n}</td><td class="n">${fmt(p.orders)}</td><td class="n">${fmt(p.customers)}</td><td class="n">${fmt(p.avg_units)}</td><td class="n">${fmt(p.median_units)}</td><td class="n">${fmt(p.avg_value)}</td><td class="n">${fmt(p.median_value)}</td><td class="n">${fmt(p.avg_lines, 1)}</td><td class="n">${fmt(p.orders_per_customer_year, 1)}</td></tr>`;
  const t4 = `<table><thead><tr><th></th><th>Orders</th><th>Customers</th><th>Avg units</th><th>Median units</th><th>Avg value EUR</th><th>Median value EUR</th><th>Avg lines</th><th>Orders per customer per year</th></tr></thead><tbody>${prow("<b>All regions</b>", P.overall)}${REGIONS.filter(r => P.regions[r]).map(r => prow(`<span class="rdot r-${rc(r)}"></span>${esc(r)}`, P.regions[r])).join("")}</tbody></table>`;
  // 5. top customers per region
  const tops = REGIONS.filter(r => A.top[r]);
  const s5 = barsH({label: "Top customers per region by share of region units", labelW: 210, items: tops.flatMap(r => A.top[r].map(c => ({label: `${c.key}`, value: c.region_share, color: regionColor(pal, r), text: `${pct(c.region_share)} of ${r}`})))});
  const t5 = `<table><thead><tr><th>Region</th><th>#</th><th>Customer</th><th>Orders</th><th>Units</th><th>Share of region</th><th>Value EUR</th><th>Peak months</th></tr></thead><tbody>${tops.map(r => A.top[r].map((c, i) =>
    `<tr><td><span class="rdot r-${rc(r)}"></span>${esc(r)}</td><td class="n">${i + 1}</td><td>${esc(c.key)}</td><td class="n">${fmt(c.orders)}</td><td class="n">${fmt(c.units)}</td><td class="n">${pct(c.region_share)}</td><td class="n">${fmt(c.value)}</td><td>${c.peak_months.map(m => C.MONTHS[m]).join(", ")}</td></tr>`).join("")).join("")}</tbody></table>`;
  // 6. peak and low months
  const pk = A.peaks, prs = REGIONS.filter(r => pk.regions[r]);
  const heat = `<table class="heat"><thead><tr><th></th>${C.MONTHS.map(m => `<th>${m}</th>`).join("")}</tr></thead><tbody>${[["All regions", pk.overall]].concat(prs.map(r => [r, pk.regions[r]])).map(([n, g]) => {
    const mx = Math.max(...g.index.filter(v => v != null), 1);
    return `<tr><td>${n === "All regions" ? "<b>All regions</b>" : `<span class="rdot r-${rc(n)}"></span>${esc(n)}`}</td>${g.index.map((v, i) => `<td class="h" style="background:${v == null ? "transparent" : `color-mix(in srgb,var(--q3) ${Math.round(8 + 80 * v / mx)}%,transparent)`};${v != null && v / mx > .6 ? "color:#fff;" : ""}${g.peak.includes(i) ? "font-weight:700;" : ""}" title="${esc(n)} ${C.MONTHS_LONG[i]}: index ${v == null ? "no data" : Math.round(v)}">${v == null ? "" : Math.round(v)}</td>`).join("")}</tr>`;
  }).join("")}</tbody></table>`;
  const t6 = `<table><thead><tr><th>Region</th><th>Peak months</th><th>Low months</th><th>Busiest 3 months in a row</th><th>Share of yearly volume</th></tr></thead><tbody>${[["All regions", pk.overall]].concat(prs.map(r => [r, pk.regions[r]])).map(([n, g]) =>
    `<tr><td>${n === "All regions" ? "<b>All regions</b>" : `<span class="rdot r-${rc(n)}"></span>${esc(n)}`}</td><td>${g.peak.map(i => C.MONTHS[i]).join(", ")}</td><td>${g.low.map(i => C.MONTHS[i]).join(", ")}</td><td>${C.MONTHS_LONG[g.window.months[0]]} to ${C.MONTHS_LONG[g.window.months[2]]}</td><td class="n">${pct(g.window.share)}</td></tr>`).join("")}</tbody></table>`;
  const regLegend = legendHtml(regs.map(r => ({name: r, color: regionColor(pal, r)})));
  const card = (h, note, ctl, chart, legend, table) => `<div class="card"><div class="cardhead"><h2>${h}</h2>${ctl || ""}</div>${note ? `<p class="faint bnote">${note}</p>` : ""}${legend || ""}<div class="bchart">${chart}</div><div class="tablewrap btable">${table}</div></div>`;
  return `<div class="card"><div class="cardhead"><h2>Findings</h2><span class="faint" style="font-size:12px">Written from the numbers below</span></div><ul class="bfind">${A.findings.map(f => `<li>${esc(f)}</li>`).join("")}</ul></div>` +
    card("Orders, units and value per month and year", "Year over year compares full years. ~ marks a comparison with a part year.", segHtml("bxMetric", [["orders", "Orders"], ["units", "Units"], ["value", "Value"]], M), s1, legendHtml(ys.map(y => ({name: String(y), color: yearColor(pal, ys, y)}))), t1) +
    card("Seasonality index per month", "Units per calendar month, averaged over the years that cover the month. 100 = an average month. Above 100 is busier than average.", "", s2, legendHtml([{name: "All regions", color: pal.ink}].concat(regs.map(r => ({name: r, color: regionColor(pal, r)})))), t2) +
    card("Volume by region, country, customer and garment category", "Units, top 15 in the chart. The table lists all.", segHtml("bxDim", [["region", "Region"], ["country", "Country"], ["customer", "Customer"], ["category", "Garment category"]], D), s3, D === "category" ? "" : regLegend, t3) +
    card("Order profile", "Order size in units per order, lines per order and how often a customer orders.", "", s4, "", t4) +
    card("Top customers per region", "Five largest customers per region by units, with the months they order most. Customer names stay on screen: exports use codes.", "", s5, regLegend, t5) +
    `<div class="card"><div class="cardhead"><h2>Peak and low months per region</h2></div><p class="faint bnote">Seasonality index per month. Darker = busier. Bold = the three peak months.</p><div class="tablewrap">${heat}</div><div class="tablewrap btable">${t6}</div></div>`;
}
function renderSales(){
  const P = $("bp-sales"), cur = Object.keys(B.settings.fx);
  P.innerHTML = `<div class="card">
    <div class="cardhead"><h2>Sales data sources</h2><div class="ctl"><div class="seg" id="bxScope">${[["target", "Target countries only"], ["all", "All countries"]].map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${B.settings.scope === k}">${l}</button>`).join("")}</div></div></div>
    <p class="muted bcard-lead">The analysis and the test orders run on every ticked source. Add exports from each merged entity as CSV or Excel. You map the columns once per file. Target countries: ${TARGETS.map(CNAME).join(", ")}.</p>
    ${srcList()}
    <label class="drop" id="bxDrop"><span><b>Add sales files</b><br><span class="muted">CSV or Excel, one or more files, several years. Drop them here or click to choose.</span></span><input type="file" id="bxFiles" multiple accept=".csv,.txt,.xlsx,.xlsm,.xls" aria-label="Choose sales files"></label>
    <div id="bxUpload"></div>
    <details class="custom"><summary><b>Exchange rates</b><span class="faint">EUR per unit of currency. Placeholder rates: replace them with the rates finance uses.</span></summary>
      <div class="fx">${cur.map(c => `<label>${esc(c)}<input type="number" step="any" min="0" data-fx="${esc(c)}" value="${esc(B.settings.fx[c])}"${c === "EUR" ? " disabled" : ""}></label>`).join("")}</div>
      <div class="iact"><input type="text" id="bxFxNew" placeholder="Code, e.g. JOD" maxlength="3" style="width:110px;background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:5px 8px"><button type="button" class="btn ghost sm" id="bxFxAdd">Add currency</button><button type="button" class="btn ghost sm" id="bxFxReset">Reset rates</button></div>
    </details>
  </div>
  ${qualityHtml()}
  ${B.analysis ? analysisHtml() : `<div class="empty-state">No sales lines in the selection. Tick a source, add files, or switch to All countries.</div>`}`;
  bindSales(P);
  renderUpload();
}
function bindSales(P){
  $("bxScope").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; B.settings.scope = b.dataset.v; saveSettingsSoon(); recompute(); render(); });
  P.querySelector(".srclist").addEventListener("change", e => {
    const li = e.target.closest("li"); if (!li || e.target.dataset.a !== "toggle") return;
    if (li.dataset.id === "builtin") { B.settings.builtin = e.target.checked; saveSettingsSoon(); }
    else { const s = B.sources.find(x => x.id === li.dataset.id); s.enabled = e.target.checked; saveSourceMeta(); }
    recompute(); render();
  });
  P.querySelector(".srclist").addEventListener("click", async e => {
    const b = e.target.closest('button[data-a="remove"]'); if (!b) return;
    const id = b.closest("li").dataset.id, s = B.sources.find(x => x.id === id);
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirm remove"; b.classList.remove("ghost"); setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Remove"; b.classList.add("ghost"); } }, 4000); return; }
    B.sources = B.sources.filter(x => x.id !== id);
    try { await BS.del("sales_" + id); } catch (err) {}
    await saveSourceMeta(); toast(`${s ? s.name : "Source"} removed`); recompute(); render();
  });
  const drop = $("bxDrop"), files = $("bxFiles");
  files.addEventListener("change", () => { const fs = [...files.files]; files.value = ""; if (fs.length) startUpload(fs); });
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => { const fs = [...(e.dataTransfer ? e.dataTransfer.files : [])]; if (fs.length) startUpload(fs); });
  P.querySelectorAll("[data-fx]").forEach(inp => inp.addEventListener("change", () => { const v = Number(inp.value); if (v > 0) { B.settings.fx[inp.dataset.fx] = v; saveSettingsSoon(); recompute(); render(); } }));
  $("bxFxAdd").addEventListener("click", () => { const c = $("bxFxNew").value.trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) { toast("Enter a three-letter currency code", "bad"); return; } if (!(c in B.settings.fx)) B.settings.fx[c] = 1; saveSettingsSoon(); render(); });
  $("bxFxReset").addEventListener("click", () => { B.settings.fx = clone(DEFAULT_FX); saveSettingsSoon(); recompute(); render(); });
  const seg = (id, k) => { const el = $(id); if (el) el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; B.ui[k] = b.dataset.v; const y = window.scrollY; renderSales(); window.scrollTo({top: y}); }); };
  seg("bxMetric", "metric"); seg("bxDim", "dim");
}
async function saveSourceMeta(){ return save("salesmeta", B.sources.map(s => ({id: s.id, name: s.name, file: s.file, sheet: s.sheet, currency: s.currency, enabled: s.enabled, mapping: s.mapping, added: s.added, rows: s.rows.length}))); }

// ---- upload wizard: one file at a time, sheet, column mapping, preview, check
async function startUpload(files){
  B.upload = {queue: files, idx: 0};
  await loadUploadFile();
}
async function loadUploadFile(){
  const U = B.upload; if (!U) return;
  const file = U.queue[U.idx];
  try {
    const book = await readFile(file);
    let best = book.names[0], bs = -1;
    book.names.forEach(n => { const sh = book.sheets[n] || [], h = C.headerRow(sh); const sc = Object.keys(C.guessMapping((sh[h] || []).map(c => (c == null ? "" : String(c))))).length; if (sc > bs) { bs = sc; best = n; } });
    Object.assign(U, {file, book, error: null, name: file.name.replace(/\.[^.]+$/, ""), currency: "EUR"});
    setSheet(best);
  } catch (e) { Object.assign(U, {file, book: null, error: e.message || "Could not read this file."}); }
  renderUpload();
}
function setSheet(name){
  const U = B.upload, sh = U.book.sheets[name] || [], h = C.headerRow(sh);
  U.sheet = name; U.head = h; U.headers = (sh[h] || []).map(c => (c == null ? "" : String(c).trim()));
  U.body = sh.slice(h + 1); U.map = C.guessMapping(U.headers);
}
function uploadRaw(){
  const U = B.upload;
  return C.applyMapping(U.body, U.map);
}
function renderUpload(){
  const el = $("bxUpload"), U = B.upload; if (!el) return;
  if (!U) { el.innerHTML = ""; return; }
  const of = U.queue.length > 1 ? ` (file ${U.idx + 1} of ${U.queue.length})` : "";
  if (U.error || !U.book) {
    el.innerHTML = `<div class="upcard"><div class="uph"><h3>${esc(U.file ? U.file.name : "File")}${of}</h3><button type="button" class="iclose" data-u="cancel" aria-label="Close upload">×</button></div><p class="warnc">${esc(U.error || "Could not read this file.")}</p><div class="iact"><button type="button" class="btn ghost" data-u="skip">Skip this file</button></div></div>`;
  } else {
    const raw = uploadRaw();
    const res = C.cleanSales(raw, {source: "preview", defaultCurrency: U.currency, fx: B.settings.fx, skuInfo: skuInfo(), regionOf, countryOf: v => (isBlank(v) ? null : toIso2(v))});
    const missReq = C.SALES_FIELDS.filter(f => f.required && !(f.key in U.map));
    const inTarget = res.lines.filter(l => REGIONS.includes(l.region)).length;
    el.innerHTML = `<div class="upcard"><div class="uph"><h3>Map columns: ${esc(U.file.name)}${of}</h3><button type="button" class="iclose" data-u="cancel" aria-label="Close upload">×</button></div>
      <div class="optgrid">
        ${U.book.names.length > 1 ? `<div class="ctl"><label for="bxSheet">Sheet</label><select id="bxSheet">${U.book.names.map(n => `<option${n === U.sheet ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></div>` : ""}
        <div class="ctl"><label for="bxSrcName">Source name (entity)</label><input type="text" class="wide" id="bxSrcName" value="${esc(U.name)}"></div>
        <div class="ctl"><label for="bxSrcCur">Currency when the file has none</label><select id="bxSrcCur">${Object.keys(B.settings.fx).map(c => `<option${c === U.currency ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        <span class="faint bnote">Header found on row ${U.head + 1}. ${fmt(U.body.length)} data rows.</span>
      </div>
      <div class="mapgrid">${C.SALES_FIELDS.map(f => `<div class="fld${f.required && !(f.key in U.map) ? " miss" : ""}"><label for="bxm_${f.key}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</label><select id="bxm_${f.key}" data-map="${f.key}"><option value="">${f.required ? "Choose a column" : "Not in file"}</option>${U.headers.map((h, i) => h ? `<option value="${i}"${U.map[f.key] === i ? " selected" : ""}>${esc(h)}</option>` : "").join("")}</select></div>`).join("")}</div>
      <div class="upgrid">
        <div><h4>Preview after mapping</h4><div class="tablewrap"><table><thead><tr>${C.SALES_FIELDS.filter(f => f.key in U.map).map(f => `<th>${esc(f.label)}</th>`).join("")}</tr></thead><tbody>${raw.slice(0, 6).map(r => `<tr>${C.SALES_FIELDS.filter(f => f.key in U.map).map(f => `<td>${esc(r[f.key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
        <div><h4>Check</h4><ul class="checks">
          <li class="${missReq.length ? "no" : "ok"}">${missReq.length ? "Map the required columns: " + esc(missReq.map(f => f.label).join(", ")) : "All required columns mapped"}</li>
          <li class="${res.lines.length ? "ok" : "no"}">${fmt(res.lines.length)} of ${fmt(raw.length)} rows usable${res.report.duplicates ? `, ${fmt(res.report.duplicates)} duplicates` : ""}</li>
          ${Object.entries(res.report.dropped).map(([k, v]) => `<li class="no">${fmt(v)} rows dropped: ${esc(k)}</li>`).join("")}
          <li class="${inTarget ? "ok" : "no"}">${fmt(inTarget)} lines in the target countries</li>
          ${res.report.unknown_currency ? `<li class="no">${fmt(res.report.unknown_currency)} rows in a currency without exchange rate</li>` : ""}
          <li class="ok">Dates ${esc(res.report.date_from || "n/a")} to ${esc(res.report.date_to || "n/a")}</li>
        </ul>
        <div class="iact"><button type="button" class="btn" data-u="add"${missReq.length || !res.lines.length ? " disabled" : ""}>Add to analysis</button><button type="button" class="btn ghost" data-u="skip">Skip this file</button></div></div>
      </div></div>`;
    const sheet = $("bxSheet"); if (sheet) sheet.addEventListener("change", () => { setSheet(sheet.value); renderUpload(); });
    $("bxSrcName").addEventListener("input", e => { U.name = e.target.value; });
    $("bxSrcCur").addEventListener("change", e => { U.currency = e.target.value; renderUpload(); });
    el.querySelectorAll("[data-map]").forEach(s => s.addEventListener("change", () => {
      const k = s.dataset.map;
      if (s.value === "") delete U.map[k]; else { const i = Number(s.value); Object.keys(U.map).forEach(o => { if (U.map[o] === i) delete U.map[o]; }); U.map[k] = i; }
      renderUpload();
    }));
  }
  el.querySelectorAll("[data-u]").forEach(b => b.addEventListener("click", () => uploadAction(b.dataset.u)));
}
async function uploadAction(a){
  const U = B.upload;
  if (a === "cancel") { B.upload = null; renderUpload(); return; }
  if (a === "add") {
    const raw = uploadRaw();
    const src = {id: uid("S"), name: (U.name || U.file.name).trim(), file: U.file.name, sheet: U.sheet, currency: U.currency, enabled: true, mapping: Object.fromEntries(Object.entries(U.map).map(([k, i]) => [k, U.headers[i]])),
      added: new Date().toISOString(), rows: raw.map(r => FIELD_KEYS.map(k => (r[k] === undefined ? null : r[k] instanceof Date ? r[k].toISOString() : r[k])))};
    const ok = await save("sales_" + src.id, src.rows);
    if (!ok) return;
    B.sources.push(src); await saveSourceMeta();
    toast(`${src.name}: ${fmt(src.rows.length)} rows added`);
  }
  if (U.idx + 1 < U.queue.length) { U.idx++; recompute(); await loadUploadFile(); renderSalesKeepUpload(); return; }
  B.upload = null; recompute(); render();
}
function renderSalesKeepUpload(){ const y = window.scrollY; render(); window.scrollTo({top: y}); }

// ============================================================ 3. service goals
function renderGoals(){
  const P = $("bp-goals");
  const cell = (f, g, i) => {
    const v = g[f.key];
    if (f.type === "textarea") return `<textarea data-i="${i}" data-f="${f.key}" aria-label="${esc(f.label)}">${esc(v ?? "")}</textarea>`;
    if (f.type === "select") return `<select data-i="${i}" data-f="${f.key}" aria-label="${esc(f.label)}">${optsOf(f).map(([k, l]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    if (f.type === "multi") return `<div class="mchecks" role="group" aria-label="${esc(f.label)}">${optsOf(f).map(([k, l]) => `<label><input type="checkbox" data-i="${i}" data-f="${f.key}" value="${esc(k)}"${(v || []).includes(k) ? " checked" : ""}>${esc(l)}</label>`).join("")}</div>`;
    return `<input type="text" data-i="${i}" data-f="${f.key}" value="${esc(v ?? "")}" aria-label="${esc(f.label)}"${f.required ? ' aria-required="true"' : ""}>`;
  };
  P.innerHTML = `<div class="card">
    <div class="cardhead"><h2>Service goals</h2><span class="faint" style="font-size:12px">${B.goals.length} goals · ${B.goals.filter(g => g.priority === "mandatory").length} mandatory · saved as you type</span></div>
    <p class="muted bcard-lead">Every provider reports against these goals in the response template: meets goal yes, no or partly, with a comment. They go into the report with their targets.</p>
    <div class="tablewrap mdgrid gtable"><table><thead><tr><th>ID</th>${GOAL_FIELDS.map(f => `<th>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</th>`).join("")}<th></th></tr></thead>
      <tbody>${B.goals.map((g, i) => `<tr><td class="rn">${esc(g.id)}</td>${GOAL_FIELDS.map(f => `<td>${cell(f, g, i)}</td>`).join("")}<td><button type="button" class="del" data-del="${i}" aria-label="Delete goal ${esc(g.id)}" title="Delete goal">×</button></td></tr>`).join("") ||
        `<tr><td colspan="${GOAL_FIELDS.length + 2}" class="empty">No goals. Add one or reset to the defaults.</td></tr>`}</tbody></table></div>
    <div class="iact"><button type="button" class="btn" id="bxGoalAdd">Add goal</button><button type="button" class="btn ghost" id="bxGoalReset">Reset to defaults</button></div>
  </div>`;
  P.querySelector("tbody").addEventListener("input", e => {
    const t = e.target, i = Number(t.dataset.i), f = t.dataset.f; if (!f || !B.goals[i]) return;
    if (t.type === "checkbox") B.goals[i][f] = [...P.querySelectorAll(`input[type=checkbox][data-i="${i}"][data-f="${f}"]:checked`)].map(x => x.value);
    else B.goals[i][f] = t.value;
    saveGoalsSoon();
  });
  P.querySelector("tbody").addEventListener("change", e => { if (e.target.tagName === "SELECT") { const i = Number(e.target.dataset.i); B.goals[i][e.target.dataset.f] = e.target.value; saveGoalsSoon(); renderGoalsCount(); } });
  P.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Delete?"; b.style.fontSize = "12px"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "×"; b.style.fontSize = ""; } }, 4000); return; }
    B.goals.splice(Number(b.dataset.del), 1); save("goals", B.goals, "Goal deleted"); renderGoals(); renderTabs();
  }));
  $("bxGoalAdd").addEventListener("click", () => {
    const n = Math.max(0, ...B.goals.map(g => Number(String(g.id).replace(/\D/g, "")) || 0)) + 1;
    B.goals.push({id: "G" + String(n).padStart(2, "0"), name: "New goal", description: "", target: "", unit: "", priority: "preferred", regions: []});
    save("goals", B.goals); renderGoals(); renderTabs();
    const inp = P.querySelector(`input[data-i="${B.goals.length - 1}"][data-f="name"]`); if (inp) { inp.focus(); inp.select(); }
  });
  $("bxGoalReset").addEventListener("click", e => {
    const b = e.currentTarget;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirm reset"; toast("Click Confirm reset to replace all goals with the seven defaults"); setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Reset to defaults"; } }, 4000); return; }
    B.goals = clone(DEFAULT_GOALS); save("goals", B.goals, "Goals reset"); renderGoals(); renderTabs();
  });
}
function renderGoalsCount(){ const s = $("bp-goals").querySelector(".cardhead span"); if (s) s.textContent = `${B.goals.length} goals · ${B.goals.filter(g => g.priority === "mandatory").length} mandatory · saved as you type`; }

// ============================================================ 4. test orders and report
const lineText = (t, mode) => (mode === "category"
  ? Object.entries(t.lines.reduce((a, l) => { a[l.category] = (a[l.category] || 0) + l.quantity; return a; }, {})).map(([c, q]) => `${catLabel(c)} ${fmt(q)}`).join(", ")
  : t.lines.map(l => `${l.sku || catLabel(l.category)}${l.description ? " " + l.description : ""} x ${fmt(l.quantity)}`).join("; "));
const place = t => (t.city && t.port && t.city !== t.port ? `${t.city} / ${t.port}` : t.city || t.port || "");
function hashStr(s){ let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6); }
function packageOf(t){
  const g = B.settings.gen;
  const id = "FTB-" + today().replace(/-/g, "") + "-" + hashStr(JSON.stringify([t.seed, t.base_years, t.scale.toFixed(4), t.orders.map(o => [o.id, o.country, o.units])]));
  return {id, created: today(), seed: t.seed, base_years: t.base_years, scale: t.scale, mode: g.mode, show_values: g.showValues, line_detail: g.lineDetail,
    orders: t.orders, lanes: t.lanes, goals: B.goals.map(x => x.id)};
}
// Stored snapshot: never real customer names or source order numbers.
const packageSnapshot = pkg => ({id: pkg.id, created: pkg.created, seed: pkg.seed, base_years: pkg.base_years, scale: pkg.scale, mode: pkg.mode, goals: pkg.goals,
  orders: pkg.orders.map(o => ({id: o.id, month: o.month, country: o.country, region: o.region, port: place(o), customer: o.customer, lines: o.lines.length, units: o.units, cartons: o.cartons, pallets: o.pallets, weight_kg: o.weight_kg, volume_m3: o.volume_m3, value_eur: o.value_eur})),
  lanes: pkg.lanes.map(l => ({lane_id: l.lane_id, country: l.country, region: l.region, orders: l.orders, pallets: l.pallets, weight_kg: l.weight_kg})), sent: []});
function checkHtml(t){
  const c = t.check, pal = PAL.screen;
  const tr = (n, k, f) => `<tr><td>${n}</td><td class="n">${f(c.totals[k].history)}</td><td class="n">${f(c.totals[k].test)}</td><td class="n">${c.totals[k].diff >= 0 ? "+" : ""}${(c.totals[k].diff * 100).toFixed(1)}%</td></tr>`;
  const share = (h, s, lab) => `<table><thead><tr><th></th><th>History</th><th>Test set</th><th>Difference</th></tr></thead><tbody>${[...new Set(Object.keys(h).concat(Object.keys(s)))].sort((a, b) => (h[b] || 0) - (h[a] || 0)).map(k => `<tr><td>${esc(lab(k))}</td><td class="n">${pct(h[k] || 0)}</td><td class="n">${pct(s[k] || 0)}</td><td class="n">${(((s[k] || 0) - (h[k] || 0)) * 100).toFixed(1)} pp</td></tr>`).join("")}</tbody></table>`;
  const chart = barsV({label: "Share of orders per month: history and test set", labels: C.MONTHS, series: [{name: "History", color: pal.q[1], values: c.months.history.map(v => v * 100)}, {name: "Test set", color: pal.accent, values: c.months.test.map(v => v * 100)}], fmt: v => Math.round(v) + "%", tip: v => v.toFixed(1) + "%", yLabel: "% of orders", h: 220});
  return `<div class="card"><div class="cardhead"><h2>Representative check</h2><span class="okb ${c.ok ? "yes" : "no"}">${c.ok ? "Representative" : "Check the deviations"}</span></div>
    <p class="faint bnote">History per year = the base years scaled to 12 months, times the volume factor (${t.scale.toFixed(2)}). The test set passes when the monthly shape is within 3 points, the region and category mix within 5 points and units within 15 percent.${t.orders.length < 60 ? " A small test set follows the shape less closely: raise the scale factor or the revenue target." : ""}</p>
    <div class="bgrid2"><div class="tablewrap"><table><thead><tr><th>Per year</th><th>History x factor</th><th>Test set</th><th>Difference</th></tr></thead><tbody>${tr("Orders", "orders", v => fmt(v))}${tr("Order lines", "lines", v => fmt(v))}${tr("Units", "units", v => fmt(v))}${tr("Value EUR", "value", v => fmt(v))}</tbody></table></div>
      <div>${legendHtml([{name: "History", color: pal.q[1], sq: true}, {name: "Test set", color: pal.accent, sq: true}])}<div class="bchart">${chart}</div><p class="faint bnote">Largest monthly gap: ${(c.months.max_dev * 100).toFixed(1)} points.</p></div></div>
    <div class="bgrid2"><div><h3 style="margin-bottom:6px">Region mix (units) · max gap ${(c.regions.max_dev * 100).toFixed(1)} pp</h3><div class="tablewrap">${share(c.regions.history, c.regions.test, k => k)}</div></div>
      <div><h3 style="margin-bottom:6px">Garment category mix (units) · max gap ${(c.categories.max_dev * 100).toFixed(1)} pp</h3><div class="tablewrap">${share(c.categories.history, c.categories.test, catLabel)}</div></div></div>
  </div>`;
}
function renderTest(){
  const P = $("bp-test");
  if (!B.clean || !B.clean.lines.length) { P.innerHTML = `<div class="empty-state">No sales lines to build test orders from. Add or tick a source on Sales Data and Analysis.</div>`; return; }
  const t = currentTest(), g = B.settings.gen, ys = years(), rep = B.settings.report, pal = PAL.screen;
  const baseSel = (g.baseYears || []).filter(y => ys.includes(y));
  const usdEur = Number(g.targetUsd) * (Number(B.settings.fx.USD) || 1);
  const vals = g.showValues;
  const monthly = C.MONTHS.map((_, i) => REGIONS.map(r => t.orders.filter(o => o.month === i + 1 && o.region === r).length));
  const chart = barsV({label: "Test orders per month by region", labels: C.MONTHS, stacked: true, series: REGIONS.map((r, k) => ({name: r, color: regionColor(pal, r), values: monthly.map(m => m[k])})), yLabel: "Test orders", h: 220});
  P.innerHTML = `<div class="card">
    <div class="cardhead"><h2>Test order set</h2><span class="faint" style="font-size:12px">12 months · ${fmt(t.orders.length)} orders · seed ${esc(t.seed)}</span></div>
    <p class="muted bcard-lead">Orders drawn from the sales history month by month with a fixed random seed. Each test order copies a real order's country, garment and size mix. Customers become codes per region, largest first. The same options and seed always give the same set.</p>
    <div class="optgrid">
      <div class="ctl"><label>Base years</label><div class="checks" style="flex-direction:row;flex-wrap:wrap;gap:4px 12px;margin:0">${ys.map(y => `<label class="toggle" style="align-items:center"><input type="checkbox" data-year="${y}"${!baseSel.length || baseSel.includes(y) ? " checked" : ""}>${y}</label>`).join("")}</div></div>
      <div class="ctl"><label>Volume</label>${segHtml("bxMode", [["factor", "Scale factor"], ["target", "Yearly revenue target"]], g.mode)}</div>
      ${g.mode === "factor" ? `<div class="ctl"><label for="bxScale">Scale factor</label><input type="number" id="bxScale" min="0.05" max="20" step="0.05" value="${esc(g.scale)}"></div>`
        : `<div class="ctl"><label for="bxTarget">Revenue target USD per year</label><input type="number" id="bxTarget" min="10000" step="10000" value="${esc(g.targetUsd)}"></div><span class="faint bnote">= EUR ${fmt(usdEur)} at ${B.settings.fx.USD} EUR/USD · history EUR ${fmt(t.hist.value)} per year · factor ${t.scale.toFixed(2)}</span>`}
      <div class="ctl"><label for="bxSeed">Random seed</label><div style="display:flex;gap:6px"><input type="number" id="bxSeed" step="1" value="${esc(g.seed)}" style="width:110px"><button type="button" class="btn ghost sm" id="bxNewSeed">New seed</button></div></div>
      <div class="ctl"><label for="bxDetail">Order lines as</label><select id="bxDetail"><option value="sku"${g.lineDetail === "sku" ? " selected" : ""}>SKU and description</option><option value="category"${g.lineDetail === "category" ? " selected" : ""}>Garment category only</option></select></div>
      <label class="toggle"><input type="checkbox" id="bxVals"${vals ? " checked" : ""}><span>Include order values<small>Declared value per order, for customs and insurance</small></span></label>
    </div>
  </div>
  ${checkHtml(t)}
  <div class="card"><div class="cardhead"><h2>Volume profile</h2></div>${legendHtml(REGIONS.map(r => ({name: r, color: regionColor(pal, r), sq: true})))}<div class="bchart">${chart}</div>
    <div class="tablewrap btable"><table><thead><tr><th>Lane</th><th>Destination</th><th>Ports / cities</th><th>Orders per year</th><th>Pallets</th><th>Cartons</th><th>Weight kg</th><th>Volume m3</th><th>Peak month</th></tr></thead><tbody>${t.lanes.map(l => `<tr><td class="num">${esc(l.lane_id)}</td><td><span class="rdot r-${rc(l.region)}"></span>${esc(CNAME(l.country))}</td><td>${esc(l.ports)}</td><td class="n">${fmt(l.orders)}</td><td class="n">${fmt(l.pallets)}</td><td class="n">${fmt(l.cartons)}</td><td class="n">${fmt(l.weight_kg)}</td><td class="n">${fmt(l.volume_m3, 1)}</td><td>${esc(l.peak_month)}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="card"><div class="cardhead"><h2>Test orders</h2><label class="toggle" style="font-size:12.5px"><input type="checkbox" id="bxReal"${B.ui.showReal ? " checked" : ""}><span>Show source customer and order<small>On screen only. Never exported.</small></span></label></div>
    <p class="faint bnote">Cartons, pallets, weight and volume are estimates from the product master (unit weight, units per pallet) or packing defaults per garment category: 60 x 40 x 40 cm carton, ${C.PACKING.cartons_per_pallet} cartons per EUR pallet.</p>
    <div class="tablewrap btable" style="max-height:520px"><table><thead><tr><th>Order ID</th><th>Month</th><th>Destination</th><th>City / port</th><th>Region</th><th>Customer</th>${B.ui.showReal ? "<th>Source</th>" : ""}<th>Lines</th><th>Units</th><th>Cartons</th><th>Pallets</th><th>Weight kg</th><th>Volume m3</th>${vals ? "<th>Value EUR</th>" : ""}</tr></thead>
      <tbody>${t.orders.map(o => `<tr><td class="num">${o.id}</td><td>${C.MONTHS[o.month - 1]}</td><td>${esc(CNAME(o.country))}</td><td>${esc(place(o))}</td><td><span class="rdot r-${rc(o.region)}"></span>${esc(o.region)}</td><td class="num">${esc(o.customer)}</td>${B.ui.showReal ? `<td class="faint">${esc(o.customer_real)} · ${esc(o.source_order)}</td>` : ""}<td class="lines">${esc(lineText(o, g.lineDetail))}</td><td class="n">${fmt(o.units)}</td><td class="n">${fmt(o.cartons)}</td><td class="n">${fmt(o.pallets)}</td><td class="n">${fmt(o.weight_kg)}</td><td class="n">${fmt(o.volume_m3, 2)}</td>${vals ? `<td class="n">${fmt(o.value_eur)}</td>` : ""}</tr>`).join("")}
      <tr class="sum"><td colspan="${B.ui.showReal ? 8 : 7}">Total, ${fmt(t.orders.length)} orders</td><td class="n">${fmt(t.orders.reduce((a, o) => a + o.units, 0))}</td><td class="n">${fmt(t.orders.reduce((a, o) => a + o.cartons, 0))}</td><td class="n">${fmt(t.orders.reduce((a, o) => a + o.pallets, 0))}</td><td class="n">${fmt(t.orders.reduce((a, o) => a + o.weight_kg, 0))}</td><td class="n">${fmt(t.orders.reduce((a, o) => a + o.volume_m3, 0), 1)}</td>${vals ? `<td class="n">${fmt(t.orders.reduce((a, o) => a + o.value_eur, 0))}</td>` : ""}</tr></tbody></table></div>
  </div>
  <div class="card"><div class="cardhead"><h2>Benchmarking report</h2><span class="faint" style="font-size:12px">PDF and Word report, Excel response template</span></div>
    <p class="muted bcard-lead">One report per ticked provider, or a generic version without a provider name. The report covers the purpose, instructions, origin Helmond, the yearly volume profile and seasonality, every test order, the service goals and the response deadline. Customer names, margins, purchase prices and supplier costs never appear in the files.</p>
    <div class="bgrid2">
      <div class="fld"><span class="flab">Report for</span><div class="bprov" id="bxProvSel">
        <label><input type="checkbox" value="generic"${B.ui.sel.has("generic") ? " checked" : ""}><span><b>Generic version</b> <span class="faint">no provider name</span></span></label>
        ${B.providers.map(p => `<label><input type="checkbox" value="${esc(p.id)}"${B.ui.sel.has(p.id) ? " checked" : ""}><span>${esc(p.name)} <span class="st ${esc(p.status)}">${esc(optLabel(PROVIDER_FIELDS.find(f => f.key === "status"), p.status))}</span>${p.test_sent ? ` <span class="faint num">sent ${esc(p.test_sent)}</span>` : ""}</span></label>`).join("")}
      </div></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="optgrid">
          <div class="ctl"><label for="bxDeadline">Response deadline</label><input type="date" id="bxDeadline" value="${esc(rep.deadline)}"></div>
          <div class="ctl"><label for="bxCName">FlexiTog EU contact person</label><input type="text" class="wide" id="bxCName" value="${esc(rep.contact_name)}" placeholder="Name"></div>
          <div class="ctl"><label for="bxCRole">Role</label><input type="text" class="wide" id="bxCRole" value="${esc(rep.contact_role)}"></div>
          <div class="ctl"><label for="bxCEmail">Email</label><input type="email" class="wide" id="bxCEmail" value="${esc(rep.contact_email)}" placeholder="name@company.com"></div>
          <div class="ctl"><label for="bxCPhone">Phone</label><input type="text" class="wide" id="bxCPhone" value="${esc(rep.contact_phone)}"></div>
        </div>
        <div class="checks" style="flex-direction:row;flex-wrap:wrap;gap:6px 16px;margin:0" id="bxFormats">
          ${[["pdf", "PDF report"], ["docx", "Word report (.docx)"], ["xlsx", "Excel response template"]].map(([k, l]) => `<label class="toggle" style="align-items:center"><input type="checkbox" value="${k}"${B.ui.formats[k] ? " checked" : ""}>${l}</label>`).join("")}
        </div>
        <div class="iact"><button type="button" class="btn" id="bxGen"${B.ui.busy ? " disabled" : ""}>${B.ui.busy ? "Generating…" : "Generate report files"}</button><span class="faint bnote" id="bxGenNote">${rep.contact_name && rep.contact_email ? "" : "Fill in the contact person and email: they go on the report."}</span></div>
      </div>
    </div>
    ${B.packages.length ? `<details class="custom"><summary><b>Packages sent</b><span class="faint">${B.packages.length} saved · the response template carries the package ID</span></summary><div class="tablewrap"><table><thead><tr><th>Package</th><th>Created</th><th>Orders</th><th>Seed</th><th>Factor</th><th>Sent to</th></tr></thead><tbody>${B.packages.slice().reverse().map(k => `<tr><td class="num">${esc(k.id)}</td><td class="num">${esc(k.created)}</td><td class="n">${fmt(k.orders.length)}</td><td class="n">${esc(k.seed)}</td><td class="n">${Number(k.scale).toFixed(2)}</td><td>${esc((k.sent || []).map(s => `${s.provider_name || "Generic"} (${s.date})`).join(", "))}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
  </div>`;
  bindTest(P);
}
function bindTest(P){
  const g = B.settings.gen, re = () => { saveSettingsSoon(); const y = window.scrollY; render(); window.scrollTo({top: y}); };
  P.querySelectorAll("[data-year]").forEach(cb => cb.addEventListener("change", () => {
    const sel = [...P.querySelectorAll("[data-year]:checked")].map(x => Number(x.dataset.year));
    g.baseYears = sel.length === years().length ? [] : sel;
    if (!sel.length) { toast("Pick at least one base year. All years are used now."); g.baseYears = []; }
    re();
  }));
  $("bxMode").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; g.mode = b.dataset.v; re(); });
  const num = (id, k, min) => { const el = $(id); if (el) el.addEventListener("change", () => { const v = Number(el.value); if (v >= min) { g[k] = v; re(); } else toast("Enter a number above " + min, "bad"); }); };
  num("bxScale", "scale", 0.05); num("bxTarget", "targetUsd", 1000); num("bxSeed", "seed", 1);
  $("bxNewSeed").addEventListener("click", () => { g.seed = 1 + Math.floor(Math.random() * 99999); re(); });
  $("bxDetail").addEventListener("change", e => { g.lineDetail = e.target.value; re(); });
  $("bxVals").addEventListener("change", e => { g.showValues = e.target.checked; re(); });
  $("bxReal").addEventListener("change", e => { B.ui.showReal = e.target.checked; const y = window.scrollY; render(); window.scrollTo({top: y}); });
  $("bxProvSel").addEventListener("change", e => { if (e.target.checked) B.ui.sel.add(e.target.value); else B.ui.sel.delete(e.target.value); });
  $("bxFormats").addEventListener("change", e => { B.ui.formats[e.target.value] = e.target.checked; });
  [["bxDeadline", "deadline"], ["bxCName", "contact_name"], ["bxCRole", "contact_role"], ["bxCEmail", "contact_email"], ["bxCPhone", "contact_phone"]].forEach(([id, k]) =>
    $(id).addEventListener("input", e => { B.settings.report[k] = e.target.value.trim(); saveSettingsSoon(); const n = $("bxGenNote"); if (n) n.textContent = B.settings.report.contact_name && B.settings.report.contact_email ? "" : "Fill in the contact person and email: they go on the report."; }));
  $("bxGen").addEventListener("click", generateFiles);
}

// ---- report content, shared by the PDF and Word builders
function reportModel(prov, pkg, charts){
  const rep = B.settings.report, vals = pkg.show_values, n = pkg.orders.length, by = k => pkg.orders.reduce((a, o) => a + o[k], 0);
  const provName = prov ? prov.name : "Generic version";
  const contact = [rep.contact_name || "[contact person]", rep.contact_role, "FlexiTog EU"].filter(Boolean).join(", ");
  const reach = [rep.contact_email || "[email]", rep.contact_phone].filter(Boolean).join(" · ");
  const regionRows = REGIONS.map(r => { const os = pkg.orders.filter(o => o.region === r); if (!os.length) return null; const s = k => os.reduce((a, o) => a + o[k], 0);
    const m = Array(12).fill(0); os.forEach(o => { m[o.month - 1]++; });
    return [r, fmt(os.length), fmt(os.reduce((a, o) => a + o.lines.length, 0)), fmt(s("units")), fmt(s("cartons")), fmt(s("pallets")), fmt(s("weight_kg")), fmt(s("volume_m3"), 1)].concat(vals ? [fmt(s("value_eur"))] : []).concat([C.MONTHS_LONG[m.indexOf(Math.max(...m))]]); }).filter(Boolean);
  const total = ["Total", fmt(n), fmt(pkg.orders.reduce((a, o) => a + o.lines.length, 0)), fmt(by("units")), fmt(by("cartons")), fmt(by("pallets")), fmt(by("weight_kg")), fmt(by("volume_m3"), 1)].concat(vals ? [fmt(by("value_eur"))] : []).concat([""]);
  const monthRows = C.MONTHS_LONG.map((mn, i) => { const os = pkg.orders.filter(o => o.month === i + 1); const s = k => os.reduce((a, o) => a + o[k], 0);
    return [mn].concat(REGIONS.map(r => fmt(os.filter(o => o.region === r).length))).concat([fmt(os.length), fmt(s("units")), fmt(s("pallets")), fmt(s("weight_kg"))]); });
  const orderHead = ["Order", "Month", "Destination", "City / port", "Customer", pkg.line_detail === "category" ? "Garments" : "Lines (SKU, description, quantity)", "Units", "Cartons", "Pallets", "Weight kg", "Volume m3"].concat(vals ? ["Value EUR"] : []);
  const orderRows = pkg.orders.map(o => [o.id, C.MONTHS[o.month - 1], `${CNAME(o.country)} (${rc(o.region)})`, place(o), o.customer, lineText(o, pkg.line_detail), fmt(o.units), fmt(o.cartons), fmt(o.pallets), fmt(o.weight_kg), fmt(o.volume_m3, 2)].concat(vals ? [fmt(o.value_eur)] : []));
  const goals = B.goals.map(x => [x.id, x.name, x.description || "", [x.target, x.unit].filter(s => !isBlank(s)).join(" "), x.priority === "mandatory" ? "Mandatory" : "Preferred", (x.regions || []).length ? x.regions.join(", ") : "All regions"]);
  const R = (h, ...cols) => ({head: h, align: cols});
  return {
    title: "Logistics benchmark: standard test order package", provider: provName, pkg: pkg.id,
    cover: [["Prepared for", provName], ["Date", longDate(today())], ["Package", pkg.id], ["Test orders", `${fmt(n)} orders over 12 months`], ["Response deadline", rep.deadline ? longDate(rep.deadline) : "[deadline]"], ["Contact", contact]],
    confidential: "Confidential. This package is shared for quotation purposes only. Customer names are replaced by codes. Please do not pass it on.",
    footer: `FlexiTog EU · Logistics benchmark · ${pkg.id}${prov ? " · " + provName : ""}`,
    sections: [
      {h: "1. Introduction", blocks: [
        {p: "FlexiTog EU, based in Helmond, the Netherlands, supplies cold-store and freezer workwear to customers in Türkiye, North Africa and the Gulf/GCC. We are reviewing how we deliver to these markets. We invite a small number of logistics providers to quote on one standard test order package."},
        {p: `The package holds ${fmt(n)} test orders spread over 12 months. It follows the seasonality, country mix, garment mix, order sizes and order frequency of our sales history. Every provider receives the same package, so we compare the offers like for like.`},
        {p: "Customers are replaced by codes such as Customer GCC-01. One code is one consignee, so repeat deliveries to the same customer stay visible."},
        {h3: "How to respond"},
        {list: [
          "Apply the test orders to your own network: transport mode, routing, consolidation and any stock you hold in the region.",
          "Quote per test order or per lane in the attached Excel template. Keep the sheet names and column headers as they are: we import the file automatically.",
          "Give the transit time and the total lead time from collection in Helmond to delivery at the customer, in days.",
          "List every cost: freight, fuel surcharge, customs clearance, warehousing and other surcharges. Name any cost the customer pays at delivery.",
          "Score each service goal in section 5: meets goal yes, no or partly, with a comment.",
          `Return the completed template to the contact in section 6 before ${rep.deadline ? longDate(rep.deadline) : "the deadline"}.`]},
      ]},
      {h: "2. Origin", blocks: [
        {p: "All shipments start at the FlexiTog EU warehouse in Helmond, the Netherlands. Goods are packed in export cartons on EUR pallets (120 x 80 cm) and ready for collection on the order date."},
        {p: "Quote from collection in Helmond to delivery at the customer's address or the named port or city. Offer the incoterm you propose (for example DAP or DDP) per order or lane."},
        {p: `Cartons, pallets, gross weight and volume are estimates from our packing standards: export carton 60 x 40 x 40 cm (0.096 m3), up to ${C.PACKING.cartons_per_pallet} cartons per pallet.`},
      ]},
      {h: "3. Yearly volume profile and seasonality", blocks: [
        {table: Object.assign(R(["Region", "Orders", "Lines", "Units", "Cartons", "Pallets", "Weight kg", "Volume m3"].concat(vals ? ["Value EUR"] : []).concat(["Peak month"]), "l", "r", "r", "r", "r", "r", "r", "r", ...(vals ? ["r"] : []), "l"), {body: regionRows.concat([total]), bold_last: true})},
        charts.orders ? {img: charts.orders, caption: "Test orders per month by region"} : {p: "Chart not available in this copy."},
        charts.season ? {img: charts.season, caption: "Seasonality index from the sales history (average month = 100)"} : null,
        {table: Object.assign(R(["Month"].concat(REGIONS).concat(["All orders", "Units", "Pallets", "Weight kg"]), "l", "r", "r", "r", "r", "r", "r", "r"), {body: monthRows})},
        {h3: "Lanes from Helmond"},
        {table: Object.assign(R(["Lane", "Destination", "Ports / cities", "Orders", "Pallets", "Weight kg", "Volume m3", "Peak month"], "l", "l", "l", "r", "r", "r", "r", "l"), {body: pkg.lanes.map(l => [l.lane_id, CNAME(l.country), l.ports, fmt(l.orders), fmt(l.pallets), fmt(l.weight_kg), fmt(l.volume_m3, 1), l.peak_month])})},
      ].filter(Boolean)},
      {h: "4. Test orders", blocks: [
        {p: `${fmt(n)} orders, sorted by month. Order IDs match the rows in the Excel template.${vals ? " Values are declared values in EUR, for customs and insurance." : ""}`},
        {table: Object.assign(R(orderHead, "l", "l", "l", "l", "l", "l", "r", "r", "r", "r", "r", "r"), {body: orderRows, small: true, widths: vals ? [14, 11, 19, 20, 18, 41, 11, 13, 12, 12, 12, 14] : [14, 11, 20, 22, 19, 48, 12, 13, 12, 12, 12]})},
      ]},
      {h: "5. Service goals", blocks: [
        {p: "Please state for each goal whether your offer meets it. Mandatory goals weigh most in our comparison."},
        {table: Object.assign(R(["ID", "Goal", "Description", "Target", "Priority", "Regions"], "l", "l", "l", "l", "l", "l"), {body: goals, widths: [10, 34, 70, 26, 18, 22]})},
      ]},
      {h: "6. Response", blocks: [
        {p: `Please return the completed Excel template by ${rep.deadline ? longDate(rep.deadline) : "[deadline]"}.`},
        {p: `Contact: ${contact}. ${reach}.`},
        {p: `Quote package ${pkg.id} in your reply. Questions are welcome before the deadline. Quotes should stay valid for at least 90 days.`},
      ]},
    ],
  };
}
const PDF_MAP = {"ı": "i", "İ": "I", "ş": "s", "Ş": "S", "ğ": "g", "Ğ": "G", "→": "->", "≤": "<=", "≥": ">=", "−": "-", "\u202f": " ", "\u2009": " ", "…": "..."};
const sanitizePdf = s => String(s ?? "").replace(/[^\x00-\xff€–—‘’“”•]/g, ch => PDF_MAP[ch] ?? "?");
async function buildPdf(m){
  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({unit: "mm", format: "a4", compress: true});
  const T = sanitizePdf, ACC = [31, 58, 85], INK = [20, 33, 44], MUT = [86, 99, 111], H = 297, L = 15, Wd = 180;
  const autoTable = o => { if (typeof window.autoTable === "function") window.autoTable(doc, o); else doc.autoTable(o); return doc.lastAutoTable.finalY; };
  doc.setProperties({title: m.title, subject: m.provider, author: "FlexiTog EU", creator: "FlexiTog Route Dashboard"});
  doc.setFillColor(...ACC); doc.rect(0, 0, 210, 82, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(32); doc.text("FlexiTog EU", 20, 40);
  doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.text("Helmond, the Netherlands", 20, 52);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(24);
  let y = 112;
  doc.splitTextToSize(T(m.title), 170).forEach(l => { doc.text(l, 20, y); y += 10; });
  y += 8; doc.setFontSize(11);
  m.cover.forEach(([k, v]) => { doc.setFont("helvetica", "normal"); doc.setTextColor(...MUT); doc.text(T(k), 20, y); doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); const ls = doc.splitTextToSize(T(v), 115); doc.text(ls, 70, y); y += 7 * ls.length + 1; });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUT); doc.text(doc.splitTextToSize(T(m.confidential), 170), 20, 272);
  doc.addPage(); y = 20;
  const need = h => { if (y + h > H - 18) { doc.addPage(); y = 20; } };
  const text = (s, size, bold, color, indent) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...(color || INK)); doc.splitTextToSize(T(s), Wd - (indent || 0)).forEach(l => { need(size * 0.45); doc.text(l, L + (indent || 0), y); y += size * 0.46; }); };
  m.sections.forEach((sec, si) => {
    if (si === 3) { doc.addPage(); y = 20; }
    need(20); y += si && si !== 3 ? 4 : 0;
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...INK); doc.text(T(sec.h), L, y);
    doc.setDrawColor(...INK); doc.setLineWidth(0.6); doc.line(L, y + 2, L + Wd, y + 2); y += 9;
    sec.blocks.forEach(b => {
      if (b.p) { text(b.p, 10); y += 2.5; }
      else if (b.h3) { y += 2; need(12); text(b.h3, 11.5, true); y += 1.5; }
      else if (b.list) { b.list.forEach((s, i) => { doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...INK); const ls = doc.splitTextToSize(T(s), Wd - 8); need(5 * ls.length); doc.text(`${i + 1}.`, L + 1, y); ls.forEach(l => { doc.text(l, L + 7, y); y += 4.6; }); y += 1.2; }); y += 2; }
      else if (b.img) { const h = Wd * b.img.h / b.img.w; need(h + 8); doc.addImage(b.img.url, "PNG", L, y, Wd, h); y += h + 2; if (b.caption) { text(b.caption, 8.5, false, MUT); } y += 4; }
      else if (b.table) {
        const t = b.table, cs = {};
        t.align.forEach((a, i) => { cs[i] = {halign: a === "r" ? "right" : "left"}; });
        if (t.widths) { const sum = t.widths.reduce((a, x) => a + x, 0); t.widths.forEach((w, i) => { cs[i] = Object.assign(cs[i] || {}, {cellWidth: Wd * w / sum}); }); }
        need(14);
        y = autoTable({head: [t.head.map(T)], body: t.body.map(r => r.map(c => T(c))), startY: y, margin: {left: L, right: L, top: 18, bottom: 18}, theme: "grid",
          styles: {font: "helvetica", fontSize: t.small ? 6.8 : 8.2, cellPadding: t.small ? 1 : 1.4, textColor: INK, lineColor: [217, 223, 228], lineWidth: 0.15, overflow: "linebreak"},
          headStyles: {fillColor: ACC, textColor: 255, fontStyle: "bold"}, alternateRowStyles: {fillColor: [247, 249, 250]}, columnStyles: cs,
          didParseCell: d => { if (t.bold_last && d.section === "body" && d.row.index === t.body.length - 1) d.cell.styles.fontStyle = "bold"; }}) + 6;
      }
    });
  });
  const pages = doc.getNumberOfPages();
  for (let i = 2; i <= pages; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUT);
    doc.text(T(m.footer), L, H - 8); doc.text(`Page ${i - 1} of ${pages - 1}`, L + Wd, H - 8, {align: "right"});
  }
  return doc.output("arraybuffer");
}
async function buildDocx(m){
  const D = window.docx, F = "Arial";
  const run = (text, o = {}) => new D.TextRun({text: String(text ?? ""), font: F, size: o.size || 20, bold: !!o.bold, color: o.color || "14212C"});
  const para = (text, o = {}) => new D.Paragraph({spacing: {after: o.after ?? 120}, alignment: o.align, indent: o.indent, children: [run(text, o)]});
  const cell = (text, o = {}) => new D.TableCell({
    children: [new D.Paragraph({alignment: o.right ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT, children: [run(text, {size: o.size, bold: o.head || o.bold, color: o.head ? "FFFFFF" : "14212C"})]})],
    shading: o.head ? {type: D.ShadingType.CLEAR, color: "auto", fill: "1F3A55"} : o.zebra ? {type: D.ShadingType.CLEAR, color: "auto", fill: "F7F9FA"} : undefined,
    margins: {top: 30, bottom: 30, left: 60, right: 60}, width: o.width ? {size: o.width, type: D.WidthType.PERCENTAGE} : undefined});
  const table = t => {
    const size = t.small ? 14 : 16, sum = t.widths ? t.widths.reduce((a, x) => a + x, 0) : 0, wd = i => (t.widths ? Math.round(100 * t.widths[i] / sum) : undefined);
    return new D.Table({width: {size: 100, type: D.WidthType.PERCENTAGE},
      rows: [new D.TableRow({tableHeader: true, children: t.head.map((h, i) => cell(h, {head: true, size, right: t.align[i] === "r", width: wd(i)}))})]
        .concat(t.body.map((r, ri) => new D.TableRow({cantSplit: true, children: r.map((c, i) => cell(c, {size, right: t.align[i] === "r", zebra: ri % 2 === 1, bold: t.bold_last && ri === t.body.length - 1, width: wd(i)}))})))});
  };
  const cover = [new D.Paragraph({spacing: {before: 1800, after: 120}, children: [run("FlexiTog EU", {size: 64, bold: true, color: "1F3A55"})]}), para("Helmond, the Netherlands", {size: 24, color: "56636F", after: 900}),
    new D.Paragraph({spacing: {after: 480}, children: [run(m.title, {size: 44, bold: true})]}),
    new D.Table({width: {size: 100, type: D.WidthType.PERCENTAGE}, borders: D.TableBorders ? D.TableBorders.NONE : undefined,
      rows: m.cover.map(([k, v]) => new D.TableRow({children: [cell(k, {size: 22, width: 28}), cell(v, {size: 22, bold: true, width: 72})]}))}),
    new D.Paragraph({spacing: {before: 1600}, children: [run(m.confidential, {size: 16, color: "56636F"})]})];
  const body = [];
  m.sections.forEach((sec, si) => {
    body.push(new D.Paragraph({heading: D.HeadingLevel.HEADING_1, pageBreakBefore: si === 3, spacing: {before: si ? 320 : 0, after: 140}, keepNext: true,
      border: {bottom: {style: D.BorderStyle.SINGLE, size: 10, color: "14212C", space: 2}}, children: [run(sec.h, {size: 30, bold: true})]}));
    sec.blocks.forEach(b => {
      if (b.p) body.push(para(b.p));
      else if (b.h3) body.push(new D.Paragraph({spacing: {before: 160, after: 80}, keepNext: true, children: [run(b.h3, {size: 22, bold: true})]}));
      else if (b.list) b.list.forEach((s, i) => body.push(new D.Paragraph({spacing: {after: 80}, indent: {left: 400, hanging: 300}, children: [run(`${i + 1}.\t${s}`)], tabStops: [{type: D.TabStopType.LEFT, position: 400}]})));
      else if (b.img) { body.push(new D.Paragraph({spacing: {before: 120, after: 40}, children: [new D.ImageRun({type: "png", data: b.img.bytes, transformation: {width: 620, height: Math.round(620 * b.img.h / b.img.w)}})]})); if (b.caption) body.push(para(b.caption, {size: 16, color: "56636F", after: 200})); }
      else if (b.table) { body.push(table(b.table)); body.push(para("", {after: 160})); }
    });
  });
  const footer = new D.Footer({children: [new D.Paragraph({children: [run(m.footer + " · page ", {size: 16, color: "56636F"}), new D.TextRun({children: [D.PageNumber.CURRENT], font: F, size: 16, color: "56636F"})]})]});
  const doc = new D.Document({creator: "FlexiTog EU", title: m.title, description: `${m.title} · ${m.provider}`,
    styles: {default: {document: {run: {font: F, size: 20}}}},
    sections: [{properties: {page: {margin: {top: 1000, bottom: 1000, left: 1000, right: 1000}}}, children: cover},
               {properties: {page: {margin: {top: 1000, bottom: 1000, left: 900, right: 900}}}, footers: {default: footer}, children: body}]});
  return D.Packer.toBlob(doc);
}
function templateBook(pkg, prov){
  const tpl = C.responseTemplate({id: pkg.id, created: pkg.created, orders: pkg.orders.map(o => Object.assign({}, o, {port: place(o)})), lanes: pkg.lanes}, prov ? {id: prov.id, name: prov.name} : null,
    B.goals.map(g => ({id: g.id, name: g.name, target: g.target, unit: g.unit, priority: g.priority === "mandatory" ? "Mandatory" : "Preferred"})));
  const wb = XLSX.utils.book_new(), add = (name, aoa, cols) => { const ws = XLSX.utils.aoa_to_sheet(aoa); if (cols) ws["!cols"] = cols.map(w => ({wch: w})); XLSX.utils.book_append_sheet(wb, ws, name); };
  const S = tpl.sheets;
  add("Instructions", S["Instructions"].concat([[], [`Package: ${pkg.id}`], [`Prepared for: ${prov ? prov.name : "Generic version"}`], [`Response deadline: ${B.settings.report.deadline || ""}`],
    [`Contact: ${[B.settings.report.contact_name, B.settings.report.contact_email, B.settings.report.contact_phone].filter(Boolean).join(" · ")}`]]), [110]);
  add("Provider", S["Provider"], [30, 50]);
  add("Rates per order", S["Rates per order"], [12, 11, 12, 28, 14, 9, 9, 14, 12, 26, 14, 16, 13, 13, 16, 18, 17, 17, 16, 10, 30]);
  add("Rates per lane", S["Rates per lane"], [12, 14, 12, 28, 12, 12, 16, 12, 26, 14, 16, 13, 13, 16, 18, 17, 17, 16, 10, 30]);
  add("Service goals", S["Service goals"], [9, 44, 10, 26, 20, 26, 50]);
  const vals = pkg.show_values, cat = pkg.line_detail === "category";
  const head = ["Test order ID", "Month", "Destination country", "Region", "Customer", "Garment category"].concat(cat ? [] : ["SKU", "Description"]).concat(["Quantity", "Cartons", "Gross weight (kg)", "Volume (m3)"]).concat(vals ? ["Declared value (EUR)"] : []);
  const rows = [];
  pkg.orders.forEach(o => {
    const ls = cat ? Object.values(o.lines.reduce((a, l) => { const x = a[l.category] || (a[l.category] = {category: l.category, quantity: 0, cartons: 0, weight_kg: 0, volume_m3: 0, value_eur: 0}); ["quantity", "cartons", "weight_kg", "volume_m3", "value_eur"].forEach(k => { x[k] += l[k]; }); return a; }, {})) : o.lines;
    ls.forEach(l => rows.push([o.id, o.month_name, o.country, o.region, o.customer, catLabel(l.category)].concat(cat ? [] : [l.sku, l.description]).concat([l.quantity, l.cartons, Math.round(l.weight_kg * 10) / 10, Math.round(l.volume_m3 * 1000) / 1000]).concat(vals ? [Math.round(l.value_eur * 100) / 100] : [])));
  });
  add("Test order lines", [head].concat(rows), [12, 11, 10, 14, 17, 16].concat(cat ? [] : [14, 30]).concat([10, 9, 14, 12]).concat(vals ? [16] : []));
  add("_meta", S["_meta"].concat([["deadline", B.settings.report.deadline || ""], ["seed", pkg.seed], ["scale", pkg.scale]]), [18, 40]);
  wb.Workbook = {Sheets: wb.SheetNames.map(n => ({name: n, Hidden: n === "_meta" ? 1 : 0}))};
  return wb;
}
async function chartImages(pkg){
  const pal = PAL.print, out = {};
  try {
    const monthly = C.MONTHS.map((_, i) => REGIONS.map(r => pkg.orders.filter(o => o.month === i + 1 && o.region === r).length));
    const s1 = barsV({pal, w: 760, h: 250, stacked: true, legend: true, label: "Test orders per month by region", labels: C.MONTHS, yLabel: "Test orders", series: REGIONS.map((r, k) => ({name: r, color: regionColor(pal, r), values: monthly.map(m => m[k])}))});
    out.orders = await svgToPng(s1, ...svgSize(s1));
    const se = B.analysis.seasonality, regs = REGIONS.filter(r => se.groups[r]);
    const s2 = lineChart({pal, w: 760, h: 240, legend: true, ref: 100, label: "Seasonality index", labels: C.MONTHS, yLabel: "Index", fmt: v => Math.round(v),
      series: [{name: "All regions", color: pal.ink, width: 3, values: se.overall.index}].concat(regs.map(r => ({name: r, color: regionColor(pal, r), values: se.groups[r].index})))});
    out.season = await svgToPng(s2, ...svgSize(s2));
  } catch (e) { /* the report goes out without charts */ }
  return out;
}
async function generateFiles(){
  const t = currentTest(); if (!t || B.ui.busy) return;
  const targets = [...B.ui.sel].map(id => (id === "generic" ? null : B.providers.find(p => p.id === id))).filter(x => x !== undefined);
  const fm = B.ui.formats;
  if (!targets.length) { toast("Tick the generic version or at least one provider", "bad"); return; }
  if (!fm.pdf && !fm.docx && !fm.xlsx) { toast("Tick at least one file format", "bad"); return; }
  if (fm.pdf && !(window.jspdf && window.jspdf.jsPDF)) { toast("PDF export is not available in this copy", "bad"); return; }
  if (fm.docx && !window.docx) { toast("Word export is not available in this copy", "bad"); return; }
  B.ui.busy = true; const btn = $("bxGen"); if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }
  try {
    const pkg = packageOf(t), charts = await chartImages(pkg), date = today();
    for (const prov of targets) {
      const m = reportModel(prov, pkg, charts), base = `FlexiTog_EU_benchmark_${slug(prov ? prov.name : "generic")}_${date}`;
      if (fm.pdf) await saveFile(base + ".pdf", await buildPdf(m));
      if (fm.docx) await saveFile(base + ".docx", await buildDocx(m));
      if (fm.xlsx) await saveFile(base + "_response_template.xlsx", wbBytes(templateBook(pkg, prov)));
      if (prov) { if (["prospect", "contacted", ""].includes(prov.status || "")) prov.status = "test_order_sent"; prov.test_sent = date; prov.updated = new Date().toISOString(); }
    }
    let snap = B.packages.find(k => k.id === pkg.id);
    if (!snap) { snap = packageSnapshot(pkg); B.packages.push(snap); }
    targets.forEach(p => snap.sent.push({provider_id: p ? p.id : "", provider_name: p ? p.name : "", date, formats: Object.keys(fm).filter(k => fm[k])}));
    if (B.packages.length > 30) B.packages = B.packages.slice(-30);
    await save("packages", B.packages);
    if (targets.some(Boolean)) await save("providers", B.providers);
    toast(`Report files ready for ${targets.length} recipient${targets.length > 1 ? "s" : ""}. Package ${pkg.id}`);
  } catch (e) { console.error(e); toast("Generating the report failed: " + (e && e.message ? e.message : e), "bad"); }
  finally { B.ui.busy = false; const y = window.scrollY; render(); window.scrollTo({top: y}); }
}

// ============================================================ start
async function init(){
  await storeReady();
  try {
    const [prov, goals, settings, packages, meta] = await Promise.all(["providers", "goals", "settings", "packages", "salesmeta"].map(n => BS.get(n)));
    if (prov === undefined) { const now = new Date().toISOString(); B.providers = SEED_PROVIDERS.map((p, i) => Object.assign({id: "LP-DUMMY-" + (i + 1)}, p, {created: now, updated: now, dummy: true})); await BS.set("providers", B.providers).catch(() => {}); }
    else B.providers = prov.map(normProvider);
    B.goals = goals === undefined ? clone(DEFAULT_GOALS) : goals;
    if (settings) { const d = DEFAULT_SETTINGS(); B.settings = Object.assign(d, settings, {gen: Object.assign(d.gen, settings.gen || {}), report: Object.assign(d.report, settings.report || {}), fx: Object.assign(d.fx, settings.fx || {})}); }
    B.packages = packages || [];
    B.sources = [];
    for (const s of meta || []) { const rows = await BS.get("sales_" + s.id); if (rows) B.sources.push(Object.assign({}, s, {rows})); }
  } catch (e) { toast("Could not load the saved benchmarking data", "bad"); }
  B.ready = true;
  recompute();
  if (VIEW.current === "bench") render();
}
window.BenchUI = {show(){ render(); }, state: B, schema: {providers: PROVIDER_FIELDS, goals: GOAL_FIELDS}, reportModel, packageOf, templateBook, buildPdf, buildDocx, chartImages, currentTest};
init();
})();
