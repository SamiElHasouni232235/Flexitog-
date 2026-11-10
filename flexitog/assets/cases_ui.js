/* FlexiTog Forecast tab: the volume case builder. Volume cases are edited here only; the Route dashboard reads them.
 * Logic in cases_core.js (window.FlexiCases); the sales history and the method forecasts come from forecast.js
 * (window.ForecastUI). Cases hold revenue (internal): they stay in this browser under their own key, written on Save,
 * never in an RFQ file or the default JSON export. Revenue figures follow the "Hide revenue" switch.
 * Shares the dashboard globals ($, esc, fmt, toast, Saver, PENDING_NOTE, FlexCharts, BenchUI, DataStore).
 */
(function () {
"use strict";
const C = window.FlexiCases, V = window.FlexiRFQ30, CH = window.FlexCharts;
const KEY = "flexitog-volume-cases-v1";
const ST = {cases: null, sel: null, metric: "orders"};
const hidden = () => !window.FlexiRevenue || window.FlexiRevenue.hidden !== false;
const S = () => V.withDefaults(window.BenchUI && BenchUI.rfq30 ? BenchUI.rfq30.settings() : null);
const F = () => (window.ForecastUI && ForecastUI.state) || {};
const pct1 = x => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const usd = v => "USD " + fmt(Math.round(v || 0));
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function read(){ try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
function save(msg){ Saver.later("volume-cases", () => { localStorage.setItem(KEY, JSON.stringify(ST.cases)); }); if (msg) toast(`${msg}. ${PENDING_NOTE}`); }
// Method levels from the loaded history: first forecast year / last 12 months, per method (runrate, holt, seasonal)
function levelOf(method){
  const all = F().all || {}, x = all[method]; if (!x || !x.H) return null;
  const ttm = Object.values(x.H.series).reduce((a, s) => a + s.slice(-12).reduce((b, v) => b + v, 0), 0);
  return ttm > 0 ? x.totals.Base.goods / ttm : null;
}
const backtestOf = method => { const bt = (F().F || {}).backtest || {}; return {mape: (bt.mape || {})[method] ?? null, wape: (bt.wape || {})[method] ?? null}; };
function cases(){
  if (ST.cases) return ST.cases;
  const saved = read();
  if (Array.isArray(saved) && saved.length) ST.cases = saved;
  else {   // first start: seed A to E from the current setup; units per order from the history when it is loaded
    ST.cases = C.seed(S(), {holtLevel: levelOf("holt") ?? 1});
    const hb = historyBase(); if (hb) ST.cases.forEach(c => { c.base.unitsPerOrder = hb.base.unitsPerOrder; });
  }
  return ST.cases;
}
// A new base snapshot from the latest history year: orders, revenue (USD) and units per order per country; band mix from case A.
function historyBase(){
  const fs = F(), y = window.ForecastUI && ForecastUI.latestYear ? ForecastUI.latestYear() : null; if (!y || !fs.lines) return null;
  const fxUsd = Number((fs.set.fx || {}).USD) || 0.8607, by = {};
  fs.lines.filter(l => l.file_year === y && l.type === "goods").forEach(l => {
    const L = V.LANE_IDS.find(k => V.LANES[k].country === l.country); if (!L) return;
    const x = by[L] || (by[L] = {orders: new Set(), units: 0, eur: 0}); x.orders.add(l.order); x.units += l.units; x.eur += l.net_eur;
  });
  const seedBase = C.seed(S())[0].base;
  return {year: y, base: {orders: Object.fromEntries(V.LANE_IDS.map(L => [L, by[L] ? by[L].orders.size : 0])),
    revenueUsd: Object.fromEntries(V.LANE_IDS.map(L => [L, by[L] ? by[L].eur / fxUsd : 0])),
    unitsPerOrder: Object.fromEntries(V.LANE_IDS.map(L => [L, by[L] && by[L].orders.size ? by[L].units / by[L].orders.size : 6])), bandMix: seedBase.bandMix}};
}
function nextLetter(){ const used = new Set(cases().map(c => c.letter)); return [...LETTERS].find(l => !used.has(l)) || ""; }

function listHtml(){
  const ly = window.ForecastUI && ForecastUI.latestYear ? ForecastUI.latestYear() : null;
  const rows = cases().map(c => { const ys = C.years(c, S(), Math.max(1, Number(c.years) || 5)), st = C.status(c), newer = C.newerHistory(c, ly);
    return `<tr class="${ST.sel === c.id ? "sel" : ""}" data-case="${esc(c.id)}"><td><button type="button" class="lnk" data-a="vc-open">${esc(c.name)}</button>${c.placeholder ? ' <span class="srct assumption" title="' + esc(c.placeholder) + '">placeholder</span>' : ""}</td>
      <td>${esc(C.methodLabel(c.method))}</td><td class="num">${esc(c.baseYear)}${newer ? ` <span class="srct invalid" title="History for ${ly} is loaded; this case is built on ${c.baseYear}">newer history available</span>` : ""}</td><td class="num">${esc(c.createdAt || "")}</td>
      <td><span class="srct ${st === "confirmed" ? "quoted" : "assumption"}">${st}</span>${C.hasBasis(c) ? "" : ' <span class="srct invalid" title="No basis: add the text and the source">no basis</span>'}</td>
      <td class="n">${fmt(ys[0].orders, 0)}</td><td class="n">${fmt(ys[ys.length - 1].orders, 0)} <span class="faint">${ys[ys.length - 1].year}</span></td>
      <td class="iact"><button type="button" class="btn ghost sm" data-a="vc-dup">Duplicate</button><button type="button" class="btn ghost sm" data-a="vc-del">Delete</button></td></tr>`; }).join("");
  return `<div class="tablewrap"><table class="vctable"><thead><tr><th>Volume case</th><th>Method</th><th>Base year</th><th>Created</th><th>Status</th><th>Orders, year 1</th><th>Orders, last year</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function num(path, v, label, extra){ return `<input type="number" step="any" data-vc="${path}" value="${v == null ? "" : esc(v)}" aria-label="${esc(label)}"${extra || ""}>`; }
function editorHtml(c){
  const i = c.inputs || {}, m = c.method, bt = ["runrate", "holt", "seasonal"].includes(m) ? backtestOf(m) : null, ys = C.years(c, S(), Number(c.years) || 5);
  const meth = `<select data-vc="method" aria-label="Method">${C.METHODS.map(([k, l]) => `<option value="${k}"${k === m ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  // growth per year: year 1 for the growth path; from year 2 for the other methods (year 1 comes from the method)
  const g = Array.from({length: 5}, (_, k) => k).filter(k => m === "growth" || k >= 1).map(k => `<label>Growth year ${k + 1} %${num(`inputs.growth.${k}`, (i.growth || [])[k], `Growth year ${k + 1}`)}</label>`).join("");
  const t = i.target || {}, e = i.endGoal || {};
  const spec = m === "multiplier" ? `<label>Multiplier on the last 12 months${num("inputs.multiplier", i.multiplier, "Multiplier")}</label>${g}`
    : ["runrate", "holt", "seasonal"].includes(m) ? `<label>Year-1 level (method / last 12 months)${num("inputs.level", i.level, "Level")}</label><div class="iact"><button type="button" class="btn ghost sm" data-a="vc-level"${levelOf(m) == null ? " disabled" : ""}>Take the level from the history (${levelOf(m) == null ? "no history" : levelOf(m).toFixed(3)})</button></div>${g}`
    : m === "revenueTarget" ? `<label>Revenue target, USD${num("inputs.target.value", t.value, "Revenue target")}</label><label>Target year${num("inputs.target.year", t.year, "Target year", ' step="1"')}</label>${g}`
    : m === "volumeTarget" ? `<label>Target on<select data-vc="inputs.target.kind" aria-label="Target on"><option value="orders"${t.kind !== "kg" ? " selected" : ""}>orders</option><option value="kg"${t.kind === "kg" ? " selected" : ""}>kg</option></select></label><label>Target value${num("inputs.target.value", t.value, "Volume target")}</label><label>Target year${num("inputs.target.year", t.year, "Target year", ' step="1"')}</label>${g}`
    : `<label>End goal (blank: the growth rates)${num("inputs.endGoal.value", e.value, "End goal")}</label><label>Goal currency<select data-vc="inputs.endGoal.currency" aria-label="Goal currency"><option${e.currency !== "EUR" ? " selected" : ""}>USD</option><option${e.currency === "EUR" ? " selected" : ""}>EUR</option></select></label>
      <label>Goal year${num("inputs.endGoal.year", e.year, "Goal year", ' step="1"')}</label><label>Front-load year 1 <input type="checkbox" data-vcb="inputs.endGoal.frontLoad"${e.frontLoad ? " checked" : ""}></label><label>Year-1 growth when front-loaded %${num("inputs.endGoal.frontLoadPct", e.frontLoadPct, "Front-load growth")}</label>${g}`;
  const split = c.split || {}, base = c.base || {}, bTot = V.LANE_IDS.reduce((a, L) => a + (Number((base.orders || {})[L]) || 0), 0);
  const splitRow = V.LANE_IDS.map(L => `<label title="${esc(V.LANES[L].name)}">${L}${num(`split.${L}`, split[L], `Share ${L}`, ` placeholder="${bTot ? ((Number(base.orders[L]) || 0) / bTot * 100).toFixed(1) : 0}"`)}</label>`).join("");
  const gm = c.garmentMix || {}, hm = ((F().F || {}).H || {}).overallMix || {};
  const gmRow = Object.keys(Object.assign({}, hm, gm)).map(k => `<label>${esc(k)}${num(`garmentMix.${k}`, gm[k], `Share ${k}`, ` placeholder="${((hm[k] || 0) * 100).toFixed(1)}"`)}</label>`).join("") || '<span class="faint">Load sales history for the historical mix.</span>';
  const yRows = ys.map(y => `<tr class="${y.extrapolated ? "ext" : ""}"><td class="num">${y.year}${y.extrapolated ? ' <span class="srct extrapolated">extrapolated</span>' : ""}</td><td class="n">${pct1(y.growth)}</td><td class="n">${fmt(y.orders, 1)}</td><td class="n">${fmt(y.units, 0)}</td><td class="n">${fmt(y.kg, 0)}</td>${hidden() ? "" : `<td class="n">${usd(y.revenueUsd)}</td>`}</tr>`).join("");
  return `<div class="card vcedit"><div class="cardhead"><h2>${esc(c.name)}</h2><span class="faint" style="font-size:12px">${esc(c.id)} · base year ${esc(c.baseYear)} · created ${esc(c.createdAt || "")} · ${esc(c.source || "")}</span></div>
    <div class="setrow"><label>Name<input type="text" data-vct="name" value="${esc(c.name)}" aria-label="Case name" style="width:260px"></label><label>Method${meth}</label>
      <label>Base year${num("baseYear", c.baseYear, "Base year", ' step="1"')}</label><label>First forecast year${num("startYear", c.startYear, "First forecast year", ' step="1"')}</label>
      <label>Horizon length, years${num("years", c.years, "Horizon length", ' step="1" min="1" max="5"')}</label>
      <div class="iact"><button type="button" class="btn ghost sm" data-a="vc-rebase">Rebuild the base from the latest history${window.ForecastUI && ForecastUI.latestYear && ForecastUI.latestYear() ? ` (${ForecastUI.latestYear()})` : ""}</button></div></div>
    <div class="setrow">${spec}</div>
    <h3 class="rqh3">Split per country, % <span class="faint">blank: the historical mix (greyed)</span></h3><div class="setrow">${splitRow}</div>
    <h3 class="rqh3">Garment mix, % <span class="faint">blank: the historical mix</span></h3><div class="setrow">${gmRow}</div>
    <h3 class="rqh3">Justification</h3>
    <dl class="kv"><dt>Method</dt><dd>${esc(C.methodLabel(m))}</dd><dt>Formula</dt><dd>${esc(ys[0].formula)}</dd>
      <dt>Inputs</dt><dd>${esc(JSON.stringify(c.inputs))}</dd>${bt ? `<dt>Back-test</dt><dd>MAPE ${pct1(bt.mape)} · WAPE ${pct1(bt.wape)}</dd>` : ""}
      <dt>Base</dt><dd>${fmt(bTot, 1)} orders in ${esc(c.baseYear)} · units per order ${typeof base.unitsPerOrder === "object" ? "per country from the history" : esc(base.unitsPerOrder) + " (estimate)"}${hidden() ? "" : ` · ${usd(V.LANE_IDS.reduce((a, L) => a + (Number((base.revenueUsd || {})[L]) || 0), 0))}`} · band mix per country from volume case A</dd></dl>
    <div class="setrow"><label style="flex:1 1 320px">Basis (required)<input type="text" data-vct="basis.text" value="${esc((c.basis || {}).text || "")}" placeholder="for example: sales pipeline, market study" aria-label="Basis text" style="width:100%"></label>
      <label style="flex:1 1 260px">Source<input type="text" data-vct="basis.source" value="${esc((c.basis || {}).source || "")}" placeholder="for example: sector report, Tarek" aria-label="Basis source" style="width:100%"></label>
      <label>Status<select data-vc="status" aria-label="Status"><option value="estimate"${C.status(c) !== "confirmed" ? " selected" : ""}>estimate</option><option value="confirmed"${C.status(c) === "confirmed" ? " selected" : ""}${C.hasBasis(c) ? "" : " disabled"}>confirmed</option></select></label></div>
    ${C.hasBasis(c) ? "" : '<p class="warnbox">⚠ No basis yet: this case stays an estimate. Add the text and its source.</p>'}${c.placeholder ? `<p class="warnbox">⚠ ${esc(c.placeholder)}</p>` : ""}
    <div class="tablewrap"><table class="rqtbl"><thead><tr><th>Year</th><th>Growth</th><th>Orders</th><th>Units</th><th>Kg</th>${hidden() ? "" : "<th>Revenue (USD, internal)</th>"}</tr></thead><tbody>${yRows}</tbody></table></div></div>`;
}
function chartHtml(){
  const metric = hidden() && ST.metric === "revenueUsd" ? "orders" : ST.metric, n = 5, all = cases(), s = S();
  const years = Array.from({length: n}, (_, k) => Math.min(...all.map(c => Number(c.startYear) || 2027)) + k);
  const series = all.map((c, k) => { const ys = C.years(c, s, n); return {name: c.name, color: ["var(--lc1)", "var(--lc2)", "var(--lc3)", "var(--lc4)", "var(--lc5)", "var(--lc6)"][k % 6], dash: k >= 6 ? "5 4" : null, values: years.map(y => { const r = ys.find(x => x.year === y); return r ? r[metric] : null; })}; });
  const seg = [["orders", "Orders"], ["kg", "Kg"]].concat(hidden() ? [] : [["revenueUsd", "Revenue"]]);
  return `<div class="card"><div class="cardhead"><h2>All volume cases</h2><div class="seg" id="vcMetric">${seg.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${metric === k}">${l}</button>`).join("")}</div></div>
    <div class="rqchart">${CH.lineChart({label: "Volume cases per year", labels: years.map(String), series, legend: true, w: 1100, h: 240, fmt: v => CH.sfmt(v), tip: v => fmt(v, 0)})}</div></div>`;
}
function render(){
  const host = $("vcBuilder"); if (!host) return;
  const list = cases(); if (!ST.sel || !list.some(c => c.id === ST.sel)) ST.sel = list[0] && list[0].id;
  const c = list.find(x => x.id === ST.sel);
  host.innerHTML = `<div class="card"><div class="cardhead"><h2>Volume cases</h2><div class="iact"><select id="vcNewMethod" aria-label="Method of the new case">${C.METHODS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select><button type="button" class="btn" data-a="vc-new">New volume case</button></div></div>
    <p class="faint bnote">Forecast outputs are volume cases (A, B, C, D, E and any you add); supply chain options are scenarios (S1 to S4, Route dashboard). Each case keeps its base year (latest history used) and creation date; an older base year is flagged when newer history is loaded.</p>
    ${listHtml()}</div>${c ? editorHtml(c) : ""}${chartHtml()}`;
  wire(host);
}
function setPath(obj, path, v){ const ks = path.split("."), last = ks.pop(); const o = ks.reduce((a, k) => (a[k] == null ? (a[k] = /^\d+$/.test(last) ? [] : {}) : a[k]), obj); o[last] = v; }
function wire(host){
  const cur = () => cases().find(x => x.id === ST.sel);
  const changed = msg => { save(msg); render(); if (window.DashRFQ) DashRFQ.refresh(); };
  host.querySelectorAll("[data-case] [data-a='vc-open']").forEach(b => b.addEventListener("click", () => { ST.sel = b.closest("tr").dataset.case; render(); }));
  host.querySelectorAll("[data-a='vc-dup']").forEach(b => b.addEventListener("click", () => { const c = cases().find(x => x.id === b.closest("tr").dataset.case); const d = C.duplicate(c); d.letter = nextLetter(); cases().push(d); ST.sel = d.id; changed("Volume case duplicated"); }));
  host.querySelectorAll("[data-a='vc-del']").forEach(b => b.addEventListener("click", e => { if (!confirmInline(e.target, "Click again to delete this volume case")) return; ST.cases = cases().filter(x => x.id !== b.closest("tr").dataset.case); changed("Volume case deleted"); }));
  const nb = host.querySelector("[data-a='vc-new']");
  if (nb) nb.addEventListener("click", () => { const c = C.blank(S(), `New volume case`); c.letter = nextLetter(); c.name = `${c.letter}: new volume case`; c.method = $("vcNewMethod").value;
    const hb = historyBase(); if (hb) Object.assign(c, {base: hb.base, baseYear: hb.year, startYear: hb.year + 1, source: `history ${hb.year}`});
    cases().push(c); ST.sel = c.id; changed("Volume case added"); });
  host.querySelectorAll("#vcMetric button").forEach(b => b.addEventListener("click", () => { ST.metric = b.dataset.v; render(); }));
  const c = cur(); if (!c) return;
  host.querySelectorAll("input[data-vc]").forEach(inp => inp.addEventListener("change", () => {
    const v = inp.value.trim() === "" ? null : Number(inp.value);
    if (v != null && !Number.isFinite(v)) { toast("Enter a number", "bad"); return; }
    if (inp.dataset.vc === "years" && v != null && !(v >= 1 && v <= 5)) { toast("A horizon length is 1 to 5 years", "bad"); return; }
    setPath(c, inp.dataset.vc, v);
    if (inp.dataset.vc.startsWith("split.") && Object.values(c.split || {}).every(x => x == null)) c.split = null;
    if (inp.dataset.vc.startsWith("garmentMix.") && Object.values(c.garmentMix || {}).every(x => x == null)) c.garmentMix = null;
    setTimeout(() => changed(), 0);
  }));
  host.querySelectorAll("select[data-vc]").forEach(sel => sel.addEventListener("change", () => { setPath(c, sel.dataset.vc, sel.value); setTimeout(() => changed(), 0); }));
  host.querySelectorAll("input[data-vcb]").forEach(inp => inp.addEventListener("change", () => { setPath(c, inp.dataset.vcb, inp.checked); setTimeout(() => changed(), 0); }));
  host.querySelectorAll("input[data-vct]").forEach(inp => inp.addEventListener("change", () => { setPath(c, inp.dataset.vct, inp.value); if (!C.hasBasis(c)) c.status = "estimate"; setTimeout(() => changed(), 0); }));
  const lv = host.querySelector("[data-a='vc-level']"); if (lv) lv.addEventListener("click", () => { c.inputs = Object.assign({}, c.inputs, {level: Math.round(levelOf(c.method) * 1000) / 1000}); changed("Level taken from the history"); });
  const rb = host.querySelector("[data-a='vc-rebase']"); if (rb) rb.addEventListener("click", e => { const hb = historyBase(); if (!hb) { toast("Load sales history first", "bad"); return; }
    if (!confirmInline(e.target, `Click again: the base becomes ${hb.year} history (orders and revenue per country)`)) return;
    Object.assign(c, {base: hb.base, baseYear: hb.year, startYear: hb.year + 1, createdAt: new Date().toISOString().slice(0, 10), source: `history ${hb.year}`}); changed(`Base rebuilt from ${hb.year}`); });
}
// The Route dashboard reads the cases (read-only) through this.
window.VolumeCases = {list: () => cases(), get: id => cases().find(c => c.id === id), latestYear: () => (window.ForecastUI && ForecastUI.latestYear ? ForecastUI.latestYear() : null)};
window.CasesUI = {render};
window.addEventListener("flexirevenue", () => { if ($("vcBuilder")) render(); });
if (typeof VIEW !== "undefined" && VIEW.current === "dash" && window.DashRFQ) DashRFQ.refresh();   // the dashboard drew before the cases existed
})();
