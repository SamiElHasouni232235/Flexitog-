/* FlexiTog RFQ workflow: pure logic, no DOM.
 *
 * The RFQ workbook ("Transport_Volume_Scenario_RFQ_FlexiTog.xlsx") carries a hidden Export sheet:
 * row 1 = key | value | type | description, row 2 = meta.rfq_version, row 3 = meta.export_rows, then one
 * row per key. Each value is a formula whose result Excel (or LibreOffice) caches when the provider saves.
 * This module reads that sheet generically (every row, no fixed key list), converts each value by its
 * type, validates the file, maps the known key prefixes onto a provider record and summarises the
 * response for comparison. It also prefills the Provider Profile cells of the template by patching the
 * sheet XML with JSZip, so charts, images, styles, validation and protection survive byte for byte.
 *
 * Runs in the dashboard (window.FlexiRFQ) and in node (tests/test_rfq.py). SheetJS (XLSX) and JSZip are
 * passed in, so the module has no globals of its own.
 */
(function (root) {
  "use strict";

  const SUPPORTED_VERSIONS = ["RFQ-MENA-TR v1.0"];
  const EXPORT_SHEET = "Export";
  const PROFILE_SHEET = "Provider Profile";
  // Provider Profile defined names written by the prefill, and read back when cached values are missing.
  const PP_FIELDS = [
    ["PP_provider_id", "id", "provider.provider_id"], ["PP_name", "name", "provider.name"], ["PP_website", "website", "provider.website"],
    ["PP_contact_name", "contactName", "provider.contact_name"], ["PP_contact_phone", "contactPhone", "provider.contact_phone"],
    ["PP_contact_email", "contactEmail", "provider.contact_email"],
  ];
  const PP_READ_ONLY = [["PP_hq_country", "provider.hq_country"], ["PP_quote_reference", "provider.quote_reference"],
    ["PP_quote_valid_until", "provider.quote_valid_until"], ["PP_response_date", "provider.response_date"], ["PP_currency", "provider.currency"]];
  // Lanes as the template defines them. Region keys map to the dashboard's region names.
  const LANES = {
    L01: { country: "SA", name: "Saudi Arabia", region: "Gulf/GCC" }, L02: { country: "AE", name: "United Arab Emirates", region: "Gulf/GCC" },
    L03: { country: "KW", name: "Kuwait", region: "Gulf/GCC" }, L04: { country: "QA", name: "Qatar", region: "Gulf/GCC" },
    L05: { country: "TR", name: "Türkiye", region: "Türkiye" }, L06: { country: "MA", name: "Morocco", region: "North Africa" },
    L07: { country: "DZ", name: "Algeria", region: "North Africa" }, L08: { country: "EG", name: "Egypt", region: "North Africa" },
    L09: { country: "TN", name: "Tunisia", region: "North Africa" },
  };
  const REGION_KEYS = { "region.turkiye": "Türkiye", "region.north_africa": "North Africa", "region.gulf_gcc": "Gulf/GCC" };
  // Identity keys in the Export sheet -> provider record fields.
  const IDENTITY = [["provider.name", "name"], ["provider.website", "website"], ["provider.contact_name", "contactName"],
    ["provider.contact_phone", "contactPhone"], ["provider.contact_email", "contactEmail"], ["provider.hq_country", "hqCountry"]];
  const NOT_SERVED = /^(|not served|no|none|n\/a|-)$/i;

  // ================================================================== helpers
  const isBlank = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
  const pad = n => String(n).padStart(2, "0");
  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const xmlUnesc = s => String(s).replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  // A JS Date from SheetJS (cellDates) can sit at local or UTC midnight depending on the reader;
  // adding 12 hours before taking the UTC day gives the calendar day in both cases.
  const dateIso = d => { const t = new Date(d.getTime() + 12 * 3600000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  const serialIso = n => dateIso(new Date(Math.round((n - 25569) * 86400000)));
  function toNumber(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    let s = String(v).trim().replace(/[\s ]/g, "").replace(/[€$£%]/g, "");
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");   // European 1.234,56
    else s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Convert one Export value by its declared type. An empty answer is "".
  //   text -> string; number -> number; percent -> number 0..1 (a value above 1 written as 94 becomes 0.94);
  //   date -> "YYYY-MM-DD" from a JS Date, an Excel serial or ISO text; yesno -> "Yes"|"No"; ypn -> "Yes"|"Partial"|"No".
  function convert(v, type) {
    if (isBlank(v)) return "";
    switch (type) {
      case "number": { const n = toNumber(v); return n === null ? String(v) : n; }
      case "percent": {
        const pctText = typeof v === "string" && v.includes("%");
        let n = toNumber(v); if (n === null) return String(v);
        if (pctText || n > 1.5) n = n / 100;
        return n;
      }
      case "date": {
        if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : dateIso(v);
        if (typeof v === "number") return v > 0 ? serialIso(v) : "";
        const s = String(v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
        if (!m) return /^\d+(\.\d+)?$/.test(s) ? serialIso(Number(s)) : s;
        return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
      }
      case "yesno": case "ypn": {
        const s = String(v).trim().toLowerCase();
        if (["yes", "y", "true", "ja", "1"].includes(s) || v === true) return "Yes";
        if (["no", "n", "false", "nee", "0"].includes(s) || v === false) return "No";
        if (type === "ypn" && ["partial", "partly", "p", "deels"].includes(s)) return "Partial";
        return String(v).trim();
      }
      default: return v instanceof Date ? dateIso(v) : String(v).trim();
    }
  }

  // ================================================================== reading the workbook
  const findSheet = (wb, name) => wb.SheetNames.find(n => n.toLowerCase() === name.toLowerCase());
  // Defined names -> {name: {sheet, cell}} (single cells only).
  function definedNames(wb) {
    const out = {};
    ((wb.Workbook || {}).Names || []).forEach(n => {
      if (n.Sheet != null) return;                                      // sheet-scoped names (filters) are not ours
      const m = String(n.Ref || "").match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)$/);
      if (m) out[n.Name] = { sheet: m[1].replace(/''/g, "'"), cell: m[2] + m[3] };
    });
    return out;
  }
  function cellValue(wb, sheet, addr) {
    const ws = wb.Sheets[sheet]; if (!ws) return undefined;
    const c = ws[addr]; return c ? c.v : undefined;
  }
  // Parse the Export sheet of a workbook read with SheetJS (cellDates: true). Returns every row, the
  // converted values map, and how many formula cells carry no cached result (file not saved after editing).
  function parseWorkbook(wb, XLSX) {
    const exName = findSheet(wb, EXPORT_SHEET);
    if (!exName) throw new Error("This file has no Export sheet. It is not a FlexiTog RFQ.");
    const ws = wb.Sheets[exName];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:D1");
    const head = [0, 1, 2, 3].map(c => String((ws[XLSX.utils.encode_cell({ r: range.s.r, c })] || {}).v || "").trim().toLowerCase());
    if (head[0] !== "key" || head[1] !== "value") throw new Error("The Export sheet has no key / value header in row 1.");
    const rows = [], values = {}, types = {}, labels = {};
    let formulas = 0, uncached = 0;
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = c => ws[XLSX.utils.encode_cell({ r, c })];
      const k = cell(0); if (!k || isBlank(k.v)) continue;
      const key = String(k.v).trim(), vc = cell(1), type = String((cell(2) || {}).v || "text").trim().toLowerCase();
      const raw = vc ? vc.v : undefined, hasF = !!(vc && vc.f);
      if (hasF) { formulas++; if (raw === undefined || raw === null) uncached++; }
      const value = convert(raw, type);
      rows.push({ key, value, type, description: String((cell(3) || {}).v || ""), formula: hasF });
      values[key] = value; types[key] = type; labels[key] = String((cell(3) || {}).v || "");
    }
    const version = String(values["meta.rfq_version"] || "");
    const declared = Number(values["meta.export_rows"]);
    const keyRows = rows.filter(x => !x.key.startsWith("meta.")).length;
    // Identity straight from the Provider Profile cells (defined names), for files without cached values.
    const names = definedNames(wb), profile = {};
    PP_FIELDS.concat(PP_READ_ONLY.map(([n, k]) => [n, null, k])).forEach(([n, , key]) => {
      const d = names[n]; if (!d) return;
      const v = cellValue(wb, d.sheet, d.cell);
      profile[key] = convert(v, types[key] || "text");
    });
    return { version, declaredRows: declared, keyRows, rows, values, types, labels, formulas, uncached, profile,
      sheetNames: wb.SheetNames.slice(), hidden: ((wb.Workbook || {}).Sheets || []).map(s => !!s.Hidden) };
  }
  // A file whose formulas have no cached results was edited without saving in Excel (or produced by a
  // tool that does not calculate). Totals are then unavailable; identity comes from the PP_* cells.
  // Two signals: most formula cells lack a result, or the keys a calculation always fills (the region
  // flags and the count of bands without a rate) are all empty. SheetJS drops formula cells whose cached
  // value is empty, so the second signal catches files the first one misses.
  const ALWAYS_CALCULATED = ["coverage.bands_without_rate", "region.turkiye", "region.north_africa", "region.gulf_gcc"];
  const isUncached = P => (P.formulas > 0 && P.uncached / P.formulas > 0.5) || ALWAYS_CALCULATED.every(k => isBlank(P.values[k]));

  // ================================================================== validation
  // provider: the row the file is uploaded on ({id, name}). Returns errors (stop), warnings (show), and
  // confirm (ask before continuing).
  function validate(P, provider) {
    const errors = [], warnings = [], confirm = [];
    if (!SUPPORTED_VERSIONS.includes(P.version)) errors.push(`RFQ version "${P.version || "missing"}" is not supported (supported: ${SUPPORTED_VERSIONS.join(", ")}).`);
    if (!(P.declaredRows > 0)) errors.push("meta.export_rows is missing in the Export sheet.");
    else if (P.keyRows !== P.declaredRows) errors.push(`The Export sheet has ${P.keyRows} key rows, but meta.export_rows says ${P.declaredRows}. The file may be damaged or from another template.`);
    const v = effectiveValues(P);
    const fid = String(v["provider.provider_id"] || "").trim(), fname = String(v["provider.name"] || "").trim();
    if (provider) {
      if (fid && fid !== provider.id) confirm.push(`The file is for provider ID ${fid}, but you are uploading it on ${provider.id} (${provider.name}).`);
      else if (!fid && fname && norm(fname) !== norm(provider.name)) confirm.push(`The file names the provider "${fname}", but you are uploading it on "${provider.name}".`);
    }
    if (isUncached(P)) warnings.push("The file was not saved in Excel after it was filled in, so its formulas have no results. Identity fields are read from the Provider Profile sheet; totals, costs and the timeline are unavailable until the provider opens and saves the file in Excel.");
    return { ok: !errors.length, errors, warnings, confirm };
  }
  // Values with the identity filled from the Provider Profile cells where the Export cache is empty.
  function effectiveValues(P) {
    const v = Object.assign({}, P.values);
    Object.entries(P.profile || {}).forEach(([k, x]) => { if (isBlank(v[k]) && !isBlank(x)) v[k] = x; });
    return v;
  }

  // ================================================================== summary and comparison
  const num = x => (typeof x === "number" && Number.isFinite(x) ? x : null);
  // Stored with each response: the figures the compare table and the scorecard need first.
  function summarize(values) {
    const v = values || {};
    const evidence = Object.keys(v).filter(k => /^kpi\.[A-Z]+\d+\.evidence$/.test(k));
    const answered = Object.keys(v).filter(k => /^kpi\.[A-Z]+\d+$/.test(k) && !isBlank(v[k]));
    return {
      costA: num(v["cost.A.total"]), costB: num(v["cost.B.total"]), perKgA: num(v["cost.A.per_kg"]), perKgB: num(v["cost.B.per_kg"]),
      onTargetA: num(v["timeline.A.on_target_pct"]), onTargetB: num(v["timeline.B.on_target_pct"]),
      bandsWithoutRate: num(v["coverage.bands_without_rate"]), kpiWithEvidence: evidence.filter(k => v[k] === "Yes").length,
      kpiAnswered: answered.length, kpiTotal: Object.keys(v).filter(k => /^kpi\.[A-Z]+\d+$/.test(k)).length,
      currency: v["provider.currency"] || "", quoteValidUntil: v["provider.quote_valid_until"] || "", responseDate: v["provider.response_date"] || "",
      quoteReference: v["provider.quote_reference"] || "",
    };
  }
  const latest = p => (p && p.rfqResponses && p.rfqResponses.length ? p.rfqResponses[p.latestResponseIndex >= 0 && p.latestResponseIndex < p.rfqResponses.length ? p.latestResponseIndex : p.rfqResponses.length - 1] : null);
  // Comparable metrics of a provider's latest response, for the scorecard. Null without a response.
  // Lane figures and every base KPI answer come along so the scorecard can weigh whatever it needs.
  function getComparableMetrics(provider) {
    const r = latest(provider); if (!r) return null;
    const v = r.values || {}, s = r.summary || summarize(v);
    const lanes = {};
    Object.keys(LANES).forEach(L => {
      lanes[L] = Object.assign({ lane: L }, LANES[L], {
        costA: num(v[`cost.${L}.A`]), costB: num(v[`cost.${L}.B`]), perKgB: num(v[`cost.${L}.B.per_kg`]), transitAvgDays: num(v[`transit.${L}.avg_days`]),
        onTargetA: num(v[`timeline.${L}.A.on_target_pct`]), onTargetB: num(v[`timeline.${L}.B.on_target_pct`]),
        daysLateA: num(v[`timeline.${L}.A.avg_days_late`]), daysLateB: num(v[`timeline.${L}.B.avg_days_late`]),
        presence: v[`coverage.${L}.presence`] || "", ddp: v[`coverage.${L}.ddp`] || "", importBrokerage: v[`coverage.${L}.import_brokerage`] || "",
        serveFromStock: v[`stock.${L}.serve_from_stock`] || "",
      });
    });
    const kpi = {};
    Object.keys(v).filter(k => /^kpi\.[A-Z]+\d+$/.test(k)).forEach(k => {
      const id = k.slice(4);
      kpi[id] = { value: v[k], evidence: v[k + ".evidence"] || "", details: v[k + ".details"] || "" };
    });
    return {
      providerId: provider.id, name: provider.name, rfqVersion: r.rfqVersion, uploadedAt: r.uploadedAt, fileName: r.fileName,
      responseDate: s.responseDate || String(r.uploadedAt || "").slice(0, 10),
      costA: s.costA, costB: s.costB, perKgA: s.perKgA, perKgB: s.perKgB, onTargetA: s.onTargetA, onTargetB: s.onTargetB,
      bandsWithoutRate: s.bandsWithoutRate, kpiWithEvidence: s.kpiWithEvidence, kpiAnswered: s.kpiAnswered,
      r1OnTime: num(v["kpi.R1"]), q1Damage: num(v["kpi.Q1"]), h2Parties: num(v["kpi.H2"]),
      stockCostA: num(v["stock.A.total_cost"]), stockCostB: num(v["stock.B.total_cost"]),
      regions: (provider.regionsCovered || []).slice(), types: (provider.providerTypes || []).slice(),
      currency: s.currency, quoteValidUntil: s.quoteValidUntil, lanes, kpi,
    };
  }

  // ================================================================== mapping onto the provider record
  const union = (a, b) => { const out = (a || []).slice(); (b || []).forEach(x => { if (!out.includes(x)) out.push(x); }); return out; };
  // Returns what the file changes, without touching the provider:
  //   fill: identity fields that are empty on the record and filled in the file (taken automatically)
  //   conflicts: identity fields where record and file differ (the user picks "keep mine" or "use file")
  //   add: values added to providerTypes, servicesOffered, regionsCovered, countriesCovered (union, never removed)
  //   status / dateResponseReceived, and the response entry to append.
  // opts: {fileName, uploadedAt (ISO), today ("YYYY-MM-DD"), countryOf(name) -> ISO code for hqCountry}
  function mapResponse(provider, P, opts) {
    const o = opts || {}, v = effectiveValues(P), labels = P.labels || {};
    const fill = {}, conflicts = [];
    IDENTITY.forEach(([key, field]) => {
      let fv = v[key];
      if (isBlank(fv)) return;
      fv = String(fv).trim();
      if (field === "hqCountry" && o.countryOf) fv = o.countryOf(fv) || fv;
      const mine = isBlank(provider[field]) ? "" : String(provider[field]).trim();
      if (!mine) fill[field] = fv;
      else if (field === "website" ? norm(mine.replace(/^https?:\/\//i, "")) !== norm(fv.replace(/^https?:\/\//i, "")) : field === "contactEmail" ? mine.toLowerCase() !== fv.toLowerCase() : mine !== fv)
        conflicts.push({ field, key, mine, file: fv });
    });
    // Yes on a type.* / service.* key adds the key's description (its display label).
    const yes = prefix => Object.keys(v).filter(k => k.startsWith(prefix) && v[k] === "Yes").map(k => labels[k] || k.slice(prefix.length));
    const types = yes("type."), services = yes("service.");
    const regions = Object.entries(REGION_KEYS).filter(([k]) => v[k] === "Yes").map(([, r]) => r);
    // Countries: a lane with any presence other than "Not served" adds its country.
    const countries = Object.entries(LANES).filter(([L]) => !NOT_SERVED.test(String(v[`coverage.${L}.presence`] || "").trim())).map(([, l]) => l.country);
    const add = {
      providerTypes: types.filter(x => !(provider.providerTypes || []).includes(x)),
      servicesOffered: services.filter(x => !(provider.servicesOffered || []).includes(x)),
      regionsCovered: regions.filter(x => !(provider.regionsCovered || []).includes(x)),
      countriesCovered: countries.filter(x => !(provider.countriesCovered || []).includes(x)),
    };
    const uploadedAt = o.uploadedAt || new Date().toISOString();
    const responseDate = isBlank(v["provider.response_date"]) ? (o.today || uploadedAt.slice(0, 10)) : String(v["provider.response_date"]);
    // Questions and answer types of the KPI and certification keys travel with the response, so the
    // detail panel shows them without the original file.
    const keep = k => /^(kpi\.[A-Z]+\d+$|cert\.)/.test(k);
    const pick = m => Object.fromEntries(Object.entries(m || {}).filter(([k]) => keep(k)));
    const entry = { uploadedAt, fileName: o.fileName || "", rfqVersion: P.version, values: v, summary: summarize(v),
      labels: pick(P.labels), types: pick(P.types), uncached: isUncached(P), fileId: o.fileId || "" };
    return { fill, conflicts, add, status: "response_received", dateResponseReceived: responseDate, entry };
  }
  // Apply a mapping. choices: {field: "file"|"mine"} for conflicts (default "mine"). Returns a new record
  // and a list of plain-language changes. Lists only grow; history keeps every earlier response.
  function applyResponse(provider, M, choices) {
    const p = JSON.parse(JSON.stringify(provider)), changes = [];
    Object.entries(M.fill).forEach(([f, v]) => { p[f] = v; changes.push(`${f} filled`); });
    M.conflicts.forEach(c => { if ((choices || {})[c.field] === "file") { p[c.field] = c.file; changes.push(`${c.field} taken from the file`); } });
    const WORDS = { providerTypes: ["type", "types"], servicesOffered: ["service", "services"], regionsCovered: ["region", "regions"], countriesCovered: ["country", "countries"] };
    Object.entries(M.add).forEach(([f, list]) => { if (list.length) { p[f] = union(p[f], list); changes.push(`${list.length} ${WORDS[f][list.length > 1 ? 1 : 0]} added`); } });
    if (p.status !== M.status) changes.push(`status ${p.status || "none"} → ${M.status}`);
    p.status = M.status; p.dateResponseReceived = M.dateResponseReceived;
    p.rfqResponses = (p.rfqResponses || []).concat([M.entry]);
    p.latestResponseIndex = p.rfqResponses.length - 1;
    changes.push(`response ${p.rfqResponses.length} stored`);
    return { provider: p, changes };
  }

  // ================================================================== tables for the detail panel
  function detail(values, labels) {
    const v = values || {}, L = Object.keys(LANES);
    const bands = [...new Set(Object.keys(v).map(k => (k.match(/^rate\.L\d+\.(B\d+)\./) || [])[1]).filter(Boolean))].sort();
    return {
      coverage: L.map(l => ({ lane: l, country: LANES[l].name, region: LANES[l].region, presence: v[`coverage.${l}.presence`] ?? "",
        partner: v[`coverage.${l}.partner`] ?? "", importBrokerage: v[`coverage.${l}.import_brokerage`] ?? "", ddp: v[`coverage.${l}.ddp`] ?? "" })),
      rates: L.flatMap(l => bands.map(b => {
        const g = f => v[`rate.${l}.${b}.${f}`];
        return { lane: l, country: LANES[l].name, band: b, mode: g("mode") ?? "", transit: g("transit_days"), worst: g("transit_worst_days"), perKg: g("rate_per_kg"),
          minCharge: g("min_charge"), fuel: g("fuel_pct"), docs: g("docs_fee"), other: g("other_fee"), discountB: g("discount_B_pct"), perShipment: g("cost_per_shipment") };
      })),
      costs: ["A", "B"].map(s => ({ scenario: s, allFromHelmond: v[`cost.${s}.all_from_helmond`], directFromHelmond: v[`cost.${s}.direct_from_helmond`],
        otherOrigins: v[`cost.${s}.other_origins`], total: v[`cost.${s}.total`], perKg: v[`cost.${s}.per_kg`] })),
      laneCosts: L.map(l => ({ lane: l, country: LANES[l].name, A: v[`cost.${l}.A`], B: v[`cost.${l}.B`], perKgB: v[`cost.${l}.B.per_kg`], transit: v[`transit.${l}.avg_days`] })),
      timeline: L.map(l => ({ lane: l, country: LANES[l].name, onA: v[`timeline.${l}.A.on_target_pct`], lateA: v[`timeline.${l}.A.avg_days_late`],
        onB: v[`timeline.${l}.B.on_target_pct`], lateB: v[`timeline.${l}.B.avg_days_late`] })),
      timelineTotal: { A: v["timeline.A.on_target_pct"], B: v["timeline.B.on_target_pct"] },
      kpi: Object.keys(v).filter(k => /^kpi\.[A-Z]+\d+$/.test(k)).map(k => ({ id: k.slice(4), question: (labels || {})[k] || "", answer: v[k],
        details: v[k + ".details"] ?? "", evidence: v[k + ".evidence"] ?? "" })),
      certs: Object.keys(v).filter(k => k.startsWith("cert.")).map(k => ({ key: k, label: (labels || {})[k] || k.slice(5), value: v[k] })),
      stock: { lanes: L.map(l => ({ lane: l, country: LANES[l].name, serve: v[`stock.${l}.serve_from_stock`] ?? "", transit: v[`stock.${l}.transit_days`] })),
        warehouses: [1, 2, 3].map(i => v[`stock.W${i}.location`] ?? "").filter(x => !isBlank(x)), A: v["stock.A.total_cost"], B: v["stock.B.total_cost"] },
      bands,
    };
  }
  // Keys no part of the mapping, summary or detail tables reads (stored, not shown).
  const KNOWN = [/^meta\./, /^provider\./, /^type\./, /^service\./, /^region\./, /^coverage\./, /^cert\./, /^kpi\./, /^rate\.L\d+\.B\d+\./,
    /^cost\./, /^transit\.L\d+\./, /^timeline\./, /^stock\./];
  const unmappedKeys = values => Object.keys(values || {}).filter(k => !KNOWN.some(re => re.test(k)));

  // ================================================================== template: version and prefill
  // Template version and date, from a workbook read with SheetJS.
  function templateInfo(wb, XLSX) {
    const P = parseWorkbook(wb, XLSX), props = wb.Props || {};
    const d = props.ModifiedDate || props.CreatedDate;
    return { version: P.version, date: d instanceof Date ? dateIso(d) : d ? String(d).slice(0, 10) : "", rows: P.declaredRows };
  }
  const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? xmlUnesc(m[1]) : null; };
  const colNum = ref => ref.replace(/\d+/g, "").split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  // Where the Provider Profile cells are: defined name -> sheet -> r:id -> part path, read from
  // workbook.xml and its rels (targets may be absolute "/xl/..." or relative "worksheets/...").
  async function locateProfile(zip) {
    const wbXml = await zip.file("xl/workbook.xml").async("string");
    const names = {};
    (wbXml.match(/<definedName\b[^>]*>[^<]*<\/definedName>/g) || []).forEach(t => {
      const n = attr(t, "name"); if (!n || !/^PP_/.test(n) || attr(t, "localSheetId") !== null) return;
      const ref = xmlUnesc(t.replace(/^<definedName\b[^>]*>/, "").replace(/<\/definedName>$/, ""));
      const m = ref.match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)$/); if (m) names[n] = { sheet: m[1].replace(/''/g, "'"), cell: m[2] + m[3] };
    });
    const sheets = {};
    (wbXml.match(/<sheet\b[^>]*\/?>/g) || []).forEach(t => { sheets[attr(t, "name")] = attr(t, "r:id"); });
    const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string"), targets = {};
    (rels.match(/<Relationship\b[^>]*\/?>/g) || []).forEach(t => { targets[attr(t, "Id")] = attr(t, "Target"); });
    const part = sheetName => {
      const t = targets[sheets[sheetName]]; if (!t) return null;
      return t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
    };
    return { wbXml, names, part };
  }
  // Write one cell as an inline string, keeping its style. Creates the row or cell when missing.
  function setInlineCell(xml, ref, text) {
    const cellXml = s => `<c r="${ref}"${s !== null ? ` s="${s}"` : ""} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
    const re = new RegExp(`<c\\s+r="${ref}"(?=[\\s>/])[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    const m = xml.match(re);
    if (m) return xml.replace(re, cellXml(attr(m[0].match(/^<c\b[^>]*>/)[0], "s")));
    const rowN = ref.replace(/[A-Z]+/g, ""), rowRe = new RegExp(`<row\\b[^>]*\\sr="${rowN}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
    const rm = xml.match(rowRe);
    if (rm) {
      const row = rm[0];
      if (row.endsWith("/>")) return xml.replace(rowRe, row.replace(/\/>$/, `>${cellXml(null)}</row>`));
      const cells = row.match(/<c\s+r="([A-Z]+)\d+"/g) || [];
      const after = cells.find(c => colNum(c.match(/r="([A-Z]+)/)[1]) > colNum(ref));
      const out = after ? row.replace(after, cellXml(null) + after) : row.replace(/<\/row>$/, cellXml(null) + "</row>");
      return xml.replace(rowRe, out);
    }
    // No row: insert before the first row with a higher number, or at the end of sheetData.
    const rowsAll = xml.match(/<row\b[^>]*\sr="(\d+)"/g) || [];
    const next = rowsAll.find(t => Number(t.match(/r="(\d+)"/)[1]) > Number(rowN));
    const newRow = `<row r="${rowN}">${cellXml(null)}</row>`;
    if (next) return xml.replace(next, newRow + next);
    return xml.replace(/<sheetData\s*\/>/, `<sheetData>${newRow}</sheetData>`).replace(/<\/sheetData>/, newRow + "</sheetData>");
  }
  // Prefill the Provider Profile cells (PP_*) of the template for one provider. Only the sheet XML that
  // holds those cells changes; workbook.xml changes only when it lacks fullCalcOnLoad (so Excel
  // recalculates the Export formulas on open). Returns the new file as a Uint8Array.
  async function prefill(bytes, provider, JSZip) {
    const zip = await JSZip.loadAsync(bytes, { createFolders: false });   // no extra folder entries in the output
    const L = await locateProfile(zip);
    const writes = PP_FIELDS.map(([n, field]) => [n, provider[field]]).filter(([n, v]) => L.names[n] && !isBlank(v));
    const bySheet = {};
    writes.forEach(([n, v]) => { const d = L.names[n]; (bySheet[d.sheet] = bySheet[d.sheet] || []).push([d.cell, String(v)]); });
    if (!Object.keys(bySheet).length && !Object.keys(L.names).length) throw new Error("The template has no PP_* defined names on the Provider Profile sheet.");
    for (const [sheet, cells] of Object.entries(bySheet)) {
      const path = L.part(sheet); if (!path || !zip.file(path)) throw new Error(`Sheet "${sheet}" not found in the template.`);
      let xml = await zip.file(path).async("string");
      cells.forEach(([ref, v]) => { xml = setInlineCell(xml, ref, v); });
      zip.file(path, xml, { createFolders: false });
    }
    if (!/fullCalcOnLoad="(1|true)"/.test(L.wbXml)) {
      const wbXml = /<calcPr\b/.test(L.wbXml) ? L.wbXml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"') : L.wbXml.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
      zip.file("xl/workbook.xml", wbXml, { createFolders: false });
    }
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const fileName = (provider, today) => `FlexiTog_RFQ_${String(provider.name || "provider").normalize("NFKD").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "provider"}_${today}.xlsx`;

  const api = { SUPPORTED_VERSIONS, LANES, REGION_KEYS, PP_FIELDS, IDENTITY, convert, definedNames, parseWorkbook, isUncached, validate,
    effectiveValues, summarize, latest, getComparableMetrics, mapResponse, applyResponse, detail, unmappedKeys, templateInfo, locateProfile,
    setInlineCell, prefill, fileName };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FlexiRFQ = api;
})(typeof window !== "undefined" ? window : globalThis);
