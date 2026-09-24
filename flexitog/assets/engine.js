/* FlexiTog route engine, JavaScript port of flexitog/engine.py and flexitog/batch.py.
 * Runs in the browser dashboard and in node (tests/test_dashboard_engine.py checks parity).
 * Keep the two in step: any rule change in engine.py belongs here too.
 */
(function (root) {
  "use strict";
  const PLACEHOLDER = "placeholder", REAL = "real";
  const FLEXITOG = "FlexiTog", PARTNER = "partner", CUSTOMER = "customer";
  const SCENARIOS = ["cif_baseline", "distributor", "3pl", "owned_warehouse"];
  const IN_SCOPE = ["distributor", "3pl", "owned_warehouse"];
  const STOCKED = new Set(IN_SCOPE);
  const LANE_RANK = { proven: 0, occasional: 1, unproven: 2 };
  const REGIONAL_GROUP = { "Gulf/GCC": "GCC", "North Africa": "NAF" };
  const STUDY_REGIONS = ["Türkiye", "North Africa", "Gulf/GCC"];
  const PAPERWORK = new Set(["export_docs", "clearance", "duty", "import_fees", "compliance"]);
  const DC_OVERRIDES = ["margin_pct", "inbound_eur_per_pallet", "storage_eur_per_pallet_month", "outbound_eur_per_order"];
  const LABELS = { cif_baseline: "Baseline: CIF to port", distributor: "Distributor-held stock",
                   "3pl": "3PL presence", owned_warehouse: "Owned non-EU warehouse" };

  const num = (v, d = 0) => { if (v === null || v === undefined || v === "") return d; const f = Number(v); return Number.isFinite(f) ? f : d; };
  const blank = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) ||
    ["", "nan", "None", "<NA>"].includes(String(v).trim());
  const str = v => (v === null || v === undefined ? "" : String(v));

  // ------------------------------------------------------------------ data access
  function makeData(raw) {
    const P = raw.params;
    const d = Object.assign({}, raw);
    d.regionFor = c => (c ? raw.country_region[c] || "Other" : "Other");
    d.g = name => {
      const r = P.general.find(x => x.parameter === name);
      return r ? [num(r.value), str(r.source || PLACEHOLDER)] : [0, PLACEHOLDER];
    };
    d.scenario = key => Object.assign({}, P.scenarios.find(x => x.scenario === key) || {});
    d.duty = c => P.duties.find(x => x.country === c) || null;
    d.lead = (step, country) => {
      if (country) { const r = P.lead_times.find(x => x.step === `${step}:${country}`); if (r) return [num(r.days), str(r.source)]; }
      const r = P.lead_times.find(x => x.step === step);
      return r ? [num(r.days), str(r.source)] : [0, PLACEHOLDER];
    };
    d.freightOption = (leg, dest, preferPort, preferMode) => {
      let f = P.freight.filter(x => (preferMode === "air" ? x.mode === "air" : x.mode !== "air"));
      let rows = f.filter(x => x.leg === leg && x.dest_country === dest);
      if (!rows.length) rows = f.filter(x => x.leg === leg && x.dest_country === "*");
      if (!rows.length) return null;
      if (preferPort) {
        const key = String(preferPort).toLowerCase();
        const hit = rows.filter(x => { const p = str(x.port_or_border).toLowerCase(); return !!p && (p.includes(key) || key.includes(p.split(" ")[0])); });
        if (hit.length) rows = hit;
      }
      if (preferMode && rows.some(x => x.mode === preferMode)) rows = rows.filter(x => x.mode === preferMode);
      return rows.map((x, i) => [x, i]).sort((a, b) => num(a[0].eur_per_pallet) - num(b[0].eur_per_pallet) || a[1] - b[1])[0][0];
    };
    d.complianceRows = c => P.compliance.filter(x => x.country === c);
    d.ownedFixed = c => P.owned_fixed.find(x => x.location === c) || null;
    return d;
  }

  // ------------------------------------------------------------------ route object
  function newRoute(fields) {
    return Object.assign({ steps: [], issues: [], warnings: [], lane_status: "unproven", lane_basis: "",
                           vat_eur: 0, min_order_value_eur: 0, risk_premium_pct: 0 }, fields);
  }
  const step = (o) => Object.assign({ cost_eur: 0, days: 0, paid_by: FLEXITOG, party: "", customs: false,
                                      doc_steps: 0, source: PLACEHOLDER, note: "" }, o);
  const M = {
    key: r => r.dc_id || r.scenario,
    label: r => (r.dc_id ? `${LABELS[r.scenario]} | ${r.dc_name}` : LABELS[r.scenario]),
    feasible: r => r.issues.length === 0,
    belowMov: r => r.order_value_eur < r.min_order_value_eur,
    cost: r => r.steps.reduce((a, s) => a + s.cost_eur, 0),
    lead: r => r.steps.reduce((a, s) => a + s.days, 0),
    score: r => M.cost(r) * (1 + r.risk_premium_pct / 100),
    paid: (r, who) => r.steps.reduce((a, s) => a + (s.paid_by === who ? s.cost_eur : 0), 0),
    customs: r => r.steps.filter(s => s.customs).length,
    parties: r => { const out = []; r.steps.forEach(s => { if (s.party && !out.includes(s.party)) out.push(s.party); }); return out; },
    handoffs: r => Math.max(0, M.parties(r).length - 1),
    docSteps: r => r.steps.reduce((a, s) => a + s.doc_steps, 0),
    customerSteps: r => r.steps.filter(s => s.paid_by === CUSTOMER && s.category !== "margin" && s.category !== "receipt").length,
    customerPaperworkSteps: r => r.steps.filter(s => s.paid_by === CUSTOMER && PAPERWORK.has(s.category)).length,
    paperwork: (r, who) => r.steps.reduce((a, s) => a + (s.paid_by === who && PAPERWORK.has(s.category) ? (s.customs ? 1 : 0) + s.doc_steps : 0), 0),
    placeholderShare: r => { const t = M.cost(r); return t ? r.steps.reduce((a, s) => a + (s.source === PLACEHOLDER ? s.cost_eur : 0), 0) / t : 1; },
    byCategory: r => { const o = {}; r.steps.forEach(s => { o[s.category] = (o[s.category] || 0) + s.cost_eur; }); return o; },
  };

  // ------------------------------------------------------------------ order context
  function orderContext(order, lines, data) {
    const issues = [];
    const customer = data.customers.find(c => str(c.customer_id) === str(order.customer_id)) || null;
    if (!customer) issues.push(`Customer '${order.customer_id}' not found`);
    const country = customer ? str(customer.country) : "";
    const prod = {}; data.products.forEach(p => { prod[p.sku] = p; });
    const ol = lines.map(l => {
      const p = prod[l.sku] || {};
      const qty = num(l.quantity);
      const price = p.unit_price_eur;
      return { sku: str(l.sku), quantity: qty, price: blank(price) ? null : num(price),
               eu: data.eu27.includes(str(p.country_of_origin).toUpperCase()),
               cert: !!p.requires_conformity_cert };
    });
    const unknown = ol.filter(l => l.price === null).map(l => l.sku);
    if (unknown.length) issues.push(`Unknown SKU or missing price: ${unknown.join(", ")}`);
    ol.forEach(l => { l.value = l.quantity * (l.price === null ? 0 : l.price); });
    const pallets = num(order.pallet_count);
    if (pallets <= 0) issues.push("Pallet count missing");
    let supplier = null;
    if (!blank(order.supplier_id)) supplier = data.suppliers.find(s => str(s.supplier_id) === str(order.supplier_id)) || null;
    return { order, customer: customer || {}, country, lines: ol,
             value: ol.reduce((a, l) => a + l.value, 0), units: ol.reduce((a, l) => a + l.quantity, 0),
             pallets, certSkus: ol.filter(l => l.cert).map(l => l.sku), skus: ol.map(l => l.sku), supplier, issues };
  }

  // ------------------------------------------------------------------ lanes
  function laneStatus(data, origins, dests, viaDc, country) {
    let best = "unproven", basis = "no lane record";
    const O = new Set([...origins].map(o => o.toUpperCase()));
    const D = new Set([...dests].filter(Boolean).map(x => x.toUpperCase()));
    data.lanes.forEach(r => {
      if (!O.has(str(r.origin_id).toUpperCase()) || !D.has(str(r.destination_id).toUpperCase())) return;
      const st = LANE_RANK[str(r.status)] !== undefined ? str(r.status) : "unproven";
      if (basis === "no lane record" || LANE_RANK[st] < LANE_RANK[best]) { best = st; basis = `lane ${r.lane_id}`; }
    });
    const n = viaDc ? (data.history.via[viaDc.toUpperCase()] || 0) : (data.history.direct[country] || 0);
    const [threshold] = data.g("proven_lane_min_orders_12m");
    const derived = n >= threshold ? "proven" : n >= 1 ? "occasional" : null;
    if (derived && LANE_RANK[derived] < LANE_RANK[best]) { best = derived; basis = `${n} order(s) in sales history, last 12 months`; }
    return [best, basis];
  }

  // ------------------------------------------------------------------ building blocks
  function dutyRate(ctx, duty) {
    if (!duty || !ctx.value) return [0, false];
    const eu = num(duty.duty_pct_eu_origin), std = num(duty.duty_pct_standard);
    const rate = ctx.lines.reduce((a, l) => a + l.value * (l.eu ? eu : std), 0) / ctx.value;
    const usesPref = ctx.lines.some(l => l.eu) && str(duty.preference_document || "none") !== "none";
    return [rate, usesPref];
  }

  function compliance(data, ctx, country, alloc, paidBy, party) {
    const steps = []; let lead = 0;
    let [spy] = data.g("shipments_per_year_per_country"); const [years] = data.g("one_off_amortisation_years");
    spy = spy || 1;
    data.complianceRows(country).forEach(r => {
      const certs = str(r.applies_to) === "cert_skus";
      if (certs && !ctx.certSkus.length) return;
      const cost = num(r.cost_eur), basis = str(r.basis);
      const nSkus = new Set(certs ? ctx.certSkus : ctx.skus).size;
      let amount, note;
      if (basis === "per_shipment") { amount = cost * alloc; note = "per shipment" + (alloc < 1 ? `, ${Math.round(alloc * 100)}% allocated` : ""); }
      else if (basis === "per_sku_year") { amount = cost * nSkus / spy; note = `${nSkus} SKU(s) x EUR ${cost}/yr over ${spy} shipments`; }
      else if (basis === "one_off") { amount = cost / (Math.max(years, 1) * spy); note = `one-off EUR ${cost} over ${years} yr`; }
      else { amount = cost; note = basis; }
      steps.push(step({ step: `${r.item} (${country})`, category: "compliance", cost_eur: amount, paid_by: paidBy, party,
                        doc_steps: Math.trunc(num(r.doc_steps)), source: str(r.source), note }));
      if (basis === "per_shipment") lead = Math.max(lead, num(r.lead_days));
    });
    return [steps, lead];
  }

  function importBlock(data, ctx, route, country, customsValue, alloc, paidBy, brokerParty, countDays) {
    let duty = data.duty(country);
    if (!duty) { route.warnings.push(`No duty data for ${country}. Duty taken as 0`); duty = {}; }
    const [rate, usesPref] = dutyRate(ctx, Object.keys(duty).length ? duty : null);
    const src = str(duty.source || PLACEHOLDER);
    const [clearDays] = data.lead("import_clearance", country);
    route.steps.push(step({ step: `Import clearance ${country}`, category: "clearance",
      cost_eur: num(duty.clearance_broker_eur) * alloc, days: countDays ? clearDays : 0, paid_by: paidBy,
      party: brokerParty, customs: true, doc_steps: 1 + (usesPref ? 1 : 0), source: src,
      note: usesPref ? "preference proof: " + str(duty.preference_document) : "" }));
    const dutyAmt = customsValue * rate / 100;
    route.steps.push(step({ step: `Import duty ${country} (${rate.toFixed(1)}% weighted)`, category: "duty", cost_eur: dutyAmt,
      paid_by: paidBy, party: brokerParty, source: src, note: usesPref ? "EU-origin lines at preferential rate" : "" }));
    const fees = customsValue * num(duty.other_fees_pct) / 100;
    if (fees) route.steps.push(step({ step: `Other import levies ${country}`, category: "import_fees", cost_eur: fees,
      paid_by: paidBy, party: brokerParty, source: src }));
    route.vat_eur += (customsValue + dutyAmt + fees) * num(duty.vat_pct) / 100;
    const [comp, lead] = compliance(data, ctx, country, alloc, paidBy, brokerParty);
    route.steps.push(...comp);
    return lead;
  }

  // ------------------------------------------------------------------ route builder
  function buildRoute(ctx, data, scenario, dc) {
    let sc = data.scenario(scenario);
    let scSrc = str(sc.source || PLACEHOLDER);
    if (dc) {
      const ov = {}; DC_OVERRIDES.forEach(k => { if (!blank(dc[k])) ov[k] = dc[k]; });
      if (Object.keys(ov).length) { sc = Object.assign(sc, ov); scSrc = str(dc.data_source) === PLACEHOLDER ? PLACEHOLDER : REAL; }
    }
    const stocked = STOCKED.has(scenario);
    const country = ctx.country;
    const nodeCountry = dc ? str(dc.country) : country;
    const cross = stocked && nodeCountry !== country;
    const route = newRoute({ scenario, dc_id: dc ? dc.dc_id : null, dc_name: dc ? str(dc.name) : "Destination port",
      dc_status: dc ? str(dc.status || "") : "existing", dc_country: nodeCountry, customer_country: country,
      customer_id: str(ctx.customer.customer_id || ""),
      order_value_eur: ctx.value, units: ctx.units, pallets: ctx.pallets });
    route.issues.push(...ctx.issues);
    const Pal = ctx.pallets, V = ctx.value;
    const replen = num(sc.replenishment_pallets_per_shipment);
    const alloc = stocked && replen > 0 ? Math.min(1, Pal / replen) : 1;
    const factor = stocked ? num(sc.replenishment_freight_factor, 1) : 1;
    const nodeParty = dc ? str(dc.name) : "";
    let importPayer, brokerParty;
    if (scenario === "cif_baseline") { importPayer = CUSTOMER; brokerParty = "Customer's customs broker"; }
    else if (scenario === "distributor") { importPayer = PARTNER; brokerParty = nodeParty; }
    else { importPayer = FLEXITOG; brokerParty = "FlexiTog customs broker"; }
    route.min_order_value_eur = dc && !blank(dc.min_order_value_eur) ? num(dc.min_order_value_eur) : num(sc.min_order_value_eur);

    const origins = new Set(["HLM", "Helmond", ...(ctx.supplier ? [str(ctx.supplier.supplier_id)] : [])]);
    const dests = dc ? new Set([nodeCountry, str(dc.dc_id)])
                     : new Set([country, str(ctx.customer.customer_id || ""), str(ctx.customer.destination_port || "")]);
    [route.lane_status, route.lane_basis] = laneStatus(data, origins, dests, route.dc_id, country);
    let prem = 0;
    if (route.lane_status === "occasional" || route.lane_status === "unproven") prem += data.g(`risk_premium_lane_${route.lane_status}_pct`)[0];
    if (route.dc_status === "potential" || route.dc_status === "candidate") prem += data.g(`risk_premium_dc_${route.dc_status}_pct`)[0];
    route.risk_premium_pct = prem;

    if (ctx.supplier) {
      const f = data.freightOption("inbound", "NL");
      const cost = f ? Math.max(num(f.min_charge_eur), num(f.eur_per_pallet) * Pal) : 0;
      route.steps.push(step({ step: `Inbound ${ctx.supplier.supplier_id} -> Helmond`, category: "freight", cost_eur: cost,
        days: stocked ? 0 : num(ctx.supplier.lead_time_days), party: `Supplier ${ctx.supplier.supplier_id}`,
        source: f ? str(f.source) : PLACEHOLDER, leg: "inbound" }));
    }
    const [h, hsrc] = data.g("helmond_outbound_handling_eur_per_pallet");
    const [procDays] = data.lead("order_processing_helmond");
    route.steps.push(step({ step: "Pick and load at Helmond", category: "handling", cost_eur: h * Pal,
      days: stocked ? 0 : procDays, party: "FlexiTog Helmond", source: hsrc }));
    const [exp, esrc] = data.g("export_docs_eur_per_shipment");
    const [coo] = data.g("certificate_of_origin_eur");
    const [expDays] = data.lead("export_clearance_eu");
    route.steps.push(step({ step: "EU export declaration + CoO", category: "export_docs", cost_eur: (exp + coo) * alloc,
      days: stocked ? 0 : expDays, party: "Forwarder", customs: true, doc_steps: 2, source: esrc }));

    const preferPort = (dc ? dc.port_of_entry : ctx.customer.destination_port) || null;
    const f = data.freightOption("main", nodeCountry, preferPort);
    let freight = 0, transit = 0;
    if (!f) route.issues.push(`No main freight rate to ${nodeCountry}`);
    else {
      const rate = num(f.eur_per_pallet) * factor * Pal;
      freight = stocked ? rate : Math.max(num(f.min_charge_eur), rate);
      transit = num(f.transit_days);
      route.main_leg = { mode: f.mode, port: str(f.port_or_border), country: nodeCountry };
      route.steps.push(step({ step: `Main freight Helmond -> ${f.port_or_border || nodeCountry} (${f.mode})`, category: "freight",
        cost_eur: freight, days: stocked ? 0 : transit, party: "Forwarder", source: str(f.source), leg: "main" }));
    }
    const [insPct, isrc] = data.g("cargo_insurance_pct_of_value");
    const insurance = (V + freight) * insPct / 100;
    route.steps.push(step({ step: "Cargo insurance", category: "insurance", cost_eur: insurance, party: "Forwarder", source: isrc }));
    const cif = V + freight + insurance;

    let compLead = 0;
    if (cross) {
      const [fz, fsrc] = data.g("free_zone_handling_eur_per_pallet");
      route.steps.push(step({ step: `Free-zone entry ${nodeCountry} (duty suspended)`, category: "clearance", cost_eur: fz * Pal,
        party: nodeParty, customs: true, doc_steps: 1, source: fsrc, paid_by: importPayer }));
    } else {
      compLead = importBlock(data, ctx, route, nodeCountry, cif, alloc, importPayer, brokerParty, !stocked);
    }

    if (stocked) {
      const months = num(sc.avg_storage_months);
      route.steps.push(step({ step: "Inbound handling at node", category: "handling", cost_eur: num(sc.inbound_eur_per_pallet) * Pal,
        party: nodeParty, paid_by: importPayer, source: scSrc }));
      route.steps.push(step({ step: `Storage ${months} month(s)`, category: "storage",
        cost_eur: num(sc.storage_eur_per_pallet_month) * Pal * months, party: nodeParty, paid_by: importPayer, source: scSrc }));
      if (scenario === "3pl" || scenario === "owned_warehouse") {
        const [wc, wsrc] = data.g("working_capital_rate_pct");
        route.steps.push(step({ step: "Capital tied up in regional stock", category: "working_capital",
          cost_eur: V * wc / 100 * months / 12, party: nodeParty, source: wsrc }));
      }
      if (scenario === "owned_warehouse") {
        const fx = data.ownedFixed(nodeCountry);
        if (!fx) route.warnings.push(`No fixed cost row for an owned warehouse in ${nodeCountry}`);
        else {
          const perPal = num(fx.fixed_cost_eur_per_year) / Math.max(num(fx.expected_pallets_per_year), 1);
          route.steps.push(step({ step: "Owned warehouse fixed cost share", category: "fixed_cost", cost_eur: perPal * Pal,
            party: nodeParty, source: str(fx.source) }));
        }
      }
      const [pickDays] = data.lead("local_pick_and_dispatch");
      route.steps.push(step({ step: "Pick and dispatch from regional stock", category: "handling",
        cost_eur: num(sc.outbound_eur_per_order), days: pickDays, party: nodeParty, paid_by: importPayer, source: scSrc }));
    }

    if (cross) {
      const group = REGIONAL_GROUP[data.regionFor(country)];
      const rf = group ? data.freightOption("regional", group) : null;
      const [xDays] = data.lead("export_clearance_eu");
      route.steps.push(step({ step: `Free-zone exit / re-export ${nodeCountry}`, category: "clearance", days: xDays,
        party: nodeParty, paid_by: importPayer, customs: true, doc_steps: 1, source: PLACEHOLDER }));
      let regional = 0;
      if (!rf) route.issues.push(`No regional freight rate from ${nodeCountry} to ${country}`);
      else {
        regional = Math.max(num(rf.min_charge_eur), num(rf.eur_per_pallet) * Pal);
        route.regional_leg = { mode: rf.mode, from: nodeCountry, to: country };
        route.steps.push(step({ step: `Regional freight ${nodeCountry} -> ${country} (${rf.mode})`, category: "freight",
          cost_eur: regional, days: num(rf.transit_days), party: "Regional carrier", paid_by: importPayer, source: str(rf.source), leg: "regional" }));
      }
      const crossLead = importBlock(data, ctx, route, country, cif + regional, 1, importPayer, brokerParty, true);
      route.steps.push(step({ step: "Compliance wait (beyond clearance)", category: "compliance",
        days: Math.max(0, crossLead - data.lead("import_clearance", country)[0]), party: brokerParty, paid_by: importPayer }));
    }
    if (!stocked && compLead > transit) {
      route.steps.push(step({ step: "Compliance wait (beyond transit)", category: "compliance", days: compLead - transit,
        party: brokerParty, paid_by: importPayer }));
    }
    const dm = data.freightOption("domestic", country);
    if (!dm) route.warnings.push(`No domestic delivery rate for ${country}`);
    else {
      route.steps.push(step({ step: `Delivery to ${ctx.customer.city || "customer"}`, category: "freight",
        cost_eur: Math.max(num(dm.min_charge_eur), num(dm.eur_per_pallet) * Pal), days: num(dm.transit_days),
        paid_by: scenario === "cif_baseline" ? CUSTOMER : importPayer,
        party: scenario === "cif_baseline" ? "Customer's local carrier" : "Local carrier", source: str(dm.source), leg: "domestic" }));
    }
    if (scenario === "distributor") {
      const m = num(sc.margin_pct);
      route.steps.push(step({ step: `Distributor margin ${m}%`, category: "margin", cost_eur: V * m / 100, paid_by: CUSTOMER,
        party: nodeParty, source: scSrc, note: "paid by the customer through a higher local price" }));
    }
    route.steps.push(step({ step: "Goods received", category: "receipt", party: "Customer", paid_by: CUSTOMER, source: "n/a" }));
    if (M.belowMov(route)) route.warnings.push(`Order value EUR ${Math.round(V)} below minimum EUR ${Math.round(route.min_order_value_eur)}`);
    if (!STUDY_REGIONS.includes(data.regionFor(country))) route.warnings.push(`${country} is outside the three study regions`);
    return route;
  }

  function candidateNodes(data, scenario, country) {
    return data.dcs.filter(dc => dc.dc_type === scenario &&
      (dc.country === country || str(dc.serves_countries).split(";").filter(Boolean).includes(country)));
  }

  function evaluate(order, lines, data, override, includeBaseline) {
    const ctx = orderContext(order, lines, data);
    const routes = [buildRoute(ctx, data, "cif_baseline")];
    const notes = [];
    IN_SCOPE.forEach(s => {
      const nodes = candidateNodes(data, s, ctx.country);
      if (!nodes.length) notes.push(`No ${LABELS[s].toLowerCase()} node serves ${ctx.country || "this country"}`);
      nodes.forEach(dc => routes.push(buildRoute(ctx, data, s, dc)));
    });
    const pool = routes.filter(r => M.feasible(r) && !M.belowMov(r) && (includeBaseline || r.scenario !== "cif_baseline"));
    let rec = null;
    pool.forEach(r => {
      if (!rec) { rec = r; return; }
      const a = [M.score(r), LANE_RANK[r.lane_status] ?? 2], b = [M.score(rec), LANE_RANK[rec.lane_status] ?? 2];
      if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) rec = r;
    });
    let selected = rec;
    const forced = override || (blank(order.dc_override) ? null : str(order.dc_override));
    if (forced) { const m = routes.find(r => M.key(r) === forced); if (m) selected = m; else notes.push(`Forced node '${forced}' does not serve ${ctx.country}`); }
    return { order_id: str(order.order_id), routes, recommended: rec, selected, baseline: routes[0], notes, ctx };
  }

  // ------------------------------------------------------------------ batch
  function bestRoute(routes) {
    if (!routes.length) return null;
    const ok = routes.filter(r => M.feasible(r) && !M.belowMov(r));
    const pool = ok.length ? ok : (routes.filter(M.feasible).length ? routes.filter(M.feasible) : routes);
    return pool.reduce((a, r) => (M.score(r) < M.score(a) ? r : a), pool[0]);
  }

  const HASSLE = {
    customer_first: (r, d) => d.g("hassle_weight_customer_paperwork")[0] * M.customerPaperworkSteps(r) +
                              d.g("hassle_weight_customer_other")[0] * (M.customerSteps(r) - M.customerPaperworkSteps(r)),
    customs_touchpoints: r => M.customs(r), handoffs: r => M.handoffs(r), doc_steps: r => M.docSteps(r),
  };

  function runBatch(orders, lines, data) {
    const byOrder = {}; lines.forEach(l => { (byOrder[l.order_id] = byOrder[l.order_id] || []).push(l); });
    const rows = [];
    orders.forEach(o => {
      const ev = evaluate(o, byOrder[o.order_id] || [], data);
      const region = data.regionFor(ev.baseline.customer_country);
      SCENARIOS.forEach(s => {
        const r = bestRoute(ev.routes.filter(x => x.scenario === s));
        const row = { order_id: o.order_id, region, country: ev.baseline.customer_country, customer_id: o.customer_id,
                      scenario: s, route: r };
        if (!r) Object.assign(row, { node: "", available: false, reason: "no node serves this country" });
        else Object.assign(row, {
          node: r.dc_id || "port", available: M.feasible(r) && !M.belowMov(r),
          reason: r.issues.join("; ") || (M.belowMov(r) ? "below minimum order value" : ""),
          units: r.units, pallets: r.pallets, order_value_eur: r.order_value_eur, cost_to_serve_eur: M.cost(r),
          customer_pays_eur: M.paid(r, CUSTOMER), flexitog_pays_eur: M.paid(r, FLEXITOG), partner_pays_eur: M.paid(r, PARTNER),
          lead_time_days: M.lead(r), lane_status: r.lane_status, customs_touchpoints: M.customs(r), handoffs: M.handoffs(r),
          doc_steps: M.docSteps(r), customer_steps: M.customerSteps(r), customer_paperwork_steps: M.customerPaperworkSteps(r),
          flexitog_paperwork: M.paperwork(r, FLEXITOG), partner_paperwork: M.paperwork(r, PARTNER),
          placeholder_cost_share: M.placeholderShare(r),
          hassle: Object.fromEntries(Object.entries(HASSLE).map(([k, fn]) => [k, fn(r, data)])),
        });
        rows.push(row);
      });
    });
    return rows;
  }

  function aggregate(rows, method) {
    const ok = rows.filter(r => r.available);
    const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
    const mean = (arr, f) => (arr.length ? arr.reduce((a, r) => a + f(r), 0) / arr.length : null);
    const units = sum(ok, "units"), value = sum(ok, "order_value_eur");
    return {
      orders: rows.length, coverage: rows.length ? ok.length / rows.length : 0,
      cost_per_unit_eur: units ? sum(ok, "cost_to_serve_eur") / units : null,
      cost_pct_of_value: value ? 100 * sum(ok, "cost_to_serve_eur") / value : null,
      customer_cost_per_unit_eur: units ? sum(ok, "customer_pays_eur") / units : null,
      flexitog_cost_per_unit_eur: units ? sum(ok, "flexitog_pays_eur") / units : null,
      lead_time_days: mean(ok, r => r.lead_time_days), hassle: mean(ok, r => r.hassle[method]),
      customer_paperwork_steps: mean(ok, r => r.customer_paperwork_steps),
      flexitog_paperwork: mean(ok, r => r.flexitog_paperwork),
      proven_lane_share: mean(ok, r => (r.lane_status === "proven" ? 1 : 0)),
      placeholder_cost_share: mean(ok, r => r.placeholder_cost_share),
      pallets: sum(ok, "pallets"),
    };
  }

  function scorecard(rows, method, keyFn) {
    keyFn = keyFn || (r => r.region);
    const groups = new Map();
    rows.forEach(r => { const k = keyFn(r) + "|" + r.scenario; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    const out = [];
    groups.forEach((g, k) => { const [group, scenario] = k.split("|"); out.push(Object.assign({ group, scenario, scenario_label: LABELS[scenario] }, aggregate(g, method))); });
    return out;
  }

  const api = { makeData, evaluate, runBatch, scorecard, bestRoute, M, LABELS, SCENARIOS, IN_SCOPE, STUDY_REGIONS,
                FLEXITOG, PARTNER, CUSTOMER, PLACEHOLDER, REAL };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FlexEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
