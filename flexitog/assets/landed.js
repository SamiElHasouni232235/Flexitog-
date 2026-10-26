/* Landed Cost view: cost per garment from EXW to DAP price for one target country, per SKU, on the cheapest valid
 * quote for the filters. Every number comes from FlexiCalc (calc.js) on the Master Data tables (products, countries,
 * quotes, lanes, settings). Results are cached per data version and filter set. Runs after workspace.js.
 */
(function(){
"use strict";
const C = window.FlexiCalc;
const PARTS = [["exw", "EXW"], ["freight", "Freight"], ["insurance", "Insurance"], ["duty", "Duty"], ["clearance", "Clearance"], ["compliance", "Compliance"]];
const MODES = ["road", "sea", "air", "express"];
const LC = Object.assign({country: null, category: "all", provider: "all", mode: "all", currency: "EUR", sku: null, exw: true}, DataStore.pref.get("landed-ui") || {});
const savePref = () => DataStore.pref.set("landed-ui", LC);
const today = () => new Date().toISOString().slice(0, 10);
const provName = id => ((MD.t.distribution_centers || []).find(d => d.dc_id === id) || {}).name || id;
const stChip = r => (FlexiData.statusOf(r) === "confirmed" ? '<span class="dst done">confirmed</span>' : '<span class="dst est">estimate</span>');

function results(){
  const S = settingsRow(), country = countryRow(LC.country), units = Number(S.shipment_units) || 0;
  const products = (MD.t.products || []).filter(p => LC.category === "all" || p.category === LC.category);
  const key = JSON.stringify([LC.country, LC.category, LC.provider, LC.mode, units, today()]);
  return C.memo("landed", key, () => products.map(p => C.bestLanded({product: p, units, country, settings: S, quotes: MD.t.quotes, lanes: MD.t.lanes,
    mode: LC.mode, provider: LC.provider, today: today()})));
}
const money = v => {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const x = LC.currency === "USD" ? C.fromEUR(v, "USD", settingsRow()) : v;
  return fmt(x, Math.abs(x) < 100 ? 2 : 0);
};
const cur = () => LC.currency;

function chart(rows){
  const ok = rows.filter(r => !r.error).sort((a, b) => b.perGarment.landed - a.perGarment.landed);
  if (!ok.length) return '<p class="muted">No SKU can be priced with these filters. Check that Countries has the country, Quotes has a valid quote to it and the products have carton data.</p>';
  // Drawn at the card's own width so text stays at its real size. Without EXW the bars show the cost on top of EXW.
  const shown = r => r.parts.filter(pt => LC.exw || pt.key !== "exw"), tot = r => shown(r).reduce((a, pt) => a + pt.eur, 0);
  const W = Math.max(560, Math.min(1400, (($("viewLanded") || {}).clientWidth || 900) - 48)), L = 170, R = 170, bh = 18, rowH = 36, H = ok.length * rowH + 4;
  const max = Math.max(...ok.map(tot)) || 1;
  const sx = v => (W - L - R) * v / max;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="lcsvg" role="img" aria-label="Landed cost per garment by cost element, ${esc(cur())}">`;
  ok.forEach((r, i) => {
    const y = i * rowH + 6; let x = L;
    const p = (MD.t.products || []).find(q => q.sku === r.sku) || {};
    svg += `<g class="lcrow${LC.sku === r.sku ? " on" : ""}" data-sku="${esc(r.sku)}" tabindex="0" role="button" aria-label="${esc(r.sku)}: landed ${money(r.perGarment.landed)} ${cur()}, DAP ${money(r.perGarment.dap)}">`;
    svg += `<rect x="0" y="${y - 6}" width="${W}" height="${rowH}" fill="transparent"/>`;
    svg += `<text x="${L - 8}" y="${y + 9}" text-anchor="end" class="lcl">${esc(r.sku)}</text><text x="${L - 8}" y="${y + 22}" text-anchor="end" class="lcs">${esc(String(p.description || p.category || "").slice(0, 24))}</text>`;
    const ps = shown(r);
    r.parts.forEach((pt, k) => {
      if (!ps.includes(pt)) return;
      const w = sx(pt.eur); if (w <= 0) return;
      const last = ps.indexOf(pt) === ps.length - 1 || ps.slice(ps.indexOf(pt) + 1).every(q => sx(q.eur) <= 0);
      svg += `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(w - 2, 0.8).toFixed(1)}" height="${bh}" rx="${last ? 3 : 0}" class="lcseg c${k + 1}" data-tip="${esc(r.sku)} · ${pt.label}: ${money(pt.eur)} ${cur()} (${Math.round(pt.share * 100)}% of landed)"/>`;
      x += w;
    });
    svg += `<text x="${(x + 6).toFixed(1)}" y="${y + 13}" class="lcv">${LC.exw ? money(r.perGarment.landed) : "+" + money(tot(r))}<tspan class="lcs">${LC.exw ? " · DAP " + money(r.perGarment.dap) : " on EXW " + money(r.perGarment.exw)}</tspan></text></g>`;
  });
  svg += "</svg>";
  const legend = `<div class="lchead"><div class="maplegend lclegend">${PARTS.map(([key, l], k) => (LC.exw || key !== "exw" ? `<span><i class="sw lcc${k + 1}"></i>${l}</span>` : "")).join("")}<span class="faint">per garment, ${cur()}</span></div>
    <label class="toggle"><input type="checkbox" id="lcExw"${LC.exw ? " checked" : ""}><span>Include EXW in the bars<small>Off: only the cost added on top of EXW</small></span></label></div>`;
  return legend + `<div class="lcchart">${svg}</div>`;
}

function table(rows){
  const ok = rows.filter(r => !r.error), bad = rows.filter(r => r.error);
  const cell = (r, k) => { const pt = r.parts.find(x => x.key === k); return `<td class="n">${money(pt.eur)}<br><span class="faint">${Math.round(pt.share * 100)}%</span></td>`; };
  return `<div class="tablewrap"><table class="lctable"><thead><tr><th>SKU</th><th>Provider · mode</th>${PARTS.map(([, l]) => `<th>${l}</th>`).join("")}<th>Landed</th><th>DAP price</th></tr></thead><tbody>
    ${ok.map(r => `<tr data-sku="${esc(r.sku)}" class="${LC.sku === r.sku ? "sel" : ""}"><td><button type="button" class="lnk" data-pick="${esc(r.sku)}">${esc(r.sku)}</button></td>
      <td>${esc(provName(r.providerId))}<br><span class="faint">${esc(r.mode)} · ${esc(r.quoteId)}</span></td>${PARTS.map(([k]) => cell(r, k)).join("")}
      <td class="n"><b>${money(r.perGarment.landed)}</b><br><span class="faint">100%</span></td><td class="n"><b>${money(r.perGarment.dap)}</b></td></tr>`).join("")}
    ${bad.map(r => `<tr class="noans"><td>${esc(r.sku)}</td><td colspan="${PARTS.length + 3}" class="faint">Not priced: ${esc(r.error)}</td></tr>`).join("")}
    </tbody></table></div><p class="faint bnote">Values in ${cur()} per garment, share of the landed cost under each value. Click a SKU for every intermediate value.</p>`;
}

function detail(r){
  if (!r || r.error) return "";
  const p = (MD.t.products || []).find(q => q.sku === r.sku) || {}, q = (MD.t.quotes || []).find(x => x.quote_id === r.quoteId) || {}, c = countryRow(r.country) || {}, S = settingsRow();
  const f = r.freight, g = r.perGarment, sh = r.shipment;
  const line = (label, value, note) => `<tr><td>${label}</td><td class="n">${value}</td><td class="faint">${note || ""}</td></tr>`;
  const qc = f.currency, qm = v => fmt(v, 2) + " " + qc;
  const surRows = [{label: "Base freight", amount: f.base, eur: f.baseEUR}].concat(f.surchargesEUR.map(s => ({label: s.label + " surcharge", amount: s.amount, eur: s.eur})));
  const fTot = f.totalEUR || 1;
  const surBar = surRows.filter(s => s.eur > 0).map((s, k) => `<i class="lcsur c${k + 1}" style="width:${(s.eur / fTot * 100).toFixed(2)}%" title="${esc(s.label)}: ${Math.round(s.eur / fTot * 100)}%"></i>`).join("");
  return `<div class="card"><div class="cardhead"><h2>${esc(r.sku)} to ${esc(CNAME(r.country))}: every step</h2><span class="faint" style="font-size:12px">${fmt(r.units)} garments per shipment · ${esc(provName(r.providerId))}, ${esc(r.mode)}, quote ${esc(r.quoteId)}</span></div>
    <div class="lcgrid">
      <div><h3>Shipment and freight</h3><div class="tablewrap"><table class="kvtab"><tbody>
        ${line("Cartons", fmt(sh.cartons), `${fmt(r.units)} / ${fmt(p.units_per_carton)} per carton, rounded up`)}
        ${line("Volume", fmt(sh.m3, 3) + " m3", `${fmt(sh.cartons)} × ${fmt(p.carton_l_cm)} × ${fmt(p.carton_w_cm)} × ${fmt(p.carton_h_cm)} cm`)}
        ${line("Actual weight", fmt(sh.kg, 1) + " kg", `${fmt(r.units)} × ${fmt(p.unit_weight_kg, 2)} kg`)}
        ${line("Volume weight", fmt(f.volumeKg, 1) + " kg", `${fmt(sh.m3, 3)} m3 × ${f.factor} kg per m3 (${esc(r.mode)})`)}
        ${line("Chargeable", f.rateUnit === "per m3" ? fmt(f.chargeableM3, 3) + " m3" : f.rateUnit === "per kg" ? fmt(f.chargeableKg, 1) + " kg" : "1 shipment", f.byVolume ? "volume weight is higher" : "actual weight is higher")}
        ${line("Rate × chargeable", qm(f.byRate), `${fmt(f.rate, 2)} ${qc} ${esc(f.rateUnit)}`)}
        ${f.minCharge ? line("Minimum charge", qm(f.minCharge), f.minApplied ? "applied" : "below the rate, not applied") : ""}
        ${f.surcharges.map(s => line(s.label + " surcharge", qm(s.amount), "per shipment")).join("")}
        ${line("Freight total", qm(f.total) + (qc !== "EUR" ? ` = ${fmt(f.totalEUR, 2)} EUR` : ""), qc !== "EUR" ? `at ${fmt(Number(S.eur_usd_rate), 4)} USD per EUR` : "")}
        ${line("Freight per garment", money(g.freight) + " " + cur(), "freight total / garments")}
      </tbody></table></div>
      <h3>Surcharge split</h3><div class="lcsurbar" role="img" aria-label="Freight split into base and surcharges">${surBar}</div>
      <div class="tablewrap"><table><thead><tr><th>Part</th><th>Per shipment (${esc(qc)})</th><th>Per garment (${cur()})</th><th>Share of freight</th></tr></thead><tbody>
        ${surRows.map((s, k) => `<tr><td><i class="sw lcc${k + 1}"></i> ${esc(s.label)}</td><td class="n">${fmt(s.amount, 2)}</td><td class="n">${money(s.eur / r.units)}</td><td class="n">${Math.round(s.eur / fTot * 100)}%</td></tr>`).join("")}
      </tbody></table></div></div>
      <div><h3>Per garment (${cur()})</h3><div class="tablewrap"><table class="kvtab"><tbody>
        ${line("EXW price", money(g.exw), `product ${esc(r.sku)}`)}
        ${line("Freight", money(g.freight), "")}
        ${line("Insurance", money(g.insurance), `${fmt(r.rates.insurancePct, 2)}% × (EXW + freight)`)}
        ${line("<b>CIF</b>", "<b>" + money(g.cif) + "</b>", "EXW + freight + insurance")}
        ${line("Duty", money(g.duty), `${fmt(r.rates.dutyPct, 2)}% × CIF${c.preference_cert && c.preference_cert !== "none" ? ", with " + esc(c.preference_cert) : ""}${r.rates.standardDutyPct != null && r.rates.standardDutyPct !== r.rates.dutyPct ? ` (without preference ${fmt(r.rates.standardDutyPct, 1)}%)` : ""}`)}
        ${line("Clearance", money(g.clearance), `${fmt(Number(c.clearance_fee_eur))} EUR per shipment / ${fmt(r.units)}`)}
        ${line("Compliance", money(g.compliance), `${fmt(Number(c.compliance_cost_eur))} EUR per year / ${fmt(Number(c.expected_yearly_units))} garments`)}
        ${line("<b>Landed cost</b>", "<b>" + money(g.landed) + "</b>", "CIF + duty + clearance + compliance")}
        ${line("<b>DAP price</b>", "<b>" + money(g.dap) + "</b>", `landed × (1 + ${fmt(r.rates.marginPct, 1)}% margin)`)}
        ${line("Transit", r.transitDays == null ? "n/a" : fmt(r.transitDays) + " days", "door to door, from the quote")}
      </tbody></table></div>
      <h3>Inputs</h3><div class="tablewrap"><table><thead><tr><th>Input</th><th>Status</th><th>Source</th><th>Date</th></tr></thead><tbody>
        ${[["Product " + r.sku, p], ["Country " + r.country, c], ["Quote " + r.quoteId, q], ["Settings", S]].map(([l, row]) => `<tr><td>${esc(l)}</td><td>${stChip(row)}</td><td>${esc(row.source_ref || "")}</td><td class="num">${esc(String(row.source_date || "").slice(0, 10))}</td></tr>`).join("")}
      </tbody></table></div></div>
    </div></div>`;
}

function render(){
  const el = $("viewLanded"); if (!el) return;
  const tg = targetCountries();
  if (!LC.country || !tg.includes(LC.country)) {   // first target country with a quote in force, else the first one
    const laneTo = Object.fromEntries((MD.t.lanes || []).map(l => [l.lane_id, String(l.destination_id).toUpperCase()]));
    const quoted = new Set(C.liveQuotes(MD.t.quotes, {today: today(), months: 0, typeOf: () => null}).map(q => laneTo[q.lane_id]));
    LC.country = tg.find(c => quoted.has(c)) || tg[0] || null;
  }
  const S = settingsRow(), provs = [...new Set((MD.t.quotes || []).map(q => q.provider_id))];
  const sel = (id, label, opts, v) => `<div class="ctl"><label for="${id}">${label}</label><select id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}"${String(v) === String(k) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  const rows = LC.country ? results() : [];
  const pick = rows.find(r => !r.error && r.sku === LC.sku) || rows.filter(r => !r.error).sort((a, b) => b.perGarment.landed - a.perGarment.landed)[0];
  if (pick) LC.sku = pick.sku;
  const c = countryRow(LC.country);
  el.innerHTML = `<div class="card lcbar">
      <div class="controls">
        ${sel("lcCountry", "Country", tg.map(x => [x, CNAME(x)]), LC.country)}
        ${sel("lcCat", "Garment category", [["all", "All categories"], ["Jackets", "Jackets"], ["Trousers", "Trousers"], ["Coveralls", "Coveralls"], ["Other", "Other"]], LC.category)}
        ${sel("lcProv", "Provider", [["all", "Cheapest of all"]].concat(provs.map(p => [p, provName(p)])), LC.provider)}
        ${sel("lcMode", "Mode", [["all", "Cheapest mode"]].concat(MODES.map(m => [m, m])), LC.mode)}
        <div class="ctl"><label for="lcUnits">Garments per shipment</label><input type="number" id="lcUnits" min="1" step="1" value="${esc(S.shipment_units ?? "")}"></div>
        <div class="ctl"><label>Currency</label><div class="seg" role="group" aria-label="Currency"><button type="button" data-cur="EUR" aria-pressed="${LC.currency === "EUR"}">EUR</button><button type="button" data-cur="USD" aria-pressed="${LC.currency === "USD"}">USD</button></div></div>
      </div>
      <p class="faint lcrate">1 EUR = ${fmt(Number(S.eur_usd_rate), 4)} USD · rate of ${esc(String(S.eur_usd_date || "n/a").slice(0, 10))} ${stChip(S)} · insurance ${fmt(Number(S.insurance_rate_pct), 2)}% · margin ${fmt(Number(S.margin_pct), 1)}% · from Master Data > Settings</p>
      ${c ? `<p class="faint lcrate">${esc(CNAME(LC.country))}: duty ${fmt(Number(c.duty_rate_pct), 2)}% (${esc(c.preference_cert || "none")}), clearance ${fmt(Number(c.clearance_fee_eur))} EUR per shipment, compliance ${fmt(Number(c.compliance_cost_eur))} EUR per year over ${fmt(Number(c.expected_yearly_units))} garments ${stChip(c)}</p>` : `<p class="warnc">No row for this country in Master Data > Countries.</p>`}
    </div>
    <div class="card"><div class="cardhead"><h2>Landed cost per garment${LC.country ? " · " + esc(CNAME(LC.country)) : ""}</h2><span class="faint" style="font-size:12px">${rows.filter(r => !r.error).length} of ${rows.length} SKUs priced · cheapest valid quote per SKU · expired quotes left out</span></div>
      ${tg.length ? chart(rows) : '<p class="muted">No target countries. Add rows with target = true to Master Data > Countries.</p>'}</div>
    <div class="card"><div class="cardhead"><h2>Cost elements</h2></div>${table(rows)}</div>
    ${detail(pick)}`;
  const on = (id, k) => $(id).addEventListener("change", e => { LC[k] = e.target.value; LC.sku = null; savePref(); render(); });
  if (tg.length) { on("lcCountry", "country"); on("lcCat", "category"); on("lcProv", "provider"); on("lcMode", "mode"); }
  const ex = $("lcExw"); if (ex) ex.addEventListener("change", () => { LC.exw = ex.checked; savePref(); render(); });
  el.querySelectorAll("[data-cur]").forEach(b => b.addEventListener("click", () => { LC.currency = b.dataset.cur; savePref(); render(); }));
  $("lcUnits").addEventListener("change", async e => {
    const v = Math.round(Number(e.target.value));
    if (!(v > 0)) { toast("Garments per shipment must be a whole number above 0", "bad"); e.target.value = S.shipment_units ?? ""; return; }
    try { await mdUpsertRows("settings", [{settings_id: "main", shipment_units: v, source_ref: "Entered in Landed Cost" + (window.Auth && Auth.user() ? " by " + Auth.user().username : ""), source_date: today(), data_source: "manual"}]); toast(`Shipment size ${v} saved in Settings`); }
    catch (err) { toast(storeErrorText(err), "bad"); }
  });
  const choose = sku => { LC.sku = sku; savePref(); render(); const d = el.querySelector(".lcgrid"); if (d) d.scrollIntoView({block: "nearest", behavior: "smooth"}); };
  el.querySelectorAll(".lcrow").forEach(g => { g.addEventListener("click", () => choose(g.dataset.sku)); g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(g.dataset.sku); } }); });
  el.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", () => choose(b.dataset.pick)));
  bindTips(el);
}

// Current view as tables, for Export view.
function exportView(){
  const rows = LC.country ? results() : [], S = settingsRow(), x = v => (v == null ? "" : Number((LC.currency === "USD" ? C.fromEUR(v, "USD", S) : v).toFixed(4)));
  const main = rows.map(r => r.error ? {SKU: r.sku, Note: "Not priced: " + r.error} : Object.assign({SKU: r.sku, Provider: provName(r.providerId), Mode: r.mode, Quote: r.quoteId},
    Object.fromEntries(r.parts.flatMap(p => [[p.label + " " + LC.currency, x(p.eur)], [p.label + " share", Number(p.share.toFixed(4))]])), {["CIF " + LC.currency]: x(r.perGarment.cif), ["Landed " + LC.currency]: x(r.perGarment.landed), ["DAP " + LC.currency]: x(r.perGarment.dap),
      Cartons: r.shipment.cartons, "Volume m3": Number(r.shipment.m3.toFixed(4)), "Actual kg": Number(r.shipment.kg.toFixed(2)), "Chargeable kg": Number(r.freight.chargeableKg.toFixed(2)), "Freight total EUR": Number(r.freight.totalEUR.toFixed(2))}));
  return {title: "Landed Cost", filters: {Country: LC.country ? CNAME(LC.country) : "none", Category: LC.category, Provider: LC.provider === "all" ? "cheapest" : provName(LC.provider), Mode: LC.mode === "all" ? "cheapest" : LC.mode,
    "Garments per shipment": S.shipment_units, Currency: LC.currency + (LC.currency === "USD" ? ` (1 EUR = ${S.eur_usd_rate} USD, ${String(S.eur_usd_date || "").slice(0, 10)})` : "")}, tables: [{name: "Landed cost", rows: main}]};
}

window.LandedUI = {show: render, exportView, results, state: LC};
})();
