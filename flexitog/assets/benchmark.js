/* FlexiTog dashboard: Benchmarking view. Logistics providers, sales data and analysis, service
 * goals, the standard test order package and its report (PDF, Word, Excel response template).
 * Runs after workspace.js and shares its globals (STORE, chunks, saveFile, toast, readFile, toIso2,
 * norm, wbBytes, storeErrorText, VIEW, PAYLOAD, MD, REGIONS, regionOf, CNAME, esc, fmt, pct, clone, $).
 * The logic without DOM (cleaning, seasonality, generator, template) is in bench_core.js.
 */
(function () {
"use strict";
const C = window.BenchCore;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const longDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "long", year: "numeric"});
const uid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const rc = r => C.regionCode(r);
const catLabel = k => ({jackets: "Jackets", trousers: "Trousers", coveralls: "Coveralls", other: "Other items"})[k] || k;
const slug = s => String(s || "").normalize("NFKD").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "generic";
// Target countries: Master Data > Countries (target = true), read on every use so an added country shows at once.
const TARGETS = () => targetCountries();
// Exchange rates in EUR per unit. USD always follows Master Data > Settings (eurUsdRate = USD per EUR); the other
// currencies are the editable table under Sales Data and Analysis.
const fx = () => { const r = Number(settingsRow().eur_usd_rate); return Object.assign({}, B.settings.fx, r > 0 ? {USD: 1 / r} : {}); };
const WORLD = (() => {
  const m = new Map();
  (PAYLOAD.geo.basemap.countries || []).forEach(c => { if (c.iso && /^[A-Z]{2}$/.test(c.iso) && !m.has(c.iso)) m.set(c.iso, PAYLOAD.names.countries[c.iso] || c.name); });
  Object.entries(PAYLOAD.names.countries).forEach(([k, v]) => { if (!m.has(k)) m.set(k, v); });
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "en"));
})();

// ============================================================ schemas
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
// EUR per unit of each currency. Placeholder rates: replace with the rates finance uses.
const DEFAULT_FX = {EUR: 1, USD: 0.86, GBP: 1.15, CHF: 1.07, TRY: 0.021, AED: 0.234, SAR: 0.229, QAR: 0.236, KWD: 2.8, BHD: 2.28, OMR: 2.23, MAD: 0.093, DZD: 0.0066, TND: 0.29, EGP: 0.0177, LYD: 0.16};
const DEFAULT_SETTINGS = () => ({
  scope: "target", builtin: true, fx: clone(DEFAULT_FX),
  gen: {baseYears: [], mode: "factor", scale: 1, targetUsd: 2400000, seed: 2026, showValues: true, lineDetail: "sku"},
  report: {deadline: addDays(today(), 21), contact_name: "", contact_role: "Supply chain", contact_email: "", contact_phone: ""},
});
const optsOf = f => (typeof f.options === "function" ? f.options() : f.options || []);
const optLabel = (f, v) => { const o = optsOf(f).find(x => x[0] === v); return o ? o[1] : (v ?? ""); };

// ============================================================ storage: the shared layer in workspace.js (DataStore)
async function save(name, value, okMsg){
  try { const where = await DataStore.set(name, value); if (okMsg) toast(where === "pending" ? `${okMsg}. ${PENDING_NOTE}` : okMsg + (where === "artifact" ? " (saved with the dashboard)" : " (saved in this browser)")); return true; }
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
  providers: [], rfq: {}, goals: [], settings: DEFAULT_SETTINGS(), packages: [], sources: [],
  ui: {psort: null, q: "", status: "all", type: "all", region: "all", metric: "units", dim: "region", showReal: false, sel: new Set(["generic"]), formats: {pdf: true, docx: true, xlsx: true}, busy: false},
  upload: null, clean: null, analysis: null, test: null, testKey: "", stale: {}, mdRef: null, respDirty: false,
};
{ const u = DataStore.pref.get("bench-ui"); if (u && u.tab) B.tab = u.tab; }
const rememberTab = () => DataStore.pref.set("bench-ui", {tab: B.tab});

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
    const res = C.cleanSales(s.raw, {source: s.id, defaultCurrency: s.currency, fx: fx(), skuInfo: info, regionOf,
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
// Test set from the 2027 forecast (Forecast view): one average month, per country the forecast orders / 12,
// each order carrying the country's product class mix at the forecast units and value.
const FC_CAT = {Jackets: "jackets", Trousers: "trousers", Coveralls: "coveralls"};
function forecastTest(){
  const FU = window.ForecastUI;
  if (!FU || !FU.ready()) return null;
  const rows = FU.demandRows(), prof = FU.classProfile(), set = FU.settings(), info = skuInfo();
  const key = "fc|" + JSON.stringify([set.method, set.scenario, rows.length, Math.round(rows.reduce((a, r) => a + r.units + r.revenue, 0)), prof]);
  if (B.test && B.testKey === key) return B.test;
  const by = {};
  rows.forEach(r => { const c = by[r.country] || (by[r.country] = {orders: 0, cls: {}}); c.orders += r.orders;
    const k = c.cls[r.product_class] || (c.cls[r.product_class] = {units: 0, eur: 0}); k.units += r.units; k.eur += r.revenue_eur; });
  const profile = (FU.state.F && FU.state.F.H.profile) || {}, orders = [], seq = {};
  Object.keys(by).sort().forEach(c => {
    const region = regionOf(c); if (!REGIONS.includes(region)) return;
    const n = Math.max(1, Math.round(by[c].orders / 12)), code = C.regionCode(region);
    for (let i = 0; i < n; i++) {
      seq[code] = (seq[code] || 0) + 1;
      const lines = Object.entries(by[c].cls).filter(([, v]) => v.units / 12 / n >= 0.5).map(([k, v]) => {
        const q = Math.max(1, Math.round(v.units / 12 / n)), sku = (prof[k] || {}).sku || "", cat = FC_CAT[k] || "other";
        const pk = C.packLine({sku, category: cat, quantity: q}, info);
        return {sku, description: k, category: cat, brand: "", quantity: q, cartons: pk.cartons, weight_kg: Math.round(pk.weight_kg * 10) / 10,
                volume_m3: Math.round(pk.volume_m3 * 1000) / 1000, pallet_float: pk.pallet_float, value_eur: Math.round(v.eur / 12 / n * 100) / 100};
      });
      if (!lines.length) continue;
      const sumf = f => lines.reduce((a, l) => a + l[f], 0);
      orders.push({month: 1, month_name: "Average month", country: c, region, city: (profile[c] || {}).city || "", port: C.DEFAULT_PORTS[c] || "",
        customer: `Customer ${code}-F${String(seq[code]).padStart(2, "0")}`, customer_real: "forecast", source_order: "average month",
        lines, units: sumf("quantity"), cartons: sumf("cartons"), pallets: Math.max(1, Math.ceil(sumf("pallet_float") - 1e-9)),
        weight_kg: Math.round(sumf("weight_kg") * 10) / 10, volume_m3: Math.round(sumf("volume_m3") * 100) / 100, value_eur: Math.round(sumf("value_eur") * 100) / 100});
    }
  });
  orders.sort((a, b) => REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region) || (a.country < b.country ? -1 : a.country > b.country ? 1 : 0) || b.units - a.units);
  orders.forEach((o, i) => { o.id = `TO-${String(i + 1).padStart(3, "0")}`; });
  const mname = (C.MONTHS && FU.state.F) ? (window.ForecastCore.METHODS.find(m => m[0] === set.method) || [, set.method])[1] : set.method;
  B.test = {orders, lanes: C.lanes(orders), check: null, hist: {value: 0}, scale: 1, base_years: [], seed: 0, kind: "forecast",
    label: `${set.scenario} scenario, ${mname}`, yearly: {orders: rows.reduce((a, r) => a + r.orders, 0), units: rows.reduce((a, r) => a + r.units, 0)}};
  B.testKey = key;
  return B.test;
}
function currentTest(){
  if (B.settings.gen.source === "forecast") return forecastTest();
  if (!B.clean || !B.clean.lines.length) return null;
  const g = B.settings.gen, ys = years();
  const base = (g.baseYears || []).filter(y => ys.includes(y));
  const opts = {baseYears: base.length ? base : null, seed: Number(g.seed) || 1, skuInfo: skuInfo()};
  if (g.mode === "target") opts.targetValueEur = Number(g.targetUsd) * (Number(fx().USD) || 1); else opts.scale = Number(g.scale) > 0 ? Number(g.scale) : 1;
  const key = B.ver + "|" + JSON.stringify([opts.baseYears, opts.seed, opts.scale, opts.targetValueEur]);
  if (B.test && B.testKey === key) return B.test;
  B.test = C.generateTestOrders(B.clean.lines, opts); B.testKey = key;
  return B.test;
}
const isDummy = () => (B.settings.builtin && builtinDummy()) || B.providers.some(p => p.dummy);

// ============================================================ charts (shared helpers in charts.js)
const {PAL, sfmt, lineChart, barsV, barsH, legendHtml, svgToPng, svgSize} = window.FlexCharts;
const regionColor = (pal, r) => pal[rc(r)] || pal.OTH;

// ============================================================ shell, tabs, chips
const TABS = [["providers", "Logistics Providers"], ["quotes", "Quote Benchmark"], ["sales", "Sales Data and Analysis"], ["goals", "Service Goals"], ["test", "Test Order and Report"]];
function renderTabs(){
  const n = {providers: B.providers.length, quotes: FlexiCalc.liveQuotes(MD.t.quotes, {today: today(), months: 0, typeOf: () => null}).length, sales: B.clean ? B.clean.lines.length : 0, goals: B.goals.length, test: B.test ? B.test.orders.length : null};
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
  syncProviders();   // Master Data is the provider list: picked up on every render, no manual sync
  const ref = [MD.t.sales_history, MD.t.products, MD.t.customers];
  if (!B.mdRef || ref.some((r, i) => r !== B.mdRef[i])) recompute();
  TABS.forEach(([k]) => { $("bp-" + k).hidden = k !== B.tab; });
  if (B.tab === "test") currentTest();
  renderTabs(); renderChips();
  ({providers: renderProviders, quotes: renderQuotes, sales: renderSales, goals: renderGoals, test: renderTest})[B.tab]();
  B.stale[B.tab] = false;
}
$("benchTabs").addEventListener("click", e => {
  const b = e.target.closest("button[data-t]"); if (!b) return;
  B.tab = b.dataset.t; rememberTab(); render();
});

// ============================================================ 1. logistics providers (from Master Data)
// Master Data > Logistics providers is the one provider list. Every row with a provider type (3PL, Freight
// forwarder, Own hub; blank = from dc_type) appears here, Helmond (Own hub) first as the baseline. Benchmarking only
// keeps the RFQ side per provider ID: status, every upload with its parsed rates, the active upload.
const R = window.FlexiRFQ, FRT = window.FlexiRoute;
const PTYPE = {helmond_hub: "Own hub", "3pl": "3PL", freight_forwarder: "Freight forwarder"};
const PROVIDER_TYPES = ["Own hub", "3PL", "Freight forwarder"];
const providerTypeOf = r => (isBlank(r.provider_type) ? PTYPE[r.dc_type] || "" : String(r.provider_type).trim());
const RFQ_STATUS = [["not_sent", "Not sent"], ["sent", "Sent"], ["answered", "Answered"]];
const statusLabel = v => (v === "baseline" ? "Baseline" : (RFQ_STATUS.find(x => x[0] === v) || ["", v || ""])[1]);
const listOf = v => String(v || "").split(";").map(x => x.trim()).filter(Boolean);
const laneTag = c => { const l = FRT ? FRT.laneFor(c) : null; return l ? `${CNAME(c)} ${l}` : CNAME(c); };
const rfqOf = id => B.rfq[id] || (B.rfq[id] = {status: "not_sent", uploads: [], active: -1});
// Provider records for this view: one per Master Data row with a type, rebuilt on every render.
function syncProviders(){
  const rows = (MD.t.distribution_centers || []).filter(r => providerTypeOf(r));
  B.providers = rows.map(r => {
    const id = String(r.dc_id), t = providerTypeOf(r), st = B.rfq[id] || {status: "not_sent", uploads: [], active: -1};
    const ups = st.uploads || [], act = ups.length ? Math.min(Math.max(st.active ?? ups.length - 1, 0), ups.length - 1) : -1;
    const countries = [...new Set(listOf(r.serves_countries).concat(isBlank(r.country) ? [] : [String(r.country)]))].filter(c => TARGETS().includes(c));
    const a = act >= 0 ? ups[act] : null;
    return {id, name: String(r.name || id), type: t, baseline: t === "Own hub", dcType: r.dc_type, mdStatus: r.status || "",
      countriesCovered: countries, regionsCovered: [...new Set(countries.map(regionOf))].filter(x => REGIONS.includes(x)), providerTypes: [t], servicesOffered: [],
      contactName: r.contact_name || "", contactEmail: r.contact_email || "", contactPhone: r.contact_phone || "", website: r.website || "", hqCountry: r.country || "", notes: r.notes || "",
      dummy: String(r.data_source || "") === "placeholder",
      status: t === "Own hub" ? "baseline" : a ? "answered" : st.status === "sent" ? "sent" : "not_sent",
      dateRfqSent: st.sentDate || "", dateTestOrderSent: st.testOrderSent || "",
      dateResponseReceived: a ? ((a.summary || {}).responseDate || String(a.uploadedAt).slice(0, 10)) : "",
      rfqResponses: ups, latestResponseIndex: act};
  }).sort((a, b) => b.baseline - a.baseline);   // Master Data order, Helmond first
}
// RFQ state is stored without the parsed values; values and rate tables sit apart in "rfqvalues" (chunked).
async function saveRfq(msg){
  const slim = Object.fromEntries(Object.entries(B.rfq).map(([id, st]) => [id, Object.assign({}, st, {uploads: (st.uploads || []).map(u => Object.assign({}, u, {values: undefined, rates: undefined}))})]));
  if (!(await save("rfqstate", slim, msg))) return false;
  if (B.respDirty) {
    if (!(await save("rfqvalues", Object.entries(B.rfq).flatMap(([id, st]) => (st.uploads || []).map(u => ({ref: u.ref, providerId: id, values: u.values, rates: u.rates})))))) return false;
    B.respDirty = false;
  }
  return true;
}
const latestOf = p => R.latest(p);
const nextProviderId = () => "PRV-" + String(Math.max(0, ...(MD.t.distribution_centers || []).map(r => { const m = String(r.dc_id).match(/^PRV-(\d+)$/); return m ? Number(m[1]) : 0; })) + 1).padStart(4, "0");
const editInMd = id => { MDUI.tab = "distribution_centers"; MDUI.typeFilter = "all"; MDUI.colf.distribution_centers = {}; MDUI.filter = id || ""; MDUI.page = 0; showView("md"); };

// ---- RFQ template: the bundled file, or the one you replaced it with (kept in this browser)
const RFQT = {bundled: null, current: null};
function b64Bytes(b64){ const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
const templateInfo = bytes => R.templateInfo(XLSX.read(bytes, {type: "array", cellDates: true}), XLSX);
const rfqSources = () => (PAYLOAD.rfq_template || {}).sources || {};
async function loadTemplates(){
  const t = PAYLOAD.rfq_template;
  if (t && t.base64) { const bytes = b64Bytes(t.base64); try { RFQT.bundled = Object.assign({bytes, name: t.name, source: "bundled"}, templateInfo(bytes)); } catch (e) {} }
  const saved = await DataStore.files.get("rfq-template");
  if (saved && saved.bytes) RFQT.current = Object.assign({}, saved, {bytes: new Uint8Array(saved.bytes), source: "replaced"});
}
const tmpl = () => RFQT.current || RFQT.bundled;
function templateText(){
  const t = tmpl();
  return t ? `${t.version} · template of ${t.date ? longDate(t.date) : "unknown date"} · ${t.source === "replaced" ? "replaced in this browser" : "bundled"}` : "No RFQ template in this copy";
}
async function replaceTemplate(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  let info;
  try { info = templateInfo(bytes); } catch (e) { toast(e.message || "This file is not an RFQ template", "bad"); return; }
  if (!info.version) { toast("The Export sheet has no meta.rfq_version. Template not replaced.", "bad"); return; }
  if (!R.SUPPORTED_VERSIONS.includes(info.version)) toast(`Template ${info.version} is not in the supported list, so uploads of its responses will be refused until the tool supports it.`, "bad");
  const rec = {bytes: bytes.buffer.slice(0), name: file.name, version: info.version, date: info.date, replacedAt: nowIso()};
  await DataStore.files.put("rfq-template", rec);
  RFQT.current = Object.assign({}, rec, {bytes, source: "replaced"});
  toast(`RFQ template replaced: ${info.version}`); renderProviders();
}
const xlsxBlob = bytes => new Blob([bytes], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
// Prefilled RFQ: the provider cells plus the hidden _rfqmeta sheet (template version and provider ID only).
async function downloadPrefilled(id){
  const p = B.providers.find(x => x.id === id), t = tmpl(); if (!p || !t) return;
  try {
    const bytes = await R.prefill(t.bytes, p, JSZip, {version: t.version});
    await saveFile(R.fileName(p, today()), xlsxBlob(bytes));
    const st = rfqOf(id); if (st.status !== "sent") st.status = "sent"; st.sentDate = today();
    await saveRfq(`Prefilled RFQ for ${p.name}. Status Sent`); renderProviders();
  } catch (err) { toast("Could not prefill the RFQ: " + (err.message || err), "bad"); }
}

// ---- table
// Header sort for the provider table; Helmond stays first. Without a sort the table shows Master Data's order,
// which drag (or Alt + arrow keys) on the grip changes and saves in Master Data.
const PSORT = {name: ["Provider", p => p.name], type: ["Type", p => p.type], countries: ["Countries and lanes", p => p.countriesCovered.length || null],
  status: ["RFQ status", p => ["not_sent", "sent", "answered"].indexOf(p.status) + 1 || null], upload: ["Last upload", p => { const a = p.rfqResponses[p.latestResponseIndex]; return a ? String(a.uploadedAt || "") : null; }]};
function provSorted(rows){
  const s = B.ui.psort; if (!s || !PSORT[s.f]) return rows;
  const rest = rows.filter(p => !p.baseline), get = PSORT[s.f][1];
  return rows.filter(p => p.baseline).concat(sortIdx(rest.map((p, i) => i), i => get(rest[i]), s.dir).map(i => rest[i]));
}
function provFiltered(){
  const q = norm(B.ui.q);
  return provSorted(B.providers.filter(p => (B.ui.status === "all" || p.status === B.ui.status) && (B.ui.type === "all" || p.type === B.ui.type) &&
    (B.ui.region === "all" || p.regionsCovered.includes(B.ui.region)) &&
    (!q || [p.name, p.id, p.type, p.contactName, p.contactEmail, p.notes, p.countriesCovered.map(CNAME).join(" ")].some(x => norm(x).includes(q)))));
}
const safeUrl = u => { const s = String(u || "").trim(); return /^https?:\/\//i.test(s) ? s : "https://" + s; };
const badge = p => (p.baseline ? ' <span class="st baseline">Baseline</span>' : "") + (p.dummy ? ' <span class="srcb ph" title="Placeholder or dummy data from Master Data">dummy</span>' : "");
function provRow(p){
  const a = p.latestResponseIndex >= 0 ? p.rfqResponses[p.latestResponseIndex] : null, n = p.rfqResponses.length;
  const status = p.baseline ? `<span class="faint">Costs from Master Data, no RFQ</span>`
    : p.status === "answered" ? `<span class="st response_received">Answered</span><br><span class="faint num">${esc(p.dateResponseReceived)}</span>`
    : `<select data-st aria-label="RFQ status of ${esc(p.name)}">${RFQ_STATUS.filter(s => s[0] !== "answered").map(([k, l]) => `<option value="${k}"${p.status === k ? " selected" : ""}>${l}</option>`).join("")}</select>${p.dateRfqSent ? `<br><span class="faint num">sent ${esc(p.dateRfqSent)}</span>` : ""}`;
  const last = a ? `${esc(a.fileName)}<br><span class="faint num">${esc(String(a.uploadedAt).slice(0, 16).replace("T", " "))}${n > 1 ? ` · ${n} uploads` : ""}</span>` : '<span class="faint">none</span>';
  const dis = a ? "" : " disabled";
  const acts = p.baseline ? `<button type="button" class="btn ghost sm" data-a="md">Edit in Master Data</button>`
    : `<label class="btn sm filebtn" title="Upload the RFQ this provider answered">Upload answered RFQ<input type="file" data-up="${esc(p.id)}" accept=".xlsx,.xlsm" aria-label="Upload answered RFQ for ${esc(p.name)}"></label>
      <button type="button" class="btn ghost sm" data-a="rates"${dis}>View parsed rates</button>
      <button type="button" class="btn ghost sm" data-a="orig"${dis}>Download original</button>
      <button type="button" class="btn ghost sm" data-a="rm"${dis}>Remove upload</button>
      <button type="button" class="btn ghost sm" data-a="prefill"${tmpl() ? "" : " disabled"} title="RFQ with this provider's details and the metadata sheet; sets status Sent">Prefilled RFQ</button>
      <button type="button" class="btn ghost sm" data-a="md">Edit in Master Data</button>`;
  return `<tr data-id="${esc(p.id)}" data-row="${esc(p.id)}" class="${p.baseline ? "baserow" : ""}">
    <td><div class="pcell">${p.baseline || B.ui.psort ? "" : `<span class="grip" draggable="true" data-drag="${esc(p.id)}" tabindex="0" role="button" aria-label="Move ${esc(p.name)}. Drag it, or press Alt and the arrow keys" title="Drag to change the order (saved in Master Data)">⠿</span>`}<div><div class="pname"><button type="button" class="lnk" data-a="detail" title="Open the provider detail">${esc(p.name)}</button>${badge(p)}</div><span class="faint num">${esc(p.id)}</span></div></div></td>
    <td>${esc(p.type)}</td>
    <td class="wrap"><div class="tags">${p.countriesCovered.map(c => `<span class="tag r-${rc(regionOf(c))}">${esc(laneTag(c))}</span>`).join("") || '<span class="faint">none set</span>'}</div></td>
    <td>${status}</td><td>${last}</td><td><div class="bacts">${acts}</div></td></tr>`;
}
function renderProvHead(){
  const h = $("bxProvHead"), s = B.ui.psort; if (!h) return;
  const words = (f, d) => (f === "name" || f === "type" ? (d > 0 ? "A to Z" : "Z to A") : f === "upload" ? (d > 0 ? "oldest first" : "newest first") : f === "status" ? (d > 0 ? "Not sent first" : "Answered first") : (d > 0 ? "fewest first" : "most first"));
  const th = k => { const on = s && s.f === k; return `<th aria-sort="${on ? (s.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" class="thsort" data-psort="${k}" title="Click to sort: ${words(k, 1)}, again ${words(k, -1)}, a third time back to the Master Data order">${PSORT[k][0]}<span class="sarr" aria-hidden="true">${on ? (s.dir > 0 ? "▲" : "▼") : "↕"}</span></button></th>`; };
  h.innerHTML = `<tr>${th("name")}${th("type")}${th("countries")}${th("status")}${th("upload")}<th><span class="faint">Actions</span></th></tr>`;
  $("bxProvNote").innerHTML = s ? `Sorted by ${esc(PSORT[s.f][0].toLowerCase())}, ${words(s.f, s.dir)}. Helmond stays first. <button type="button" class="btn ghost sm" data-a="unsort">Back to Master Data order</button>` : "Drag ⠿ to change the order. It is saved in Master Data, so both lists match. Click a column header to sort.";
}
function renderProvTable(){
  renderProvHead();
  const rows = provFiltered(), el = $("bxProvBody"); if (!el) return;
  el.innerHTML = rows.map(provRow).join("") ||
    `<tr><td colspan="6" class="empty">${B.providers.length ? "No provider matches the search or filters." : "No logistics providers in Master Data. Add rows with a provider type in Master Data > Logistics providers."}</td></tr>`;
  $("bxProvCount").textContent = `${rows.length} of ${B.providers.length} shown`;
  renderCompare();
}
function renderProviders(){
  const P = $("bp-providers");
  const sel = (id, label, all, opts, v) => `<select id="${id}" aria-label="${esc(label)}"><option value="all">${esc(all)}</option>${opts.map(([k, l]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const t = tmpl();
  P.innerHTML = `<div class="card">
    <div class="cardhead"><h2>Logistics providers</h2>
      <div class="rfqbar"><button type="button" class="btn" data-a="rfq-dl"${t ? "" : " disabled"}>Download latest RFQ</button>
        <span class="faint num" id="bxRfqVer">${esc(templateText())}</span>
        <label class="btn ghost sm filebtn">Replace RFQ template<input type="file" id="bxRfqTpl" accept=".xlsx,.xlsm" aria-label="Replace the RFQ template"></label>
        ${RFQT.current ? `<button type="button" class="btn ghost sm" data-a="rfq-reset">Reset to bundled</button>` : ""}</div></div>
    <p class="muted bcard-lead">Providers come from Master Data > Logistics providers (rows with a provider type). Send the RFQ, then use Upload answered RFQ when it comes back: the file is checked, you see the parsed rates, and it saves only after you confirm. Helmond is the baseline: its costs come from Master Data. <span class="faint" id="bxProvCount"></span></p>
    <p class="faint mdview" id="bxProvNote"></p>
    <div class="mdbar">
      <input type="search" id="bxQ" placeholder="Search name, ID, contact, country" value="${esc(B.ui.q)}" aria-label="Search providers">
      ${sel("bxFStatus", "Filter by RFQ status", "All statuses", [["baseline", "Baseline"]].concat(RFQ_STATUS), B.ui.status)}
      ${sel("bxFType", "Filter by type", "All types", PROVIDER_TYPES.map(x => [x, x]), B.ui.type)}
      ${sel("bxFRegion", "Filter by region", "All regions", REGIONS.map(r => [r, r]), B.ui.region)}
      <span class="sp"></span>
      <label class="btn filebtn">Upload answered RFQ<input type="file" id="bxUpAny" accept=".xlsx,.xlsm" aria-label="Upload an answered RFQ and pick the provider"></label>
      <button type="button" class="btn ghost" data-a="md-add">Add provider in Master Data</button>
      <button type="button" class="btn ghost" data-a="print">Print report (PDF)</button>
    </div>
    <div class="tablewrap mdgrid"><table><thead id="bxProvHead"></thead><tbody id="bxProvBody"></tbody></table></div>
    <p class="faint bnote">Add, edit or delete providers in Master Data; they show here the next time this view opens. Upload history stays per provider: the latest confirmed upload is active, older ones open from View parsed rates. Uploaded files stay in this browser.</p>
  </div>
  <div id="bxCompare"></div>`;
  renderProvTable();
  $("bxQ").addEventListener("input", e => { B.ui.q = e.target.value; renderProvTable(); });
  P.querySelector(".card").addEventListener("click", e => {   // the card is new on each render, so one listener
    const b = e.target.closest("[data-psort],[data-a=unsort]"); if (!b) return;
    const k = b.dataset.psort, s = B.ui.psort;
    B.ui.psort = !k ? null : !s || s.f !== k ? {f: k, dir: 1} : s.dir > 0 ? {f: k, dir: -1} : null;
    renderProvTable(); const nb = k && P.querySelector(`[data-psort="${k}"]`); if (nb) nb.focus({preventScroll: true});
  });
  wireProvOrder();
  [["bxFStatus", "status"], ["bxFType", "type"], ["bxFRegion", "region"]].forEach(([id, k]) => $(id).addEventListener("change", e => { B.ui[k] = e.target.value; renderProvTable(); }));
  P.querySelector('[data-a="print"]').addEventListener("click", printProviders);
  P.querySelector('[data-a="md-add"]').addEventListener("click", () => editInMd(""));
  P.querySelector('[data-a="rfq-dl"]').addEventListener("click", () => { const t = tmpl(); if (t) saveFile(t.name || "Transport_Volume_Scenario_RFQ_FlexiTog.xlsx", xlsxBlob(t.bytes)); });
  $("bxRfqTpl").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) replaceTemplate(f); });
  $("bxUpAny").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) uploadRfq(null, f); });
  const rs = P.querySelector('[data-a="rfq-reset"]');
  if (rs) rs.addEventListener("click", async () => { await DataStore.files.del("rfq-template"); RFQT.current = null; toast("Back to the bundled RFQ template"); renderProviders(); });
  $("bxProvBody").addEventListener("change", async e => {
    const inp = e.target.closest("input[data-up]");
    if (inp) { const f = inp.files[0]; inp.value = ""; if (f) uploadRfq(inp.dataset.up, f); return; }
    const s = e.target.closest("select[data-st]"); if (!s) return;
    const id = s.closest("tr").dataset.id, st = rfqOf(id);
    st.status = s.value; if (s.value === "sent" && !st.sentDate) st.sentDate = today(); if (s.value === "not_sent") st.sentDate = "";
    await saveRfq(`RFQ status ${statusLabel(s.value)}`); syncProviders(); renderProvTable(); renderTabs();
  });
  $("bxProvBody").addEventListener("click", e => {
    const b = e.target.closest("button[data-a]"); if (!b || b.disabled) return;
    const id = b.closest("tr").dataset.id;
    ({detail: () => openDetail(id), rates: () => openDetail(id, "rates"), orig: () => downloadOriginal(id), rm: () => removeUpload(id),
      prefill: () => downloadPrefilled(id), md: () => editInMd(id)})[b.dataset.a]();
  });
}

// Drag a provider (or Alt + arrow keys on the grip) to change the order. The new order goes to Master Data at once.
function wireProvOrder(){
  const tb = $("bxProvBody"); let from = null;
  const ids = () => B.providers.filter(p => !p.baseline).map(p => p.id);
  const marks = () => tb.querySelectorAll(".drop-before,.drop-after,.dragging").forEach(t => t.classList.remove("drop-before", "drop-after", "dragging"));
  const below = (e, tr) => e.clientY > tr.getBoundingClientRect().top + tr.offsetHeight / 2;
  const target = e => { const tr = e.target.closest("tr[data-row]"); return tr && !tr.classList.contains("baserow") ? tr : null; };
  async function move(id, to, after){
    const o = ids().filter(x => x !== id); o.splice(o.indexOf(to) + (after ? 1 : 0), 0, id);
    try { await mdReorderRows("distribution_centers", o); } catch (err) { toast(storeErrorText(err), "bad"); return false; }
    syncProviders(); renderProvTable(); return true;
  }
  tb.addEventListener("dragstart", e => {
    const g = e.target.closest && e.target.closest("[data-drag]"); if (!g) return;
    from = g.dataset.drag; const tr = g.closest("tr"); tr.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", from);
    try { e.dataTransfer.setDragImage(tr, 24, 16); } catch (x) {}
  });
  tb.addEventListener("dragover", e => {
    if (from == null) return; const tr = target(e); if (!tr) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    tb.querySelectorAll(".drop-before,.drop-after").forEach(t => t.classList.remove("drop-before", "drop-after"));
    if (tr.dataset.row !== from) tr.classList.add(below(e, tr) ? "drop-after" : "drop-before");
  });
  tb.addEventListener("drop", async e => {
    if (from == null) return; e.preventDefault();
    const tr = target(e), id = from; from = null; marks();
    if (!tr || tr.dataset.row === id) return;
    if (await move(id, tr.dataset.row, below(e, tr))) toast("Order saved in Master Data");
  });
  tb.addEventListener("dragend", () => { from = null; marks(); });
  tb.addEventListener("keydown", async e => {
    const g = e.target.closest && e.target.closest("[data-drag]"); if (!g || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const id = g.dataset.drag, vis = provFiltered().filter(p => !p.baseline).map(p => p.id), k = vis.indexOf(id), nb = vis[k + (e.key === "ArrowUp" ? -1 : 1)];
    if (nb == null) return;
    if (await move(id, nb, e.key === "ArrowDown")) { const ng = tb.querySelector(`[data-drag="${CSS.escape(id)}"]`); if (ng) ng.focus({preventScroll: true}); }
  });
}

// ---- small dialogs
function ask(title, html, buttons, wide){
  return new Promise(res => {
    const dlg = $("bxDlg");
    dlg.classList.toggle("bdetail", !!wide);
    dlg.innerHTML = `<form class="bform" method="dialog"><div class="dhead"><div><span class="eyebrow">RFQ upload</span><h2>${esc(title)}</h2></div></div>
      <div class="fbody" style="display:block">${html}</div>
      <div class="dfoot">${buttons.map((b, i) => `<button type="button" class="btn${b.primary ? "" : " ghost"}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></form>`;
    let done = false;
    const finish = v => { if (done) return; done = true; dlg.close(); dlg.classList.remove("bdetail"); res(typeof v === "function" ? v(dlg) : v); };
    dlg.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => finish(buttons[+b.dataset.i].value)));
    dlg.addEventListener("cancel", () => finish(null), {once: true});
    dlg.showModal();
  });
}
const problemsDialog = (file, list) => ask("RFQ not accepted", `<p class="muted" style="margin-bottom:8px">${esc(file)}: ${list.length} problem${list.length === 1 ? "" : "s"}. Nothing was saved. Fix the cells below in the file and upload it again.</p>
  <div class="tablewrap btable" style="max-height:50vh"><table><thead><tr><th>Sheet</th><th>Cell</th><th>Problem</th></tr></thead><tbody>${list.map(x => `<tr><td>${esc(x.sheet || "")}</td><td class="num">${esc(x.cell || "")}</td><td class="wrap">${esc(x.message)}</td></tr>`).join("")}</tbody></table></div>`,
  [{label: "Close", value: null, primary: true}], true);

// ---- upload: read, check the template, pick the provider, validate the rates, preview, save on confirm
// A provider from the file that Master Data does not have: created as a Master Data row from the file's profile.
function providerRowFromFile(id, v){
  const yes = k => /^yes$/i.test(String(v[k] || ""));
  const is3pl = yes("type.3pl_contract_logistics");
  const cov = R.LANES ? Object.entries(R.LANES).filter(([L]) => !/^(|not served|no|none|n\/a|-)$/i.test(String(v[`coverage.${L}.presence`] || "").trim())).map(([, l]) => l.country) : [];
  return {dc_id: id, name: String(v["provider.name"] || id).trim(), dc_type: is3pl ? "3pl" : "freight_forwarder", provider_type: is3pl ? "3PL" : "Freight forwarder", status: "candidate",
    country: toIso2(v["provider.hq_country"]) || "NL", serves_countries: cov.join(";"), contact_name: v["provider.contact_name"] || null, contact_email: v["provider.contact_email"] || null,
    contact_phone: v["provider.contact_phone"] || null, website: v["provider.website"] || null, notes: "Created from an RFQ upload", data_source: "imported:RFQ"};
}
async function createFromFile(id, v){
  await mdUpsertRows("distribution_centers", [providerRowFromFile(id, v)]);
  syncProviders();
  toast(`${v["provider.name"] || id} added to Master Data > Logistics providers`);
  return id;
}
async function pickProvider(rowId, meta, v){
  const fid = String(v["provider.provider_id"] || "").trim(), fname = String(v["provider.name"] || "").trim();
  const others = B.providers.filter(p => !p.baseline), find = id => others.find(p => p.id === id);
  if (meta && meta.providerId) {
    const mp = find(meta.providerId);
    if (!mp) {
      const go = await ask("Provider not in Master Data", `<p>The file is for provider <b>${esc(meta.providerId)}</b>${fname ? ` (${esc(fname)})` : ""}, which is not in Master Data > Logistics providers.</p><p class="muted">Create it from the file's Provider Profile, then continue with the upload?</p>`,
        [{label: "Cancel", value: null}, {label: "Create in Master Data", value: true, primary: true}]);
      return go ? createFromFile(meta.providerId, v) : null;
    }
    if (rowId && rowId !== mp.id) {
      const rp = find(rowId);
      const go = await ask("Check the provider", `<p>The file's metadata sheet names <b>${esc(mp.name)}</b> (${esc(mp.id)}), but you uploaded it on <b>${esc(rp ? rp.name : rowId)}</b>.</p>`,
        [{label: "Cancel", value: null}, {label: `Use ${mp.name}`, value: true, primary: true}]);
      return go ? mp.id : null;
    }
    return mp.id;
  }
  // No metadata sheet (sent before it existed): you pick the provider. Preselect the clicked row, else the file's ID or name.
  const pre = (rowId && find(rowId)) || find(fid) || others.find(p => fname && norm(p.name) === norm(fname));
  const newId = fid && !find(fid) && !(MD.t.distribution_centers || []).some(r => String(r.dc_id) === fid) ? fid : nextProviderId();
  const pick = await ask("Which provider sent this file?", `<p class="muted" style="margin-bottom:8px">This file has no FlexiTog metadata sheet, so it was sent before the sheet existed. ${fname ? `It names <b>${esc(fname)}</b>${fid ? ` (${esc(fid)})` : ""}. ` : ""}Pick the provider it belongs to.</p>
    <div class="fld"><label for="bxPick">Provider</label><select id="bxPick"><option value="">Choose a provider</option>${others.map(p => `<option value="${esc(p.id)}"${pre && pre.id === p.id ? " selected" : ""}>${esc(p.name)} · ${esc(p.id)} · ${esc(p.type)}</option>`).join("")}
      <option value="__new">New provider from this file: ${esc(fname || "unnamed")} (${esc(newId)})</option></select></div>`,
    [{label: "Cancel", value: null}, {label: "Continue", primary: true, value: dlg => (dlg.querySelector("#bxPick") || {}).value || ""}]);
  if (pick === null) return null;
  if (!pick) { toast("Pick a provider to continue", "bad"); return null; }
  return pick === "__new" ? createFromFile(newId, v) : pick;
}
function previewHtml(p, file, P, v, rates, warnings, hasMeta){
  const s = R.summarize(v), served = rates.filter(r => r.served), off = [...new Set(rates.filter(r => !r.served).map(r => `${r.lane} ${r.name}`))];
  const n2 = x => (x == null ? "" : fmt(x, 2)), pc = x => (x == null ? "" : (x * 100).toFixed(1) + "%");
  return `<dl class="kv"><dt>Provider</dt><dd><b>${esc(p.name)}</b> · ${esc(p.id)} · ${esc(p.type)}</dd><dt>File</dt><dd>${esc(file.name)}</dd>
      <dt>Template</dt><dd>${esc(P.version)} · ${hasMeta ? "metadata sheet found" : "no metadata sheet, provider picked by hand"}</dd><dt>Currency</dt><dd>${esc(s.currency)}</dd>
      ${s.quoteReference ? `<dt>Quote</dt><dd>${esc(s.quoteReference)}${s.quoteValidUntil ? ` · valid until ${esc(s.quoteValidUntil)}` : ""}</dd>` : ""}
      ${s.responseDate ? `<dt>Response date</dt><dd>${esc(s.responseDate)}</dd>` : ""}<dt>Lanes</dt><dd>${new Set(served.map(r => r.lane)).size} served${off.length ? ` · not served: ${esc(off.join(", "))}` : ""}</dd></dl>
    ${warnings.map(w => `<p class="muted" style="font-size:12.5px">⚠ ${esc(w)}</p>`).join("")}
    <div class="tablewrap btable" style="max-height:48vh;margin-top:8px"><table><thead><tr><th>Lane</th><th>Country</th><th>Band</th><th>Mode</th><th>Transit (wd)</th><th>Worst</th><th>Rate/kg</th><th>Min charge</th><th>Fuel</th><th>Docs fee</th><th>Other</th><th>Discount B</th><th>Cost per shipment</th></tr></thead><tbody>
      ${served.map(r => `<tr><td class="num">${r.lane}</td><td>${esc(r.name)}</td><td class="num">${r.band}</td><td>${esc(r.mode)}</td><td class="n">${n2(r.transit)}</td><td class="n">${n2(r.worst)}</td><td class="n">${n2(r.perKg)}</td><td class="n">${n2(r.minCharge)}</td><td class="n">${pc(r.fuel)}</td><td class="n">${n2(r.docs)}</td><td class="n">${n2(r.other)}</td><td class="n">${pc(r.discountB)}</td><td class="n">${r.perShipment == null ? '<span class="faint">per order</span>' : n2(r.perShipment)}</td></tr>`).join("")}</tbody></table></div>
    <p class="faint bnote">Nothing is saved yet. Confirm to store this upload for ${esc(p.name)} and make it the active one; earlier uploads stay in the history.</p>`;
}
async function uploadRfq(rowId, file){
  let buf, wb, P;
  try {
    buf = await file.arrayBuffer();
    wb = XLSX.read(buf, {type: "array", cellDates: true});
    P = R.parseWorkbook(wb, XLSX, {sources: rfqSources()});
  } catch (e) { await problemsDialog(file.name, [{sheet: "", cell: "", message: (e && e.message) || "This file could not be read as an Excel workbook."}]); return; }
  // 1. right template: version and row count of the Export sheet, version of the metadata sheet
  const base = R.validate(P, null), meta = R.readMeta(wb);
  const tpl = base.errors.map(m => ({sheet: "Export", cell: /version/i.test(m) ? "B2" : "B3", message: m}));
  if (meta && meta.version && !R.SUPPORTED_VERSIONS.includes(meta.version)) tpl.push({sheet: R.META_SHEET, cell: "B1", message: `Template version ${meta.version} is not supported.`});
  if (tpl.length) { await problemsDialog(file.name, tpl); return; }
  const v = R.effectiveValues(P);
  // 2. provider: metadata sheet, or picked by hand; one missing from Master Data can be created from the file
  const pid = await pickProvider(rowId, meta, v); if (!pid) return;
  syncProviders();
  const p = B.providers.find(x => x.id === pid); if (!p) { toast("That provider is not in Master Data", "bad"); return; }
  // 3. rates: required cells filled, numeric, not negative, currency stated; every problem with sheet and cell
  const problems = R.validateRates(wb, P);
  if (problems.length) { await problemsDialog(file.name, problems); return; }
  // 4. preview; nothing saves before Confirm
  const rates = R.rateTable(v);
  const warnings = base.warnings.filter(w => !/not saved in Excel/.test(w) || !P.fromInputs).concat(P.fromInputs ? ["The file was not saved in Excel after it was filled in. Rates are read from the input cells; the RFQ's own totals and timeline are unavailable."] : []);
  const ok = await ask(`Preview: ${p.name}`, previewHtml(p, file, P, v, rates, warnings, !!meta), [{label: "Cancel", value: null}, {label: "Confirm and save", value: true, primary: true}], true);
  if (!ok) { toast("Upload cancelled. Nothing saved."); return; }
  // 5. save: the upload with values and parsed rates, the original file, empty contact fields in Master Data
  const M = R.mapResponse(p, P, {fileName: file.name, today: today(), uploadedAt: nowIso(), countryOf: x => toIso2(x)});
  const entry = Object.assign(M.entry, {ref: uid("RSP"), fileId: uid("RFQF"), rates, hasMeta: !!meta, confirmedAt: nowIso()});
  await DataStore.files.put("rfq-file:" + entry.fileId, {bytes: buf, name: file.name, uploadedAt: entry.uploadedAt, providerId: p.id});
  const st = rfqOf(p.id); st.uploads = (st.uploads || []).concat([entry]); st.active = st.uploads.length - 1;
  B.respDirty = true;
  if (!(await saveRfq())) return;
  const md = (MD.t.distribution_centers || []).find(r => String(r.dc_id) === p.id) || {};
  const fill = {dc_id: p.id}; [["contact_name", "provider.contact_name"], ["contact_email", "provider.contact_email"], ["contact_phone", "provider.contact_phone"], ["website", "provider.website"]]
    .forEach(([k, src]) => { if (isBlank(md[k]) && !isBlank(v[src])) fill[k] = String(v[src]); });
  if (Object.keys(fill).length > 1) await mdUpsertRows("distribution_centers", [fill]);
  syncProviders();
  await syncRfqQuotes(p.id);
  toast(`${p.name}: RFQ answer saved (upload ${st.uploads.length}, active)${Object.keys(fill).length > 1 ? ". Empty contact fields filled in Master Data" : ""}`);
  renderTabs(); renderChips(); renderProvTable();
}
async function downloadOriginal(id, idx){
  const p = B.providers.find(x => x.id === id); if (!p) return;
  const r = p.rfqResponses[idx == null ? p.latestResponseIndex : idx]; if (!r) return;
  const f = r.fileId ? await DataStore.files.get("rfq-file:" + r.fileId) : null;
  if (f && f.bytes) saveFile(f.name || r.fileName, xlsxBlob(new Uint8Array(f.bytes)));
  else toast("The original file is not in this browser. It stays only where it was uploaded.", "bad");
}
async function removeUpload(id){
  const p = B.providers.find(x => x.id === id), st = B.rfq[id]; if (!p || !st || !(st.uploads || []).length) return;
  const i = p.latestResponseIndex, r = st.uploads[i];
  const go = await ask("Remove upload", `<p>Remove the active upload <b>${esc(r.fileName)}</b> (${esc(String(r.uploadedAt).slice(0, 10))}) of ${esc(p.name)}?</p><p class="muted">${st.uploads.length > 1 ? "The newest remaining upload becomes active." : "The provider goes back to status Sent."}</p>`,
    [{label: "Cancel", value: null}, {label: "Remove upload", value: true, primary: true}]);
  if (!go) return;
  st.uploads.splice(i, 1); st.active = st.uploads.length - 1;
  if (!st.uploads.length && st.status !== "sent") st.status = "sent";
  if (r.fileId) await DataStore.files.del("rfq-file:" + r.fileId);
  B.respDirty = true; await saveRfq(`Upload removed from ${p.name}`);
  syncProviders(); await syncRfqQuotes(p.id); renderTabs(); renderChips(); renderProvTable();
}

// ---- RFQ answer -> quote rows. The active upload's Rate Card becomes quotes in Master Data > Quotes (one per lane,
// mode and weight band, ids QR-<provider>-<lane>-<band>), so Landed Cost and the Quote Benchmark read one table.
// The Rate Card formula MAX(min, rate x kg) x (1 + fuel) + docs + other maps to: rate and minimum with fuel
// included, docs + other as the other surcharge per shipment. Older QR rows of the provider are replaced.
const modeOf = t => (/express|courier/i.test(t) ? "express" : /air/i.test(t) ? "air" : /sea|lcl|ocean|ship/i.test(t) ? "sea" : "road");
async function syncRfqQuotes(pid){
  const p = B.providers.find(x => x.id === pid); if (!p) return;
  const up = p.latestResponseIndex >= 0 ? p.rfqResponses[p.latestResponseIndex] : null;
  const prefix = `QR-${pid}-`, keep = (MD.t.quotes || []).filter(q => !String(q.quote_id).startsWith(prefix));
  const quotes = [], lanes = [];
  if (up) {
    const v = up.values || {}, cur = String((up.summary || {}).currency || v["provider.currency"] || "EUR").toUpperCase();
    if (!["EUR", "USD"].includes(cur)) { toast(`${p.name}: quoted in ${cur}. Quotes take EUR or USD, so this answer feeds Benchmarking only.`, "bad"); }
    else {
      const date = String(v["provider.response_date"] || up.uploadedAt || today()).slice(0, 10), valid = v["provider.quote_valid_until"] ? String(v["provider.quote_valid_until"]).slice(0, 10) : null;
      const limits = Object.fromEntries(FRT.BANDS.map(([b, max], i) => [b, [i ? FRT.BANDS[i - 1][1] : 0, Number.isFinite(max) ? max : null]]));
      (up.rates || R.rateTable(v)).filter(r => r.served && (r.perKg != null || r.minCharge != null)).forEach(r => {
        const mode = modeOf(r.mode || ""), lane = `L-HLM-${r.country}-${mode.toUpperCase()}`, f = 1 + (r.fuel || 0);
        if (!lanes.some(l => l.lane_id === lane) && !(MD.t.lanes || []).some(l => l.lane_id === lane))
          lanes.push({lane_id: lane, origin_id: "HLM", destination_id: r.country, mode, status: "unproven", source_ref: "RFQ answer " + up.fileName, source_date: date, data_status: "confirmed", data_source: "imported:" + up.fileName});
        const [from, to] = limits[r.band] || [null, null];
        quotes.push({quote_id: `${prefix}${r.lane}-${r.band}`, provider_id: pid, lane_id: lane, quote_date: date, valid_until: valid, base_rate: (r.perKg || 0) * f, rate_unit: "per kg",
          min_charge: r.minCharge != null ? r.minCharge * f : null, weight_from_kg: from, weight_to_kg: to, fuel_surcharge: 0, peak_surcharge: 0, war_risk_surcharge: 0,
          other_surcharge: (r.docs || 0) + (r.other || 0), currency: cur, transit_days: r.transit, notes: `From RFQ answer ${up.fileName}, ${r.lane} ${r.band}; fuel ${Math.round((r.fuel || 0) * 1000) / 10}% included in rate and minimum`,
          source_ref: "RFQ answer " + up.fileName, source_date: date, data_status: "confirmed", data_source: "imported:" + up.fileName});
      });
    }
  }
  const had = (MD.t.quotes || []).length - keep.length;
  if (!had && !quotes.length) return;
  try {
    if (lanes.length) { MD.t.lanes = (MD.t.lanes || []).concat(lanes); await persist("lanes"); }
    MD.t.quotes = keep.concat(quotes); await persist("quotes");
    if (MDUI.draft.quotes) delete MDUI.draft.quotes;
    masterDataChanged(["quotes", "lanes"]);
  } catch (e) { toast(storeErrorText(e), "bad"); }
}

// ---- Quote Benchmark: the quotes in force per lane (low, median, high) and per provider
const QB = Object.assign({type: "all", months: 0, country: "all", mode: "all"}, DataStore.pref.get("bench-quotes") || {});
const provTypeOf = id => { const r = (MD.t.distribution_centers || []).find(d => d.dc_id === id); return !r ? null : r.dc_type === "3pl" ? "3PL" : r.dc_type === "freight_forwarder" ? "forwarder" : r.provider_type === "3PL" ? "3PL" : r.provider_type ? "forwarder" : null; };
const provNameOf = id => ((MD.t.distribution_centers || []).find(d => d.dc_id === id) || {}).name || id;
function quoteStatsNow(){
  return FlexiCalc.memo("quoteStats", JSON.stringify([QB, today()]), () => {
    const st = FlexiCalc.quoteStats({quotes: MD.t.quotes, lanes: MD.t.lanes, today: today(), months: Number(QB.months) || 0, type: QB.type, typeOf: provTypeOf, settings: settingsRow()});
    const lanes = st.lanes.filter(l => (QB.country === "all" || l.country === QB.country) && (QB.mode === "all" || l.mode === QB.mode));
    return Object.assign({}, st, {lanes});
  });
}
function renderQuotes(){
  const P = $("bp-quotes"), st = quoteStatsNow(), all = MD.t.quotes || [];
  const expired = all.filter(q => FlexiCalc.isExpired(q, today())).length;
  const segQ = (id, list, v) => `<div class="seg" id="${id}" role="group">${list.map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${String(v) === String(k)}">${esc(l)}</button>`).join("")}</div>`;
  const sel = (id, label, opts, v) => `<div class="ctl"><label for="${id}">${label}</label><select id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}"${String(v) === String(k) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  const unitTxt = u => (u === "per kg" ? "EUR/kg" : u === "per m3" ? "EUR/m3" : "EUR/shipment");
  const laneRows = st.lanes.map(L => `<tr><td>${esc(CNAME(L.country))}<br><span class="faint num">${esc(L.laneId)}</span></td><td>${esc(L.origin)} → ${esc(L.country)}<br><span class="faint">${esc(L.mode)}</span></td>
      <td>${esc(L.rateUnit)}${L.band ? `<br><span class="faint">${esc(L.band)}</span>` : ""}</td><td class="n">${L.quotes}</td>
      <td class="n">${fmt(L.low, 2)}</td><td class="n"><b>${fmt(L.median, 2)}</b></td><td class="n">${fmt(L.high, 2)}</td>
      <td><div class="tags">${L.entries.slice().sort((a, b) => a.eur - b.eur).map(e => `<span class="tag${L.quotes >= 2 && e.eur > L.median + 1e-9 ? " above" : ""}" title="${esc(e.quoteId)} · ${esc(String(e.date).slice(0, 10))}${e.transit != null ? " · " + e.transit + " days" : ""}">${esc(provNameOf(e.providerId))} ${fmt(e.eur, 2)}</span>`).join("")}</div></td></tr>`).join("");
  const provRows = st.providers.map(p => `<tr><td><b>${esc(provNameOf(p.providerId))}</b><br><span class="faint num">${esc(p.providerId)}</span></td><td>${esc(provTypeOf(p.providerId) || "")}</td>
      <td class="n">${p.lanes}</td><td class="n">${p.compared}</td><td class="n">${p.aboveMedian}</td><td class="n">${p.shareAbove == null ? "n/a" : Math.round(p.shareAbove * 100) + "%"}</td><td class="n">${p.avgTransit == null ? "n/a" : fmt(p.avgTransit, 1)}</td></tr>`).join("");
  P.innerHTML = `<div class="card"><div class="cardhead"><h2>Quote benchmark</h2><span class="faint" style="font-size:12px">${st.quotes} quote${st.quotes === 1 ? "" : "s"} in force · ${expired} expired left out · rates in EUR (USD at Settings rate)</span></div>
      <div class="controls">
        <div class="ctl"><label>Provider type</label>${segQ("qbType", [["all", "All"], ["forwarder", "Forwarders"], ["3PL", "3PLs"]], QB.type)}</div>
        <div class="ctl"><label>Quote date</label>${segQ("qbMonths", [[0, "All"], [6, "Last 6 months"], [3, "Last 3 months"]], QB.months)}</div>
        ${sel("qbCountry", "Country", [["all", "All countries"]].concat(TARGETS().map(c => [c, CNAME(c)])), QB.country)}
        ${sel("qbMode", "Mode", [["all", "All modes"], ["road", "road"], ["sea", "sea"], ["air", "air"], ["express", "express"]], QB.mode)}
      </div>
      <p class="faint bnote">Quotes from Master Data > Quotes, newest per provider per lane. A lane groups quotes with the same rate unit and weight band, so rates compare like with like. Expired quotes (validUntil before today) never count.</p></div>
    <div class="card"><div class="cardhead"><h2>Per lane</h2><span class="faint" style="font-size:12px">low, median and high base rate</span></div>
      <div class="tablewrap btable"><table><thead><tr><th>Country</th><th>Lane</th><th>Rate unit</th><th>Quotes</th><th>Low</th><th>Median</th><th>High</th><th>Providers (above the median marked)</th></tr></thead>
      <tbody>${laneRows || `<tr><td colspan="8" class="empty">No quotes in force for these filters.</td></tr>`}</tbody></table></div></div>
    <div class="card"><div class="cardhead"><h2>Per provider</h2><span class="faint" style="font-size:12px">lanes with 2 or more providers count for the median comparison</span></div>
      <div class="tablewrap btable"><table><thead><tr><th>Provider</th><th>Type</th><th>Lanes quoted</th><th>Lanes compared</th><th>Above median</th><th>Share above median</th><th>Avg transit days</th></tr></thead>
      <tbody>${provRows || `<tr><td colspan="7" class="empty">No quotes in force for these filters.</td></tr>`}</tbody></table></div></div>`;
  const save = () => { DataStore.pref.set("bench-quotes", QB); renderQuotes(); };
  P.querySelectorAll("#qbType [data-v]").forEach(b => b.addEventListener("click", () => { QB.type = b.dataset.v; save(); }));
  P.querySelectorAll("#qbMonths [data-v]").forEach(b => b.addEventListener("click", () => { QB.months = Number(b.dataset.v); save(); }));
  $("qbCountry").addEventListener("change", e => { QB.country = e.target.value; save(); });
  $("qbMode").addEventListener("change", e => { QB.mode = e.target.value; save(); });
}

// ---- provider detail panel (parsed rates and the upload history)
const pctTxt = v => (typeof v === "number" ? (v * 100).toFixed(1) + "%" : esc(v ?? ""));
const numTxt = (v, dp) => (typeof v === "number" ? fmt(v, dp == null ? 0 : dp) : esc(v ?? ""));
const ansTxt = (v, type) => (type === "percent" ? pctTxt(v) : type === "number" ? numTxt(v, typeof v === "number" && Number.isInteger(v) ? 0 : 2) : esc(v ?? ""));
function openDetail(id, tab, idx){
  const p = B.providers.find(x => x.id === id); if (!p) return;
  const dlg = $("bxDetail");
  const n = p.rfqResponses.length, ri = idx == null ? p.latestResponseIndex : idx, r = n && ri >= 0 ? p.rfqResponses[ri] : null;
  const v = r ? r.values || {} : {}, D = r ? R.detail(v, r.labels || {}) : null, s = r ? r.summary || R.summarize(v) : null;
  const cur = (s && s.currency) || "EUR";
  const T = tab || "profile";
  const tabs = [["profile", "Profile and coverage"], ["rates", "Rates"], ["costs", "Costs"], ["timeline", "Timeline"], ["rq", "Reliability & Quality"]];
  const kv = rows => `<dl class="kv">${rows.filter(x => !isBlank(x[1])).map(([k, x]) => `<dt>${esc(k)}</dt><dd>${x}</dd>`).join("")}</dl>`;
  let body = "";
  if (T === "profile") {
    body = kv([["Provider ID", esc(p.id)], ["Type", esc(p.type)], ["Website", p.website ? `<a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener noreferrer">${esc(p.website)}</a>` : ""], ["Contact", esc(p.contactName)],
      ["Phone", esc(p.contactPhone)], ["Email", p.contactEmail ? `<a href="mailto:${esc(p.contactEmail)}">${esc(p.contactEmail)}</a>` : ""], ["Country", esc(CNAME(p.hqCountry))],
      ["RFQ status", esc(statusLabel(p.status))], ["RFQ sent", esc(p.dateRfqSent)], ["Response", esc(p.dateResponseReceived)],
      ["Countries and lanes", esc(p.countriesCovered.map(laneTag).join(", "))],
      ["Quote reference", esc(s && s.quoteReference)], ["Quote valid until", esc(s && s.quoteValidUntil)], ["Currency", esc(s && s.currency)]]) +
      (p.baseline ? `<p class="muted">Helmond is the baseline. Its costs and lead times come from Master Data and the parameters; it needs no RFQ.</p>` : "");
    if (D) body += `<h3 style="margin:12px 0 6px">Coverage per country</h3><div class="tablewrap"><table><thead><tr><th>Lane</th><th>Country</th><th>Region</th><th>Presence</th><th>Partner</th><th>Import brokerage</th><th>DDP</th></tr></thead><tbody>
        ${D.coverage.map(c => `<tr><td class="num">${c.lane}</td><td>${esc(c.country)}</td><td><span class="rdot r-${rc(c.region)}"></span>${esc(c.region)}</td><td>${esc(c.presence)}</td><td>${esc(c.partner)}</td><td>${esc(c.importBrokerage)}</td><td>${esc(c.ddp)}</td></tr>`).join("")}</tbody></table></div>
      ${D.certs.length ? `<h3 style="margin:12px 0 6px">Certifications</h3><div class="tags">${D.certs.filter(c => !isBlank(c.value) && c.value !== "No").map(c => `<span class="tag">${esc(c.label)}${c.value !== "Yes" ? ": " + esc(c.value) : ""}</span>`).join("") || '<span class="faint">none stated</span>'}</div>` : ""}
      <h3 style="margin:12px 0 6px">Optional regional stock</h3>${kv([["Warehouses", esc(D.stock.warehouses.join("; ") || "none")], ["Total cost A", numTxt(D.stock.A)], ["Total cost B", numTxt(D.stock.B)]])}`;
  } else if (!D) body = `<p class="empty">${p.baseline ? "Helmond needs no RFQ." : "No RFQ answer yet. Use Upload answered RFQ on the provider's row."}</p>`;
  else if (T === "rates") {
    const rows = (r.rates || R.rateTable(v)).filter(x => x.served);
    body = `<div class="tablewrap btable" style="max-height:60vh"><table><thead><tr><th>Lane</th><th>Country</th><th>Band</th><th>Mode</th><th>Transit (wd)</th><th>Worst case</th><th>Rate/kg</th><th>Min charge</th><th>Fuel</th><th>Docs fee</th><th>Other fee</th><th>Discount B</th><th>Cost per shipment</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td class="num">${x.lane}</td><td>${esc(x.name || x.country)}</td><td class="num">${x.band}</td><td>${esc(x.mode)}</td><td class="n">${numTxt(x.transit, 1)}</td><td class="n">${numTxt(x.worst, 1)}</td><td class="n">${numTxt(x.perKg, 2)}</td><td class="n">${numTxt(x.minCharge, 2)}</td><td class="n">${pctTxt(x.fuel)}</td><td class="n">${numTxt(x.docs, 2)}</td><td class="n">${numTxt(x.other, 2)}</td><td class="n">${pctTxt(x.discountB)}</td><td class="n">${numTxt(x.perShipment, 2)}</td></tr>`).join("")}</tbody></table></div>`;
  } else if (T === "costs") {
    body = `<div class="tablewrap"><table><thead><tr><th>Scenario</th><th>All from Helmond</th><th>Direct from Helmond</th><th>Other origins</th><th>Total ${esc(cur)}</th><th>Cost per kg</th></tr></thead><tbody>
      ${D.costs.map(c => `<tr><td><b>${c.scenario}</b></td><td class="n">${numTxt(c.allFromHelmond)}</td><td class="n">${numTxt(c.directFromHelmond)}</td><td class="n">${numTxt(c.otherOrigins)}</td><td class="n"><b>${numTxt(c.total, 2)}</b></td><td class="n">${numTxt(c.perKg, 2)}</td></tr>`).join("")}</tbody></table></div>
      <h3 style="margin:12px 0 6px">Per lane</h3><div class="tablewrap"><table><thead><tr><th>Lane</th><th>Country</th><th>Cost A</th><th>Cost B</th><th>Cost per kg B</th><th>Average transit days</th></tr></thead><tbody>
      ${D.laneCosts.map(c => `<tr><td class="num">${c.lane}</td><td>${esc(c.country)}</td><td class="n">${numTxt(c.A)}</td><td class="n">${numTxt(c.B)}</td><td class="n">${numTxt(c.perKgB, 2)}</td><td class="n">${numTxt(c.transit, 1)}</td></tr>`).join("")}</tbody></table></div>`;
  } else if (T === "timeline") {
    body = `<div class="tablewrap"><table><thead><tr><th>Lane</th><th>Country</th><th>On target A</th><th>Days late A</th><th>On target B</th><th>Days late B</th></tr></thead><tbody>
      ${D.timeline.map(t => `<tr><td class="num">${t.lane}</td><td>${esc(t.country)}</td><td class="n">${pctTxt(t.onA)}</td><td class="n">${numTxt(t.lateA, 2)}</td><td class="n">${pctTxt(t.onB)}</td><td class="n">${numTxt(t.lateB, 2)}</td></tr>`).join("")}
      <tr class="sum"><td colspan="2">All lanes</td><td class="n">${pctTxt(D.timelineTotal.A)}</td><td></td><td class="n">${pctTxt(D.timelineTotal.B)}</td><td></td></tr></tbody></table></div>`;
  } else {
    body = `<div class="tablewrap btable" style="max-height:60vh"><table><thead><tr><th>ID</th><th>Question</th><th>Answer</th><th>Details</th><th>Evidence</th></tr></thead><tbody>
      ${D.kpi.map(k => `<tr><td class="num">${k.id}</td><td class="wrap" style="min-width:260px">${esc(k.question)}</td><td class="n">${ansTxt(k.answer, (r.types || {})["kpi." + k.id])}</td><td class="wrap">${esc(k.details)}</td><td>${k.evidence === "Yes" ? '<span class="okb yes">Evidence</span>' : `<span class="faint">${esc(k.evidence || "no")}</span>`}</td></tr>`).join("")}</tbody></table></div>`;
  }
  dlg.innerHTML = `<div class="bform"><div class="dhead"><div><span class="eyebrow">${esc(p.id)} · ${esc(p.type)}${badge(p)}</span><h2>${esc(p.name)}</h2></div>
      <div class="iact">${n ? `<select id="bxRespSel" aria-label="Upload">${p.rfqResponses.map((x, i) => `<option value="${i}"${i === ri ? " selected" : ""}>Upload ${i + 1} · ${esc(String(x.uploadedAt).slice(0, 10))} · ${esc(x.fileName)}${i === p.latestResponseIndex ? " (active)" : ""}</option>`).join("")}</select>` : ""}
        ${r && ri !== p.latestResponseIndex ? `<button type="button" class="btn ghost sm" data-a="activate">Make this upload active</button>` : ""}
        ${r && r.fileId ? `<button type="button" class="btn ghost sm" data-a="orig">Download original file</button>` : ""}<button type="button" class="btn ghost" data-a="close">Close</button></div></div>
    <div style="padding:10px 16px 0">${seg2("bxDetTabs", tabs, T)}${r ? `<span class="faint bnote" style="margin-left:10px">${esc(r.rfqVersion)} · ${esc(r.fileName)} · uploaded ${esc(String(r.uploadedAt).slice(0, 16).replace("T", " "))}${ri === p.latestResponseIndex ? " · active" : " · older upload"}</span>` : ""}</div>
    <div class="fbody" style="display:block">${body}</div></div>`;
  dlg.querySelector('[data-a="close"]').addEventListener("click", () => dlg.close());
  dlg.querySelector("#bxDetTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) openDetail(id, b.dataset.v, ri); });
  const rsel = dlg.querySelector("#bxRespSel"); if (rsel) rsel.addEventListener("change", () => openDetail(id, T, Number(rsel.value)));
  const ob = dlg.querySelector('[data-a="orig"]'); if (ob) ob.addEventListener("click", () => downloadOriginal(id, ri));
  const ab = dlg.querySelector('[data-a="activate"]');
  if (ab) ab.addEventListener("click", async () => { rfqOf(id).active = ri; await saveRfq(`Upload ${ri + 1} is now active for ${p.name}`); syncProviders(); await syncRfqQuotes(id); openDetail(id, T); renderProvTable(); });
  if (!dlg.open) dlg.showModal();
}
const seg2 = (id, list, v) => `<div class="seg" id="${id}" role="group">${list.map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${v === k}">${esc(l)}</button>`).join("")}</div>`;

// ---- comparison against Helmond on the test order set (Test Order sub-tab, provider tab and the report)
// Helmond: what FlexiTog pays per test order under DAP from Helmond (Master Data and parameters, via the engine).
// A provider: the Rate Card cost of one shipment for the order's lane and weight band (gross kg), in EUR.
// Providers without an active RFQ answer get no figures: "No RFQ answer yet", never an estimate.
function comparison(){
  const t = currentTest(); if (!t || !t.orders.length) return null;
  const dash = window.FlexiDash;
  // The Helmond baseline runs the route engine per order: cached per data version and test set.
  const H = FlexiCalc.memo("helmond", t.orders.map(o => o.id + ":" + o.units + ":" + o.country).join(","), () => t.orders.map(o => (dash ? dash.helmond(o) : null)));
  const base = B.providers.find(p => p.baseline), f = fx();
  const provs = B.providers.filter(p => !p.baseline).map(p => {
    const up = p.latestResponseIndex >= 0 ? p.rfqResponses[p.latestResponseIndex] : null;
    if (!up) return {p, none: true};
    const rates = up.rates || R.rateTable(up.values || {}), cur = String((up.summary || {}).currency || (up.values || {})["provider.currency"] || "EUR").toUpperCase();
    const rate = cur === "EUR" ? 1 : Number(f[cur]);
    return rate > 0 ? {p, rates, cur, fx: rate} : {p, cur, noFx: true};
  });
  const res = FlexiCalc.helmondComparison({orders: t.orders, helmond: H, providers: provs, laneFor: FRT.laneFor, bandFor: FRT.bandFor});
  const rows = [Object.assign({p: base || {name: "Helmond EU hub", id: "HLM", type: "Own hub", baseline: true}, kind: "baseline"}, res.baseline)].concat(res.rows);
  return {t, rows, orders: t.orders.length};
}
const signed = (v, dp) => (v == null ? "n/a" : (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), dp));
function comparisonHtml(C){
  if (!C) return `<p class="muted">No test order set yet: build one on Test Order and Report.</p>`;
  const tr = r => {
    const name = `<b>${esc(r.p.name)}</b>${r.kind === "baseline" ? ' <span class="st baseline">Baseline</span>' : ""}<br><span class="faint num">${esc(r.p.id)} · ${esc(r.p.type || "")}</span>`;
    if (r.kind === "none") return `<tr class="noans"><td>${name}</td><td colspan="7" class="faint">No RFQ answer yet</td></tr>`;
    if (r.kind === "fx") return `<tr class="noans"><td>${name}</td><td colspan="7" class="faint">Quoted in ${esc(r.cur)}, which has no exchange rate under Sales Data and Analysis. Add it to compare.</td></tr>`;
    const d = r.kind === "baseline" ? '<td class="n faint">baseline</td><td class="n faint">baseline</td><td class="n faint">baseline</td>'
      : `<td class="n">${signed(r.dOrder, 0)}</td><td class="n">${signed(r.dUnit, 2)}</td><td class="n">${signed(r.dLead, 1)}</td>`;
    return `<tr${r.kind === "baseline" ? ' class="baserow"' : ""}><td>${name}</td><td class="n">${fmt(r.n)} of ${fmt(C.orders)}</td><td class="n">${r.perOrder == null ? "n/a" : fmt(r.perOrder)}</td><td class="n">${r.perUnit == null ? "n/a" : fmt(r.perUnit, 2)}</td><td class="n">${r.lead == null ? "n/a" : fmt(r.lead, 1)}</td>${d}</tr>`;
  };
  return `<div class="tablewrap btable"><table><thead><tr><th>Provider</th><th>Orders priced</th><th>Cost per order EUR</th><th>Cost per unit EUR</th><th>Lead time (working days)</th><th>vs Helmond: per order</th><th>per unit</th><th>lead time</th></tr></thead><tbody>${C.rows.map(tr).join("")}</tbody></table></div>
    <p class="faint bnote">Helmond: what FlexiTog pays per test order under DAP from Helmond (handling, export documents, freight, insurance, delivery), from Master Data and the parameters. Providers: the Rate Card cost of one shipment for the order's lane and weight band, MAX(minimum, rate × kg) × (1 + fuel) + docs + other fees, in EUR. Differences use the orders both price. Lead time in working days after pickup.</p>`;
}
function renderCompare(){
  const el = $("bxCompare"); if (!el) return;
  const C = comparison();
  const rows = B.providers.filter(p => !p.baseline).map(p => R.getComparableMetrics(p)).filter(Boolean).sort((a, b) => (a.costB ?? Infinity) - (b.costB ?? Infinity));
  const base = B.providers.find(p => p.baseline);
  el.innerHTML = `<div class="card"><div class="cardhead"><h2>Against Helmond, on the test order set</h2><span class="faint" style="font-size:12px">${C ? `${fmt(C.orders)} test orders · Helmond first` : ""}</span></div>${comparisonHtml(C)}</div>` +
    `<div class="card"><div class="cardhead"><h2>RFQ answers</h2><span class="faint" style="font-size:12px">Active upload per provider · sorted by total cost B</span></div>
    <div class="tablewrap btable"><table><thead><tr><th>Provider</th><th>Total cost A</th><th>Total cost B</th><th>Cost per kg B</th><th>On target B</th><th>Bands without rate</th><th>R1 on-time</th><th>Q1 damage</th><th>H2 parties</th><th>Regions</th><th>Response</th></tr></thead><tbody>
    ${base ? `<tr class="baserow"><td><b>${esc(base.name)}</b> <span class="st baseline">Baseline</span><br><span class="faint num">${esc(base.id)}</span></td><td colspan="10" class="faint">Costs from Master Data, no RFQ. See the comparison above.</td></tr>` : ""}
    ${rows.map(m => { const p = B.providers.find(x => x.id === m.providerId);
      return `<tr data-id="${esc(m.providerId)}"><td><button type="button" class="lnk" data-a="detail">${esc(m.name)}</button>${p ? badge(p) : ""}<br><span class="faint num">${esc(m.providerId)}</span></td>
        <td class="n">${m.costA == null ? "n/a" : esc(m.currency || "") + " " + fmt(m.costA)}</td><td class="n">${m.costB == null ? "n/a" : esc(m.currency || "") + " " + fmt(m.costB)}</td><td class="n">${m.perKgB == null ? "n/a" : fmt(m.perKgB, 2)}</td>
        <td class="n">${m.onTargetB == null ? "n/a" : pctTxt(m.onTargetB)}</td><td class="n">${m.bandsWithoutRate ?? "n/a"}</td><td class="n">${m.r1OnTime == null ? "n/a" : pctTxt(m.r1OnTime)}</td>
        <td class="n">${m.q1Damage == null ? "n/a" : pctTxt(m.q1Damage)}</td><td class="n">${m.h2Parties ?? "n/a"}</td>
        <td><div class="tags">${m.regions.map(x => `<span class="tag r-${rc(x)}">${esc(x)}</span>`).join("")}</div></td>
        <td class="num">${esc(m.responseDate)}</td></tr>`; }).join("") || `<tr><td colspan="11" class="empty">No RFQ answers yet.</td></tr>`}</tbody></table></div></div>`;
  el.querySelectorAll('[data-a="detail"]').forEach(b => b.addEventListener("click", () => openDetail(b.closest("tr").dataset.id)));
}

// ---- printable reports (PDF through buildPdf). Internal: they hold provider contacts and quotes.
const money = (v, cur) => (typeof v === "number" ? `${cur || ""} ${fmt(v)}`.trim() : "n/a");
const pctPlain = v => (typeof v === "number" ? (v * 100).toFixed(1) + "%" : "n/a");
const dash = v => (isBlank(v) ? "-" : String(v));
const nameOf = p => p.name + (p.dummy && !/dummy/i.test(p.name) ? " (dummy)" : "") + (p.baseline ? " (Baseline)" : "");
// Comparison block shared by both PDFs: Helmond first, each answered provider against it, the rest marked.
function comparisonBlocks(C){
  if (!C) return [{p: "No test order set yet, so no cost comparison."}];
  return [{p: `${fmt(C.orders)} test orders from Test Order and Report. Helmond is the baseline: what FlexiTog pays under DAP from Helmond, from Master Data and the parameters. Providers: the Rate Card cost of one shipment for each order's lane and weight band, in EUR. Differences use the orders both price; lead time in working days after pickup.`},
    {table: {head: ["Provider", "Type", "Orders priced", "Per order EUR", "Per unit EUR", "Lead (wd)", "vs Helmond per order", "per unit", "lead"], align: ["l", "l", "r", "r", "r", "r", "r", "r", "r"],
      widths: [3, 1.5, 1.2, 1.3, 1.2, 1, 1.5, 1.1, 0.9], small: true,
      body: C.rows.map(r => r.kind === "none" ? [nameOf(r.p), r.p.type, "No RFQ answer yet", "", "", "", "", "", ""]
        : r.kind === "fx" ? [nameOf(r.p), r.p.type, `No exchange rate for ${r.cur}`, "", "", "", "", "", ""]
        : [nameOf(r.p), r.p.type || "", `${fmt(r.n)} of ${fmt(C.orders)}`, r.perOrder == null ? "n/a" : fmt(r.perOrder), r.perUnit == null ? "n/a" : fmt(r.perUnit, 2), r.lead == null ? "n/a" : fmt(r.lead, 1),
          r.kind === "baseline" ? "baseline" : signed(r.dOrder, 0), r.kind === "baseline" ? "" : signed(r.dUnit, 2), r.kind === "baseline" ? "" : signed(r.dLead, 1)])}}];
}
function comparisonReportModel(){
  const C = comparison(), date = today();
  return {title: "Logistics benchmark: providers against Helmond", provider: "", confidential: "Internal. Holds Helmond's costs and provider quotes. Do not send to providers.",
    cover: [["Date", longDate(date)], ["Test orders", C ? fmt(C.orders) : "none"], ["Answered providers", String(C ? C.rows.filter(r => r.kind === "rfq").length : 0)], ["Baseline", "Helmond EU hub (Master Data)"]],
    footer: `FlexiTog EU · Providers against Helmond · ${date}`, sections: [{h: "Cost comparison", newPage: false, blocks: comparisonBlocks(C)}]};
}
function providerReportModel(list){
  const date = today(), dummies = list.filter(p => p.dummy).length;
  const filters = [B.ui.q && `search "${B.ui.q}"`, B.ui.status !== "all" && `status ${statusLabel(B.ui.status)}`,
    B.ui.type !== "all" && `type ${B.ui.type}`, B.ui.region !== "all" && `region ${B.ui.region}`].filter(Boolean);
  const responded = list.filter(p => p.latestResponseIndex >= 0);
  const byStatus = [["baseline", "Baseline"]].concat(RFQ_STATUS).map(([k, l]) => [l, list.filter(p => p.status === k).length]).filter(x => x[1]);
  const overview = [
    {p: `${list.length} logistics provider${list.length === 1 ? "" : "s"} from Master Data, ${responded.length} with an RFQ answer.${dummies ? ` ${dummies} ${dummies === 1 ? "is" : "are"} placeholder or dummy data.` : ""}`},
    {table: {head: ["RFQ status", "Providers"], align: ["l", "r"], widths: [3, 1], body: byStatus}},
    {h3: "Provider list"},
    {table: {head: ["ID", "Provider", "Type", "Countries", "Contact", "Email", "RFQ status", "Sent", "Answer"], align: ["l", "l", "l", "l", "l", "l", "l", "l", "l"],
      widths: [1.3, 2.6, 1.5, 2.6, 1.7, 2.4, 1.4, 1.4, 1.4], small: true,
      body: list.map(p => [p.id, nameOf(p), p.type, p.countriesCovered.map(CNAME).join(", "), dash(p.contactName), dash(p.contactEmail), statusLabel(p.status), dash(p.dateRfqSent), dash(p.dateResponseReceived)])}}];
  const sections = [{h: "Overview", blocks: overview}, {h: "Against Helmond", newPage: false, blocks: comparisonBlocks(comparison())}];
  const profiles = [];
  list.forEach((p, i) => {
    if (i) profiles.push({newPage: true});
    const r = p.latestResponseIndex >= 0 ? p.rfqResponses[p.latestResponseIndex] : null;
    profiles.push({h3: `${nameOf(p)} · ${p.id}`});
    profiles.push({table: {head: ["Field", "Value"], align: ["l", "l"], widths: [1, 3], small: true, body: [
      ["Type", p.type], ["RFQ status", statusLabel(p.status)], ["Website", dash(p.website)], ["Contact", dash(p.contactName)], ["Phone", dash(p.contactPhone)],
      ["Email", dash(p.contactEmail)], ["Country", dash(p.hqCountry && CNAME(p.hqCountry))], ["Countries and lanes", dash(p.countriesCovered.map(laneTag).join(", "))],
      ["RFQ sent", dash(p.dateRfqSent)], ["Answer received", dash(p.dateResponseReceived)], ["Test order sent", dash(p.dateTestOrderSent)], ["Notes", dash(p.notes)]].filter(x => x[1] !== "-")}});
    if (p.baseline) { profiles.push({p: "Baseline: costs and lead times from Master Data and the parameters. No RFQ."}); return; }
    if (!r) { profiles.push({p: "No RFQ answer yet."}); return; }
    const v = r.values || {}, s = r.summary || R.summarize(v), D = R.detail(v, r.labels || {}), m = R.getComparableMetrics(p) || {}, cur = s.currency || "EUR";
    profiles.push({p: `Active upload ${p.latestResponseIndex + 1} of ${p.rfqResponses.length}: ${r.fileName}, ${r.rfqVersion}, response date ${dash(s.responseDate || String(r.uploadedAt).slice(0, 10))}.` +
      `${s.quoteReference ? ` Quote ${s.quoteReference}.` : ""}${s.quoteValidUntil ? ` Valid until ${s.quoteValidUntil}.` : ""}`});
    profiles.push({table: {head: ["Key figure", "Scenario A", "Scenario B"], align: ["l", "r", "r"], widths: [2, 1, 1], small: true, body: [
      ["Total cost", money(s.costA, cur), money(s.costB, cur)], ["Cost per kg", s.perKgA == null ? "n/a" : fmt(s.perKgA, 2), s.perKgB == null ? "n/a" : fmt(s.perKgB, 2)],
      ["On target", pctPlain(s.onTargetA), pctPlain(s.onTargetB)]]}});
    profiles.push({table: {head: ["Lane", "Country", `Cost A ${cur}`, `Cost B ${cur}`, "Per kg B", "Transit days"], align: ["l", "l", "r", "r", "r", "r"], widths: [0.8, 2, 1.3, 1.3, 1, 1], small: true,
      body: D.laneCosts.map(c => [c.lane, c.country, typeof c.A === "number" ? fmt(c.A) : "n/a", typeof c.B === "number" ? fmt(c.B) : "n/a",
        typeof c.perKgB === "number" ? fmt(c.perKgB, 2) : "n/a", typeof c.transit === "number" ? fmt(c.transit, 1) : "n/a"])}});
    const certs = D.certs.filter(c => !isBlank(c.value) && c.value !== "No").map(c => c.label + (c.value !== "Yes" ? ": " + c.value : ""));
    profiles.push({table: {head: ["Reliability and quality", "Answer"], align: ["l", "r"], widths: [3, 1], small: true, body: [
      ["On-time delivery rate, last 12 months (R1)", pctPlain(m.r1OnTime)], ["Damage and loss rate, last 12 months (Q1)", pctPlain(m.q1Damage)],
      ["Parties handling a shipment, Helmond to door (H2)", dash(m.h2Parties)], ["Questions answered", `${s.kpiAnswered} of ${s.kpiTotal}`],
      ["Answers with evidence", dash(s.kpiWithEvidence)], ["Weight bands without a rate", dash(s.bandsWithoutRate)]]}});
    profiles.push({p: `Certifications: ${certs.length ? certs.join(", ") : "none stated"}.`});
  });
  sections.push({h: "Provider profiles", newPage: true, blocks: profiles});
  return {title: "Logistics providers report", provider: "", confidential: "Internal. Holds provider contact details, quotes and Helmond's costs. Share only with the FlexiTog team.",
    cover: [["Date", longDate(date)], ["Providers", String(list.length)], ["RFQ answers", String(responded.length)], ["Selection", filters.length ? filters.join(", ") : "all providers"]],
    footer: `FlexiTog EU · Logistics providers report · ${date}`, sections};
}
async function pdfOut(name, model){
  if (!(window.jspdf && window.jspdf.jsPDF)) { toast("PDF export is not available in this copy", "bad"); return; }
  try { await saveFile(name, new Blob([await buildPdf(model)], {type: "application/pdf"})); }
  catch (e) { console.error(e); toast("Building the report failed: " + (e && e.message ? e.message : e), "bad"); }
}
async function printProviders(){
  const list = provFiltered();
  if (!list.length) { toast("No providers in the current view to print", "bad"); return; }
  await pdfOut(`FlexiTog_logistics_providers_report_${today()}.pdf`, providerReportModel(list));
}
const printComparison = () => pdfOut(`FlexiTog_providers_vs_Helmond_${today()}.pdf`, comparisonReportModel());

// ---- one-time move of the old Benchmarking provider list (before Master Data was the source) into Master Data.
// Rows already in Master Data (same ID or name) keep their Master Data values; their RFQ history moves to the new store.
async function migrateOldProviders(old, responses){
  const byRef = {}; (responses || []).forEach(x => { byRef[x.ref] = x.values; });
  const rows = MD.t.distribution_centers || [], add = [];
  const typeOf = p => { const t = [].concat(p.providerTypes || [], p.type ? [p.type] : []).map(String);
    return t.some(x => /^3pl/i.test(x)) ? "3PL" : t.some(x => /distributor/i.test(x)) && !t.some(x => /forward|carrier|courier|broker|4pl/i.test(x)) ? null : "Freight forwarder"; };
  old.forEach(p => {
    if (!p || !p.name) return;
    const name = String(p.name).trim();
    let row = rows.find(r => String(r.dc_id) === String(p.id)) || rows.find(r => norm(r.name) === norm(name)) || add.find(r => r.dc_id === p.id);
    const t = typeOf(p);
    if (!row) {
      if (!t) return;   // distributors stay out of Benchmarking
      const id = /^PRV-\d+$/.test(String(p.id || "")) ? String(p.id) : nextProviderId();
      row = {dc_id: id, name, dc_type: t === "3PL" ? "3pl" : "freight_forwarder", provider_type: t, status: "candidate", country: toIso2(p.hqCountry || p.hq_country) || "NL",
        serves_countries: (p.countriesCovered || p.countries || []).join(";"), contact_name: p.contactName || p.contact_person || null, contact_email: p.contactEmail || p.email || null,
        contact_phone: p.contactPhone || p.phone || null, website: p.website || null, notes: p.notes || null, data_source: p.dummy ? "placeholder" : "manual"};
      add.push(row);
    }
    const ups = (p.rfqResponses || []).map(x => Object.assign({}, x, {values: x.values || byRef[x.ref] || {}}));
    ups.forEach(u => { if (!u.rates) u.rates = R.rateTable(u.values); });
    const was = String(p.status || "");
    B.rfq[String(row.dc_id)] = {status: ["rfq_sent", "test_order_sent", "response_received", "shortlisted", "rejected"].includes(was) ? "sent" : "not_sent",
      sentDate: p.dateRfqSent || "", testOrderSent: p.dateTestOrderSent || p.test_sent || "", uploads: ups,
      active: ups.length ? Math.min(Math.max(Number.isInteger(p.latestResponseIndex) ? p.latestResponseIndex : ups.length - 1, 0), ups.length - 1) : -1, migratedFrom: p.id};
  });
  if (add.length) await mdUpsertRows("distribution_centers", add);
  B.respDirty = true; await saveRfq();
  return add.length;
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
    return `<tr><td>${n === "All regions" ? "<b>All regions</b>" : `<span class="rdot r-${rc(n)}"></span>${esc(n)}`}</td>${g.index.map((v, i) => `<td class="h" style="background:${v == null ? "transparent" : `color-mix(in srgb,var(--q3) ${Math.round(8 + 80 * v / mx)}%,transparent)`};${v != null && v / mx > .6 ? "color:var(--on-strong);" : ""}${g.peak.includes(i) ? "font-weight:700;" : ""}" title="${esc(n)} ${C.MONTHS_LONG[i]}: index ${v == null ? "no data" : Math.round(v)}">${v == null ? "" : Math.round(v)}</td>`).join("")}</tr>`;
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
    <p class="muted bcard-lead">The analysis and the test orders run on every ticked source. Add exports from each merged entity as CSV or Excel. You map the columns once per file. Target countries: ${TARGETS().map(CNAME).join(", ")} (from Master Data > Countries).</p>
    ${srcList()}
    <label class="drop" id="bxDrop"><span><b>Add sales files</b><br><span class="muted">CSV or Excel, one or more files, several years. Drop them here or click to choose.</span></span><input type="file" id="bxFiles" multiple accept=".csv,.txt,.xlsx,.xlsm,.xls" aria-label="Choose sales files"></label>
    <div id="bxUpload"></div>
    <details class="custom"><summary><b>Exchange rates</b><span class="faint">EUR per unit of currency. Placeholder rates: replace them with the rates finance uses.</span></summary>
      <div class="fx">${cur.map(c => `<label>${esc(c)}<input type="number" step="any" min="0" data-fx="${esc(c)}" value="${esc(c === "USD" ? +fx().USD.toFixed(6) : B.settings.fx[c])}"${c === "EUR" || c === "USD" ? " disabled" : ""}${c === "USD" ? ' title="From Master Data > Settings (eurUsdRate)"' : ""}></label>`).join("")}</div>
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
    try { await DataStore.del("sales_" + id); } catch (err) {}
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
    const res = C.cleanSales(raw, {source: "preview", defaultCurrency: U.currency, fx: fx(), skuInfo: skuInfo(), regionOf, countryOf: v => (isBlank(v) ? null : toIso2(v))});
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
    kind: t.kind || "history", label: t.label || "",
    orders: t.orders, lanes: t.lanes, goals: B.goals.map(x => x.id)};
}
// Stored snapshot: never real customer names or source order numbers.
const packageSnapshot = pkg => ({id: pkg.id, created: pkg.created, seed: pkg.seed, base_years: pkg.base_years, scale: pkg.scale, mode: pkg.mode, goals: pkg.goals,
  orders: pkg.orders.map(o => ({id: o.id, month: o.month, country: o.country, region: o.region, port: place(o), customer: o.customer, lines: o.lines.length, units: o.units, cartons: o.cartons, pallets: o.pallets, weight_kg: o.weight_kg, volume_m3: o.volume_m3, value_eur: o.value_eur})),
  lanes: pkg.lanes.map(l => ({lane_id: l.lane_id, country: l.country, region: l.region, orders: l.orders, pallets: l.pallets, weight_kg: l.weight_kg})), sent: []});
function checkHtml(t){
  if (t.kind === "forecast") return `<div class="card"><div class="cardhead"><h2>From the forecast</h2><span class="okb yes">Average month</span></div>
    <p class="muted bcard-lead">${fmt(t.orders.length)} test orders = one average month of the 2027 forecast (${esc(t.label)}): ${fmt(t.yearly.orders, 0)} orders and ${fmt(t.yearly.units)} units a year, divided by 12, with each country's product class mix. Change the method or scenario on the Forecast view.</p></div>`;
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
  if (B.settings.gen.source === "forecast" && !currentTest()) { B.settings.gen.source = "history"; toast("The forecast is not ready. Using the sales history"); }
  if (B.settings.gen.source !== "forecast" && (!B.clean || !B.clean.lines.length)) { P.innerHTML = `<div class="empty-state">No sales lines to build test orders from. Add or tick a source on Sales Data and Analysis.</div>`; return; }
  const t = currentTest(), g = B.settings.gen, ys = years(), rep = B.settings.report, pal = PAL.screen;
  const baseSel = (g.baseYears || []).filter(y => ys.includes(y));
  const usdEur = Number(g.targetUsd) * (Number(fx().USD) || 1);
  const vals = g.showValues;
  const monthly = C.MONTHS.map((_, i) => REGIONS.map(r => t.orders.filter(o => o.month === i + 1 && o.region === r).length));
  const chart = barsV({label: "Test orders per month by region", labels: C.MONTHS, stacked: true, series: REGIONS.map((r, k) => ({name: r, color: regionColor(pal, r), values: monthly.map(m => m[k])})), yLabel: "Test orders", h: 220});
  P.innerHTML = `<div class="card">
    <div class="cardhead"><h2>Test order set</h2><span class="faint" style="font-size:12px">${t.kind === "forecast" ? "one average month of the 2027 forecast" : "12 months"} · ${fmt(t.orders.length)} orders${t.kind === "forecast" ? "" : " · seed " + esc(t.seed)}</span></div>
    <div class="ctl" style="margin-bottom:8px"><label>Build the test set from</label>${segHtml("bxSource", [["history", "Sales history (12 months)"], ["forecast", "Forecast: average month"]], g.source === "forecast" ? "forecast" : "history")}</div>
    ${t.kind === "forecast" ? "" : `<p class="muted bcard-lead">Orders drawn from the sales history month by month with a fixed random seed. Each test order copies a real order's country, garment and size mix. Customers become codes per region, largest first. The same options and seed always give the same set.</p>`}
    <div class="optgrid"${t.kind === "forecast" ? " hidden" : ""}>
      <div class="ctl"><label>Base years</label><div class="checks" style="flex-direction:row;flex-wrap:wrap;gap:4px 12px;margin:0">${ys.map(y => `<label class="toggle" style="align-items:center"><input type="checkbox" data-year="${y}"${!baseSel.length || baseSel.includes(y) ? " checked" : ""}>${y}</label>`).join("")}</div></div>
      <div class="ctl"><label>Volume</label>${segHtml("bxMode", [["factor", "Scale factor"], ["target", "Yearly revenue target"]], g.mode)}</div>
      ${g.mode === "factor" ? `<div class="ctl"><label for="bxScale">Scale factor</label><input type="number" id="bxScale" min="0.05" max="20" step="0.05" value="${esc(g.scale)}"></div>`
        : `<div class="ctl"><label for="bxTarget">Revenue target USD per year</label><input type="number" id="bxTarget" min="10000" step="10000" value="${esc(g.targetUsd)}"></div><span class="faint bnote">= EUR ${fmt(usdEur)} at ${fmt(fx().USD, 4)} EUR per USD (Settings) · history EUR ${fmt(t.hist.value)} per year · factor ${t.scale.toFixed(2)}</span>`}
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
  <div class="card"><div class="cardhead"><h2>Cost against Helmond</h2><div class="iact"><span class="faint" style="font-size:12px">Helmond first, then every provider with an active RFQ answer</span><button type="button" class="btn ghost sm" id="bxCmpPdf">Comparison report (PDF)</button></div></div>
    ${comparisonHtml(comparison())}<p class="faint bnote">Internal: the comparison report holds Helmond's costs and provider quotes. The package below goes to providers and never includes them.</p></div>
  <div class="card"><div class="cardhead"><h2>Benchmarking report</h2><span class="faint" style="font-size:12px">PDF and Word report, Excel response template</span></div>
    <p class="muted bcard-lead">One report per ticked provider, or a generic version without a provider name. The report covers the purpose, instructions, origin Helmond, the yearly volume profile and seasonality, every test order, the service goals and the response deadline. Customer names, margins, purchase prices and supplier costs never appear in the files.</p>
    <div class="bgrid2">
      <div class="fld"><span class="flab">Report for</span><div class="bprov" id="bxProvSel">
        <label><input type="checkbox" value="generic"${B.ui.sel.has("generic") ? " checked" : ""}><span><b>Generic version</b> <span class="faint">no provider name</span></span></label>
        ${B.providers.filter(p => !p.baseline).map(p => `<label><input type="checkbox" value="${esc(p.id)}"${B.ui.sel.has(p.id) ? " checked" : ""}><span>${esc(p.name)} <span class="faint">${esc(p.type)}</span> <span class="st ${p.status === "answered" ? "response_received" : esc(p.status)}">${esc(statusLabel(p.status))}</span>${p.dateTestOrderSent ? ` <span class="faint num">test order sent ${esc(p.dateTestOrderSent)}</span>` : ""}</span></label>`).join("")}
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
  $("bxSource").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; g.source = b.dataset.v; B.test = null; B.testKey = ""; re(); });
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
  $("bxCmpPdf").addEventListener("click", printComparison);
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
    cover: [["Prepared for", provName], ["Date", longDate(today())], ["Package", pkg.id], ["Test orders", pkg.kind === "forecast" ? `${fmt(n)} orders, one average month of the 2027 forecast` : `${fmt(n)} orders over 12 months`], ["Response deadline", rep.deadline ? longDate(rep.deadline) : "[deadline]"], ["Contact", contact]],
    confidential: "Confidential. This package is shared for quotation purposes only. Customer names are replaced by codes. Please do not pass it on.",
    footer: `FlexiTog EU · Logistics benchmark · ${pkg.id}${prov ? " · " + provName : ""}`,
    sections: [
      {h: "1. Introduction", blocks: [
        {p: "FlexiTog EU, based in Helmond, the Netherlands, supplies cold-store and freezer workwear to customers in Türkiye, North Africa and the Gulf/GCC. We are reviewing how we deliver to these markets. We invite a small number of logistics providers to quote on one standard test order package."},
        {p: pkg.kind === "forecast" ? `The package holds ${fmt(n)} test orders: one average month of our 2027 sales forecast, with its country mix, product mix and order sizes. Twelve such months make a year. Every provider receives the same package, so we compare the offers like for like.`
          : `The package holds ${fmt(n)} test orders spread over 12 months. It follows the seasonality, country mix, garment mix, order sizes and order frequency of our sales history. Every provider receives the same package, so we compare the offers like for like.`},
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
        pkg.kind === "forecast" ? {p: "The orders below are one average month. Multiply by 12 for the yearly volume per lane."} :
          charts.orders ? {img: charts.orders, caption: "Test orders per month by region"} : {p: "Chart not available in this copy."},
        charts.season ? {img: charts.season, caption: "Seasonality index from the sales history (average month = 100)"} : null,
        pkg.kind === "forecast" ? null : {table: Object.assign(R(["Month"].concat(REGIONS).concat(["All orders", "Units", "Pallets", "Weight kg"]), "l", "r", "r", "r", "r", "r", "r", "r"), {body: monthRows})},
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
    const brk = sec.newPage ?? si === 3;
    if (brk) { doc.addPage(); y = 20; }
    need(20); y += si && !brk ? 4 : 0;
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...INK); doc.text(T(sec.h), L, y);
    doc.setDrawColor(...INK); doc.setLineWidth(0.6); doc.line(L, y + 2, L + Wd, y + 2); y += 9;
    sec.blocks.forEach(b => {
      if (b.newPage) { if (y > 30) { doc.addPage(); y = 20; } }
      else if (b.p) { text(b.p, 10); y += 2.5; }
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
    body.push(new D.Paragraph({heading: D.HeadingLevel.HEADING_1, pageBreakBefore: sec.newPage ?? si === 3,spacing: {before: si ? 320 : 0, after: 140}, keepNext: true,
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
  const targets = [...B.ui.sel].map(id => (id === "generic" ? null : B.providers.find(p => p.id === id && !p.baseline))).filter(x => x !== undefined);
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
      if (prov) rfqOf(prov.id).testOrderSent = date;
    }
    let snap = B.packages.find(k => k.id === pkg.id);
    if (!snap) { snap = packageSnapshot(pkg); B.packages.push(snap); }
    targets.forEach(p => snap.sent.push({provider_id: p ? p.id : "", provider_name: p ? p.name : "", date, formats: Object.keys(fm).filter(k => fm[k])}));
    if (B.packages.length > 30) B.packages = B.packages.slice(-30);
    await save("packages", B.packages);
    if (targets.some(Boolean)) await saveRfq();
    toast(`Report files ready for ${targets.length} recipient${targets.length > 1 ? "s" : ""}. Package ${pkg.id}`);
  } catch (e) { console.error(e); toast("Generating the report failed: " + (e && e.message ? e.message : e), "bad"); }
  finally { B.ui.busy = false; const y = window.scrollY; render(); window.scrollTo({top: y}); }
}

// ============================================================ start
async function init(){
  await storeReady();
  try {
    const names = ["goals", "settings", "packages", "salesmeta", "rfqstate", "rfqvalues", "providers", "rfqresponses"];
    const [goals, settings, packages, meta, rfqstate, rfqvalues, oldProv, oldResp] = await Promise.all(names.map(n => DataStore.get(n)));
    B.packages = packages || [];
    B.rfq = rfqstate || {};
    const byRef = {}; (rfqvalues || []).forEach(x => { byRef[x.ref] = x; });
    Object.values(B.rfq).forEach(st => (st.uploads || []).forEach(u => { const x = byRef[u.ref]; if (x) { u.values = x.values || {}; u.rates = x.rates || R.rateTable(u.values); } else u.values = u.values || {}; }));
    // Before Master Data held the providers, Benchmarking kept its own list ("providers"). Move it over once.
    if (rfqstate === undefined && Array.isArray(oldProv) && oldProv.length) {
      try { const n = await migrateOldProviders(oldProv, oldResp); await Saver.save(); if (n) toast(`${n} provider${n === 1 ? "" : "s"} moved from Benchmarking into Master Data`); }
      catch (e) { console.error(e); toast("Moving the old provider list into Master Data failed: " + (e.message || e), "bad"); }
    }
    B.goals = goals === undefined ? clone(DEFAULT_GOALS) : goals;
    if (settings) { const d = DEFAULT_SETTINGS(); B.settings = Object.assign(d, settings, {gen: Object.assign(d.gen, settings.gen || {}), report: Object.assign(d.report, settings.report || {}), fx: Object.assign(d.fx, settings.fx || {})}); }
    B.sources = [];
    for (const s of meta || []) { const rows = await DataStore.get("sales_" + s.id); if (rows) B.sources.push(Object.assign({}, s, {rows})); }
  } catch (e) { console.error(e); toast("Could not load the saved benchmarking data", "bad"); }
  try { await loadTemplates(); } catch (e) {}
  syncProviders();
  B.ready = true;
  recompute();
  if (VIEW.current === "bench") render();
  if (VIEW.current === "dash") renderView();   // the Route Dashboard drew before the RFQ answers loaded
}
// getComparableMetrics(provider or id): the latest RFQ response in comparable form, for the scorecard.
const getComparableMetrics = p => R.getComparableMetrics(typeof p === "string" ? B.providers.find(x => x.id === p) : p);
window.BenchUI = {show(){ render(); }, state: B, getComparableMetrics, syncProviders, comparison, comparisonReportModel, providerReportModel,
  rfq: {tmpl, uploadRfq, openDetail, removeUpload, downloadPrefilled, files: DataStore.files}, schema: {goals: GOAL_FIELDS}, reportModel, packageOf, templateBook, buildPdf, buildDocx, chartImages, currentTest};
init();
})();
