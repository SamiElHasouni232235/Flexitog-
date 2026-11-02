/* FlexiTog dashboard: the five logistics scenarios of the modular RFQ v3.0 on the Dashboard.
 * S1 direct from Helmond (M1), S2 distributor holds stock (M2), S3 3PL holds stock (M2 to M5, S3b dedicated site),
 * S4 own warehouse (M2, M3, M5 proxy and own inputs), S5 other (M6, indicative, not ranked).
 * The Dashboard reads, compares and explains. It never parses files and holds no cost formula: every figure comes from
 * rfq_v30.js (window.FlexiRFQ30) applied to the providers Benchmarking lists (BenchUI.rfq30) and the internal settings
 * on Benchmarking, so totals match the Benchmarking tab. Runs after benchmark.js. renderView (dashboard.html) calls
 * DashRFQ.render(), and the map asks DashRFQ.country(iso) for its colour and tooltip.
 * Shares the dashboard globals ($, esc, fmt, ui, drawCountries, toast, FlexCharts, FlexiCalc).
 */
(function () {
"use strict";
const V = window.FlexiRFQ30;
const MODS = ["M1", "M2", "M3", "M4", "M5", "M6"];
const MOD_LABEL = {M1: "M1 direct from Helmond", M2: "M2 bulk to the region", M3: "M3 customs", M4: "M4 warehouse", M5: "M5 delivery from warehouse", M6: "M6 other solution"};
const saved = DataStore.pref.get("dash-rfq30") || {};
const RQ = {vc: saved.vc === "B" ? "B" : "A", region: saved.region || "all", country: saved.country || "map",
  choice: Object.assign(Object.fromEntries(MODS.map(m => [m, "best"])), saved.choice || {})};
const remember = () => DataStore.pref.set("dash-rfq30", RQ);
const RANKED = ["S1", "S2", "S3", "S3b", "S4"];
const ALL = RANKED.concat("S5");
const COLOR = {S1: "var(--lc1)", S2: "var(--s-distributor)", S3: "var(--s-3pl)", S3b: "var(--lc5)", S4: "var(--s-owned_warehouse)", S5: "var(--s-cif_baseline)"};
const TYPE_COLOR = {transport: "var(--lc1)", customs: "var(--lc4)", handling: "var(--lc2)", storage: "var(--lc5)", delivery: "var(--lc3)",
  fixed: "var(--s-cif_baseline)", direct: "var(--lc6)"};
const STATE = {complete: "complete", incomplete: "incomplete", not_configured: "not configured", indicative: "indicative, not ranked"};
const TAG_TIP = {quoted: "quoted: prices from the files", derived: "derived: calculated from quoted prices", extrapolated: "extrapolated: next lower band per kg",
  proxy: "proxy: another provider's prices stand in", assumption: "assumption: rests on the internal settings", indicative: "indicative: not comparable, not ranked",
  "excludes distributor margin": "excludes distributor margin: the cost leaves the distributor's margin out; its discount lowers net revenue (Revenue, internal only)"};
const laneOfIso = iso => V.LANE_IDS.find(L => V.LANES[L].country === iso);
const lname = L => V.LANES[L].short || V.LANES[L].name;
const eur = (v, dp) => (v == null ? "n/a" : "EUR " + fmt(v, dp == null ? 0 : dp));
const pct2 = x => (x == null ? "n/a" : `${(x * 100).toFixed(2)}%`);
const hidden = () => !window.FlexiRevenue || window.FlexiRevenue.hidden !== false;   // revenue stays hidden until someone turns it on
const pct = (a, b) => (b ? `${Math.round(a / b * 1000) / 10}%` : "n/a");
const sname = id => V.sname(id);
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
let M = null;   // this render's data

// ---- data: providers and settings from Benchmarking, the scenarios for the filters (cached per inputs)
function load(){
  const B = window.BenchUI && BenchUI.rfq30;
  if (!B || !B.ready()) return null;
  const list = B.list(), S = V.withDefaults(B.settings()), legacy = B.legacy();
  MODS.forEach(m => { if (RQ.choice[m] !== "best" && !list.some(e => e.id === RQ.choice[m])) RQ.choice[m] = "best"; });
  if (RQ.region !== "all" && !V.REGIONS.some(([r]) => r === RQ.region)) RQ.region = "all";
  if (RQ.country !== "map" && !V.LANES[RQ.country]) RQ.country = "map";
  const key = JSON.stringify([list.map(e => [e.id, e.up && (e.up.ref || e.up.uploadedAt)]), S, RQ.vc, RQ.choice]);
  const calc = () => ({out: V.scenarios(list, S, RQ.vc, RQ.choice), sens: V.sensitivity(list, S, RQ.vc, RQ.choice)});
  const C = window.FlexiCalc && FlexiCalc.memo ? FlexiCalc.memo("dash-rfq30", key, calc) : calc();
  const rev = B.revenue ? B.revenue() : null, view = V.revenueView(C.out, rev, S);
  // cost as % of revenue at each volume multiplier (revenue scales with the volumes)
  const sensPct = C.sens.rows.map(row => Object.fromEntries(["S1", "S3", "S4"].map(k => [k, row[k] != null && view.eur > 0 ? row[k] / (view.eur * row.m) : null])));
  return {list, S, legacy, out: C.out, sens: C.sens, view, sensPct, answers: V.answers(C.out, C.sens, list), revAnswers: V.revenueAnswers(view)};
}
const lanesIn = () => (RQ.region === "all" ? V.LANE_IDS : (V.REGIONS.find(([r]) => r === RQ.region) || [null, V.LANE_IDS])[1]);
const scopeName = () => (RQ.region === "all" ? "all 9 countries" : RQ.region);
const volIn = (lanes, f) => sum(lanes, L => sum(V.BANDS, b => (Number(((M.S.volumes[RQ.vc] || {})[L] || {})[b]) || 0) * f(b)));
// A scenario in the current scope: cost, shipments, coverage, per order and per kg. Null cost when it is not complete.
function scoped(id){
  const R = M.out[id], lanes = lanesIn();
  if (id === "S5") return {R, cost: R.total, state: R.state, rv: null};
  const cs = lanes.map(L => R.countries[L]);
  const cost = R.state === "complete" ? (RQ.region === "all" ? R.total : sum(cs, c => c.cost)) : null;
  const n = volIn(lanes, () => 1), kg = volIn(lanes, b => Number(M.S.avgKg[b]) || 0);
  const types = Object.fromEntries(V.TYPES.map(([k]) => [k, RQ.region === "all" ? R.types[k] : sum(cs, c => c.types[k])]));
  const rv = hidden() ? null : RQ.region === "all" ? M.view.scenarios[id].total : M.view.scenarios[id].regions[RQ.region];
  return {R, cost, state: R.state, n, kg, types, rv, perOrder: cost != null && n ? cost / n : null, perKg: cost != null && kg ? cost / kg : null,
    perPallet: cost != null && kg ? cost / (kg / (Number(M.S.kgPerPallet) || 250)) : null,
    shipments: sum(cs, c => c.shipments), covered: sum(cs, c => c.covered), measured: sum(cs, c => c.measured), onTime: sum(cs, c => c.onTime)};
}
function cheapestIn(){
  const xs = RANKED.map(id => [id, scoped(id).cost]).filter(([, c]) => c != null).sort((a, b) => a[1] - b[1]);
  return xs.length ? xs[0][0] : null;
}
// "21.23% of revenue (covered shipments only)" for a revenue block of revenueView
const ofRev = (b, id) => (b && b.pct != null ? `${pct2(b.pct)} of ${id === "S2" ? "net revenue" : "revenue"}${b.coveredOnly ? " (covered shipments only)" : ""}` : "");
const lowestPct = () => (hidden() ? null : (RANKED.map(id => [id, scoped(id).rv]).filter(([, b]) => b && b.pct != null).sort((a, b) => a[1].pct - b[1].pct)[0] || [null])[0]);
const tagChips = R => (R.tags || []).map(t => `<span class="rqtag" title="${esc(TAG_TIP[t] || t)}">${esc(t)}</span>`).join("");
const sw = id => `<i class="sw" style="background:${COLOR[id]}"></i>`;
function stateLine(R){
  if (R.state === "not_configured") return `<span class="rqna" title="${esc(R.notes.join(" "))}">not configured</span>`;
  if (R.state === "incomplete") return `<span class="rqna" title="${esc("Missing: " + R.missing.join(", "))}">incomplete</span>`;
  return "";
}
const missingText = R => (R.state === "incomplete" ? `Missing ${R.missing.slice(0, 6).join(", ")}${R.missing.length > 6 ? ` and ${R.missing.length - 6} more` : ""}.` : R.state === "not_configured" ? R.notes.join(" ") : "");

// ---- revenue per volume case, top right of the block: editable, hidden while "Hide revenue" is on
function revBoxHtml(){
  const sw = `<label class="revsw" title="Keep revenue off the screen while sharing it with providers"><input type="checkbox" id="rqHideRev"${hidden() ? " checked" : ""}> Hide revenue</label>`;
  const B = window.BenchUI && BenchUI.rfq30;
  if (hidden() || !M || !B) return `<div class="rqrevbox">${sw}</div>`;
  const rv = V.revenueSettings(B.revenue()), byC = sc => V.revenueByCountry(B.revenue(), M.S, sc);
  // the case total is editable while it feeds any country; with all nine countries set it is their sum
  const row = sc => { const b = byC(sc), own = !b.allocated.length;
    return `<label class="rqrevrow${RQ.vc === sc ? " on" : ""}"><span>Volume case ${sc}, USD</span>
      ${own ? `<b class="num" title="Sum of the per-country revenue on Benchmarking">USD ${fmt(b.usd, 0)}</b>` : `<input type="number" min="0" step="1000" data-rev="total.${sc}" value="${esc(rv.total[sc])}" aria-label="Net revenue volume case ${sc}, USD">`}
      <small class="num">= ${eur(b.usd * rv.fx)}</small></label>`; };
  return `<div class="rqrevbox">${sw}<div class="rqrevf" aria-label="Net revenue excl. VAT, internal only">
      ${row("A")}${row("B")}
      <label class="rqrevrow"><span>USD to EUR</span><input type="number" min="0" step="0.0001" data-rev="fx" value="${esc(rv.fx)}" aria-label="Exchange rate USD to EUR" title="Confirm with Anna Murphy"><small></small></label>
      <small class="faint">Net revenue excl. VAT in USD, internal only · rate: confirm with Anna Murphy<br>Per country: Benchmarking > internal settings${byC("A").allocated.length ? " (now allocated by shipments)" : ""}</small></div></div>`;
}

// ---- 1. filters and scenario cards (above the map)
function filtersHtml(){
  const seg = (id, items, v) => `<div class="seg" id="${id}" role="group">${items.map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${v === k}">${esc(l)}</button>`).join("")}</div>`;
  const provSel = m => { const ps = M.list.filter(e => e.Q.priced[m]);
    return `<div class="ctl"><label for="rqC${m}">${esc(MOD_LABEL[m])}</label><select id="rqC${m}" data-mod="${m}"><option value="best">Best per module</option>${ps.map(e => `<option value="${esc(e.id)}"${RQ.choice[m] === e.id ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select></div>`; };
  return `<div class="controls rqfilters">
      <div class="ctl"><label>Volume case</label>${seg("rqVc", [["A", "Volume case A"], ["B", "Volume case B"]], RQ.vc)}</div>
      <div class="ctl"><label for="rqRegion">Region</label><select id="rqRegion"><option value="all">All regions</option>${V.REGIONS.map(([r]) => `<option${RQ.region === r ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></div>
      <div class="ctl"><label for="rqCountry">Country detail</label><select id="rqCountry"><option value="map">Follows the map selection</option>${V.LANE_IDS.map(L => `<option value="${L}"${RQ.country === L ? " selected" : ""}>${L} ${esc(V.LANES[L].name)}</option>`).join("")}</select></div>
    </div>
    <details class="rqprov"${MODS.some(m => RQ.choice[m] !== "best") ? " open" : ""}><summary>Provider per module: ${MODS.some(m => RQ.choice[m] !== "best") ? MODS.filter(m => RQ.choice[m] !== "best").map(m => `${m} ${esc((M.list.find(e => e.id === RQ.choice[m]) || {}).name || "")}`).join(", ") : "best per module"}</summary>
      <div class="controls">${MODS.map(provSel).join("")}</div>
      <p class="faint bnote">Best per module takes the cheapest price per lane, band or load over all providers. A fixed provider uses only that provider's prices for the module. The 3PL for S3 follows M4 when fixed, else the S3 setting on Benchmarking.</p></details>`;
}
function cardHtml(id, best){
  const x = scoped(id), R = x.R, s = V.SCENARIOS.find(z => z.id === id);
  const prov = MODS.filter(m => (R.providers[m] || []).length).map(m => `${m} ${R.providers[m].join(", ")}`).join(" · ");
  let main, sub = "";
  if (id === "S5") {
    main = R.total != null ? `<span data-roll="rq-${id}">${eur(R.total)}</span>` : stateLine(R) || '<span class="rqna">no estimate</span>';
    sub = R.solutions && R.solutions.length ? R.solutions.map(z => `${esc(z.name)}: ${esc(z.title || "unnamed solution")}`).join("<br>") : esc(R.notes.join(" "));
  } else if (x.cost != null) {
    main = `<span data-roll="rq-${id}">${eur(x.cost)}</span>`;
    const s1 = scoped("S1").cost;
    sub = `${eur(x.perOrder, 2)} per order${id !== "S1" && s1 != null ? ` · ${x.cost <= s1 ? "saves" : "costs"} ${eur(Math.abs(s1 - x.cost))} against S1` : ""}`;
    if (x.rv && x.rv.pct != null) sub += `<br><span class="rqrev" title="${esc(`Internal revenue ${eur(x.rv.netEur)}${id === "S2" ? " net of the distributor discount" : ""}; contribution after logistics, before product cost and other overheads`)}">${ofRev(x.rv, id)} · contribution ${eur(x.rv.contribution)}</span>`;
  } else { main = stateLine(R); sub = esc(missingText(R)); }
  return `<div class="rqcard${best === id ? " best" : ""}${R.state === "complete" || R.state === "indicative" ? "" : " off"}" style="--sc:${COLOR[id]}">
    <div class="rqch"><b>${id}</b><span>${esc(s.label)}</span>${best === id ? '<em class="rqbest">cheapest</em>' : ""}</div>
    <div class="rqcv">${main}</div><small>${sub}</small>
    <div class="rqcm"><span title="Required inputs filled">${Math.round((R.completeness == null ? 0 : R.completeness) * 100)}% inputs</span>${tagChips(R)}</div>
    ${prov ? `<small class="rqprovs" title="${esc(prov)}">${esc(prov)}</small>` : ""}</div>`;
}
function topHtml(){
  const head = `<div class="cardhead rqhead"><div><h2 id="rqh">Logistics scenarios</h2><span class="faint" style="font-size:12px">Modular RFQ v3.0 answers from Benchmarking > Logistics Providers${M && M.legacy.length ? ` · ${M.legacy.length} legacy v1 answer${M.legacy.length === 1 ? "" : "s"} not compared` : ""}</span></div>${revBoxHtml()}</div>`;
  if (!M) return `<div class="card">${head}<p class="muted">Loading the Benchmarking results…</p></div>`;
  if (!M.list.length) return `<div class="card">${head}<p class="empty">No RFQ v3.0 or v2.3 answers yet. Upload them on Benchmarking > Logistics Providers; this block fills in by itself.</p></div>`;
  const best = cheapestIn();
  return `<div class="card">${head}${filtersHtml()}
    <div class="rqcards">${ALL.map(id => cardHtml(id, best)).join("")}</div>
    <p class="faint bnote">Annual cost, volume case ${RQ.vc}, ${esc(scopeName())}. Only complete scenarios are ranked. S5 is indicative and never ranked. Hover a tag for its meaning: quoted, derived, extrapolated, proxy, assumption or indicative. The internal settings (volumes, S2 to S4 inputs) live on Benchmarking.</p></div>`;
}

// ---- 2. comparison table
function compareHtml(){
  const best = cheapestIn(), s1 = scoped("S1").cost;
  const low = lowestPct(), H = hidden();
  const rows = ALL.map(id => { const x = scoped(id), R = x.R;
    if (id === "S5") return `<tr class="ind"><th>${sw(id)}${id} ${esc(sname(id))}</th><td class="n">${R.total != null ? `<span class="rqv" title="indicative · M6 lines priced per shipment, order or kg">${eur(R.total)}</span>` : stateLine(R) || '<span class="rqna">no estimate</span>'}</td><td colspan="${H ? 9 : 12}" class="faint">${esc(STATE[R.state] || R.state)}${R.solutions && R.solutions.length ? ` · ${esc(R.solutions.map(z => `${z.name}: ${z.title || "unnamed"}`).join("; "))}` : ""}</td></tr>`;
    const ok = x.cost != null;
    return `<tr class="${best === id ? "best" : ""}"><th>${sw(id)}${id} ${esc(sname(id))}${best === id ? ' <em class="rqbest">cheapest</em>' : ""}</th>
      <td class="n">${ok ? `<span class="rqv" title="${esc((R.tags || []).join(" · "))}">${eur(x.cost)}</span>` : stateLine(R)}</td>
      ${H ? "" : `<td class="n">${ok ? `<span class="rqv" title="${esc(id === "S2" ? `net of the distributor discount (${eur(x.rv.discountEur)})` : "internal revenue")}">${eur(x.rv.netEur)}</span>` : ""}</td>
      <td class="n${low === id ? " best" : ""}">${x.rv.pct != null ? `${pct2(x.rv.pct)}${x.rv.coveredOnly ? `<small class="rqcov">covered shipments only (${pct(x.covered, x.shipments)})</small>` : ""}` : ""}</td>
      <td class="n">${x.rv.contribution != null ? eur(x.rv.contribution) : ""}</td>`}
      <td class="n">${ok && s1 != null && id !== "S1" ? `<span class="${x.cost <= s1 ? "rqsave" : "rqmore"}">${x.cost <= s1 ? "−" : "+"}${eur(Math.abs(x.cost - s1))}</span>` : ""}</td>
      <td class="n">${ok ? eur(x.perOrder, 2) : ""}</td><td class="n">${ok ? eur(x.perKg, 2) : ""}</td>
      <td class="n">${x.shipments ? `${fmt(x.covered, 0)} of ${fmt(x.shipments, 0)}` : ""}</td><td class="n">${x.measured ? pct(x.onTime, x.measured) : ""}</td>
      <td class="n">${Math.round((R.completeness || 0) * 100)}%</td><td class="n">${R.oneOff ? eur(R.oneOff) : ""}</td></tr>`; }).join("");
  return `<div class="card"><div class="cardhead"><h2>Logistics scenario comparison</h2><span class="faint" style="font-size:12px">Volume case ${RQ.vc} · ${esc(scopeName())} · green: the cheapest complete scenario</span></div>
    <div class="tablewrap btable"><table class="rqtbl"><thead><tr><th>Scenario</th><th>Annual cost</th>${H ? "" : "<th>Revenue (EUR)</th><th>Logistics cost % of revenue</th><th>Contribution after logistics</th>"}<th>Against S1</th><th>Per order</th><th>Per kg</th><th>Shipments covered</th><th>On time</th><th>Inputs</th><th>One-off</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${H ? '<p class="faint bnote">Revenue is hidden. Turn off Hide revenue above to show the internal figures.</p>' : revNote()}
    ${RANKED.filter(id => M.out[id].state !== "complete").map(id => `<p class="faint rqnote">${id} ${esc(sname(id))}: ${esc(missingText(M.out[id]))}</p>`).join("")}</div>`;
}

function revNote(){
  const v = M.view, warn = v.allocated.length ? `<p class="warnbox">⚠ Revenue per country is allocated by shipments for ${esc(v.allocated.join(", "))}. Replace with per-country revenue from the internal scenario file (net revenue column on the Scenario_A and Scenario_B sheets) under Benchmarking > internal settings > Revenue, internal only.</p>` : "";
  return `${warn}<p class="faint bnote">Internal revenue, volume case ${RQ.vc}: USD ${fmt(v.usd, 0)} at ${v.fx} = ${eur(v.eur)} (all countries). Cost % of revenue = annual cost / revenue in EUR; S2 divides by net revenue after the distributor discount. Contribution after logistics: before product cost and other overheads. Green in that column: the lowest % among complete scenarios. "Covered shipments only": the scenario leaves some shipments without a price, so its cost covers fewer shipments than the revenue.</p>`;
}

// ---- 3. region x scenario matrix
function regionHtml(){
  const rows = V.REGIONS.map(([region, lanes]) => {
    const costs = Object.fromEntries(RANKED.map(id => [id, M.out[id].state === "complete" ? sum(lanes, L => M.out[id].countries[L].cost) : null]));
    const best = (M.out.byRegion.find(r => r.region === region) || {}).best;
    return `<tr${RQ.region === region ? ' class="sel"' : ""}><th>${esc(region)}<br><span class="faint num">${lanes.join(" ")}</span></th>${RANKED.map(id => `<td class="n${best === id ? " best" : ""}">${costs[id] != null ? `<span class="rqv" title="${esc(`${id} ${sname(id)} · ${region} · volume case ${RQ.vc}`)}">${eur(costs[id])}</span>${hidden() ? "" : `<small class="rqpct">${ofRev(M.view.scenarios[id].regions[region], id)}</small>`}` : stateLine(M.out[id])}</td>`).join("")}<td>${best ? `${sw(best)}${best}` : '<span class="rqna">none complete</span>'}</td></tr>`;
  }).join("");
  return `<div class="card"><div class="cardhead"><h2>Region by scenario</h2><span class="faint" style="font-size:12px">Annual cost per region · volume case ${RQ.vc}</span></div>
    <div class="tablewrap"><table class="rqtbl rqreg"><thead><tr><th>Region</th>${RANKED.map(id => `<th>${sw(id)}${id}<br><span class="faint">${esc(sname(id))}</span></th>`).join("")}<th>Cheapest</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="faint bnote">Warehouse-wide costs (replenishment, storage, devanning, carrying) are spread over the served countries by kg; fixed costs and the minimum top-up by orders.</p></div>`;
}

// ---- 4. country detail: cost per order by class and scenario, and the cost breakdown per scenario
function countryLane(){
  if (RQ.country !== "map") return RQ.country;
  const L = ui.country ? laneOfIso(ui.country) : null;
  if (L) return L;
  const lanes = lanesIn();
  return lanes.slice().sort((a, b) => volOne(b) - volOne(a))[0];
}
const volOne = L => sum(V.BANDS, b => Number(((M.S.volumes[RQ.vc] || {})[L] || {})[b]) || 0);
function stackBar(types, total){
  if (!(total > 0)) return '<div class="rqstack na"><span>n/a</span></div>';
  return `<div class="rqstack">${V.TYPES.filter(([k]) => types[k] > 0.005).map(([k, l]) => `<i style="width:${(types[k] / total * 100).toFixed(2)}%;background:${TYPE_COLOR[k]}" title="${esc(`${l}: ${eur(types[k])} (${pct(types[k], total)})`)}"></i>`).join("")}</div>`;
}
function countryHtml(){
  const L = countryLane();
  if (!L) return "";
  const best = M.out.byCountry[L];
  const vol = b => Number(((M.S.volumes[RQ.vc] || {})[L] || {})[b]) || 0;
  const rows = V.CLASSES.map(c => {
    const cells = RANKED.map(id => { const x = V.classCost(M.out[id], L, c.band);
      return `<td class="n">${x ? `<span class="rqv" title="${esc(`${x.tag}${x.via ? " · via the distributor, cost per customer shipment" : ""} · ${id} ${sname(id)}`)}">${eur(x.price, 2)}</span>` : M.out[id].state === "complete" ? '<span class="rqna">–</span>' : stateLine(M.out[id])}</td>`; }).join("");
    return `<tr><th>${esc(c.label)}<br><span class="faint">${c.size} · ${fmt(M.S.avgKg[c.band], 0)} kg · ${fmt(vol(c.band), 0)} a year</span></th>${cells}</tr>`;
  }).join("");
  const bars = RANKED.map(id => { const R = M.out[id], c = R.countries[L];
    return `<div class="rqbrow"><span class="rqbl">${sw(id)}${id}</span>${R.state === "complete" ? stackBar(c.types, c.cost) : `<div class="rqstack na"><span>${esc(STATE[R.state] || R.state)}</span></div>`}<span class="rqbv num">${R.state === "complete" ? eur(c.cost) : ""}${R.state === "complete" && !hidden() && c.shipments > 0 ? `<small>${ofRev(M.view.scenarios[id].countries[L], id)}</small>` : ""}</span></div>`; }).join("");
  const legend = V.TYPES.map(([k, l]) => `<span><i class="sw" style="background:${TYPE_COLOR[k]}"></i>${esc(l)}</span>`).join("");
  return `<div class="card" id="rqCountryCard"><div class="cardhead"><h2>${esc(V.LANES[L].name)}</h2><span class="faint" style="font-size:12px">${L} · ${esc(V.LANES[L].region)} · target ${M.S.targetDays[L]} working days · volume case ${RQ.vc}${best ? ` · cheapest ${best} ${esc(sname(best))}` : " · no complete scenario"}</span></div>
    <h3 class="rqh3">Cost per order by class</h3>
    <div class="tablewrap"><table class="rqtbl"><thead><tr><th>Class</th>${RANKED.map(id => `<th>${sw(id)}${id}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="faint bnote">Direct volume: the M1 price. Stock volume: delivery and handling of the class plus this country's share of the warehouse-wide costs per stock order. Distributor country (S2): the country's cost per customer shipment. "–": no volume or no price for the class in that scenario.</p>
    <h3 class="rqh3">Annual cost breakdown</h3><div class="rqbars">${bars}</div><div class="rqlegend">${legend}</div></div>`;
}

// ---- 5. unit cost and 6. break-even
function unitHtml(){
  const rows = RANKED.map(id => { const x = scoped(id);
    return `<tr><th>${sw(id)}${id} ${esc(sname(id))}</th><td class="n">${x.cost != null ? eur(x.perOrder, 2) : stateLine(x.R)}</td><td class="n">${x.cost != null ? eur(x.perKg, 2) : ""}</td><td class="n">${x.cost != null ? eur(x.perPallet, 2) : ""}</td>${hidden() ? "" : `<td class="n">${x.rv && x.rv.per1000 != null ? eur(x.rv.per1000, 2) : ""}</td>`}</tr>`; }).join("");
  const n = volIn(lanesIn(), () => 1), kg = volIn(lanesIn(), b => Number(M.S.avgKg[b]) || 0);
  return `<div class="card"><div class="cardhead"><h2>Unit cost</h2><span class="faint" style="font-size:12px">${esc(scopeName())} · ${fmt(n, 0)} orders · ${fmt(kg, 0)} kg a year</span></div>
    <div class="tablewrap"><table class="rqtbl"><thead><tr><th>Scenario</th><th>Per order</th><th>Per kg</th><th>Per pallet (${fmt(M.S.kgPerPallet, 0)} kg)</th>${hidden() ? "" : "<th>Per USD 1,000 of revenue</th>"}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="faint bnote">Annual cost divided by the customer orders and kg of volume case ${RQ.vc}. Per pallet: per kg times the kg per pallet setting.</p></div>`;
}
function breakEvenHtml(){
  const sens = M.sens, labels = sens.rows.map(r => `${r.m}×`);
  const series = ["S1", "S3", "S4"].filter(k => sens.rows.some(r => r[k] != null)).map(k => ({name: `${k} ${sname(k)}`, color: COLOR[k], values: sens.rows.map(r => r[k]), width: k === "S1" ? 2.4 : 2}));
  const be = Object.entries(sens.breakEven).filter(([, m]) => m != null);
  const note = be.length ? be.map(([k, m]) => `${k} ${esc(sname(k))} becomes cheaper than S1 from about <b>${m}×</b> volume case ${RQ.vc}.`).join(" ")
    : `Neither S3 nor S4 becomes cheaper than S1 between 0.25× and 5×${["S3", "S4"].some(k => M.out[k].state !== "complete") ? " (S3 or S4 is not complete yet)" : ""}.`;
  const right = hidden() ? null : {label: "% of revenue", fmt: v => `${Math.round(v * 1000) / 10}%`, tip: v => pct2(v),
    series: ["S1", "S3", "S4"].filter(k => M.sensPct.some(r => r[k] != null)).map(k => ({name: `${k} % of revenue`, color: COLOR[k], dash: "5 4", values: M.sensPct.map(r => r[k])}))};
  const chart = series.length && window.FlexCharts ? FlexCharts.lineChart({label: "Annual cost by volume multiplier", labels, series, legend: true, w: 1100, h: 240, fmt: v => FlexCharts.sfmt(v), tip: v => eur(v), yLabel: right ? "EUR a year" : null, right}) : '<p class="empty">No complete scenario to chart.</p>';
  return `<div class="card"><div class="cardhead"><h2>Break-even volume</h2><span class="faint" style="font-size:12px">S1, S3 and S4 at 0.5× to 3× volume case ${RQ.vc} · all countries</span></div>
    <div class="rqchart">${chart}</div><p class="rqnote">${note}</p>
    <div class="tablewrap"><table class="rqtbl"><thead><tr><th>Multiplier</th>${sens.rows.map(r => `<th>${r.m}×</th>`).join("")}</tr></thead><tbody>${["S1", "S3", "S4"].map(k => `<tr><th>${sw(k)}${k}</th>${sens.rows.map((r, i) => `<td class="n">${r[k] != null ? eur(r[k]) : '<span class="rqna">n/a</span>'}${!hidden() && M.sensPct[i][k] != null ? `<small class="rqpct">${pct2(M.sensPct[i][k])} of revenue</small>` : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}

// ---- 7. answers and follow-up questions
function answersHtml(){
  const fu = M.list.filter(e => (e.follow || []).length);
  return `<div class="card rqans"><div class="cardhead"><h2>Answers</h2><span class="faint" style="font-size:12px">Built from the scenario figures · volume case ${RQ.vc} · all regions</span></div>
    <ul class="rqq">${M.answers.concat(hidden() ? [] : M.revAnswers).map(a => `<li>${esc(a)}</li>`).join("")}</ul>
    <h3 class="rqh3">Follow-up questions <button type="button" class="btn ghost sm" data-a="rqcopy"${fu.length ? "" : " disabled"}>Copy</button></h3>
    ${fu.length ? fu.map(e => `<p class="rqfu"><b>${esc(e.name)}</b></p><ol class="rqlist" data-fu>${e.follow.map(i => `<li>${esc(i)}</li>`).join("")}</ol>`).join("") : '<p class="faint">Nothing to ask.</p>'}</div>`;
}

// ---- the map: colour by the cheapest complete scenario per country, tooltip per scenario and class
function country(iso){
  if (!M || !M.list.length) return null;
  const L = laneOfIso(iso); if (!L) return null;
  const best = M.out.byCountry[L];
  const lines = [`${V.LANES[L].name} · volume case ${RQ.vc} · target ${M.S.targetDays[L]} working days`, best ? `Cheapest complete: ${best} ${sname(best)}` : "No complete scenario"];
  RANKED.forEach(id => { const R = M.out[id], c = R.countries[L];
    if (R.state !== "complete") { lines.push(`${id} ${STATE[R.state] || R.state}`); return; }
    const per = V.CLASSES.map(k => [k, V.classCost(R, L, k.band)]).filter(([, x]) => x).map(([k, x]) => `${k.size} ${eur(x.price, 0)}`);
    lines.push(`${id} ${eur(c.cost)} a year${!hidden() && c.shipments > 0 ? (b => (b.pct != null ? `, revenue ${eur(b.netEur)}, ${pct2(b.pct)}${b.coveredOnly ? " (covered shipments only)" : ""}` : ""))(M.view.scenarios[id].countries[L]) : ""}${per.length ? ` · per order ${per.join(", ")}` : ""}`);
  });
  if (M.out.S5.solutions && M.out.S5.solutions.some(z => z.lanes.includes(L))) lines.push(`S5 indicative: ${M.out.S5.solutions.filter(z => z.lanes.includes(L)).map(z => `${z.name}, ${z.title || "unnamed"}`).join("; ")}`);
  return {fill: best ? COLOR[best] : null, scenario: best, tip: lines.join("\n")};
}
const legend = () => RANKED.map(id => `<span><i class="sw" style="background:${COLOR[id]}"></i>${id} ${esc(sname(id))}</span>`).join("") + `<span><i class="sw" style="background:var(--land-study)"></i>no complete scenario</span>`;

function wire(){
  const top = $("rfqTop"), body = $("rfqBody");
  top.querySelectorAll("input[data-rev]").forEach(inp => inp.addEventListener("change", () => {
    const B = window.BenchUI && BenchUI.rfq30; if (!B || !B.editRevenue) return;
    if (B.editRevenue(inp.dataset.rev, inp.value)) setTimeout(refresh, 0);   // after the event: the field is redrawn
  }));
  const hr = top.querySelector("#rqHideRev");
  if (hr) hr.addEventListener("change", () => { window.FlexiRevenue = Object.assign(window.FlexiRevenue || {}, {hidden: hr.checked}); window.dispatchEvent(new Event("flexirevenue")); refresh(); });
  top.querySelectorAll("#rqVc button").forEach(b => b.addEventListener("click", () => { RQ.vc = b.dataset.v; remember(); refresh(); }));
  const rg = top.querySelector("#rqRegion"); if (rg) rg.addEventListener("change", () => { RQ.region = rg.value; remember(); refresh(); });
  const ct = top.querySelector("#rqCountry"); if (ct) ct.addEventListener("change", () => { RQ.country = ct.value; remember(); refresh(); });
  top.querySelectorAll("select[data-mod]").forEach(s => s.addEventListener("change", () => { RQ.choice[s.dataset.mod] = s.value; remember(); refresh(); }));
  const cq = body.querySelector('[data-a="rqcopy"]');
  if (cq) cq.addEventListener("click", () => {
    const text = [...body.querySelectorAll("[data-fu]")].map(ol => `${ol.previousElementSibling.textContent}\n${[...ol.children].map((li, i) => `${i + 1}. ${li.textContent}`).join("\n")}`).join("\n\n");
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Follow-up questions copied"), () => toast("Copy failed. Select the text and copy it by hand.", "bad"));
  });
}
function render(){
  M = load();
  const top = $("rfqTop"), body = $("rfqBody"); if (!top || !body) return;
  top.innerHTML = topHtml();
  body.innerHTML = M && M.list.length ? compareHtml() + regionHtml() + `<div class="rqpair">${countryHtml()}${unitHtml()}</div>` + breakEvenHtml() + answersHtml() : "";
  // the map shows the cheapest scenario once there is one, unless someone picked another colouring
  const has = !!(M && M.list.length), sel = $("mapMetric");
  if (has && !ui.mapMetricPicked && ui.mapMetric !== "rfq") { ui.mapMetric = "rfq"; if (sel) sel.value = "rfq"; }
  if (!has && ui.mapMetric === "rfq" && !ui.mapMetricPicked) { ui.mapMetric = "best"; if (sel) sel.value = "best"; }
  wire();
}
function refresh(){ render(); if (typeof drawCountries === "function") drawCountries(); }
window.DashRFQ = {render, refresh, country, legend, state: RQ};
if (typeof VIEW !== "undefined" && VIEW.current === "dash") refresh();
})();
