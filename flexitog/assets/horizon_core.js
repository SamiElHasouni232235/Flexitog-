/* FlexiTog time horizon: the cost of the four scenarios year by year over 1 to 5 years, for one volume case. No DOM.
 * Browser: window.FlexiHorizon. Node: module.exports (tests). Uses the scenario engine (rfq_v30.js) and the volume cases
 * (cases_core.js); holds no rate of its own.
 *
 * Per year y of the horizon:
 *   1. Volume: the case's shipments table of year y (cases_core.years), priced by rfq_v30.scenarios as one year.
 *   2. Rates: each cost type x its escalation factor (1 + e)^(y - 1), e from settings.escalation (low, base or high):
 *      transport, direct from Helmond and delivery: freight x fuel; warehouse handling, storage and fixed (3PL minimums,
 *      own-site rent and staff): warehouse; customs: not escalated.
 *   3. One-off costs (3PL onboarding W16 + W17, own-site setup and licences) fall in full in settings.oneOffYear (year 1 by
 *      default) instead of the yearly amortisation the single-year view uses.
 * Outputs: cost per year per scenario, cumulative cost, the cheapest scenario per year, the switch point (first year S2, S3
 * or S4 costs less than S1, with that year's orders and kg; beyond the horizon, the volume multiplier from the existing
 * break-even logic, rfq_v30.sensitivity), revenue and cost as % of revenue (internal), and the recommendation: the lowest
 * cumulative cost among the scenarios meeting the GCC delivery target.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rfq_v30.js"), require("./cases_core.js"));
  else root.FlexiHorizon = factory(root.FlexiRFQ30, root.FlexiCases);
})(typeof self !== "undefined" ? self : this, function (V, C) {
  "use strict";
  const IDS = V.IDS, sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const GROUP = {transport: ["freight", "fuel"], direct: ["freight", "fuel"], delivery: ["freight", "fuel"], handling: ["warehouse"], storage: ["warehouse"], fixed: ["warehouse"], customs: []};
  // escalation % per rate for the chosen setting (low, base, high)
  const ratesOf = (S, setting) => Object.fromEntries(Object.entries(S.escalation.rates).map(([k, v]) => [k, Number(v[setting || S.escalation.setting || "base"]) || 0]));
  const factor = (rates, keys, y) => keys.reduce((a, k) => a * Math.pow(1 + (rates[k] || 0) / 100, y - 1), 1);

  /* run(list, settings, volumeCase, opts) -> {years: [...], totals, cumulative, cheapest, switchPoints, recommended, startYear}
     opts: {years (1-5), setting ("low" | "base" | "high"), lanes (filter; default all), choice (provider filter), revenue (internal
     revenue settings: fx), withRevenue (false: no revenue figures computed)} */
  function run(list, settingsIn, vc, opts) {
    const o = opts || {}, S = V.withDefaults(settingsIn), n = Math.max(1, Math.min(5, Number(o.years) || 1)), rates = ratesOf(S, o.setting);
    const lanes = o.lanes && o.lanes.length ? o.lanes : V.LANE_IDS, all = lanes.length === V.LANE_IDS.length;
    const rows = C.years(vc, S, n), rv = V.revenueSettings(o.revenue || null);
    const years = rows.map(row => {
      const Sy = Object.assign({}, S, {volumes: Object.assign({}, S.volumes, {Y: row.volumes})});
      const out = V.scenarios(list, Sy, "Y", o.choice || "best");
      const fx = rv.fx * Math.pow(1 + (rates.eurusd || 0) / 100, row.i - 1);
      const scen = Object.fromEntries(IDS.map(id => {
        const R = out[id];
        if (R.state !== "complete") return [id, {state: R.state, cost: null, missing: R.missing, notes: R.notes, capability: R.capability, R}];
        const cs = lanes.map(L => R.countries[L]);
        const types = Object.fromEntries(V.TYPES.map(([k]) => [k, all ? R.types[k] : sum(cs, c => c.types[k])]));
        const am = R.amortised || {total: 0, oneOff: 0, byCountry: {}};
        const amort = all ? am.total : sum(lanes, L => ((am.byCountry[L] || {}).amount || 0)), oneOffAll = all ? am.oneOff : sum(lanes, L => ((am.byCountry[L] || {}).oneOff || 0));
        const esc = Object.fromEntries(Object.keys(types).map(k => [k, factor(rates, GROUP[k] || [], row.i)]));
        // recurring = every cost type x its escalation, without the amortised one-off; the one-off falls in its own year
        const recurring = sum(Object.keys(types), k => (k === "fixed" ? types[k] - amort : types[k]) * esc[k]);
        const oneOff = (Number(S.oneOffYear[id]) || 1) === row.i ? oneOffAll : 0;
        const cost = recurring + oneOff, n0 = sum(lanes, L => row.byCountry[L].orders), kg = sum(lanes, L => row.byCountry[L].kg);
        const floor = id === "S3" && R.floor ? R.floor.total * esc.fixed * (all ? 1 : (sum(lanes, L => R.countries[L].orders) / Math.max(1e-9, sum(V.LANE_IDS, L => R.countries[L].orders)))) : null;
        let revenue = null;
        if (o.withRevenue) {
          const rev = {fx, total: {Y: row.revenueUsd}, byCountry: {Y: Object.fromEntries(V.LANE_IDS.map(L => [L, row.byCountry[L].revenueUsd]))}, discount: rv.discount};
          const view = V.revenueView(out, rev, Sy), b = all ? view.scenarios[id].total : null;
          const netEur = b ? b.netEur : sum(lanes, L => view.scenarios[id].countries[L].netEur);
          revenue = {netEur, pct: netEur > 0 ? cost / netEur : null, contribution: netEur - cost};
        }
        // per country (all countries, for the map): the same escalation, one-off by the same order weights
        const byCountry = Object.fromEntries(V.LANE_IDS.map(L => { const c = R.countries[L], a = am.byCountry[L] || {};
          return [L, sum(Object.keys(types), k => (k === "fixed" ? c.types[k] - (a.amount || 0) : c.types[k]) * esc[k]) + ((Number(S.oneOffYear[id]) || 1) === row.i ? (a.oneOff || 0) : 0)]; }));
        return [id, {state: "complete", cost, recurring, oneOff, types, escalation: esc, byCountry, perOrder: n0 ? cost / n0 : null, perKg: kg ? cost / kg : null, floor,
          capability: R.capability, coveredOnly: R.covered < R.shipments - 1e-9, providers: R.providers, distributors: R.distributorNames || [], completeness: R.completeness, revenue, R}];
      }));
      const ok = IDS.filter(id => scen[id].cost != null).sort((a, b) => scen[a].cost - scen[b].cost);
      return {year: row.year, i: row.i, extrapolated: row.extrapolated, volume: row, orders: sum(lanes, L => row.byCountry[L].orders), kg: sum(lanes, L => row.byCountry[L].kg),
        units: sum(lanes, L => row.byCountry[L].units), revenueUsd: sum(lanes, L => row.byCountry[L].revenueUsd), fx, scen, cheapest: ok[0] || null, out, settings: Sy};
    });
    const complete = id => years.every(y => y.scen[id].cost != null);
    const cumulative = Object.fromEntries(IDS.map(id => { let a = 0; return [id, years.map(y => (y.scen[id].cost == null ? null : (a += y.scen[id].cost)))]; }));
    const totals = Object.fromEntries(IDS.map(id => [id, complete(id) ? cumulative[id][n - 1] : null]));
    const oneOffs = Object.fromEntries(IDS.map(id => [id, sum(years, y => (y.scen[id].oneOff || 0))]));
    // switch point: first year S2, S3 or S4 costs less than S1; past the horizon, the break-even multiplier on year 1
    const switchPoints = Object.fromEntries(IDS.filter(id => id !== "S1").map(id => {
      const y = years.find(x => x.scen[id].cost != null && x.scen.S1.cost != null && x.scen[id].cost < x.scen.S1.cost);
      if (y) return [id, {year: y.year, i: y.i, orders: y.orders, kg: y.kg, within: true}];
      if (id === "S2" || !complete("S1") || !complete(id)) return [id, null];
      const Sy = Object.assign({}, S, {volumes: Object.assign({}, S.volumes, {Y: years[0].volume.volumes})}), be = V.sensitivity(list, Sy, "Y", o.choice || "best").breakEven[id];
      return [id, be != null ? {year: null, multiplier: be, orders: years[0].orders * be, kg: years[0].kg * be, within: false} : null];
    }));
    // recommendation: lowest cumulative cost among the scenarios meeting the GCC delivery target in every year
    const target = S.gccTarget === "next-day" ? "nextDay" : "meets48", label = S.gccTarget === "next-day" ? "next-day" : "48 hours";
    const meets = id => years.every(y => y.scen[id].capability && y.scen[id].capability[target]);
    const cand = IDS.filter(id => totals[id] != null), good = cand.filter(meets).sort((a, b) => totals[a] - totals[b]), any = cand.slice().sort((a, b) => totals[a] - totals[b]);
    let recommended = null;
    if (good.length) {
      const cheaper = any[0] && any[0] !== good[0] ? ` ${any[0]} costs less (EUR ${Math.round(totals[any[0]]).toLocaleString("en-GB")}) but does not reach ${label} in the GCC.` : "";
      recommended = {id: good[0], reason: `Lowest cumulative cost over ${n} year${n === 1 ? "" : "s"} (EUR ${Math.round(totals[good[0]]).toLocaleString("en-GB")}) among the scenarios reaching ${label} in the GCC.${cheaper}`};
    } else if (any.length) recommended = {id: null, fallback: any[0], reason: `No complete scenario reaches ${label} in the GCC in every year. Lowest cumulative cost: ${any[0]} (EUR ${Math.round(totals[any[0]]).toLocaleString("en-GB")}).`};
    // cumulative per country and the cheapest complete scenario per country over the horizon (map)
    const countryTotals = Object.fromEntries(V.LANE_IDS.map(L => [L, Object.fromEntries(IDS.map(id => [id, complete(id) ? sum(years, y => y.scen[id].byCountry[L]) : null]))]));
    const byCountry = Object.fromEntries(V.LANE_IDS.map(L => { const ok = IDS.filter(id => countryTotals[L][id] != null && years.some(y => y.volume.byCountry[L].orders > 0) && years.every(y => y.out[id].countries[L].state === "complete"));
      return [L, ok.sort((a, b) => countryTotals[L][a] - countryTotals[L][b])[0] || null]; }));
    return {startYear: years[0].year, n, countryTotals, byCountry, setting: o.setting || S.escalation.setting, rates, lanes, years, cumulative, totals, oneOffs, switchPoints, recommended,
      cheapestOverall: any[0] || null, extrapolated: years.filter(y => y.extrapolated).map(y => y.year)};
  }
  return {run, ratesOf, factor, GROUP};
});
