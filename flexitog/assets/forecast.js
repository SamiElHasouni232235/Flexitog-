/* FlexiTog dashboard: Forecast view. Sales forecast for 2027 from the Odoo sales order lines, with
 * four methods, a back-test, Low/Base/Target scenarios, and the demand object the route engine reads.
 *
 * Runs after workspace.js and benchmark.js and shares their globals (PAYLOAD, MD, W, R, ui, compute,
 * renderView, VIEW, readFile, saveFile, toast, esc, fmt, pct, clone, CNAME, regionOf, REGIONS, $).
 * The logic without DOM is in forecast_core.js (window.ForecastCore); charts in charts.js.
 *
 * Integration: window.DEMAND = {active, batch, volume, label, rows}. The main script's buildBatch()
 * prices DEMAND.batch instead of the sales history when active, and effectiveRaw() passes DEMAND.volume
 * to the engine (shipments per country, refill loads per node, owned warehouse pallets per year).
 */
(function () {
"use strict";
const FC = window.ForecastCore, CH = window.FlexCharts;
const KEY = "flexitog-forecast-v1";                     // per-viewer settings in this browser
const rc = r => ({"Türkiye": "TR", "North Africa": "NAF", "Gulf/GCC": "GCC"})[r] || "OTH";
const regionColor = (pal, c) => pal[rc(regionOf(c))] || pal.OTH;
const CUR_SYM = {USD: "$", EUR: "€", GBP: "£"};
const money = (v, cur) => (CUR_SYM[cur] || cur + " ") + fmt(v);
const smoney = (v, cur) => (CUR_SYM[cur] || "") + CH.sfmt(v);
const LOGISTIC = ["cif_baseline", "distributor", "3pl", "owned_warehouse"];

// Product class -> representative SKU (origin, supplier, duty and compliance rules) and units per EUR
// pallet. The SKU's own price is not used: forecast lines carry the net unit price from history.
const CLASS_SKU = {Jackets: ["Jackets"], Trousers: ["Trousers"], Coveralls: ["Coveralls"], Baselayers: ["Vests", "Jackets"],
  "Other clothing": ["Vests", "Jackets"], Gloves: ["Gloves"], Footwear: ["Footwear"], Headwear: ["Headwear"], Accessories: ["Socks", "Headwear"],
  "Drying cabinets": ["Footwear"]};
function defaultClassProfile(){
  const out = {}, prods = MD.t.products || [];
  FC.CLASSES.forEach(k => {
    const p = (CLASS_SKU[k] || []).map(f => prods.find(x => String(x.product_family) === f)).find(Boolean) || prods[0] || {};
    out[k] = {sku: p.sku || "", units_per_pallet: k === "Drying cabinets" ? 4 : Number(p.units_per_pallet) || 100, gross_margin_pct: 40};
  });
  return out;
}
const DEFAULT_SET = () => ({
  method: "holt", scenario: "Base", reporting: FC.DEFAULTS.reporting, fx: clone(FC.DEFAULTS.fx), upliftPct: 0,
  alpha: FC.DEFAULTS.alpha, beta: FC.DEFAULTS.beta, newPerQuarter: {}, targetLow: FC.DEFAULTS.targetLow, targetHigh: FC.DEFAULTS.targetHigh,
  weightMode: "history", weights: {}, includeProjects: FC.DEFAULTS.includeProjects, useAsDemand: true, refillsPerYear: 12,
  feasibleDays: {TR: 1, NAF: 1, GCC: 2}, classProfile: defaultClassProfile(), asOf: FC.DEFAULTS.asOf, capPercentile: FC.DEFAULTS.capPercentile,
});

// ============================================================ state
const FS = {ready: false, source: null, records: [], lines: [], report: null, set: DEFAULT_SET(), F: null, all: {}, rows: [], batch: null, volume: null, ver: 0};
try {
  const s = JSON.parse(localStorage.getItem(KEY) || "null");
  if (s) { const d = DEFAULT_SET(); FS.set = Object.assign(d, s, {fx: Object.assign(d.fx, s.fx || {}), classProfile: Object.assign(d.classProfile, s.classProfile || {}), feasibleDays: Object.assign(d.feasibleDays, s.feasibleDays || {})}); }
} catch (e) {}
const saveSet = () => { try { localStorage.setItem(KEY, JSON.stringify(FS.set)); } catch (e) {} };

function loadTable(t, name, anonymized){
  FS.source = {name, anonymized, rows: t.rows.length};
  FS.records = FC.fromTable(t.headers, t.rows);
  clean();
}
function clean(){
  const res = FC.clean(FS.records, {fx: FS.set.fx, reporting: FS.set.reporting, countryOf: v => (v ? toIso2(v) : null)});
  FS.lines = res.lines; FS.report = res.report; FS.ver++;
}
const opts = () => Object.assign({}, FS.set, {customerAliases: FC.DEFAULTS.customerAliases,
  weights: FS.set.weightMode === "user" ? FS.set.weights : null});

// ============================================================ recompute: forecast -> demand -> engine
let engineTimer = null;
function recompute(engine){
  if (!FS.lines.length) { FS.F = null; FS.rows = []; window.DEMAND = null; return; }
  const o = opts();
  const bt = FC.backtest(FS.lines, o);
  FS.all = {};
  FC.METHODS.forEach(([m]) => { FS.all[m] = FC.forecast(FS.lines, Object.assign({}, o, {method: m, backtest: bt})); });
  FS.F = FS.all[FS.set.method];
  const eurPer = Number(FS.set.fx[FS.set.reporting]) || 1;
  FS.rows = FC.demand(FS.F, FS.set.scenario, eurPer);
  // Engine batch: one synthetic customer per country, at the most common city and port on file.
  const cities = {}, ports = {};
  Object.entries(FS.F.H.profile).forEach(([c, p]) => { cities[c] = p.city; });
  (MD.t.customers || []).forEach(c => { if (c.country && c.destination_port && !ports[c.country]) ports[c.country] = c.destination_port; });
  FS.batch = FC.forecastBatch(FS.rows.filter(r => REGIONS.includes(regionOf(r.country))), FS.set.classProfile, {cities});
  FS.batch.customers.forEach(c => { c.destination_port = ports[c.country] || null; c.region = regionOf(c.country); });
  FS.volume = FC.volumes(FS.batch, W.dcs, Number(FS.set.refillsPerYear) || 12);
  const outside = [...new Set(FS.rows.filter(r => !REGIONS.includes(regionOf(r.country))).map(r => r.country))];
  window.DEMAND = {active: !!FS.set.useAsDemand, batch: FS.batch, volume: FS.volume, rows: FS.rows, scenario: FS.set.scenario,
    label: `forecast 2027 ${FS.set.scenario.toLowerCase()} (${FC.METHODS.find(m => m[0] === FS.set.method)[1].toLowerCase()})`,
    notes: outside.length ? [`Forecast countries outside the study regions are left out of routing: ${outside.join(", ")}`] : []};
  if (engine !== false) { clearTimeout(engineTimer); engineTimer = setTimeout(runEngine, 250); }
}
function runEngine(){
  compute(); renderView();
  if (VIEW.current === "report" && typeof renderReport === "function") renderReport();
  if (VIEW.current === "forecast") renderImpact();
}

// ============================================================ render
function render(){
  const P = $("viewForecast");
  if (!FS.ready) { P.innerHTML = `<div class="card"><p class="muted">Loading sales orders…</p></div>`; return; }
  if (!FS.F) { P.innerHTML = controlsHtml() + `<div class="empty-state">No sales order lines. Upload the Odoo export (Sheet1, Order Lines/ columns).</div>`; bind(P); return; }
  P.innerHTML = controlsHtml() + statsHtml() + chartsHtml() + tablesHtml() + `<div id="fcImpact"></div>` + assumptionsHtml();
  bind(P); renderImpact();
}
function chips(){
  const F = FS.F, w = F ? F.backtest.wape[FS.set.method] : null;
  return (FS.source && FS.source.anonymized ? `<span class="chip demo" title="Anonymized sample: names, prices and quantities are perturbed">Dummy data · read the tool, not the numbers</span>` : "") +
    (F && F.indicative ? `<span class="chip" style="background:var(--band);box-shadow:inset 0 0 0 1px var(--band-edge)" title="Back-test WAPE above ${pct(FC.DEFAULTS.indicativeWape)}">Indicative forecast · WAPE ${w == null ? "n/a" : pct(w)}</span>` : "") +
    (FS.source ? `<span class="chip">${esc(FS.source.name)} · ${fmt(FS.report.lines)} lines · ${fmt(FS.report.orders)} orders</span>` : "") +
    `<span class="chip">${FS.set.useAsDemand ? "Feeds the Route Dashboard" : "Not used as demand"}</span>`;
}
function seg(id, list, v){ return `<div class="seg" id="${id}">${list.map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${String(v) === String(k)}">${esc(l)}</button>`).join("")}</div>`; }
function controlsHtml(){
  const s = FS.set, H = FS.F ? FS.F.H : null, countries = H ? H.countries : [];
  const curs = Object.keys(s.fx);
  return `<div class="bhead"><p class="muted" style="font-size:13px;max-width:760px">2027 sales forecast from the Odoo sales order lines. Pick a method and a scenario: the result is the demand every route scenario prices on the Route Dashboard, the report extract and the Benchmarking test order.</p><div class="bchips" id="fcChips">${chips()}</div></div>
  <div class="card"><div class="cardhead"><h2>Forecast settings</h2><div class="iact">
      <label class="btn ghost filebtn">Upload Odoo export<input type="file" id="fcFile" accept=".xlsx,.xls,.csv" aria-label="Upload Odoo sales order lines"></label>
      ${FS.source && !FS.source.anonymized ? `<button type="button" class="btn ghost" id="fcSample">Back to the sample</button>` : ""}
      <button type="button" class="btn ghost" id="fcReset">Reset settings</button></div></div>
    <div class="optgrid">
      <div class="ctl"><label>Method</label>${seg("fcMethod", FC.METHODS, s.method)}</div>
      <div class="ctl"><label>Scenario fed to the routes</label>${seg("fcScen", FC.SCENARIOS.map(x => [x, x]), s.scenario)}</div>
      <div class="ctl"><label for="fcCur">Reporting currency</label><select id="fcCur">${curs.map(c => `<option${c === s.reporting ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="ctl"><label>FX (EUR per unit)</label><div class="fx" style="grid-template-columns:repeat(${curs.length - 1},minmax(110px,1fr))">${curs.filter(c => c !== "EUR").map(c => `<label>${esc(c)}<input type="number" step="any" min="0" data-fx="${esc(c)}" value="${esc(s.fx[c])}"></label>`).join("")}</div></div>
      <div class="ctl"><label for="fcUp">Growth uplift %</label><input type="number" id="fcUp" step="1" value="${esc(s.upliftPct)}" style="width:90px"></div>
      <label class="toggle"><input type="checkbox" id="fcProj"${s.includeProjects ? " checked" : ""}><span>Include project orders<small>Orders above the P${s.capPercentile} order value (${H ? money(H.cap, s.reporting) : "n/a"}) count in full</small></span></label>
      <label class="toggle"><input type="checkbox" id="fcUse"${s.useAsDemand ? " checked" : ""}><span>Use as demand<small>Route Dashboard, report and benchmark read this forecast</small></span></label>
    </div>
    <div class="optgrid" style="margin-top:4px">
      ${s.method === "holt" ? `<div class="ctl"><label for="fcA">Alpha (level) ${esc(s.alpha)}</label><input type="range" id="fcA" min="0.05" max="0.95" step="0.05" value="${esc(s.alpha)}"></div>
        <div class="ctl"><label for="fcB">Beta (trend) ${esc(s.beta)}</label><input type="range" id="fcB" min="0" max="0.9" step="0.05" value="${esc(s.beta)}"></div>` : ""}
      <div class="ctl"><label for="fcTL">2027 target low (${esc(s.reporting)})</label><input type="number" id="fcTL" step="10000" value="${esc(s.targetLow)}" style="width:140px"></div>
      <div class="ctl"><label for="fcTH">2027 target high (${esc(s.reporting)})</label><input type="number" id="fcTH" step="10000" value="${esc(s.targetHigh)}" style="width:140px"></div>
      <div class="ctl"><label>Country weights (target allocation)</label>${seg("fcWM", [["history", "Historical share"], ["user", "My weights"]], s.weightMode)}</div>
    </div>
    ${(s.method === "customer" || s.weightMode === "user") && countries.length ? `<div class="tablewrap" style="margin-top:6px"><table><thead><tr><th>Country</th>${countries.map(c => `<th>${esc(CNAME(c))}</th>`).join("")}</tr></thead><tbody>
      ${s.method === "customer" ? `<tr><td>New customers per quarter</td>${countries.map(c => `<td><input type="number" min="0" step="1" data-npq="${c}" value="${esc(s.newPerQuarter[c] || 0)}" style="width:70px"></td>`).join("")}</tr>` : ""}
      ${s.weightMode === "user" ? `<tr><td>Weight</td>${countries.map(c => `<td><input type="number" min="0" step="1" data-w="${c}" value="${esc(s.weights[c] ?? "")}" placeholder="0" style="width:70px"></td>`).join("")}</tr>` : ""}
    </tbody></table></div>` : ""}
  </div>`;
}
function statsHtml(){
  const F = FS.F, cur = FS.set.reporting, t = F.totals, bt = F.backtest, w = bt.wape[FS.set.method];
  const sel = t[FS.set.scenario].net, gap = F.target.mid - t.Base.net;
  return `<div class="card"><div class="cardhead"><h2>2027 at a glance</h2><span class="faint" style="font-size:12px">${esc(FC.METHODS.find(m => m[0] === FS.set.method)[1])} · net revenue incl. freight billed · ${esc(cur)}</span></div>
    <div class="bstat">
      <div><b>${smoney(t.Low.net, cur)}</b><span>Low</span></div><div><b>${smoney(t.Base.net, cur)}</b><span>Base</span></div><div><b>${smoney(t.High.net, cur)}</b><span>High</span></div>
      <div><b>${smoney(F.target.low, cur)}–${smoney(F.target.high, cur)}</b><span>Target range</span></div>
      <div><b>${gap > 0 ? smoney(gap, cur) : "none"}</b><span>Gap Base to target midpoint</span></div>
      <div><b>${w == null ? "n/a" : pct(w)}</b><span>Back-test WAPE (country x month)</span></div>
      <div><b>${smoney(F.projects.ttm, cur)}</b><span>Project orders, last 12 months (${F.projects.count} orders above cap)</span></div>
      <div><b>${fmt(FS.rows.reduce((a, r) => a + r.units, 0))}</b><span>Units, ${esc(FS.set.scenario)}</span></div>
    </div>
    ${F.indicative ? `<p class="warnc" style="font-size:13px">Indicative: the back-test error is ${w == null ? "unknown" : pct(w)} (above ${pct(FC.DEFAULTS.indicativeWape)}). Sixteen months of lumpy orders do not support a precise forecast; read the range, not the point.</p>` : ""}
  </div>`;
}
// History (actual total net per month) + the gap months + 2027 forecast.
function timeline(){
  const F = FS.F, H = F.H, last = H.months[H.months.length - 1];
  const months = FC.monthRange(H.months[0], F.months[F.months.length - 1]);
  const actual = {}; FS.lines.forEach(l => { actual[l.month] = (actual[l.month] || 0) + l.net_rep; });
  const net = scen => { const out = F.months.map(() => 0); Object.entries(F.scenarios[scen]).forEach(([c, a]) => a.forEach((v, i) => { out[i] += v * (1 + ((H.profile[c] || {}).freight_ratio ?? H.freightRatio)); })); return out; };
  const at = (arr, m) => { const i = F.months.indexOf(m); return i >= 0 ? arr[i] : null; };
  const S = {Low: net("Low"), Base: net("Base"), High: net("High"), Target: net("Target")};
  return {months, last, hist: months.map(m => (m <= last ? actual[m] || 0 : null)), S, at, fc: k => months.map(m => at(S[k], m))};
}
function chartsHtml(){
  const F = FS.F, cur = FS.set.reporting, pal = CH.PAL.screen, T = timeline();
  const lab = m => m.slice(5) === "01" ? m.slice(0, 4) : ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m.slice(5)];
  const c1 = CH.lineChart({label: "History and 2027 forecast", labels: T.months.map(lab), fmt: v => smoney(v, cur), tip: v => money(v, cur),
    band: {lo: T.fc("Low"), hi: T.fc("High"), name: "Low to High"}, marker: T.months.indexOf(F.months[0]), markerLabel: "2027 forecast",
    series: [{name: "Actual", color: pal.ink, values: T.hist, width: 2.5}, {name: "Base", color: pal.accent, values: T.fc("Base"), width: 2.5},
             {name: "Target", color: pal.q[3], values: T.fc("Target"), dash: "6 4", dots: false}], h: 260});
  const sel = T.S[FS.set.scenario], tm = F.target.mid / 12;
  const gaps = sel.map(v => tm - v);
  const c2 = CH.barsV({label: "Gap to target by month", labels: F.months.map(lab), fmt: v => smoney(v, cur), tip: v => (v > 0 ? "short " : "ahead ") + money(Math.abs(v), cur),
    series: [{name: "Gap to target midpoint", values: gaps, colorFor: v => (v > 0 ? "var(--st-critical)" : "var(--ok)")}], h: 210});
  const byC = FC.rollup(FS.rows, ["country"]).sort((a, b) => b.revenue - a.revenue), totC = byC.reduce((a, r) => a + r.revenue, 0) || 1;
  const c3 = CH.barsH({label: "2027 revenue by country", w: 620, labelW: 150, items: byC.map(r => ({label: CNAME(r.country), value: r.revenue, color: regionColor(pal, r.country), text: `${smoney(r.revenue, cur)} · ${pct(r.revenue / totC)}`}))});
  const byK = FC.rollup(FS.rows, ["product_class"]).sort((a, b) => b.revenue - a.revenue);
  const c4 = CH.barsH({label: "2027 revenue by product class", w: 620, labelW: 150, items: byK.map(r => ({label: r.product_class, value: r.revenue, color: pal.q[2], text: `${smoney(r.revenue, cur)} · ${fmt(r.units)} units`}))});
  const short = gaps.reduce((a, v) => a + v, 0);
  return `<div class="card"><div class="cardhead"><h2>History and forecast</h2><span class="faint" style="font-size:12px">Monthly net revenue, ${esc(cur)}. Oct to Dec 2026 is not forecast.</span></div>
      ${CH.legendHtml([{name: "Actual", color: pal.ink}, {name: "Base", color: pal.accent}, {name: "Low to High", color: pal.band, sq: true}, {name: "Target", color: pal.q[3], dash: true}])}<div class="bchart">${c1}</div></div>
    <div class="card"><div class="cardhead"><h2>Gap to target by month</h2><span class="faint" style="font-size:12px">${esc(FS.set.scenario)} against the target midpoint (${smoney(F.target.mid, cur)} / 12). Year: ${short > 0 ? "short " + money(short, cur) : "ahead " + money(-short, cur)}</span></div>
      ${CH.legendHtml([{name: "Short of target", color: "var(--st-critical)", sq: true}, {name: "Ahead of target", color: "var(--ok)", sq: true}])}<div class="bchart">${c2}</div></div>
    <div class="bgrid2"><div class="card"><div class="cardhead"><h2>Country split</h2><span class="faint" style="font-size:12px">${esc(FS.set.scenario)}, goods</span></div><div class="bchart">${c3}</div></div>
      <div class="card"><div class="cardhead"><h2>Product class split</h2><span class="faint" style="font-size:12px">${esc(FS.set.scenario)}, goods</span></div><div class="bchart">${c4}</div></div></div>`;
}
function tablesHtml(){
  const F = FS.F, cur = FS.set.reporting, rows = FS.rows;
  const classes = FC.CLASSES.filter(k => rows.some(r => r.product_class === k)), countries = [...new Set(rows.map(r => r.country))].sort((a, b) => regionOf(a).localeCompare(regionOf(b)) || a.localeCompare(b));
  const cell = (c, k) => rows.filter(r => r.country === c && r.product_class === k).reduce((a, r) => a + r.units, 0);
  const tot = (c, f) => rows.filter(r => r.country === c).reduce((a, r) => a + r[f], 0);
  const units = `<table><thead><tr><th>Country</th>${classes.map(k => `<th>${esc(k)}</th>`).join("")}<th>Units</th><th>Orders</th><th>Lines</th><th>Revenue ${esc(cur)}</th></tr></thead><tbody>
    ${countries.map(c => `<tr><td><span class="rdot r-${rc(regionOf(c))}"></span>${esc(CNAME(c))}</td>${classes.map(k => `<td class="n">${fmt(cell(c, k))}</td>`).join("")}<td class="n"><b>${fmt(tot(c, "units"))}</b></td><td class="n">${fmt(tot(c, "orders"), 1)}</td><td class="n">${fmt(tot(c, "lines"))}</td><td class="n">${fmt(tot(c, "revenue"))}</td></tr>`).join("")}
    <tr class="sum"><td>Total</td>${classes.map(k => `<td class="n">${fmt(rows.filter(r => r.product_class === k).reduce((a, r) => a + r.units, 0))}</td>`).join("")}<td class="n">${fmt(rows.reduce((a, r) => a + r.units, 0))}</td><td class="n">${fmt(rows.reduce((a, r) => a + r.orders, 0), 1)}</td><td class="n">${fmt(rows.reduce((a, r) => a + r.lines, 0))}</td><td class="n">${fmt(rows.reduce((a, r) => a + r.revenue, 0))}</td></tr></tbody></table>`;
  const bt = F.backtest;
  const methods = `<table><thead><tr><th>Method</th><th>Low</th><th>Base</th><th>High</th><th>Target</th><th>WAPE country x month</th><th>WAPE total</th><th>Hold-out actual</th><th>Hold-out forecast</th><th></th></tr></thead><tbody>
    ${FC.METHODS.map(([m, l]) => { const A = FS.all[m], w = bt.wape[m], wt = (bt.wape_total || {})[m], d = (bt.detail || {})[m];
      return `<tr${m === FS.set.method ? ' style="background:var(--accent-soft)"' : ""}><td><b>${esc(l)}</b>${m === FS.set.method ? " · selected" : ""}</td>${["Low", "Base", "High", "Target"].map(k => `<td class="n">${fmt(A.totals[k].net)}</td>`).join("")}
        <td class="n">${w == null ? "n/a" : pct(w)}</td><td class="n">${wt == null ? "n/a" : pct(wt)}</td><td class="n">${d ? fmt(d.actual) : ""}</td><td class="n">${d ? fmt(d.forecast) : ""}</td>
        <td>${m === "target" ? '<span class="faint">top down, not back-tested</span>' : w != null && w > FC.DEFAULTS.indicativeWape ? '<span class="okb no">Indicative</span>' : '<span class="okb yes">OK</span>'}</td></tr>`; }).join("")}</tbody></table>`;
  const cust = F.method === "customer" && F.extra.customers ? `<details class="custom"><summary><b>Customers in the customer-driven method</b><span class="faint">median days between orders ${fmt(F.extra.median_interval)}, median first order ${money(F.extra.median_first_order, cur)}</span></summary>
      <div class="tablewrap btable"><table><thead><tr><th>Customer</th><th>Country</th><th>Orders</th><th>Days between orders</th><th>Avg order ${esc(cur)}</th><th>Last order</th><th>2027 orders</th><th>2027 revenue</th></tr></thead><tbody>
      ${F.extra.customers.slice().sort((a, b) => b.revenue - a.revenue).map(c => `<tr${c.lapsed ? ' class="faint"' : ""}><td>${esc(c.customer)}${c.lapsed ? " (lapsed)" : ""}</td><td>${esc(c.country)}</td><td class="n">${c.orders}</td><td class="n">${fmt(c.interval)}</td><td class="n">${fmt(c.aov)}</td><td class="num">${esc(c.last)}</td><td class="n">${c.expected}</td><td class="n">${fmt(c.revenue * (1 + FS.set.upliftPct / 100))}</td></tr>`).join("")}</tbody></table></div></details>` : "";
  return `<div class="card"><div class="cardhead"><h2>2027 units per country and product class</h2><span class="faint" style="font-size:12px">${esc(FS.set.scenario)} · units = revenue / net unit price per class and country · orders = revenue / average order value</span></div><div class="tablewrap btable">${units}</div></div>
    <div class="card"><div class="cardhead"><h2>Methods and back-test</h2><span class="faint" style="font-size:12px">Fit to ${esc(bt.fit_to || "n/a")}, hold-out ${esc((bt.months || []).join(", "))} · 2027 net revenue ${esc(cur)}</span></div>
      <p class="faint bnote">WAPE = sum of absolute errors / sum of actual goods revenue over the hold-out months. Above ${pct(FC.DEFAULTS.indicativeWape)} the forecast is labelled indicative. The Low to High band is the method's WAPE, clipped to ${pct(FC.DEFAULTS.bandMin)}–${pct(FC.DEFAULTS.bandMax)}.</p>
      <div class="tablewrap">${methods}</div>${cust}</div>`;
}
// Step 6: what the forecast volume does to each route scenario (from the engine run on DEMAND.batch).
function renderImpact(){
  const el = $("fcImpact"); if (!el) return;
  if (!FS.set.useAsDemand || !window.DEMAND || !R || !R.rows || !BATCH || BATCH.source !== window.DEMAND.label) {
    el.innerHTML = `<div class="card"><div class="cardhead"><h2>Route scenarios on the forecast volume</h2></div><p class="muted">${FS.set.useAsDemand ? "Calculating…" : "Tick Use as demand to price the forecast in every route scenario."}</p></div>`;
    return;
  }
  const cur = FS.set.reporting, eurPer = Number(FS.set.fx[cur]) || 1, rep = v => v / eurPer, prof = FS.set.classProfile;
  const lines = {}; BATCH.lines.forEach(l => { (lines[l.order_id] = lines[l.order_id] || []).push(l); });
  const sc = E.scorecard(R.rows, ui.method, () => "all");
  const rowsOf = s => R.rows.filter(r => r.scenario === s && r.available);
  const out = LOGISTIC.map(s => {
    const rs = rowsOf(s), all = R.rows.filter(r => r.scenario === s);
    const units = rs.reduce((a, r) => a + r.units, 0) || 1, value = rs.reduce((a, r) => a + r.order_value_eur, 0);
    let cogs = 0; const freight = {}, fUnits = {};
    rs.forEach(r => {
      const ls = lines[r.order_id] || [], u = ls.reduce((a, l) => a + l.quantity, 0) || 1;
      const fr = r.route.steps.filter(x => x.category === "freight" || x.category === "inbound").reduce((a, x) => a + x.cost_eur, 0);
      ls.forEach(l => { cogs += l.quantity * l.unit_price_eur * (1 - (Number((prof[l.product_class] || {}).gross_margin_pct) || 0) / 100);
        freight[l.product_class] = (freight[l.product_class] || 0) + fr * l.quantity / u; fUnits[l.product_class] = (fUnits[l.product_class] || 0) + l.quantity; });
    });
    const feas = rs.filter(r => r.lead_time_days <= (FS.set.feasibleDays[rc(r.region)] ?? 2)).length;
    const card = sc.find(x => x.scenario === s) || {};
    return {s, orders: all.length, covered: rs.length, units, value, cost: rs.reduce((a, r) => a + r.cost_to_serve_eur, 0), flex: rs.reduce((a, r) => a + r.flexitog_pays_eur, 0),
      cust: rs.reduce((a, r) => a + r.customer_pays_eur, 0), cogs, freight, fUnits, feas, hassle: card.hassle, lead: card.lead_time_days};
  });
  const classes = FC.CLASSES.filter(k => out.some(o => o.fUnits[k]));
  el.innerHTML = `<div class="card"><div class="cardhead"><h2>Route scenarios on the forecast volume</h2><span class="faint" style="font-size:12px">${fmt(BATCH.orders.length)} forecast orders priced by the route engine · ${esc(cur)} · ${esc(FS.set.scenario)}</span></div>
    <p class="faint bnote">Per scenario, the best node per order. Shipments, refill loads and owned warehouse volume come from the forecast (refills ${esc(FS.set.refillsPerYear)} per node per year). Margin = revenue − goods cost (gross margin % per class, placeholder) − logistics FlexiTog pays. Feasible = lead time at most ${FS.set.feasibleDays.TR} day(s) for Türkiye and North Africa, ${FS.set.feasibleDays.GCC} for Gulf/GCC.</p>
    <div class="tablewrap"><table><thead><tr><th>Scenario</th><th>Orders priced</th><th>Units</th><th>Cost to serve per unit</th><th>FlexiTog logistics per unit</th><th>Landed cost per unit</th><th>Margin</th><th>Margin %</th><th>Next-day / 48 h feasible</th><th>Lead time days</th><th>Hassle</th></tr></thead><tbody>
    ${out.map(o => `<tr><td><i class="sw" style="background:var(--s-${o.s});margin-right:6px"></i>${esc(E.LABELS[o.s])}</td><td class="n">${o.covered} / ${o.orders}</td><td class="n">${fmt(o.units)}</td>
      <td class="n">${fmt(rep(o.cost / o.units), 2)}</td><td class="n">${fmt(rep(o.flex / o.units), 2)}</td><td class="n">${fmt(rep((o.cogs + o.cost) / o.units), 2)}</td>
      <td class="n">${fmt(rep(o.value - o.cogs - o.flex))}</td><td class="n">${o.value ? pct((o.value - o.cogs - o.flex) / o.value) : "n/a"}</td>
      <td class="n">${o.covered ? pct(o.feas / o.covered) : "n/a"}</td><td class="n">${o.lead == null ? "n/a" : fmt(o.lead, 1)}</td><td class="n">${o.hassle == null ? "n/a" : fmt(o.hassle, 1)}</td></tr>`).join("")}</tbody></table></div>
    <h3 style="margin:6px 0 4px">Freight per unit by product class (${esc(cur)})</h3>
    <div class="tablewrap"><table><thead><tr><th>Scenario</th>${classes.map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>
    ${out.map(o => `<tr><td>${esc(E.LABELS[o.s])}</td>${classes.map(k => `<td class="n">${o.fUnits[k] ? fmt(rep(o.freight[k] / o.fUnits[k]), 2) : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}
function assumptionsHtml(){
  const s = FS.set, D = FC.DEFAULTS, H = FS.F.H, rp = FS.report;
  const prof = s.classProfile, skus = (MD.t.products || []).map(p => p.sku);
  return `<details class="custom card"><summary><b>Assumptions</b><span class="faint">every data rule and default</span></summary>
    <ol class="bfind" style="margin-top:8px">
      <li>Source: ${esc(FS.source.name)}, sheet Sheet1, headers prefixed "Order Lines/". ${fmt(rp.rows)} rows read.</li>
      <li>Rows with an empty Order Reference are skipped (${rp.no_reference}).</li>
      <li>Net revenue = Total − Total Tax. UK lines include 20% VAT; Fortdress Group GmbH lines carry tax too. An empty Total counts as 0.</li>
      <li>Revenue converts through EUR to the reporting currency (${esc(s.reporting)}). Default FX: 1 GBP = 1.1555 EUR, 1 USD = 0.8607 EUR.${Object.keys(rp.unknown_currency).length ? " Currencies without a rate count at 1: " + esc(Object.keys(rp.unknown_currency).join(", ")) + "." : ""}</li>
      <li>Order date = the earliest Created on of all lines in the same Order Reference. Months follow the order date.</li>
      <li>Customer = Customer/Company Name Entity, or Customer when it is empty, without " (EU)". Aliases: ${Object.entries(D.customerAliases).map(([a, b]) => `${esc(a)} → ${esc(b)}`).join("; ")}.</li>
      <li>Freight: Product Template/Category "Service", or a product name containing ${D.freightWords.map(esc).join(", ")}. Freight billed is a separate series. Lines without a product name are blank and ignored (${rp.blank_lines}). Everything else is goods.</li>
      <li>Product class from the product name, in order: Coveralls (Coverall, Overall), Baselayers (Baselayer, Long John, Undershirt), Trousers (Trouser, Salopette), Jackets (Jacket, Coat, Vest). Otherwise the template category: Gloves, Footwear, Headwear, Accessories, Drying cabinets; Clothing and anything else = Other clothing.</li>
      <li>Units = Quantity × pack size ("Pack of 10" = 10 units). Net unit price per class and country = net goods revenue / units (fallback: class, then overall).</li>
      <li>Aggregation: goods revenue, units and orders by month, country and product class.</li>
      <li>Validation figures count goods and freight billed. Last 12 months = ${esc(FS.F.backtest && FC.validation(FS.lines, opts()).last12_from)} to ${esc(s.asOf)}. History runs ${esc(H.months[0])} to ${esc(H.months[H.months.length - 1])} (last full month before ${esc(s.asOf)}).</li>
      <li>Project orders: single orders above the ${s.capPercentile}th percentile of goods order value (${money(H.cap, s.reporting)}) are capped; the excess is reported apart. Toggle Include project orders to forecast them in full.</li>
      <li>Run rate: trailing 12 full months per country, spread evenly over 2027.</li>
      <li>Holt: level starts at the mean of the first 3 months, trend at 0; alpha ${s.alpha}, beta ${s.beta}; no seasonality; floor at 0.</li>
      <li>Customer-driven: days between orders = days from the first order to the cut-off / orders, at least 30. Each customer repeats at that interval with its average order value from its last order. Lapsed = a one-order customer whose order is over 365 days old, or a repeat customer silent for more than twice its interval and over 365 days. New customers: first order mid-quarter at the median first-order value, repeats at the median interval.</li>
      <li>Target allocation: the target (${money(s.targetLow, s.reporting)} to ${money(s.targetHigh, s.reporting)}, total net revenue) split by country on ${s.weightMode === "user" ? "your weights" : "the share of the last 12 months"}, flat by month, freight billed taken out by the country's freight ratio.</li>
      <li>Scenarios: Base = the method × (1 + uplift ${s.upliftPct}%). Low and High = Base × (1 ∓ band), band = back-test WAPE clipped to ${pct(D.bandMin)}–${pct(D.bandMax)} (target allocation: the target range). Target = the Base mix scaled to the target midpoint.</li>
      <li>Orders = revenue / average goods order value per country; lines = orders × lines per order; shipments = orders (one shipment per order).</li>
      <li>Back-test: hold out the last ${D.holdoutMonths} full months, fit on the rest, WAPE on goods revenue per country and month. Above ${pct(D.indicativeWape)} = indicative.</li>
      <li>Routing: the forecast orders per country and month (rounded so the year adds up; a month without a whole order passes its volume to the next order), lines per class at the forecast units and net unit price, a synthetic customer per country at its most common city. Countries outside Türkiye, North Africa and Gulf/GCC are left out of routing.</li>
      <li>Volumes for the engine: shipments per year per country = forecast orders; refill load per node = pallets per year of the countries it serves / refills per year (${esc(s.refillsPerYear)}), capped at the scenario default; owned warehouse pallets per year = pallets of the countries it serves.</li>
      <li>Baseline: DAP from Helmond. FlexiTog pays freight, insurance and delivery to the door; the customer clears import and pays duty and VAT.</li>
    </ol>
    <h3 style="margin:10px 0 6px">Product class profile (routing and margin)</h3>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Product class</th><th>Representative SKU</th><th>Units per EUR pallet</th><th>Gross margin % (placeholder)</th></tr></thead><tbody>
      ${FC.CLASSES.map(k => `<tr><td>${esc(k)}</td><td><select data-cp="${esc(k)}" data-f="sku">${skus.map(x => `<option${x === (prof[k] || {}).sku ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></td>
        <td><input type="number" min="1" step="1" data-cp="${esc(k)}" data-f="units_per_pallet" value="${esc((prof[k] || {}).units_per_pallet)}"></td>
        <td><input type="number" min="0" max="100" step="1" data-cp="${esc(k)}" data-f="gross_margin_pct" value="${esc((prof[k] || {}).gross_margin_pct)}"></td></tr>`).join("")}</tbody></table></div>
    <div class="optgrid" style="margin-top:8px">
      <div class="ctl"><label for="fcRefill">Refills per node per year</label><input type="number" id="fcRefill" min="1" step="1" value="${esc(s.refillsPerYear)}"></div>
      <div class="ctl"><label for="fcFTR">Feasible lead days TR / NAF</label><input type="number" id="fcFTR" min="0" step="0.5" value="${esc(s.feasibleDays.TR)}"></div>
      <div class="ctl"><label for="fcFGCC">Feasible lead days GCC</label><input type="number" id="fcFGCC" min="0" step="0.5" value="${esc(s.feasibleDays.GCC)}"></div>
      <div class="ctl"><label for="fcAsOf">Last 12 months to</label><input type="date" id="fcAsOf" value="${esc(s.asOf)}"></div>
    </div></details>`;
}

// ============================================================ events
function update(fn, opt){
  fn(FS.set); saveSet();
  if (opt && opt.clean) clean();
  recompute();
  const y = window.scrollY; render(); window.scrollTo({top: y});
}
function bind(P){
  const segBind = (id, k) => { const el = $(id); if (el) el.addEventListener("click", e => { const b = e.target.closest("button"); if (b) update(s => { s[k] = b.dataset.v; }); }); };
  segBind("fcMethod", "method"); segBind("fcScen", "scenario"); segBind("fcWM", "weightMode");
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  // Switching currency keeps the target's value: amounts convert at the FX table.
  on("fcCur", "change", e => update(s => { const k = (Number(s.fx[s.reporting]) || 1) / (Number(s.fx[e.target.value]) || 1);
    s.targetLow = Math.round(s.targetLow * k); s.targetHigh = Math.round(s.targetHigh * k); s.reporting = e.target.value; }, {clean: true}));
  P.querySelectorAll("[data-fx]").forEach(i => i.addEventListener("change", () => { const v = Number(i.value); if (v > 0) update(s => { s.fx[i.dataset.fx] = v; }, {clean: true}); }));
  on("fcUp", "change", e => update(s => { s.upliftPct = Number(e.target.value) || 0; }));
  on("fcProj", "change", e => update(s => { s.includeProjects = e.target.checked; }));
  on("fcUse", "change", e => update(s => { s.useAsDemand = e.target.checked; }));
  ["fcA", "fcB"].forEach((id, i) => on(id, "change", e => update(s => { s[i ? "beta" : "alpha"] = Number(e.target.value); })));
  on("fcTL", "change", e => update(s => { s.targetLow = Number(e.target.value) || 0; }));
  on("fcTH", "change", e => update(s => { s.targetHigh = Number(e.target.value) || 0; }));
  P.querySelectorAll("[data-npq]").forEach(i => i.addEventListener("change", () => update(s => { s.newPerQuarter[i.dataset.npq] = Math.max(0, Number(i.value) || 0); })));
  P.querySelectorAll("[data-w]").forEach(i => i.addEventListener("change", () => update(s => { s.weights[i.dataset.w] = Math.max(0, Number(i.value) || 0); })));
  P.querySelectorAll("[data-cp]").forEach(i => i.addEventListener("change", () => update(s => { const k = i.dataset.cp, f = i.dataset.f; s.classProfile[k] = Object.assign({}, s.classProfile[k], {[f]: f === "sku" ? i.value : Number(i.value)}); })));
  on("fcRefill", "change", e => update(s => { s.refillsPerYear = Math.max(1, Number(e.target.value) || 12); }));
  on("fcFTR", "change", e => update(s => { s.feasibleDays.TR = s.feasibleDays.NAF = Number(e.target.value); }));
  on("fcFGCC", "change", e => update(s => { s.feasibleDays.GCC = Number(e.target.value); }));
  on("fcAsOf", "change", e => update(s => { if (e.target.value) s.asOf = e.target.value; }));
  on("fcReset", "click", () => { FS.set = DEFAULT_SET(); saveSet(); clean(); recompute(); render(); toast("Forecast settings reset"); });
  on("fcSample", "click", () => { loadTable(PAYLOAD.sales_orders, PAYLOAD.sales_orders.source, PAYLOAD.sales_orders.anonymized); recompute(); render(); });
  on("fcFile", "change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const book = await readFile(f), name = book.names.includes("Sheet1") ? "Sheet1" : book.names[0], sh = book.sheets[name] || [];
      const hi = sh.findIndex(r => (r || []).some(c => /Order Reference/.test(String(c || ""))));
      if (hi < 0) throw new Error("No Order Lines/Order Reference column in " + name);
      loadTable({headers: sh[hi], rows: sh.slice(hi + 1)}, f.name, false);
      recompute(); render(); toast(`${f.name}: ${fmt(FS.report.lines)} lines, ${fmt(FS.report.orders)} orders. Kept in this tab only.`);
    } catch (err) { toast(err.message || "Could not read the file", "bad"); }
  });
}

// ============================================================ start
function init(){
  if (PAYLOAD.sales_orders && PAYLOAD.sales_orders.rows) loadTable(PAYLOAD.sales_orders, PAYLOAD.sales_orders.source, PAYLOAD.sales_orders.anonymized);
  FS.ready = true;
  recompute(false);
  if (window.DEMAND && window.DEMAND.active) runEngine();
}
window.ForecastUI = {
  show(){ render(); }, state: FS, ready: () => FS.ready && !!FS.F,
  demandRows: () => FS.rows, classProfile: () => FS.set.classProfile, settings: () => FS.set,
};
init();
})();
