/* FlexiTog dashboard: the Benchmarking tab's Quick Quote v2.3 results on the Dashboard, per country, region and order
 * class. The Dashboard reads, summarizes and explains; it never parses files and holds no cost formula. Every figure
 * comes from rfq_v23.js (window.FlexiRFQ23) applied to the list Benchmarking ranks (BenchUI.rfq23), so totals match
 * the Benchmarking tab. Runs after benchmark.js; renderView (dashboard.html) calls DashRFQ.render() and the map asks
 * DashRFQ.country(iso) for its colour and tooltip. Shares the dashboard globals ($, esc, fmt, CNAME, ui, drawCountries).
 */
(function () {
"use strict";
const V = window.FlexiRFQ23;
const RQ = Object.assign({provider: "all", scenario: "A", option: "cheapest", chartProvider: ""}, DataStore.pref.get("dash-rfq") || {});
const remember = () => DataStore.pref.set("dash-rfq", RQ);
const OPT_COLOR = {opt1: "var(--lc1)", opt2: "var(--lc3)", opt3: "var(--lc4)"};
const OPT_SHORT = {opt1: "Opt 1", opt2: "Opt 2", opt3: "Opt 3"};
const OPT_LONG = {opt1: "Option 1 from Helmond", opt2: "Option 2 regional stock", opt3: "Option 3 other", cheapest: "Cheapest option"};
const TAGS = {quoted: "quoted", derived: "derived", extrapolated: "extrapolated", assumption: "assumption"};
const laneOfIso = iso => Object.keys(V.LANES).find(L => V.LANES[L].country === iso);
const lname = L => V.LANES[L].name;
const eur = (v, dp) => "EUR " + fmt(v, dp == null ? 2 : dp);
const days = d => (d == null ? "" : `${fmt(d, Number.isInteger(d) ? 0 : 1)} d`);
let M = null;   // this render's data: {list, settings, legacy, f}

function load(){
  const R = window.BenchUI && BenchUI.rfq23;
  if (!R || !R.ready()) return null;
  const list = R.list();
  if (RQ.provider !== "all" && !list.some(e => e.id === RQ.provider)) RQ.provider = "all";
  return {list, settings: R.settings(), legacy: R.legacy(), f: {provider: RQ.provider, scenario: RQ.scenario, option: RQ.option}};
}
// A figure with its source tag in the tooltip; blank and not-offered values say so, never 0.
function figure(c, opts){
  const o = opts || {};
  if (!c || c.state === "not_quoted") return `<span class="rqna" title="Not quoted: the provider left this blank">not quoted</span>`;
  if (c.state === "incomplete") return `<span class="rqna" title="${esc("Option 2 incomplete. Missing: " + (c.missing || []).join(", "))}">incomplete</span>`;
  if (c.state === "no_test") return `<span class="rqna" title="No test shipment for this class on this lane, and no volume to extrapolate for">–</span>`;
  const tag = o.tag || c.tag || "quoted";
  const t = [`${TAGS[tag] || tag}`, c.name, c.opt && OPT_LONG[c.opt], c.ship && `test shipment ${c.ship}${c.from ? ` (from ${c.from})` : ""}`, c.service, c.transit != null && `${days(c.transit)} against a target of ${c.target}`].filter(Boolean).join(" · ");
  return `<span class="rqv${o.meets === false || (c.meets === false && o.mark) ? " late" : ""}" title="${esc(t)}">${eur(c.price, o.dp)}</span>`;
}
const pct = (a, b) => (b ? `${Math.round(a / b * 1000) / 10}%` : "n/a");

// ---- 1. filters and key figures
function topHtml(){
  if (!M) return `<div class="card"><p class="muted">Loading the Benchmarking results…</p></div>`;
  const {list, legacy} = M;
  const head = `<div class="cardhead"><h2 id="rqh">Logistics benchmark</h2><span class="faint" style="font-size:12px">Quick Quote v2.3 answers from Benchmarking > Logistics Providers${legacy.length ? ` · ${legacy.length} legacy v1 answer${legacy.length === 1 ? "" : "s"} not compared` : ""}</span></div>`;
  if (!list.length) return `<div class="card">${head}<p class="empty">No Quick Quote v2.3 answers yet. Upload them on Benchmarking > Logistics Providers; this block fills in by itself.</p></div>`;
  const seg = (id, items, v) => `<div class="seg" id="${id}" role="group">${items.map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${v === k}">${esc(l)}</button>`).join("")}</div>`;
  const K = V.keyFigures(list, M.f, M.settings), p = K.pick;
  const tile = (label, value, sub, tip) => `<div class="rqk"${tip ? ` title="${esc(tip)}"` : ""}><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  return `<div class="card">${head}
    <div class="controls">
      <div class="ctl"><label for="rqProv">Provider</label><select id="rqProv"><option value="all">All providers</option>${list.map(e => `<option value="${esc(e.id)}"${e.id === RQ.provider ? " selected" : ""}>${esc(e.name)}</option>`).join("")}</select></div>
      <div class="ctl"><label>Scenario</label>${seg("rqScen", [["A", "Scenario A"], ["B", "Scenario B"]], RQ.scenario)}</div>
      <div class="ctl"><label>Option</label>${seg("rqOpt", [["cheapest", "Cheapest"], ["opt1", "Option 1"], ["opt2", "Option 2"], ["opt3", "Option 3"]], RQ.option)}</div>
    </div>
    <div class="rqkpis">
      ${tile("Providers compared", `<span data-roll="rq-n">${K.providers}</span>`, "Quick Quote v2.3")}
      ${tile("Best by total score", K.best ? esc(K.best.name) : "n/a", K.best ? `<span data-roll="rq-best">${K.best.S.total.toFixed(2)}</span> of 4` : "", "derived · the Benchmarking scorecard")}
      ${tile("Cheapest complete option, A", p ? `<span data-roll="rq-a">${eur(p.A, 0)}</span>` : "not quoted", p ? `${esc(OPT_SHORT[p.opt])} · ${esc(p.name)}${p.complete ? "" : " · below 90% coverage"}` : "", p ? `${p.tagA} · annual cost, Scenario A` : "")}
      ${tile("Same option, Scenario B", p && p.B != null ? `<span data-roll="rq-b">${eur(p.B, 0)}</span>` : "not quoted", p ? esc(OPT_SHORT[p.opt]) : "", p ? `${p.tagB} · annual cost, Scenario B` : "")}
      ${tile(`Coverage, Scenario ${RQ.scenario}`, p ? `<span data-roll="rq-cov">${pct(p.coverage.covered, p.coverage.shipments)}</span>` : "n/a", p ? `${p.coverage.covered} of ${p.coverage.shipments} shipments` : "", "derived · shipments with a price")}
      ${tile(`GCC on time, Scenario ${RQ.scenario}`, p && p.gcc ? `<span data-roll="rq-gcc">${pct(p.gcc.onTime, p.gcc.shipments)}</span>` : "n/a", p && p.gcc ? `${p.gcc.onTime} of ${p.gcc.shipments} within 2 working days` : "", "derived · transit days against the lane target")}
    </div>
    <p class="faint bnote">Filters apply to the map colours below and to every card in this block. Hover a figure for its source: quoted (from the file), derived (calculated from quoted prices), extrapolated (next lower band per kg) or assumption (rests on the Quick Quote settings).</p></div>`;
}

// ---- 3. region cards
function regionsHtml(){
  const cards = V.regionCards(M.list, M.f, M.settings);
  return `<div class="rqregions">${cards.map(c => `<div class="card rqreg"><div class="cardhead"><h3>${esc(c.region)}</h3><span class="faint num">${c.lanes.join(" ")}</span></div>
    <table><tbody>${c.per.filter(p => RQ.option === "cheapest" || p.opt === RQ.option).map(p => { const b = p.best, st = p.states[0] || {};
      const why = !b ? (p.states.some(x => x.state === "incomplete") ? `<span class="rqna" title="${esc("Missing: " + ((p.states.find(x => x.state === "incomplete") || {}).missing || []).join(", "))}">incomplete</span>` : '<span class="rqna">not quoted</span>') : "";
      return `<tr class="${c.overall && b && c.overall === b ? "best" : ""}"><td><i class="sw" style="background:${OPT_COLOR[p.opt]}"></i>${OPT_SHORT[p.opt]}</td>
        <td class="n">${b ? `<span class="rqv" title="${esc(`${b.tag || "derived"} · annual cost, Scenario ${RQ.scenario}, ${b.name}`)}">${eur(b.cost, 0)}</span>` : why}</td>
        <td class="n">${b ? `${b.covered} of ${b.shipments}` : st.shipments ? `0 of ${st.shipments}` : ""}</td><td class="n">${b ? `${b.onTime} on time` : ""}</td></tr>`; }).join("")}</tbody></table>
    <p class="faint rqnote">${c.overall ? `Cheapest: <b>${esc(c.overall.name)}</b>, ${esc(OPT_LONG[c.overall.opt])}` : "No option quoted"} · volume-weighted sum of its countries</p></div>`).join("")}</div>`;
}

// ---- 4. order class matrix
function matrixHtml(){
  const groups = V.REGIONS;
  const head1 = groups.map(([r, ls]) => `<th colspan="${ls.length}" class="grp">${esc(r)}</th>`).join("");
  const head2 = groups.flatMap(([, ls]) => ls).map(L => `<th title="${esc(lname(L))}">${esc(L)}<br><span class="faint">${esc(lname(L).replace("United Arab Emirates", "UAE"))}</span></th>`).join("");
  const rows = V.CLASSES.map(c => `<tr><th class="cls">${esc(c.label)}<br><span class="faint">${c.size} · ${fmt(c.kg)} kg</span></th>${groups.flatMap(([, ls]) => ls).map(L => {
    const x = V.cheapestCell(M.list, M.f, L, c.band, M.settings);
    return `<td>${figure(x, {mark: true})}${x.state === "ok" ? `<small><i class="sw" style="background:${OPT_COLOR[x.opt]}"></i>${OPT_SHORT[x.opt]}${M.list.length > 1 || RQ.provider === "all" ? ` · ${esc(x.name)}` : ""}${x.transit != null ? ` · ${days(x.transit)}` : ""}</small>` : ""}</td>`; }).join("")}</tr>`).join("");
  return `<div class="card"><div class="cardhead"><h2>Cost per order by class and country</h2><span class="faint" style="font-size:12px">${esc(OPT_LONG[RQ.option])} · Scenario ${RQ.scenario} · red: transit above the lane target</span></div>
    <div class="tablewrap btable"><table class="rqmatrix"><thead><tr><th rowspan="2">Class</th>${head1}</tr><tr>${head2}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="faint bnote">Each cell: the cheapest price per order over the providers and options in the filters. Parcel S 8 kg (B1), small consignment M 52 kg (B2), pallet L 261 kg (B3), multi-pallet XL 941 kg (B4), full load XXL 2,380 kg (B5). "–": no test shipment for that class on that lane.</p></div>`;
}

// ---- 5. pallet cost and 6. warehouse
function palletHtml(){
  const ps = M.list.filter(e => RQ.provider === "all" || e.id === RQ.provider), opts = RQ.option === "cheapest" ? ["opt1", "opt2", "opt3"] : [RQ.option];
  const best = (L, kind) => { const xs = []; ps.forEach(e => opts.forEach(o => { const p = V.palletCost(e, o, RQ.scenario, L, M.settings)[kind]; xs.push(Object.assign({name: e.name, opt: o}, p)); }));
    return xs.filter(x => x.state === "ok").sort((a, b) => a.price - b.price)[0] || xs.find(x => x.state === "not_quoted") || xs.find(x => x.state === "incomplete") || xs[0]; };
  const rows = Object.keys(V.LANES).map(L => { const a = best(L, "pallet"), b = best(L, "multi");
    return `<tr><td class="num">${L}</td><td>${esc(lname(L))}</td><td class="n">${figure(a)}</td><td class="n">${b && b.state === "ok" ? figure(b, {tag: "derived"}) : figure(b)}</td><td>${a && a.state === "ok" ? `${OPT_SHORT[a.opt]} · ${esc(a.name)}` : ""}</td></tr>`; }).join("");
  const store = ps.map(e => { const w = V.warehouse(e, M.settings); return `<li><b>${esc(e.name)}</b>: ${w.storage == null ? '<span class="rqna">not quoted</span>' : `<span class="rqv" title="quoted · W04">${eur(w.storage)}</span> per pallet per month`}</li>`; }).join("");
  return `<div class="card"><div class="cardhead"><h2>Cost per pallet</h2><span class="faint" style="font-size:12px">Shipped per country (Q2) and stored per provider (Q3)</span></div>
    <div class="tablewrap"><table><thead><tr><th>Lane</th><th>Country</th><th>One pallet (pallet class)</th><th>Per pallet, multi-pallet ÷ 4</th><th>Cheapest</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3 class="rqh3">Storage per pallet per month</h3><ul class="rqlist">${store}</ul></div>`;
}
function warehouseHtml(){
  const ps = M.list.filter(e => RQ.provider === "all" || e.id === RQ.provider);
  const v = (x, key, unit) => (x == null ? '<span class="rqna">not quoted</span>' : typeof x === "number" ? `<span class="rqv" title="quoted · ${key}">${eur(x)}</span>${unit ? ` <span class="faint">${unit}</span>` : ""}` : `<span title="quoted · ${key}">${esc(x)}</span>`);
  return `<div class="card"><div class="cardhead"><h2>Holding stock per provider</h2><span class="faint" style="font-size:12px">Option 2 warehouse rates (Q3), EUR excl. VAT</span></div>
    <div class="rqwh">${ps.map(e => { const w = V.warehouse(e, M.settings);
      return `<div class="rqwhc"><h3>${esc(e.name)}</h3><dl class="kv">
        <dt>Location (W01)</dt><dd>${v(w.location, "W01")}</dd><dt>Customs status (W02)</dt><dd>${v(w.customs, "W02")}</dd>
        <dt>Storage (W04)</dt><dd>${v(w.storage, "W04", "per pallet per month")}</dd><dt>Inbound (W05)</dt><dd>${v(w.inbound, "W05", "per pallet")}</dd>
        <dt>Pick (W06)</dt><dd>${v(w.pick, "W06", "per order line")}</dd><dt>Pack and dispatch (W07)</dt><dd>${v(w.pack, "W07", "per order")}</dd>
        <dt>Export or clearance (W08)</dt><dd>${v(typeof w.clearance === "number" ? w.clearance : null, "W08", "per order")}</dd><dt>Fixed fee (W09)</dt><dd>${v(w.fixed, "W09", "per month")}</dd>
        <dt>Replenishment by sea (W11)</dt><dd>${v(w.seaPallet, "W11", "per pallet")}${w.seaDays != null ? ` · ${esc(w.seaDays)} d` : ""}</dd><dt>Replenishment by air (W13)</dt><dd>${v(w.airPallet, "W13", "per pallet")}${w.airDays != null ? ` · ${esc(w.airDays)} d` : ""}</dd>
        <dt>Handling per order</dt><dd>${w.handling.every(h => h.value == null) ? '<span class="rqna">not quoted</span>' : w.handling.map(h => `${esc(h.label)} <span class="rqv" title="derived · ${w.method}: W07 + ${w.method === "order lines" ? `W06 × ${M.settings.orderLinesByClass[h.band]} lines` : "W15 × cartons + W16 × pallets"} + W08">${h.value == null ? "n/a" : eur(h.value)}</span>`).join(" · ")}</dd></dl>
        ${w.complete ? "" : `<p class="faint rqnote">Option 2 incomplete: missing ${esc(w.missing.join(", "))}.</p>`}</div>`; }).join("")}</div></div>`;
}

// ---- 7. Option 1 against Option 2 per country, by class
function optVsHtml(){
  const ps = M.list.filter(e => RQ.provider === "all" || e.id === RQ.provider);
  const id = ps.some(e => e.id === RQ.chartProvider) ? RQ.chartProvider : (ps[0] || {}).id, e = ps.find(x => x.id === id);
  const sel = ps.length > 1 ? `<select id="rqChartProv" aria-label="Provider for the chart">${ps.map(x => `<option value="${esc(x.id)}"${x.id === id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : "";
  const head = `<div class="cardhead"><h2>Helmond or regional stock, per country</h2><div class="ctl">${sel}<span class="faint" style="font-size:12px">${e ? esc(e.name) : ""} · cost per order by class · Scenario ${RQ.scenario} (Q4)</span></div></div>`;
  if (!e) return `<div class="card">${head}<p class="empty">No provider selected.</p></div>`;
  const r = V.breakEven(e, RQ.scenario, "L01", M.settings);
  if (r.state !== "ok") return `<div class="card" id="rqOptVs">${head}<p class="muted">Option 2 is ${r.state === "incomplete" ? "incomplete" : "not quoted"} for ${esc(e.name)}${r.state === "incomplete" ? `: missing ${esc(r.missing.join(", "))}` : ""}. Helmond and regional stock cannot be compared for this provider.</p></div>`;
  const rows = Object.keys(V.LANES).map(L => {
    const b = V.breakEven(e, RQ.scenario, L, M.settings);
    if (!b.rows.some(x => x.opt1.state === "ok" || x.opt2.state === "ok")) return "";
    const cells = b.rows.map(x => { const a = x.opt1.price, c = x.opt2.price, max = Math.max(a || 0, c || 0) || 1, from = b.from === x.band;
      const bar = (v, o, cc) => (v == null ? `<div class="rqbar na" title="${o === "opt1" ? "Option 1" : "Option 2"}: not quoted"><i></i><span>not quoted</span></div>`
        : `<div class="rqbar" title="${esc(`${o === "opt1" ? "Option 1 from Helmond" : "Option 2 regional stock"}: ${eur(v)} · ${(cc.tag || "quoted")}${cc.transit != null ? ` · ${days(cc.transit)} against ${cc.target}` : ""}`)}"><i style="width:${(v / max * 100).toFixed(1)}%;background:${OPT_COLOR[o]}"></i><span>${eur(v, 0)}</span></div>`);
      return `<td class="${from ? "from" : ""}">${bar(a, "opt1", x.opt1)}${bar(c, "opt2", x.opt2)}${x.diff != null ? `<small class="${x.diff < 0 ? "save" : ""}">${x.diff < 0 ? "stock saves" : "Helmond saves"} ${eur(Math.abs(x.diff), 0)}</small>` : ""}${from ? '<small class="pay">regional stock pays off from here</small>' : ""}</td>`; }).join("");
    return `<tr><th>${esc(L)} ${esc(lname(L))}<br><span class="faint">${b.from ? `stock from ${esc(V.classOf(b.from).label.toLowerCase())}` : "Helmond cheaper"}</span></th>${cells}</tr>`;
  }).join("");
  return `<div class="card" id="rqOptVs">${head}<div class="rqlegend"><span><i class="sw" style="background:${OPT_COLOR.opt1}"></i>Option 1 from Helmond</span><span><i class="sw" style="background:${OPT_COLOR.opt2}"></i>Option 2 regional stock</span></div>
    <div class="tablewrap"><table class="rqvs"><thead><tr><th>Country</th>${V.CLASSES.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ---- 8. answers, data gaps and follow-up questions
function answersHtml(){
  const A = V.answers(M.list, M.f, M.settings);
  const fu = A.followUps.filter(x => x.items.length);
  return `<div class="card rqans"><div class="cardhead"><h2>Answers</h2><span class="faint" style="font-size:12px">Built from the figures above · ${esc(OPT_LONG[RQ.option])} · Scenario ${RQ.scenario}</span></div>
    <ol class="rqq">${A.answers.map(a => `<li><b>${a.q}</b> ${esc(a.text)}</li>`).join("")}</ol>
    <h3 class="rqh3">Data gaps</h3>${A.gaps.length ? `<ul class="rqlist">${A.gaps.map(g => `<li>${esc(g)}</li>`).join("")}</ul>` : '<p class="faint">None.</p>'}
    <h3 class="rqh3">Follow-up questions <button type="button" class="btn ghost sm" data-a="rqcopy"${fu.length ? "" : " disabled"}>Copy</button></h3>
    ${fu.length ? fu.map(x => `<p class="rqfu"><b>${esc(x.provider)}</b></p><ol class="rqlist" data-fu>${x.items.map(i => `<li>${esc(i)}</li>`).join("")}</ol>`).join("") : '<p class="faint">Nothing to ask.</p>'}</div>`;
}

// ---- the map: colour by the cheapest option, tooltip per class
const country = iso => {
  if (!M || !M.list.length) return null;
  const L = laneOfIso(iso); if (!L) return null;
  const sc = RQ.scenario, vol = c => Number(((M.settings.volumes[sc] || {})[L] || {})[c.band]) || 0;
  const lines = [`${lname(L)} · Scenario ${sc} · target ${M.settings.targetDays[L]} working days`], winners = {};
  V.CLASSES.forEach(c => {
    const per = (RQ.option === "cheapest" ? ["opt1", "opt2", "opt3"] : [RQ.option]).map(o => {
      const x = V.cheapestCell(M.list, Object.assign({}, M.f, {option: o}), L, c.band, M.settings);
      return x.state === "ok" ? `${OPT_SHORT[o]} ${eur(x.price)} (${x.name}, ${x.transit != null ? `${days(x.transit)}${x.meets ? "" : " late"}` : "no transit"}, ${x.tag})` : `${OPT_SHORT[o]} ${x.state === "incomplete" ? "incomplete" : x.state === "no_test" ? "no test shipment" : "not quoted"}`;
    });
    const best = V.cheapestCell(M.list, M.f, L, c.band, M.settings);
    if (best.state === "ok") winners[best.opt] = (winners[best.opt] || 0) + Math.max(vol(c), 0.001) ;
    lines.push(`${c.label}: ${per.join(" · ")}${best.state === "ok" ? ` → ${best.name}` : ""}`);
  });
  const flags = M.list.filter(e => RQ.provider === "all" || e.id === RQ.provider).flatMap(e => V.countryFlags(e, L).map(fl => `${fl.id} ${e.name}: ${fl.reason}`));
  if (flags.length) lines.push("Red flags: " + flags.join(" | "));
  const top = Object.entries(winners).sort((a, b) => b[1] - a[1])[0];
  return {fill: top ? OPT_COLOR[top[0]] : null, opt: top ? top[0] : null, tip: lines.join("\n")};
};
const legend = () => ["opt1", "opt2", "opt3"].map(o => `<span><i class="sw" style="background:${OPT_COLOR[o]}"></i>${esc(OPT_LONG[o])} cheapest</span>`).join("") + `<span><i class="sw" style="background:var(--land-study)"></i>not quoted</span>`;

function wire(){
  const top = $("rfqTop"), body = $("rfqBody");
  const p = top.querySelector("#rqProv"); if (p) p.addEventListener("change", () => { RQ.provider = p.value; remember(); refresh(); });
  top.querySelectorAll("#rqScen button, #rqOpt button").forEach(b => b.addEventListener("click", () => { if (b.closest("#rqScen")) RQ.scenario = b.dataset.v; else RQ.option = b.dataset.v; remember(); refresh(); }));
  const cp = body.querySelector("#rqChartProv"); if (cp) cp.addEventListener("change", () => { RQ.chartProvider = cp.value; remember(); refresh(); });
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
  body.innerHTML = M && M.list.length ? regionsHtml() + matrixHtml() + `<div class="rqpair">${palletHtml()}${warehouseHtml()}</div>` + optVsHtml() + answersHtml() : "";
  // the map shows the benchmark once there is one, unless someone picked another colouring
  const has = !!(M && M.list.length), sel = $("mapMetric");
  if (has && !ui.mapMetricPicked && ui.mapMetric !== "rfq") { ui.mapMetric = "rfq"; if (sel) sel.value = "rfq"; }
  if (!has && ui.mapMetric === "rfq" && !ui.mapMetricPicked) { ui.mapMetric = "best"; if (sel) sel.value = "best"; }
  wire();
}
function refresh(){ render(); if (typeof drawCountries === "function") drawCountries(); }
window.DashRFQ = {render, refresh, country, legend, state: RQ};
if (typeof VIEW !== "undefined" && VIEW.current === "dash") refresh();
})();
