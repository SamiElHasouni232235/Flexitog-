/* FlexiTog Route dashboard: the four supply chain scenarios over a time horizon, for one volume case. Read-only.
 * S1 direct from Helmond (M1), S2 distributor holds stock (M2 + distributor terms), S3 3PL presence (M2 + M3 + M4 + M5;
 * the dedicated site is a toggle), S4 own warehouse (M2 + M3 + M5 proxy + own site costs). M6 answers stay on Benchmarking.
 * The page selects (volume case, horizon, filter, revenue on or off) and shows; it edits no volume case and no rate.
 * Every figure comes from horizon_core.js (window.FlexiHorizon) on the volume case (cases_ui.js, window.VolumeCases) with the
 * providers and internal settings from Benchmarking (BenchUI.rfq30): one data store, one engine, no formula here.
 * renderView (dashboard.html) calls DashRFQ.render(); the map asks DashRFQ.country(iso) for its colour and tooltip.
 * Shares the dashboard globals ($, esc, fmt, ui, drawCountries, toast, FlexCharts, FlexiCalc, showView).
 */
(function () {
"use strict";
const V = window.FlexiRFQ30, HZ = window.FlexiHorizon, CS = window.FlexiCases;
const MODS = ["M1", "M2", "M3", "M4", "M5", "M6"];
const MOD_LABEL = {M1: "M1 direct from Helmond", M2: "M2 bulk to the region", M3: "M3 customs", M4: "M4 warehouse", M5: "M5 delivery from warehouse", M6: "M6 other solution"};
const saved = DataStore.pref.get("dash-horizon") || {};
const RQ = {caseId: saved.caseId || "", horizon: saved.horizon || 0, filter: saved.filter || "all",
  choice: Object.assign(Object.fromEntries(MODS.map(m => [m, "best"])), saved.choice || {})};
const remember = () => DataStore.pref.set("dash-horizon", RQ);
const IDS = V.IDS;
const COLOR = {S1: "var(--lc1)", S2: "var(--s-distributor)", S3: "var(--s-3pl)", S4: "var(--s-owned_warehouse)"};
const TYPE_COLOR = {transport: "var(--lc1)", customs: "var(--lc4)", handling: "var(--lc2)", storage: "var(--lc5)", delivery: "var(--lc3)",
  fixed: "var(--s-cif_baseline)", direct: "var(--lc6)"};
const STATE = {complete: "complete", incomplete: "incomplete", not_configured: "not configured"};
const TAG_TIP = {quoted: "quoted: prices from the files", derived: "derived: calculated from quoted prices", extrapolated: "extrapolated: next lower band per kg",
  proxy: "proxy: another provider's prices stand in", assumption: "assumption: rests on the internal settings",
  "excludes distributor margin": "excludes distributor margin: the cost leaves the distributor's margin out; its margin lowers net revenue",
  "no distributor data": "no distributor data: no distributor chosen for a country, S2 uses the default margin (estimate)"};
const laneOfIso = iso => V.LANE_IDS.find(L => V.LANES[L].country === iso);
const eur = (v, dp) => (v == null ? "n/a" : "EUR " + fmt(v, dp == null ? 0 : dp));
const pct2 = x => (x == null ? "n/a" : `${(x * 100).toFixed(2)}%`);
const hidden = () => !window.FlexiRevenue || window.FlexiRevenue.hidden !== false;   // revenue stays hidden until someone turns it on
const pct = (a, b) => (b ? `${Math.round(a / b * 1000) / 10}%` : "n/a");
const sname = id => V.sname(id);
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const go = (view, text, title) => `<button type="button" class="lnk srcl" data-go="${view}" title="${esc(title || `Source: ${view}`)}">${text}</button>`;
let M = null;   // this render's data

// ---- data: the volume case, the horizon run and the year-1 detail (cached per inputs)
const isLane = f => !!V.LANES[f], isRegion = f => V.REGIONS.some(([r]) => r === f);
const lanesIn = () => (isLane(RQ.filter) ? [RQ.filter] : isRegion(RQ.filter) ? V.REGIONS.find(([r]) => r === RQ.filter)[1] : V.LANE_IDS);
const scopeName = () => (isLane(RQ.filter) ? V.LANES[RQ.filter].name : isRegion(RQ.filter) ? RQ.filter : "all 9 countries");
function load(){
  const B = window.BenchUI && BenchUI.rfq30, VC = window.VolumeCases;
  if (!B || !B.ready() || !VC) return null;
  const list = B.list(), S = V.withDefaults(B.settings()), legacy = B.legacy(), cases = VC.list();
  if (!cases.length) return {list, S, legacy, cases, vc: null};
  MODS.forEach(m => { if (RQ.choice[m] !== "best" && !list.some(e => e.id === RQ.choice[m])) RQ.choice[m] = "best"; });
  if (RQ.filter !== "all" && !isLane(RQ.filter) && !isRegion(RQ.filter)) RQ.filter = "all";
  const vc = cases.find(c => c.id === RQ.caseId) || cases[0]; RQ.caseId = vc.id;
  const n = Math.max(1, Math.min(5, Number(RQ.horizon) || Number(vc.years) || 5)), rev = B.revenue ? B.revenue() : null, lanes = lanesIn(), withRevenue = !hidden();
  const key = JSON.stringify([list.map(e => [e.id, e.up && (e.up.ref || e.up.uploadedAt)]), S, vc, n, lanes, RQ.choice, rev, withRevenue]);
  const calc = () => {
    const H = HZ.run(list, S, vc, {years: n, lanes, choice: RQ.choice, revenue: rev, withRevenue});
    const y1 = H.years[0], Sy = y1.settings, sens = V.sensitivity(list, Sy, "Y", RQ.choice);
    const rv = V.revenueSettings(rev), yrev = {fx: rv.fx, total: {Y: y1.volume.revenueUsd}, byCountry: {Y: Object.fromEntries(V.LANE_IDS.map(L => [L, y1.volume.byCountry[L].revenueUsd]))}, discount: rv.discount};
    return {H, sens, view: V.revenueView(y1.out, yrev, Sy)};
  };
  const C = window.FlexiCalc && FlexiCalc.memo ? FlexiCalc.memo("dash-horizon", key, calc) : calc();
  const y1 = C.H.years[0], out = y1.out;
  const sensPct = C.sens.rows.map(row => Object.fromEntries(["S1", "S3", "S4"].map(k => [k, row[k] != null && C.view.eur > 0 ? row[k] / (C.view.eur * row.m) : null])));
  return {list, S: y1.settings, legacy, cases, vc, n, H: C.H, y1, out, sens: C.sens, view: C.view, sensPct, answers: V.answers(out, C.sens, list), revAnswers: V.revenueAnswers(C.view)};
}
const volIn = (lanes, f) => sum(lanes, L => sum(V.BANDS, b => (Number(((M.S.volumes.Y || {})[L] || {})[b]) || 0) * f(b)));
const yearLabel = () => `${esc(M.vc.name)}, ${M.y1.year}`;
// A scenario in year 1 within the filter: cost (one-offs amortised), shipments, coverage, per order and per kg.
function scoped(id){
  const R = M.out[id], lanes = lanesIn(), all = lanes.length === V.LANE_IDS.length, cs = lanes.map(L => R.countries[L]);
  const cost = R.state === "complete" ? (all ? R.total : sum(cs, c => c.cost)) : null;
  const n = volIn(lanes, () => 1), kg = volIn(lanes, b => Number(M.S.avgKg[b]) || 0);
  const rv = hidden() ? null : all ? M.view.scenarios[id].total : isRegion(RQ.filter) ? M.view.scenarios[id].regions[RQ.filter] : M.view.scenarios[id].countries[RQ.filter];
  return {R, cost, state: R.state, n, kg, rv, perOrder: cost != null && n ? cost / n : null, perKg: cost != null && kg ? cost / kg : null,
    perPallet: cost != null && kg ? cost / (kg / (Number(M.S.kgPerPallet) || 250)) : null,
    shipments: sum(cs, c => c.shipments), covered: sum(cs, c => c.covered), measured: sum(cs, c => c.measured), onTime: sum(cs, c => c.onTime)};
}
const cheapestTotal = () => (IDS.filter(id => M.H.totals[id] != null).sort((a, b) => M.H.totals[a] - M.H.totals[b])[0] || null);
const ofRev = (b, id) => (b && b.pct != null ? `${pct2(b.pct)} of ${id === "S2" ? "net revenue" : "revenue"}${b.coveredOnly ? " (covered shipments only)" : ""}` : "");
const tagChips = R => (R.tags || []).map(t => `<span class="rqtag" title="${esc(TAG_TIP[t] || t)}">${esc(t)}</span>`).join("");
const sw = id => `<i class="sw" style="background:${COLOR[id]}"></i>`;
function stateLine(R){
  if (R.state === "not_configured") return `<span class="rqna" title="${esc(R.notes.join(" "))}">not configured</span>`;
  if (R.state === "incomplete") return `<span class="rqna" title="${esc("Missing: " + R.missing.join(", "))}">incomplete</span>`;
  return "";
}
const missingText = R => (R.state === "incomplete" ? `Missing ${R.missing.slice(0, 6).join(", ")}${R.missing.length > 6 ? ` and ${R.missing.length - 6} more` : ""}.` : R.state === "not_configured" ? R.notes.join(" ") : "");

// ---- 1. top bar: read-only selections
function barHtml(){
  const vc = M.vc, ly = window.VolumeCases.latestYear(), st = CS.status(vc);
  const caseOpts = M.cases.map(c => `<option value="${esc(c.id)}"${c.id === vc.id ? " selected" : ""}>${esc(c.name)} · base ${esc(c.baseYear)} · ${CS.status(c)}</option>`).join("");
  const filt = `<option value="all">All countries</option><optgroup label="Region">${V.REGIONS.map(([r]) => `<option value="${esc(r)}"${RQ.filter === r ? " selected" : ""}>${esc(r)}</option>`).join("")}</optgroup>
    <optgroup label="Country">${V.LANE_IDS.map(L => `<option value="${L}"${RQ.filter === L ? " selected" : ""}>${esc(V.LANES[L].name)}</option>`).join("")}</optgroup>`;
  const provSel = m => { const ps = M.list.filter(e => e.Q.priced[m]);
    return `<div class="ctl"><label for="rqC${m}">${esc(MOD_LABEL[m])}</label><select id="rqC${m}" data-mod="${m}"><option value="best">Best per module</option>${ps.map(e => `<option value="${esc(e.id)}"${RQ.choice[m] === e.id ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select></div>`; };
  const H = M.H, e = M.S.escalation;
  return `<div class="controls rqfilters">
      <div class="ctl"><label for="rqCase">Volume case ${go("forecast", "edit on Forecast", "Volume cases are built and edited on the Forecast tab")}</label><select id="rqCase">${caseOpts}</select></div>
      <div class="ctl"><label for="rqHz">Horizon</label><select id="rqHz">${[1, 2, 3, 4, 5].map(y => `<option value="${y}"${y === M.n ? " selected" : ""}>${y} year${y === 1 ? "" : "s"}</option>`).join("")}</select></div>
      <div class="ctl"><label for="rqFilter">Filter</label><select id="rqFilter">${filt}</select></div>
    </div>
    <p class="faint bnote rqbar">${esc(vc.name)}: base year ${esc(vc.baseYear)}, created ${esc(vc.createdAt || "")}, <span class="srct ${st === "confirmed" ? "quoted" : "assumption"}">${st}</span>${CS.hasBasis(vc) ? "" : ' <span class="srct invalid">no basis</span>'}${CS.newerHistory(vc, ly) ? ` <span class="srct invalid">newer history available (${ly})</span>` : ""}
      · ${H.startYear} to ${H.startYear + M.n - 1}${H.extrapolated.length ? ` (${H.extrapolated.join(", ")} extrapolated)` : ""}
      · rates: ${esc(e.setting)} setting, freight ${H.rates.freight}%, fuel ${H.rates.fuel}%, warehouse ${H.rates.warehouse}% a year <span class="srct assumption">${esc(e.status || "estimate")}</span> ${go("bench", "edit on Benchmarking", "Rates and scenario inputs: Benchmarking > Logistics Providers > Internal settings")}</p>
    <details class="rqprov"${MODS.some(m => RQ.choice[m] !== "best") ? " open" : ""}><summary>Provider per module: ${MODS.some(m => RQ.choice[m] !== "best") ? MODS.filter(m => RQ.choice[m] !== "best").map(m => `${m} ${esc((M.list.find(x => x.id === RQ.choice[m]) || {}).name || "")}`).join(", ") : "best per module"}</summary>
      <div class="controls">${MODS.filter(m => m !== "M6").map(provSel).join("")}</div>
      <p class="faint bnote">Best per module takes the cheapest price per lane, band or load over all providers. One provider upload feeds both S1 (its M1) and S3 (its M2 to M5). The 3PL for S3 follows M4 when fixed, else the S3 setting on Benchmarking.</p></details>`;
}
// ---- 2. scenario cards: the horizon, one layout for all four
function cardHtml(id, cheap){
  const H = M.H, y1 = M.y1.scen[id], R = M.out[id], s = V.SCENARIOS.find(z => z.id === id), tot = H.totals[id], rec = H.recommended && H.recommended.id === id;
  const orders = sum(H.years, y => y.orders), kg = sum(H.years, y => y.kg);
  const prov = id === "S2" ? (R.distributorNames && R.distributorNames.length ? `Distributor ${R.distributorNames.join(", ")}` : "no distributor data") + ((R.providers.M2 || []).length ? ` · M2 ${R.providers.M2.join(", ")}` : "")
    : MODS.filter(m => (R.providers[m] || []).length).map(m => `${m} ${R.providers[m].join(", ")}`).join(" · ");
  const cap = R.capability || {label: "n/a"};
  const rows = [
    ["Cost per order", tot != null ? eur(tot / orders, 2) : ""], ["Cost per kg", tot != null ? eur(tot / kg, 2) : ""],
    ["One-off investment", H.oneOffs[id] ? `${eur(H.oneOffs[id])} <span class="faint">year ${M.S.oneOffYear[id] || 1}</span>` : "none"],
    ["GCC delivery (S, M, L)", `<b>${esc(cap.label)}</b>${id === "S3" && R.nextDayState ? ` <span class="faint">next-day ${esc(R.nextDayState)}${R.cutoff ? `, cut-off ${esc(R.cutoff)}` : ""}</span>` : ""}`],
    ["Data completeness", `${Math.round((R.completeness || 0) * 100)}%`],
  ].concat(id === "S3" && y1 && y1.floor != null ? [["3PL minimum (floor)", `${eur(y1.floor)} a year <span class="faint">${R.dedicated ? "dedicated site" : "fixed fees W15 + minimum monthly W19"}</span>`]] : [])
   .concat(!hidden() && tot != null ? [["Cost % of revenue", (() => { const net = sum(H.years, y => (y.scen[id].revenue || {}).netEur || 0); return net > 0 ? pct2(tot / net) : "n/a"; })()]] : []);
  return `<div class="rqcard${cheap === id ? " best" : ""}${tot != null ? "" : " off"}${rec ? " rec" : ""}" style="--sc:${COLOR[id]}">
    <div class="rqch"><b>${id}</b><span>${esc(s.label)}</span>${rec ? '<em class="rqrec">recommended</em>' : ""}${cheap === id ? '<em class="rqbest">cheapest</em>' : ""}</div>
    <div class="rqcv">${tot != null ? `<span data-roll="hz-${id}">${eur(tot)}</span>` : stateLine(R) || '<span class="rqna">n/a</span>'}</div>
    <small>${tot != null ? `over ${M.n} year${M.n === 1 ? "" : "s"}${R.dedicated ? " · dedicated site" : ""}` : esc(missingText(R))}</small>
    <dl class="rqkv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <div class="rqcm">${tagChips(R)}</div>
    ${prov ? `<small class="rqprovs" title="${esc(prov)}">${go("bench", esc(prov), id === "S2" ? "Distributors: Benchmarking > Distributors" : "Providers: Benchmarking > Logistics Providers")}</small>` : ""}</div>`;
}
function topHtml(){
  const head = `<div class="cardhead rqhead"><div><h2 id="rqh">Supply chain scenarios</h2><span class="faint" style="font-size:12px">S1 to S4 for a volume case over a horizon · read-only: volume cases on Forecast, rates and providers on Benchmarking${M && M.legacy && M.legacy.length ? ` · ${M.legacy.length} legacy v1 answer${M.legacy.length === 1 ? "" : "s"} not compared` : ""}</span></div>
    <div class="rqrevbox"><label class="revsw" title="Keep revenue off the screen while sharing it with providers"><input type="checkbox" id="rqHideRev"${hidden() ? " checked" : ""}> Hide revenue</label></div></div>`;
  if (!M) return `<div class="card">${head}<p class="muted">Loading the Benchmarking results…</p></div>`;
  if (!M.vc) return `<div class="card">${head}<p class="empty">No volume case yet. Build one on the ${go("forecast", "Forecast tab")}.</p></div>`;
  if (!M.list.length) return `<div class="card">${head}${barHtml()}<p class="empty">No RFQ v3 answers yet. Upload them on ${go("bench", "Benchmarking > Logistics Providers")}; this block fills in by itself.</p></div>`;
  const cheap = cheapestTotal(), rec = M.H.recommended;
  return `<div class="card">${head}${barHtml()}
    ${rec ? `<p class="rqrecline">${rec.id ? `${sw(rec.id)}<b>Recommended: ${rec.id} ${esc(sname(rec.id))}.</b> ` : "<b>No recommendation.</b> "}${esc(rec.reason)}</p>` : ""}
    <div class="rqcards four">${IDS.map(id => cardHtml(id, cheap)).join("")}</div>
    <p class="faint bnote">Total cost over the horizon, ${esc(scopeName())}: each year's volume priced at that year's rates; one-off costs in full in their year. Only scenarios complete in every year are ranked. Hover a tag for its meaning.</p></div>`;
}

// ---- 3. summary panel (right of the map)
function summaryHtml(){
  if (!M || !M.vc) return `<div class="cardhead"><h2>Summary</h2></div><p class="muted">No volume case yet.</p>`;
  const H = M.H, lanes = lanesIn(), fs = window.ForecastUI && ForecastUI.state, prof = fs && fs.F && fs.F.H ? fs.F.H.profile : {};
  const withOrders = lanes.filter(L => H.years.some(y => y.volume.byCountry[L].orders > 0));
  const customers = sum(withOrders, L => ((prof[V.LANES[L].country] || {}).customers || 0));
  const rows = H.years.map(y => `<tr${y.extrapolated ? ' class="ext"' : ""}><td class="num">${y.year}${y.extrapolated ? ' <span class="srct extrapolated">extrapolated</span>' : ""}</td><td class="n">${fmt(y.orders, 0)}</td><td class="n">${fmt(y.kg, 0)}</td>${hidden() ? "" : `<td class="n">${eur(y.revenueUsd * y.fx)}</td>`}</tr>`).join("");
  return `<div class="cardhead"><h2>Summary</h2><span class="faint" style="font-size:12px">${esc(scopeName())}</span></div>
    <dl class="kv sumkv">
      <dt>Volume case</dt><dd>${go("forecast", esc(M.vc.name), "Open the case on the Forecast tab")}</dd>
      <dt>Orders</dt><dd><b>${fmt(sum(H.years, y => y.orders), 0)}</b> over ${M.n} year${M.n === 1 ? "" : "s"}</dd>
      <dt>Units</dt><dd>${fmt(sum(H.years, y => y.units), 0)}</dd>
      <dt>Kg</dt><dd>${fmt(sum(H.years, y => y.kg), 0)}</dd>
      <dt>Countries</dt><dd>${withOrders.length} of ${lanes.length}${withOrders.length && withOrders.length < 9 ? ` <span class="faint">${withOrders.map(L => V.LANES[L].short || V.LANES[L].name).join(", ")}</span>` : ""}</dd>
      <dt>Customers</dt><dd>${customers ? `${fmt(customers)} <span class="faint">in the ${esc(M.vc.baseYear)} history</span>` : '<span class="faint">no history loaded</span>'}</dd>
      <dt>Years</dt><dd>${H.startYear} to ${H.startYear + M.n - 1}${H.extrapolated.length ? ` · extrapolated ${H.extrapolated.join(", ")}` : ""}</dd>
      ${hidden() ? "" : `<dt>Revenue</dt><dd><b>${eur(sum(H.years, y => y.revenueUsd * y.fx))}</b> <span class="faint">internal</span></dd>`}
    </dl>
    <div class="tablewrap"><table class="rqtbl"><thead><tr><th>Year</th><th>Orders</th><th>Kg</th>${hidden() ? "" : "<th>Revenue</th>"}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- 4. below the map: year-by-year table and cumulative cost
function horizonHtml(){
  const H = M.H, H2 = hidden();
  const rows = H.years.map(y => `<tr><th class="num">${y.year}${y.extrapolated ? ' <span class="srct extrapolated">extrapolated</span>' : ""}<br><span class="faint">${fmt(y.orders, 0)} orders · ${fmt(y.kg, 0)} kg</span></th>
    ${IDS.map(id => { const x = y.scen[id];
      return `<td class="n${y.cheapest === id ? " best" : ""}">${x.cost != null ? `<span class="rqv" title="${esc(`recurring ${eur(x.recurring)}${x.oneOff ? ` + one-off ${eur(x.oneOff)}` : ""}; rates x (1 + escalation)^${y.i - 1}`)}">${eur(x.cost)}</span>${x.oneOff ? `<small class="rqpct">incl. one-off ${eur(x.oneOff)}</small>` : ""}${!H2 && x.revenue && x.revenue.pct != null ? `<small class="rqpct">${pct2(x.revenue.pct)} of revenue</small>` : ""}` : stateLine(x.R)}</td>`; }).join("")}</tr>`).join("");
  const totals = `<tr class="tot"><th>Total ${H.startYear} to ${H.startYear + M.n - 1}</th>${IDS.map(id => `<td class="n">${H.totals[id] != null ? `<b>${eur(H.totals[id])}</b>` : ""}</td>`).join("")}</tr>`;
  const sp = IDS.filter(id => id !== "S1").map(id => { const x = H.switchPoints[id]; if (!x) return `${id}: no switch point`;
    return x.within ? `${id} beats S1 from <b>${x.year}</b> (${fmt(x.orders, 0)} orders, ${fmt(x.kg, 0)} kg that year)` : `${id} beats S1 beyond the horizon, from about ${x.multiplier}× year-1 volume (${fmt(x.orders, 0)} orders, ${fmt(x.kg, 0)} kg)`; });
  const first = IDS.filter(id => id !== "S1" && H.switchPoints[id] && H.switchPoints[id].within).sort((a, b) => H.switchPoints[a].i - H.switchPoints[b].i)[0];
  const labels = H.years.map(y => String(y.year));
  const series = IDS.filter(id => H.cumulative[id].some(v => v != null)).map(id => ({name: `${id} ${sname(id)}`, color: COLOR[id], values: H.cumulative[id], width: id === "S1" ? 2.4 : 2}));
  const chart = series.length && window.FlexCharts ? FlexCharts.lineChart({label: "Cumulative cost over the horizon", labels, series, legend: true, w: 1100, h: 240, fmt: v => FlexCharts.sfmt(v), tip: v => eur(v),
    marker: first ? H.switchPoints[first].i - 1 + 0.5 : null, markerLabel: first ? `${first} switch point ${H.switchPoints[first].year}` : null}) : '<p class="empty">No complete scenario to chart.</p>';
  return `<div class="card"><div class="cardhead"><h2>Year by year</h2><span class="faint" style="font-size:12px">${esc(M.vc.name)} · ${esc(scopeName())} · green: cheapest that year</span></div>
    <div class="tablewrap btable"><table class="rqtbl hztbl"><thead><tr><th>Year</th>${IDS.map(id => `<th>${sw(id)}${id}<br><span class="faint">${esc(sname(id))}</span></th>`).join("")}</tr></thead><tbody>${rows}${totals}</tbody></table></div>
    <p class="faint bnote">Each year: the volume of that year (${go("forecast", "volume case")}) priced with the providers' rates (${go("bench", "Benchmarking")}) x (1 + escalation)^(year - 1): freight and fuel on transport, direct and delivery; warehouse on handling, storage and fixed costs; customs not escalated. One-off costs (3PL onboarding, own-site setup) in full in their year. ${H.extrapolated.length ? `Extrapolated years continue the case's last growth rate.` : ""}</p></div>
    <div class="card"><div class="cardhead"><h2>Cumulative cost</h2><span class="faint" style="font-size:12px">switch point: the first year S2, S3 or S4 costs less than S1</span></div>
    <div class="rqchart">${chart}</div><p class="rqnote">${sp.join(" · ")}</p></div>`;
}

// ---- 5. year-1 detail: comparison, regions, country, unit cost, break-even, answers
function compareHtml(){
  const ok = IDS.filter(id => scoped(id).cost != null).sort((a, b) => scoped(a).cost - scoped(b).cost), best = ok[0], s1 = scoped("S1").cost, H = hidden();
  const low = H ? null : (IDS.map(id => [id, scoped(id).rv]).filter(([, b]) => b && b.pct != null).sort((a, b) => a[1].pct - b[1].pct)[0] || [null])[0];
  const rows = IDS.map(id => { const x = scoped(id), R = x.R, okc = x.cost != null;
    return `<tr class="${best === id ? "best" : ""}"><th>${sw(id)}${id} ${esc(sname(id))}${best === id ? ' <em class="rqbest">cheapest</em>' : ""}</th>
      <td class="n">${okc ? `<span class="rqv" title="${esc((R.tags || []).join(" · "))}">${eur(x.cost)}</span>` : stateLine(R)}</td>
      ${H ? "" : `<td class="n">${okc && x.rv ? eur(x.rv.netEur) : ""}</td><td class="n${low === id ? " best" : ""}">${okc && x.rv && x.rv.pct != null ? `${pct2(x.rv.pct)}${x.rv.coveredOnly ? `<small class="rqcov">covered shipments only (${pct(x.covered, x.shipments)})</small>` : ""}` : ""}</td><td class="n">${okc && x.rv && x.rv.contribution != null ? eur(x.rv.contribution) : ""}</td>`}
      <td class="n">${okc && s1 != null && id !== "S1" ? `<span class="${x.cost <= s1 ? "rqsave" : "rqmore"}">${x.cost <= s1 ? "−" : "+"}${eur(Math.abs(x.cost - s1))}</span>` : ""}</td>
      <td class="n">${okc ? eur(x.perOrder, 2) : ""}</td><td class="n">${okc ? eur(x.perKg, 2) : ""}</td>
      <td class="n">${x.shipments ? `${fmt(x.covered, 0)} of ${fmt(x.shipments, 0)}` : ""}</td><td class="n">${x.measured ? pct(x.onTime, x.measured) : ""}</td>
      <td class="n">${Math.round((R.completeness || 0) * 100)}%</td><td class="n">${R.oneOff ? eur(R.oneOff) : ""}</td></tr>`; }).join("");
  return `<h2 class="rqsec">Year-1 detail <span class="faint">${yearLabel()} · one-off costs spread over their amortisation years</span></h2>
    <div class="card"><div class="cardhead"><h2>Scenario comparison, year 1</h2><span class="faint" style="font-size:12px">${esc(scopeName())} · green: the cheapest complete scenario</span></div>
    <div class="tablewrap btable"><table class="rqtbl"><thead><tr><th>Scenario</th><th>Annual cost</th>${H ? "" : "<th>Revenue (EUR)</th><th>Logistics cost % of revenue</th><th>Contribution after logistics</th>"}<th>Against S1</th><th>Per order</th><th>Per kg</th><th>Shipments covered</th><th>On time</th><th>Inputs</th><th>One-off</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${H ? "" : `<p class="faint bnote">Internal revenue of the volume case, ${M.y1.year}: ${eur(M.view.eur)}. Cost % of revenue = annual cost / revenue in EUR; S2 divides by net revenue after the distributor's margin. Contribution after logistics: before product cost and other overheads.</p>`}
    ${IDS.filter(id => M.out[id].state !== "complete").map(id => `<p class="faint rqnote">${id} ${esc(sname(id))}: ${esc(missingText(M.out[id]))}</p>`).join("")}</div>`;
}
function regionHtml(){
  const rows = V.REGIONS.map(([region, lanes]) => {
    const costs = Object.fromEntries(IDS.map(id => [id, M.out[id].state === "complete" ? sum(lanes, L => M.out[id].countries[L].cost) : null]));
    const best = (M.out.byRegion.find(r => r.region === region) || {}).best;
    return `<tr${RQ.filter === region ? ' class="sel"' : ""}><th>${esc(region)}<br><span class="faint num">${lanes.join(" ")}</span></th>${IDS.map(id => `<td class="n${best === id ? " best" : ""}">${costs[id] != null ? `<span class="rqv">${eur(costs[id])}</span>${hidden() ? "" : `<small class="rqpct">${ofRev(M.view.scenarios[id].regions[region], id)}</small>`}` : stateLine(M.out[id])}</td>`).join("")}<td>${best ? `${sw(best)}${best}` : '<span class="rqna">none complete</span>'}</td></tr>`;
  }).join("");
  return `<div class="card"><div class="cardhead"><h2>Region by scenario, year 1</h2><span class="faint" style="font-size:12px">${yearLabel()}</span></div>
    <div class="tablewrap"><table class="rqtbl rqreg"><thead><tr><th>Region</th>${IDS.map(id => `<th>${sw(id)}${id}<br><span class="faint">${esc(sname(id))}</span></th>`).join("")}<th>Cheapest</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="faint bnote">Warehouse-wide costs (replenishment, storage, devanning, carrying) are spread over the served countries by kg; fixed costs and the minimum top-up by orders.</p></div>`;
}
const volOne = L => sum(V.BANDS, b => Number(((M.S.volumes.Y || {})[L] || {})[b]) || 0);
function countryLane(){
  if (isLane(RQ.filter)) return RQ.filter;
  const L = ui.country ? laneOfIso(ui.country) : null; if (L) return L;
  return lanesIn().slice().sort((a, b) => volOne(b) - volOne(a))[0];
}
function stackBar(types, total){
  if (!(total > 0)) return '<div class="rqstack na"><span>n/a</span></div>';
  return `<div class="rqstack">${V.TYPES.filter(([k]) => types[k] > 0.005).map(([k, l]) => `<i style="width:${(types[k] / total * 100).toFixed(2)}%;background:${TYPE_COLOR[k]}" title="${esc(`${l}: ${eur(types[k])} (${pct(types[k], total)})`)}"></i>`).join("")}</div>`;
}
function countryHtml(){
  const L = countryLane(); if (!L) return "";
  const best = M.out.byCountry[L], vol = b => Number(((M.S.volumes.Y || {})[L] || {})[b]) || 0;
  const rows = V.CLASSES.map(c => `<tr><th>${esc(c.label)}<br><span class="faint">${c.size} · ${fmt(M.S.avgKg[c.band], 0)} kg · ${fmt(vol(c.band), 1)} a year</span></th>${IDS.map(id => { const x = V.classCost(M.out[id], L, c.band);
    return `<td class="n">${x ? `<span class="rqv" title="${esc(`${x.tag}${x.via ? " · via the distributor, cost per customer shipment" : ""} · ${id} ${sname(id)}`)}">${eur(x.price, 2)}</span>` : M.out[id].state === "complete" ? '<span class="rqna">–</span>' : stateLine(M.out[id])}</td>`; }).join("")}</tr>`).join("");
  const bars = IDS.map(id => { const R = M.out[id], c = R.countries[L];
    return `<div class="rqbrow"><span class="rqbl">${sw(id)}${id}</span>${R.state === "complete" ? stackBar(c.types, c.cost) : `<div class="rqstack na"><span>${esc(STATE[R.state] || R.state)}</span></div>`}<span class="rqbv num">${R.state === "complete" ? eur(c.cost) : ""}${R.state === "complete" && !hidden() && c.shipments > 0 ? `<small>${ofRev(M.view.scenarios[id].countries[L], id)}</small>` : ""}</span></div>`; }).join("");
  const legend = V.TYPES.map(([k, l]) => `<span><i class="sw" style="background:${TYPE_COLOR[k]}"></i>${esc(l)}</span>`).join("");
  return `<div class="card" id="rqCountryCard"><div class="cardhead"><h2>${esc(V.LANES[L].name)}</h2><span class="faint" style="font-size:12px">${L} · ${esc(V.LANES[L].region)} · target ${M.S.targetDays[L]} working days · ${yearLabel()}${best ? ` · cheapest ${best}` : ""}</span></div>
    <h3 class="rqh3">Cost per order by class</h3>
    <div class="tablewrap"><table class="rqtbl"><thead><tr><th>Class</th>${IDS.map(id => `<th>${sw(id)}${id}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <h3 class="rqh3">Annual cost breakdown</h3><div class="rqbars">${bars}</div><div class="rqlegend">${legend}</div></div>`;
}
function unitHtml(){
  const rows = IDS.map(id => { const x = scoped(id);
    return `<tr><th>${sw(id)}${id} ${esc(sname(id))}</th><td class="n">${x.cost != null ? eur(x.perOrder, 2) : stateLine(x.R)}</td><td class="n">${x.cost != null ? eur(x.perKg, 2) : ""}</td><td class="n">${x.cost != null ? eur(x.perPallet, 2) : ""}</td>${hidden() ? "" : `<td class="n">${x.rv && x.rv.per1000 != null ? eur(x.rv.per1000, 2) : ""}</td>`}</tr>`; }).join("");
  const n = volIn(lanesIn(), () => 1), kg = volIn(lanesIn(), b => Number(M.S.avgKg[b]) || 0);
  return `<div class="card"><div class="cardhead"><h2>Unit cost, year 1</h2><span class="faint" style="font-size:12px">${esc(scopeName())} · ${fmt(n, 0)} orders · ${fmt(kg, 0)} kg</span></div>
    <div class="tablewrap"><table class="rqtbl"><thead><tr><th>Scenario</th><th>Per order</th><th>Per kg</th><th>Per pallet (${fmt(M.S.kgPerPallet, 0)} kg)</th>${hidden() ? "" : "<th>Per USD 1,000 of revenue</th>"}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function breakEvenHtml(){
  const sens = M.sens, labels = sens.rows.map(r => `${r.m}×`);
  const series = ["S1", "S3", "S4"].filter(k => sens.rows.some(r => r[k] != null)).map(k => ({name: `${k} ${sname(k)}`, color: COLOR[k], values: sens.rows.map(r => r[k]), width: k === "S1" ? 2.4 : 2}));
  const be = Object.entries(sens.breakEven).filter(([, m]) => m != null);
  const note = be.length ? be.map(([k, m]) => `${k} ${esc(sname(k))} becomes cheaper than S1 from about <b>${m}×</b> the year-1 volume.`).join(" ")
    : `Neither S3 nor S4 becomes cheaper than S1 between 0.25× and 5×${["S3", "S4"].some(k => M.out[k].state !== "complete") ? " (S3 or S4 is not complete yet)" : ""}.`;
  const right = hidden() ? null : {label: "% of revenue", fmt: v => `${Math.round(v * 1000) / 10}%`, tip: v => pct2(v),
    series: ["S1", "S3", "S4"].filter(k => M.sensPct.some(r => r[k] != null)).map(k => ({name: `${k} % of revenue`, color: COLOR[k], dash: "5 4", values: M.sensPct.map(r => r[k])}))};
  const chart = series.length && window.FlexCharts ? FlexCharts.lineChart({label: "Annual cost by volume multiplier", labels, series, legend: true, w: 1100, h: 240, fmt: v => FlexCharts.sfmt(v), tip: v => eur(v), yLabel: right ? "EUR a year" : null, right}) : '<p class="empty">No complete scenario to chart.</p>';
  return `<div class="card"><div class="cardhead"><h2>Break-even volume, year 1</h2><span class="faint" style="font-size:12px">S1, S3 and S4 at 0.5× to 3× the year-1 volume · all countries</span></div>
    <div class="rqchart">${chart}</div><p class="rqnote">${note}</p></div>`;
}
function answersHtml(){
  const fu = M.list.filter(e => (e.follow || []).length);
  return `<div class="card rqans"><div class="cardhead"><h2>Answers</h2><span class="faint" style="font-size:12px">${yearLabel()} · all regions</span></div>
    <ul class="rqq">${M.answers.concat(hidden() ? [] : M.revAnswers).map(a => `<li>${esc(a)}</li>`).join("")}</ul>
    <h3 class="rqh3">Follow-up questions <button type="button" class="btn ghost sm" data-a="rqcopy"${fu.length ? "" : " disabled"}>Copy</button></h3>
    ${fu.length ? fu.map(e => `<p class="rqfu"><b>${esc(e.name)}</b></p><ol class="rqlist" data-fu>${e.follow.map(i => `<li>${esc(i)}</li>`).join("")}</ol>`).join("") : '<p class="faint">Nothing to ask.</p>'}</div>`;
}

// ---- the map: colour by the cheapest scenario over the horizon per country, tooltip per scenario
function country(iso){
  if (!M || !M.vc || !M.list.length) return null;
  const L = laneOfIso(iso); if (!L) return null;
  const H = M.H, best = H.byCountry[L];
  const lines = [`${V.LANES[L].name} · ${M.vc.name} · ${H.startYear} to ${H.startYear + M.n - 1}`, best ? `Cheapest over the horizon: ${best} ${sname(best)}` : "No complete scenario"];
  IDS.forEach(id => { const t = H.countryTotals[L][id], R = M.out[id];
    if (t == null) { lines.push(`${id} ${STATE[R.state] || R.state}`); return; }
    const per = V.CLASSES.map(k => [k, V.classCost(R, L, k.band)]).filter(([, x]) => x).map(([k, x]) => `${k.size} ${eur(x.price, 0)}`);
    const rv = !hidden() && R.countries[L].shipments > 0 ? M.view.scenarios[id].countries[L] : null;
    lines.push(`${id} ${eur(t)} over ${M.n} yr${rv && rv.pct != null ? `, year 1 ${pct2(rv.pct)} of revenue` : ""}${per.length ? ` · year-1 per order ${per.join(", ")}` : ""}`);
  });
  return {fill: best ? COLOR[best] : null, scenario: best, tip: lines.join("\n")};
}
const legend = () => IDS.map(id => `<span><i class="sw" style="background:${COLOR[id]}"></i>${id} ${esc(sname(id))}</span>`).join("") + `<span><i class="sw" style="background:var(--land-study)"></i>no complete scenario</span>`;

function wire(){
  const top = $("rfqTop"), body = $("rfqBody"), side = $("sumPanel");
  const hr = top.querySelector("#rqHideRev");
  if (hr) hr.addEventListener("change", () => { window.FlexiRevenue = Object.assign(window.FlexiRevenue || {}, {hidden: hr.checked}); window.dispatchEvent(new Event("flexirevenue")); refresh(); });
  const on = (id, fn) => { const el = top.querySelector("#" + id); if (el) el.addEventListener("change", () => { fn(el.value); remember(); refresh(); }); };
  on("rqCase", v => { RQ.caseId = v; RQ.horizon = 0; }); on("rqHz", v => { RQ.horizon = Number(v); }); on("rqFilter", v => { RQ.filter = v; });
  top.querySelectorAll("select[data-mod]").forEach(s => s.addEventListener("change", () => { RQ.choice[s.dataset.mod] = s.value; remember(); refresh(); }));
  [top, body, side].filter(Boolean).forEach(el => el.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showView(b.dataset.go))));
  const cq = body.querySelector('[data-a="rqcopy"]');
  if (cq) cq.addEventListener("click", () => {
    const text = [...body.querySelectorAll("[data-fu]")].map(ol => `${ol.previousElementSibling.textContent}\n${[...ol.children].map((li, i) => `${i + 1}. ${li.textContent}`).join("\n")}`).join("\n\n");
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Follow-up questions copied"), () => toast("Copy failed. Select the text and copy it by hand.", "bad"));
  });
}
function render(){
  M = load();
  const top = $("rfqTop"), body = $("rfqBody"), side = $("sumPanel"); if (!top || !body) return;
  top.innerHTML = topHtml();
  if (side) side.innerHTML = summaryHtml();
  body.innerHTML = M && M.vc && M.list.length ? horizonHtml() + compareHtml() + regionHtml() + `<div class="rqpair">${countryHtml()}${unitHtml()}</div>` + breakEvenHtml() + answersHtml() : "";
  // the map shows the cheapest scenario once there is one, unless someone picked another colouring
  const has = !!(M && M.vc && M.list.length), sel = $("mapMetric");
  if (has && !ui.mapMetricPicked && ui.mapMetric !== "rfq") { ui.mapMetric = "rfq"; if (sel) sel.value = "rfq"; }
  if (!has && ui.mapMetric === "rfq" && !ui.mapMetricPicked) { ui.mapMetric = "best"; if (sel) sel.value = "best"; }
  wire();
}
function refresh(){ render(); if (typeof drawCountries === "function") drawCountries(); }
window.DashRFQ = {render, refresh, country, legend, state: RQ};
if (typeof VIEW !== "undefined" && VIEW.current === "dash") refresh();
})();
