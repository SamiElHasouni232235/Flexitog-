/* Route Dashboard logic without DOM (window.FlexiRoute). Tested in tests/test_route.py.
   Inputs are the engine's batch rows (engine.js runBatch) and the master data partner nodes; nothing here
   changes engine results, so the Python/JS parity of engine.py and engine.js is untouched.
   Scenario keys follow the engine: cif_baseline (Baseline DAP), distributor, 3pl, owned_warehouse. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FlexiRoute = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SCENARIOS = ["cif_baseline", "distributor", "3pl", "owned_warehouse"];
  const IN_SCOPE = ["distributor", "3pl", "owned_warehouse"];   // Baseline DAP is the reference, never "best"

  // ---- lane rules: RFQ lane per country, the destination weekend (Excel WORKDAY.INTL code) and the delivery
  // target in working days after pickup. Service Goals override a country only when a goal names it.
  const LANES = [
    {lane: "L01", country: "SA", name: "Saudi Arabia", weekend: 7, target: 2, note: "48 hours, next day preferred"},
    {lane: "L02", country: "AE", name: "United Arab Emirates", weekend: 1, target: 2, note: "48 hours, next day preferred"},
    {lane: "L03", country: "KW", name: "Kuwait", weekend: 7, target: 2, note: "48 hours, next day preferred"},
    {lane: "L04", country: "QA", name: "Qatar", weekend: 7, target: 2, note: "48 hours, next day preferred"},
    {lane: "L05", country: "TR", name: "Türkiye", weekend: 1, target: 3, note: "3 working days"},
    {lane: "L06", country: "MA", name: "Morocco", weekend: 1, target: 3, note: "3 working days"},
    {lane: "L07", country: "DZ", name: "Algeria", weekend: 7, target: 5, note: "5 working days"},
    {lane: "L08", country: "EG", name: "Egypt", weekend: 7, target: 4, note: "4 working days"},
    {lane: "L09", country: "TN", name: "Tunisia", weekend: 1, target: 4, note: "4 working days"},
  ];
  const BY_COUNTRY = Object.fromEntries(LANES.map(l => [l.country, l]));
  const laneFor = c => (BY_COUNTRY[c] || {}).lane || null;
  const laneRule = c => BY_COUNTRY[c] || null;

  // ---- weight bands of the RFQ by gross kg: B1 up to 30, B2 up to 100, B3 up to 500, B4 up to 2,000, B5 above.
  const BANDS = [["B1", 30], ["B2", 100], ["B3", 500], ["B4", 2000], ["B5", Infinity]];
  const bandFor = kg => (BANDS.find(([, max]) => Number(kg) <= max) || BANDS[BANDS.length - 1])[0];
  const PALLET_TARE_KG = 20;
  // Gross kg of an order: quantity x unit_weight_kg per line, plus pallet tare. Unknown weights count as 0.
  function grossKg(lines, products, pallets) {
    const w = Object.fromEntries((products || []).map(p => [String(p.sku), Number(p.unit_weight_kg) || 0]));
    return (lines || []).reduce((a, l) => a + (Number(l.quantity) || 0) * (w[String(l.sku)] || 0), 0) + PALLET_TARE_KG * (Number(pallets) || 0);
  }

  // ---- working days. Excel weekend codes 1-7 (1 Sat-Sun ... 7 Fri-Sat), days as Date.getUTCDay (0 = Sunday).
  const WEEKEND = {1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6]};
  // Engine lead times are calendar days. Delivery lands lead days after pickup and rolls forward to the next
  // working day when it falls in the weekend; the result is the working days between pickup and delivery.
  // Averaged over the five working weekdays as pickup day, so a weekend in transit counts as it would on average.
  function workingDays(calendarDays, weekendCode) {
    const off = new Set(WEEKEND[weekendCode] || WEEKEND[1]), n = Math.max(0, Math.ceil(Number(calendarDays) - 1e-9));
    const picks = [0, 1, 2, 3, 4, 5, 6].filter(d => !off.has(d));
    const one = start => {
      let day = start, k = n; while (k-- > 0) day = (day + 1) % 7;
      let extra = 0; while (off.has(day)) { day = (day + 1) % 7; extra++; }
      let wd = 0; day = start; for (let i = 0; i < n + extra; i++) { day = (day + 1) % 7; if (!off.has(day)) wd++; }
      return wd;
    };
    return picks.reduce((a, s) => a + one(s), 0) / picks.length;
  }

  // Target for a country: a Service Goal with a time unit that names the country (ISO code or name) wins,
  // otherwise the lane rules above. Returns {days, source, note} or null for a country without a lane.
  const REGION_NAMES = ["türkiye", "north africa", "gulf/gcc"];
  const TIME_UNIT = /^(working\s*)?days?$|^hours?$/i;
  function targetFor(country, goals) {
    const rule = laneRule(country);
    // Region names never count as a country, so a region-wide goal (Türkiye, North Africa, Gulf/GCC) stays region-level.
    const names = [country, rule && rule.name].filter(Boolean).map(s => String(s).toLowerCase()).filter(n => !REGION_NAMES.includes(n));
    const g = (goals || []).find(x => TIME_UNIT.test(String(x.unit || "").trim()) && (x.regions || []).some(r => names.includes(String(r).toLowerCase())));
    if (g) {
      const v = Number(g.target), hours = /^hours?$/i.test(String(g.unit).trim());
      if (Number.isFinite(v)) return {days: hours ? v / 24 : v, source: "service goal", note: `${g.name}: ${g.target} ${g.unit}`};
    }
    return rule ? {days: rule.target, source: "lane rules", note: rule.note} : null;
  }

  // ---- partner status per scenario and country, from the served countries of the partner nodes.
  // signed = a node with status "existing" serves the country; candidate = only potential or candidate nodes.
  // Baseline DAP needs no partner: Helmond serves it when the hub lists the country.
  const served = dc => String(dc.serves_countries || "").split(";").map(s => s.trim()).filter(Boolean).concat([String(dc.country || "")]);
  function partnerStatus(dcs, scenario, country) {
    const type = scenario === "cif_baseline" ? "helmond_hub" : scenario;
    const nodes = (dcs || []).filter(d => d.dc_type === type && served(d).includes(country));
    // Without any hub row in the data, Baseline DAP is taken as available from Helmond.
    if (!nodes.length) return scenario === "cif_baseline" && !(dcs || []).some(d => d.dc_type === "helmond_hub") ? "signed" : "none";
    return nodes.some(d => String(d.status) === "existing") ? "signed" : "candidate";
  }
  function coverageMatrix(dcs, countries) {
    return (countries || LANES.map(l => l.country)).map(c => ({country: c, cells: Object.fromEntries(SCENARIOS.map(s => [s, partnerStatus(dcs, s, c)]))}));
  }
  const allowed = (status, includeCandidates) => status === "signed" || (includeCandidates && status === "candidate");

  // ---- order-weighted aggregation of batch rows.
  // Per country and scenario: per-unit values over the served orders, lead time as mean working days,
  // orders meeting the target. Region values weight each country by its order count.
  function rowStatus(row) {
    if (!row.route) return "none";
    if (row.scenario === "cif_baseline") return "signed";
    return String(row.route.dc_status || "") === "existing" ? "signed" : "candidate";
  }
  function countryStats(rows, opts) {
    const o = Object.assign({method: "customer_first", goals: [], dcs: []}, opts);
    const by = {};
    rows.forEach(r => { const k = r.country; (by[k] = by[k] || []).push(r); });
    return Object.entries(by).map(([country, g]) => {
      const t = targetFor(country, o.goals), wk = (laneRule(country) || {}).weekend || 1;
      const orders = new Set(g.map(r => r.order_id)).size;
      const scenarios = {};
      SCENARIOS.forEach(s => {
        const sg = g.filter(r => r.scenario === s);
        // served = available rows whose partner counts under the switch (signed only when includeCandidates is false)
        const ok = sg.filter(r => r.available && allowed(rowStatus(r), o.includeCandidates !== false));
        const units = ok.reduce((a, r) => a + (r.units || 0), 0);
        const wds = ok.map(r => workingDays(r.lead_time_days, wk));
        const met = t ? wds.filter(d => d <= t.days + 1e-9).length : 0;
        const mean = f => (ok.length ? ok.reduce((a, r) => a + f(r), 0) / ok.length : null);
        const st = partnerStatus(o.dcs, s, country);
        scenarios[s] = {orders: sg.length, served: ok.length, met, missing: sg.length - met, status: st,
          routeStatus: !ok.length ? null : ok.some(r => rowStatus(r) === "candidate") ? "candidate" : "signed",
          costPerUnit: units ? ok.reduce((a, r) => a + r.cost_to_serve_eur, 0) / units : null,
          custPerUnit: units ? ok.reduce((a, r) => a + r.customer_pays_eur, 0) / units : null,
          leadWd: wds.length ? wds.reduce((a, b) => a + b, 0) / wds.length : null,
          leadDays: mean(r => r.lead_time_days), hassle: mean(r => (r.hassle || {})[o.method] || 0), paperwork: mean(r => r.flexitog_paperwork || 0),
          realShare: ok.length ? 1 - mean(r => r.placeholder_cost_share) : null};
      });
      return {country, orders, target: t, scenarios};
    });
  }
  // Combine country stats into one selection (region or country), weighted by order count.
  function combine(countries) {
    const out = {};
    SCENARIOS.forEach(s => {
      const cs = countries.filter(c => c.scenarios[s] && c.scenarios[s].served > 0);
      const w = cs.reduce((a, c) => a + c.orders, 0);
      const wavg = k => { const v = cs.filter(c => c.scenarios[s][k] != null); const ww = v.reduce((a, c) => a + c.orders, 0); return ww ? v.reduce((a, c) => a + c.orders * c.scenarios[s][k], 0) / ww : null; };
      const sum = k => countries.reduce((a, c) => a + ((c.scenarios[s] || {})[k] || 0), 0);
      const sts = countries.map(c => (c.scenarios[s] || {}).status || "none");
      out[s] = {orders: countries.reduce((a, c) => a + c.orders, 0), served: sum("served"), met: sum("met"), missing: sum("missing"), weight: w,
        inScope: cs.length > 0,
        status: sts.includes("signed") ? "signed" : sts.includes("candidate") ? "candidate" : "none",
        costPerUnit: wavg("costPerUnit"), custPerUnit: wavg("custPerUnit"), leadWd: wavg("leadWd"), leadDays: wavg("leadDays"),
        hassle: wavg("hassle"), paperwork: wavg("paperwork"), realShare: wavg("realShare")};
      out[s].total = out[s].costPerUnit == null ? null : out[s].costPerUnit + (out[s].custPerUnit || 0);
    });
    return out;
  }

  /* ---- bestScenario(countries, {includeCandidates})
     countries: countryStats() output for the selection.
     1. Only in-scope scenarios count: Distributor, 3PL and Owned WH (Baseline DAP is the reference), with at
        least one served order through a signed partner, or through a candidate when includeCandidates is on.
     2. Prefer scenarios where every order of the selection meets its lead time target (unserved orders miss).
     3. Among those, the lowest cost to serve plus customer pays per unit, each country weighted by its orders.
     4. On a tie (same value to the cent), the lower hassle score.
     5. When no scenario meets the target, the lowest cost wins and the result is flagged missesTarget.
     Returns {scenario, missesTarget, stats, ranked} or {scenario: null, reason} when nothing is in scope. */
  function bestScenario(countries, opts) {
    const inc = !opts || opts.includeCandidates !== false;
    // A scenario counts in a country when it serves orders there through partners allowed by the switch.
    const list = (countries || []).map(c => Object.assign({}, c, {scenarios: Object.fromEntries(Object.entries(c.scenarios).map(([s, x]) => {
      const keep = x.served > 0 && (inc || x.routeStatus === "signed");
      return [s, keep ? x : Object.assign({}, x, {served: 0, met: 0, missing: x.orders, routeStatus: null, costPerUnit: null, custPerUnit: null, leadWd: null})];
    }))}));
    const agg = combine(list);
    const cand = IN_SCOPE.filter(s => agg[s].inScope && agg[s].total != null);
    if (!cand.length) {
      const anyCandidate = IN_SCOPE.some(s => (countries || []).some(c => { const x = c.scenarios[s] || {}; return x.status === "candidate" || x.routeStatus === "candidate"; }));
      return {scenario: null, reason: !inc && anyCandidate ? "candidates-only" : "no-partner", stats: agg, ranked: []};
    }
    const meets = s => agg[s].met === agg[s].orders && agg[s].orders > 0;
    const cents = v => Math.round(v * 100);
    const order = (a, b) => cents(agg[a].total) - cents(agg[b].total) || (agg[a].hassle || 0) - (agg[b].hassle || 0);
    const ranked = cand.slice().sort((a, b) => (meets(b) - meets(a)) || order(a, b));
    const pool = cand.filter(meets);
    const best = (pool.length ? pool : cand).slice().sort(order)[0];
    return {scenario: best, missesTarget: !pool.length, stats: agg, ranked};
  }

  // ---- issues: coverage gaps ("No <scenario> option in <country>") move to the coverage matrix.
  function splitIssues(list) {
    const SEV = {critical: 0, serious: 1, warning: 2, info: 3};
    const risks = [], coverage = [];
    (list || []).forEach(i => (i.type === "coverage" ? coverage : risks).push(i));
    risks.sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9));
    return {risks, coverage};
  }
  const severityCounts = list => (list || []).reduce((a, i) => { a[i.severity] = (a[i.severity] || 0) + 1; return a; }, {});

  /* ---- RFQ adapter. getProviders() returns the Benchmarking providers (BenchUI.state.providers); each holds
     rfqResponses[] with the parsed Export values of every returned RFQ, the newest at latestResponseIndex.
     getRfqRate(providerId, lane, band) reads rate.<lane>.<band>.cost_per_shipment and .transit_days from
     that latest response, and getRfqStock(providerId, lane) reads stock.<lane>.serve_from_stock and
     .transit_days. A missing response, value or provider gives {source: "placeholder"}, so the caller keeps
     the engine's placeholder rates and labels the option "placeholder". */
  function rfqAdapter(getProviders) {
    const latest = id => {
      const p = (getProviders() || []).find(x => x.id === id);
      const r = p && p.rfqResponses && p.rfqResponses.length ? p.rfqResponses[p.latestResponseIndex ?? p.rfqResponses.length - 1] : null;
      return r && r.values ? {p, r} : null;
    };
    const num = v => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    function getRfqRate(providerId, lane, band) {
      const L = latest(providerId); if (!L || !lane || !band) return {source: "placeholder"};
      const v = L.r.values, k = `rate.${lane}.${band}.`;
      const cost = num(v[k + "cost_per_shipment"]), days = num(v[k + "transit_days"]);
      if (cost == null || cost <= 0) return {source: "placeholder"};
      return {source: "rfq", providerId, providerName: L.p.name, lane, band, costPerShipment: cost, transitDays: days,
        mode: v[k + "mode"] || "", currency: v["provider.currency"] || "EUR", responseDate: (L.r.summary || {}).responseDate || String(L.r.uploadedAt || "").slice(0, 10)};
    }
    function getRfqStock(providerId, lane) {
      const L = latest(providerId); if (!L || !lane) return {source: "placeholder"};
      const v = L.r.values, yes = String(v[`stock.${lane}.serve_from_stock`] || "").toLowerCase();
      const days = num(v[`stock.${lane}.transit_days`]);
      if (!(yes === "yes" || yes === "true") || days == null) return {source: "placeholder"};
      return {source: "rfq", providerId, providerName: L.p.name, lane, transitDays: days};
    }
    // Providers with a usable rate for this lane and band (rejected providers left out).
    function quotes(lane, band) {
      return (getProviders() || []).filter(p => p.status !== "rejected").map(p => getRfqRate(p.id, lane, band)).filter(q => q.source === "rfq");
    }
    return {getRfqRate, getRfqStock, quotes};
  }

  return {SCENARIOS, IN_SCOPE, LANES, BANDS, PALLET_TARE_KG, laneFor, laneRule, bandFor, grossKg, workingDays, targetFor,
    partnerStatus, coverageMatrix, rowStatus, countryStats, combine, bestScenario, splitIssues, severityCounts, rfqAdapter};
});
