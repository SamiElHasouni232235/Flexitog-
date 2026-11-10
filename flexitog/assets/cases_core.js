/* FlexiTog volume cases: named forecasts of customer volume per year (orders, units, kg, revenue), built on the Forecast
 * tab and read by the Route dashboard. "Volume case" is the forecast output (A, B, C, D, E and any added); "scenario" is a
 * supply chain option (S1 to S4). No DOM. Browser: window.FlexiCases. Node: module.exports (tests).
 *
 * A case holds a snapshot of its base year (orders and revenue per country, the size-band mix per country, units per order)
 * and a method that turns it into a factor per forecast year: f(y) = volume in year y / base-year volume.
 *   multiplier       f(1) = k, then f(y) = f(y-1) x (1 + g(y))
 *   runrate, holt,   f(1) = method forecast for the first year / base year (stored as "level" when the case is built),
 *   seasonal         then the growth rates per year
 *   revenueTarget    target T in year Y: r = (T / base)^(1 / (Y - base year)) - 1, f(y) = (1 + r)^(y - base year)
 *   volumeTarget     the same on orders or kg
 *   growth           rates per year: f(y) = (1 + g1) x ... x (1 + gy); or an end goal G in year Y solved as a CAGR
 *                    (front-load: year 1 at g1, the remaining years at the rate that still reaches G)
 * Years past the case's own length extend with its last growth rate and are tagged "extrapolated".
 * Orders per country = base orders x f(y) x country share; shipments per lane and band = orders x band mix; kg = shipments x
 * average kg of the band; units = orders x units per order; revenue (USD, internal only) = base revenue x f(y) x revenue share.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rfq_v30.js"));
  else root.FlexiCases = factory(root.FlexiRFQ30);
})(typeof self !== "undefined" ? self : this, function (V) {
  "use strict";
  const LANES = V.LANE_IDS, BANDS = V.BANDS;
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const num = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
  const METHODS = [["multiplier", "Multiplier on history"], ["runrate", "Moving average (run rate)"], ["holt", "Exponential smoothing (Holt)"],
    ["seasonal", "Seasonal (run rate x seasonal index)"], ["revenueTarget", "Revenue target"], ["volumeTarget", "Volume target"], ["growth", "Growth path"]];
  const methodLabel = m => (METHODS.find(x => x[0] === m) || [m, m])[1];

  const shares = obj => { const t = sum(Object.values(obj || {}), x => num(x, 0)); return Object.fromEntries(Object.entries(obj || {}).map(([k, x]) => [k, t > 0 ? num(x, 0) / t : 0])); };
  // Base totals of a case: orders, revenue (USD) and kg in the base year.
  function baseTotals(c, S) {
    const b = c.base || {}, orders = sum(LANES, L => num((b.orders || {})[L], 0)), revenueUsd = sum(LANES, L => num((b.revenueUsd || {})[L], 0));
    const kg = sum(LANES, L => num((b.orders || {})[L], 0) * sum(BANDS, x => num(((b.bandMix || {})[L] || {})[x], 0) * num(S.avgKg[x], 0)));
    return {orders, revenueUsd, kg};
  }
  // The growth rate per forecast year (index 1..n) and the formula text, before extension past the case length.
  function path(c, S, n) {
    const i = c.inputs || {}, g = Array.isArray(i.growth) ? i.growth.map(x => num(x, 0) / 100) : [], B = baseTotals(c, S);
    const by = num(c.baseYear, 2026), sy = num(c.startYear, by + 1), f = [];
    let formula = "";
    const grow = (f1, from) => { f[0] = f1; for (let y = 2; y <= n; y++) f[y - 1] = f[y - 2] * (1 + (g[y - 1] ?? g[g.length - 1] ?? 0)); formula = `${from}; then f(y) = f(y-1) x (1 + growth of year y)`; };
    const cagr = (target, baseV, year) => { const yrs = Math.max(1, num(year, sy) - by); return baseV > 0 && target > 0 ? Math.pow(target / baseV, 1 / yrs) - 1 : 0; };
    switch (c.method) {
      case "multiplier": grow(num(i.multiplier, 1), `f(1) = ${num(i.multiplier, 1)} x base year`); break;
      case "runrate": case "holt": case "seasonal": grow(num(i.level, 1), `f(1) = ${methodLabel(c.method)} forecast for ${sy} / base year = ${num(i.level, 1).toFixed(3)}`); break;
      case "revenueTarget": case "volumeTarget": {
        const t = i.target || {}, kind = c.method === "revenueTarget" ? "revenue" : (t.kind === "kg" ? "kg" : "orders");
        const baseV = kind === "revenue" ? B.revenueUsd : kind === "kg" ? B.kg : B.orders, r = cagr(num(t.value, 0), baseV, t.year);
        // after the target year: the growth rates entered for those years, else flat
        for (let y = 1; y <= n; y++) f[y - 1] = sy + y - 1 <= num(t.year, sy) ? Math.pow(1 + r, sy + y - 1 - by) : f[y - 2] * (1 + (g[y - 1] ?? 0));
        formula = `r = (${kind} target ${num(t.value, 0).toLocaleString("en-GB")} in ${num(t.year, sy)} / base ${Math.round(baseV).toLocaleString("en-GB")})^(1 / ${Math.max(1, num(t.year, sy) - by)}) - 1 = ${(r * 100).toFixed(2)}%; f(y) = (1 + r)^(y - ${by})`;
        break;
      }
      case "growth": {
        const e = i.endGoal || {};
        if (num(e.value, 0) > 0) {
          const year = num(e.year, sy + 4), yrs = Math.max(1, year - by), goalUsd = num(e.value, 0) / (e.currency === "EUR" ? num(e.fx, 0.8607) : 1);
          if (e.frontLoad && yrs > 1) {
            const g1 = num(e.frontLoadPct, 50) / 100, rest = Math.pow(goalUsd / (B.revenueUsd * (1 + g1)), 1 / (yrs - 1)) - 1;
            for (let y = 1; y <= n; y++) f[y - 1] = sy + y - 1 <= year ? (1 + g1) * Math.pow(1 + rest, sy + y - 1 - by - 1) : f[y - 2] * (1 + (g[y - 1] ?? 0));
            formula = `front-loaded: year 1 +${(g1 * 100).toFixed(1)}%, then r = (goal / (base x ${(1 + g1).toFixed(2)}))^(1 / ${yrs - 1}) - 1 = ${(rest * 100).toFixed(2)}%`;
          } else {
            const r = cagr(goalUsd, B.revenueUsd, year);
            for (let y = 1; y <= n; y++) f[y - 1] = sy + y - 1 <= year ? Math.pow(1 + r, sy + y - 1 - by) : f[y - 2] * (1 + (g[y - 1] ?? 0));
            formula = `CAGR r = (goal USD ${Math.round(goalUsd).toLocaleString("en-GB")} in ${year} / base USD ${Math.round(B.revenueUsd).toLocaleString("en-GB")})^(1 / ${yrs}) - 1 = ${(r * 100).toFixed(2)}%`;
          }
        } else {
          for (let y = 1; y <= n; y++) f[y - 1] = (y > 1 ? f[y - 2] : 1) * (1 + (g[y - 1] ?? g[g.length - 1] ?? 0));
          formula = `f(y) = (1 + g1) x ... x (1 + gy), growth ${g.map(x => `${(x * 100).toFixed(1)}%`).join(", ") || "none"}`;
        }
        break;
      }
      default: grow(1, "f(1) = base year");
    }
    return {f, formula};
  }
  /* The yearly table of a case for n years: [{year, i, extrapolated, factor, orders, units, kg, revenueUsd, byCountry, volumes}].
     volumes is the shipments table per lane and band that the scenario engine prices. */
  function years(c, settingsIn, n) {
    const S = V.withDefaults(settingsIn), len = Math.max(1, Math.min(5, num(c.years, 5))), N = Math.max(1, Math.min(5, num(n, len)));
    const p = path(c, S, Math.max(N, len)), f = p.f.slice(0, Math.max(N, len));
    // past the case length: extend with its last growth rate, tagged extrapolated
    const last = len >= 2 ? f[len - 1] / f[len - 2] - 1 : num(((c.inputs || {}).growth || []).slice(-1)[0], 0) / 100;
    for (let y = len + 1; y <= N; y++) f[y - 1] = f[y - 2] * (1 + last);
    const b = c.base || {}, B = baseTotals(c, S), split = c.split && sum(Object.values(c.split), x => num(x, 0)) > 0 ? shares(c.split) : null;
    const oShare = split || shares(b.orders), rShare = split || shares(b.revenueUsd);
    const upo = L => num(typeof b.unitsPerOrder === "object" ? (b.unitsPerOrder || {})[L] : b.unitsPerOrder, 0);
    const sy = num(c.startYear, num(c.baseYear, 2026) + 1);
    return Array.from({length: N}, (_, k) => {
      const fy = f[k], byCountry = {}, volumes = {};
      LANES.forEach(L => {
        const orders = B.orders * fy * (oShare[L] || 0), mix = shares((b.bandMix || {})[L] || {});
        volumes[L] = Object.fromEntries(BANDS.map(x => [x, orders * (mix[x] || 0)]));
        const kg = sum(BANDS, x => volumes[L][x] * num(S.avgKg[x], 0));
        byCountry[L] = {orders, kg, units: orders * upo(L), revenueUsd: B.revenueUsd * fy * (rShare[L] || 0)};
      });
      const tot = key => sum(LANES, L => byCountry[L][key]);
      return {year: sy + k, i: k + 1, extrapolated: k + 1 > len, factor: fy, growth: k ? fy / f[k - 1] - 1 : fy - 1,
        orders: tot("orders"), units: tot("units"), kg: tot("kg"), revenueUsd: tot("revenueUsd"), byCountry, volumes};
    }).map(row => Object.assign(row, {formula: p.formula}));
  }
  // A case is "confirmed" only with a basis (text and source) and that status chosen; otherwise "estimate".
  const hasBasis = c => !!(c.basis && String(c.basis.text || "").trim() && String(c.basis.source || "").trim());
  const status = c => (hasBasis(c) && c.status === "confirmed" ? "confirmed" : "estimate");
  const newerHistory = (c, latestYear) => latestYear != null && num(c.baseYear, 0) < latestYear;
  const uid = () => "VC-" + Math.random().toString(36).slice(2, 8).toUpperCase();

  /* Seed cases from the current setup: the base year is the last 12 months behind volume case A (half of A, per country
     and band), revenue USD 515,000 (2 x = USD 1,030,000, the current case A revenue; last 12 months USD 514,000 rounded).
     A = 2 x history; B = Holt smoothing (level from the Forecast tab when history is loaded, else 1); C = revenue target USD
     2,400,000 in 2027 (the current case B); D = volume target and E = growth to a 5-year goal, placeholders to confirm. */
  function seed(settingsIn, opts) {
    const S = V.withDefaults(settingsIn), o = opts || {}, A = S.volumes.A, today = o.today || new Date().toISOString().slice(0, 10);
    const half = Object.fromEntries(LANES.map(L => [L, sum(BANDS, x => num(A[L][x], 0)) / 2]));
    const mixOf = T => Object.fromEntries(LANES.map(L => { const t = sum(BANDS, x => num(T[L][x], 0)); return [L, Object.fromEntries(BANDS.map(x => [x, t ? num(T[L][x], 0) / t : 0]))]; }));
    const baseRev = 515000, totHalf = sum(LANES, L => half[L]);
    const base = {orders: half, revenueUsd: Object.fromEntries(LANES.map(L => [L, totHalf ? baseRev * half[L] / totHalf : 0])), bandMix: mixOf(A), unitsPerOrder: num(o.unitsPerOrder, 6)};
    const mk = (letter, name, method, inputs, basis, extra) => Object.assign({id: `VC-${letter}`, letter, name, method, createdAt: today, baseYear: 2026, startYear: 2027, years: 5,
      base: JSON.parse(JSON.stringify(base)), inputs, split: null, garmentMix: null, basis, status: "estimate", source: "seed from the current setup", sourceDate: today}, extra || {});
    const B = S.volumes.B, bSplit = Object.fromEntries(LANES.map(L => [L, sum(BANDS, x => num(B[L][x], 0))]));
    return [
      mk("A", "A: 2 x last 12 months", "multiplier", {multiplier: 2, growth: [0, 0, 0, 0, 0]}, {text: "2 x the last 12 months, rounded (USD 514,000 to USD 1,030,000)", source: "internal scenario file, Scenario_A"}),
      mk("B", "B: Holt smoothing", "holt", {level: num(o.holtLevel, 1), growth: [0, 0, 0, 0, 0]}, {text: "", source: ""}),
      mk("C", "C: revenue target USD 2.4 million in 2027", "revenueTarget", {target: {kind: "revenue", value: 2400000, year: 2027}, growth: []},
        {text: "2027 target midpoint (USD 2.3 to 2.5 million)", source: "internal scenario file, Scenario_B"}, {split: bSplit, base: Object.assign(JSON.parse(JSON.stringify(base)), {bandMix: mixOf(B)})}),
      mk("D", "D: volume target (placeholder)", "volumeTarget", {target: {kind: "orders", value: 282, year: 2029}, growth: []}, {text: "", source: ""}, {placeholder: "Replace the volume target with your own: 282 orders in 2029 (2 x case A year 1) is a placeholder."}),
      mk("E", "E: growth to EUR 5 million in year 5 (placeholder)", "growth", {endGoal: {value: 5000000, currency: "EUR", fx: 0.8607, year: 2031, frontLoad: false, frontLoadPct: 50}, growth: []},
        {text: "", source: ""}, {placeholder: "Replace the 5-year goal with your own: EUR 5 million in 2031 is the example from the brief."}),
    ];
  }
  function duplicate(c, name) { const d = JSON.parse(JSON.stringify(c)); d.id = uid(); d.letter = ""; d.name = name || `${c.name} (copy)`; d.createdAt = new Date().toISOString().slice(0, 10); return d; }
  const blank = (settingsIn, name) => Object.assign(seed(settingsIn)[0], {id: uid(), letter: "", name: name || "New volume case", basis: {text: "", source: ""}, source: "", placeholder: ""});

  return {METHODS, methodLabel, baseTotals, path, years, hasBasis, status, newerHistory, seed, duplicate, blank, uid};
});
