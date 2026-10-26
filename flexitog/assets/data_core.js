/* FlexiTog data templates: one fixed upload template per data type, strict validation, mapping onto the Master
 * Data tables, provenance and coverage. No DOM. Browser: window.FlexiData. Node: module.exports (tests).
 *
 * A template column has: name (the header), field (the Master Data column), type (text, number, int, date, bool,
 * enum, country, countries), required, allowed (enum), min / max, unit, desc, example. Every template ends with the
 * provenance columns source, sourceDate and status. Blank source = the file name, blank sourceDate = upload date,
 * blank status = estimate.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FlexiData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PROVENANCE = [
    {name: "source", field: "source_ref", type: "text", desc: "Where the values come from: document, quote, person. Blank = the file name"},
    {name: "sourceDate", field: "source_date", type: "date", desc: "Date of the source (YYYY-MM-DD). Blank = upload date"},
    {name: "status", field: "data_status", type: "enum", allowed: ["confirmed", "estimate"], desc: "confirmed or estimate. Blank = estimate"},
  ];
  const PCT = {type: "number", min: 0, max: 100, unit: "%"};

  // The ten data types. table = Master Data table, rows = which rows of that table belong to the type.
  const TEMPLATES = {
    suppliers: {label: "Suppliers", table: "suppliers", columns: [
      {name: "supplierId", field: "supplier_id", type: "text", required: true, desc: "Unique supplier code", example: "SUP-AL-01"},
      {name: "name", field: "name", type: "text", required: true, example: "Tirana Garments"},
      {name: "country", field: "country", type: "country", required: true, desc: "ISO2 code or country name", example: "AL"},
    ]},
    products: {label: "Products", table: "products", columns: [
      {name: "category", field: "category", type: "enum", required: true, allowed: ["Jackets", "Trousers", "Coveralls", "Other"], example: "Jackets"},
      {name: "brand", field: "brand", type: "text", example: "FlexiTog"},
      {name: "sku", field: "sku", type: "text", required: true, desc: "Unique article code", example: "FT-JKT-100"},
      {name: "weightKg", field: "unit_weight_kg", type: "number", required: true, min: 0.01, max: 50, unit: "kg", desc: "Gross weight per garment", example: 2.1},
      {name: "cartonLcm", field: "carton_l_cm", type: "number", required: true, min: 1, max: 300, unit: "cm", example: 60},
      {name: "cartonWcm", field: "carton_w_cm", type: "number", required: true, min: 1, max: 300, unit: "cm", example: 40},
      {name: "cartonHcm", field: "carton_h_cm", type: "number", required: true, min: 1, max: 300, unit: "cm", example: 40},
      {name: "unitsPerCarton", field: "units_per_carton", type: "int", required: true, min: 1, max: 10000, example: 8},
      {name: "exwPriceEUR", field: "unit_price_eur", type: "number", required: true, min: 0, max: 100000, unit: "EUR", desc: "EXW price per garment", example: 139},
      {name: "hsCode", field: "hs_code", type: "text", desc: "Customs tariff code", example: "6201.40"},
    ]},
    customers: {label: "Customers", table: "customers", columns: [
      {name: "customerId", field: "customer_id", type: "text", required: true, example: "C-MA-01"},
      {name: "name", field: "name", type: "text", required: true, example: "Cold store Agadir"},
      {name: "country", field: "country", type: "country", required: true, example: "MA"},
      {name: "segment", field: "segment", type: "text", example: "Fish processing"},
    ]},
    logisticsProviders: {label: "Logistics providers", table: "distribution_centers", rows: r => ["3pl", "freight_forwarder"].includes(r.dc_type), columns: [
      {name: "providerId", field: "dc_id", type: "text", desc: "Optional. Blank = matched by name, else a new PRV code", example: "PRV-0001"},
      {name: "name", field: "name", type: "text", required: true, example: "Example Forwarding Co."},
      {name: "type", field: "_type", type: "enum", required: true, allowed: ["forwarder", "3PL"], example: "forwarder"},
      {name: "country", field: "country", type: "country", desc: "Optional. Where a 3PL holds stock", example: "NL"},
      {name: "customsBrokerage", field: "customs_brokerage", type: "bool", required: true, example: "true"},
      {name: "freeZone", field: "free_zone", type: "bool", required: true, example: "false"},
      {name: "warehousing", field: "warehousing", type: "bool", required: true, example: "false"},
      {name: "complianceSupport", field: "compliance_support", type: "bool", required: true, example: "true"},
      {name: "handoffsPerShipment", field: "handoffs_per_shipment", type: "int", required: true, min: 0, max: 50, example: 4},
      {name: "documentsPerShipment", field: "documents_per_shipment", type: "int", required: true, min: 0, max: 100, example: 5},
    ]},
    lanes: {label: "Lanes", table: "lanes", columns: [
      {name: "laneId", field: "lane_id", type: "text", desc: "Optional. Blank = L-<origin>-<destination>-<mode>", example: "L-HLM-MA"},
      {name: "origin", field: "origin_id", type: "text", required: true, desc: "HLM for Helmond, a supplier or provider id, or a country", example: "HLM"},
      {name: "destinationCountry", field: "destination_id", type: "country", required: true, example: "MA"},
      {name: "mode", field: "mode", type: "enum", required: true, allowed: ["road", "sea", "air", "express"], example: "road"},
    ]},
    quotes: {label: "Quotes", table: "quotes", columns: [
      {name: "quoteId", field: "quote_id", type: "text", desc: "Optional. Blank = next Q code", example: "Q-0001"},
      {name: "provider", field: "provider_id", type: "text", required: true, desc: "Provider name or providerId from Logistics providers", example: "Example Forwarding Co."},
      {name: "laneId", field: "lane_id", type: "text", required: true, desc: "laneId from Lanes", example: "L-HLM-MA"},
      {name: "quoteDate", field: "quote_date", type: "date", required: true, example: "2026-10-01"},
      {name: "validUntil", field: "valid_until", type: "date", desc: "Blank = no end date", example: "2027-03-31"},
      {name: "baseRate", field: "base_rate", type: "number", required: true, min: 0, max: 1e6, unit: "currency", desc: "Rate per rate unit", example: 0.55},
      {name: "rateUnit", field: "rate_unit", type: "enum", required: true, allowed: ["per kg", "per m3", "per shipment"], example: "per kg"},
      {name: "fuelSurcharge", field: "fuel_surcharge", type: "number", min: 0, max: 1e6, unit: "currency", desc: "Per shipment. Blank = 0", example: 45},
      {name: "peakSurcharge", field: "peak_surcharge", type: "number", min: 0, max: 1e6, unit: "currency", desc: "Per shipment. Blank = 0", example: 0},
      {name: "warRiskSurcharge", field: "war_risk_surcharge", type: "number", min: 0, max: 1e6, unit: "currency", desc: "Per shipment. Blank = 0", example: 0},
      {name: "currency", field: "currency", type: "enum", required: true, allowed: ["EUR", "USD"], example: "EUR"},
      {name: "transitDaysDoorToDoor", field: "transit_days", type: "number", required: true, min: 0.1, max: 365, unit: "days", example: 7},
      {name: "minCharge", field: "min_charge", type: "number", min: 0, max: 1e6, unit: "currency", desc: "Optional minimum freight per shipment", example: 250},
      {name: "otherSurcharge", field: "other_surcharge", type: "number", min: 0, max: 1e6, unit: "currency", desc: "Optional. Documents and other fees per shipment", example: 60},
      {name: "weightFromKg", field: "weight_from_kg", type: "number", min: 0, max: 1e6, unit: "kg", desc: "Optional weight band start (chargeable kg)"},
      {name: "weightToKg", field: "weight_to_kg", type: "number", min: 0, max: 1e7, unit: "kg", desc: "Optional weight band end (chargeable kg)"},
    ]},
    salesHistory: {label: "Sales history", table: "sales_history", columns: [
      {name: "date", field: "order_date", type: "date", required: true, example: "2026-03-14"},
      {name: "customerId", field: "customer_id", type: "text", required: true, example: "C-MA-01"},
      {name: "country", field: "country", type: "country", required: true, example: "MA"},
      {name: "sku", field: "sku", type: "text", required: true, example: "FT-JKT-100"},
      {name: "units", field: "quantity", type: "number", required: true, min: 0.0001, max: 1e7, example: 40},
      {name: "revenueEUR", field: "net_value_eur", type: "number", required: true, min: 0, max: 1e9, unit: "EUR", example: 5560},
      {name: "orderId", field: "order_id", type: "text", desc: "Optional. Blank = date + customer", example: "SO-2026-0142"},
    ]},
    countries: {label: "Countries", table: "countries", columns: [
      {name: "name", field: "country", type: "country", required: true, desc: "Country name or ISO2 code", example: "Morocco"},
      {name: "dutyRate", field: "duty_rate_pct", ...PCT, required: true, desc: "Duty you pay, % of CIF (with the preference certificate)", example: 0},
      {name: "preferenceCert", field: "preference_cert", type: "enum", required: true, allowed: ["EUR.1", "ATR", "none"], example: "EUR.1"},
      {name: "vatRate", field: "vat_rate_pct", ...PCT, required: true, example: 20},
      {name: "clearanceFeeEUR", field: "clearance_fee_eur", type: "number", required: true, min: 0, max: 1e5, unit: "EUR", desc: "Per shipment", example: 200},
      {name: "complianceCostEUR", field: "compliance_cost_eur", type: "number", required: true, min: 0, max: 1e7, unit: "EUR", desc: "Per year", example: 800},
      {name: "expectedYearlyUnits", field: "expected_yearly_units", type: "number", required: true, min: 1, max: 1e8, desc: "Garments per year", example: 5000},
      {name: "target", field: "target", type: "bool", desc: "Target country of the study. Blank = true", example: "true"},
      {name: "region", field: "region", type: "enum", allowed: ["Türkiye", "North Africa", "Gulf/GCC"], desc: "Region cards and map. Blank = built-in region", example: "North Africa"},
      {name: "standardDutyRate", field: "standard_duty_rate_pct", ...PCT, desc: "Optional. Duty without preference (non-EU origin goods). Blank = dutyRate", example: 40},
      {name: "otherFeesPct", field: "other_fees_pct", ...PCT, desc: "Optional. Other import levies, % of CIF", example: 0.25},
    ]},
    settings: {label: "Settings", table: "settings", columns: [
      {name: "eurUsdRate", field: "eur_usd_rate", type: "number", required: true, min: 0.2, max: 5, unit: "USD per EUR", example: 1.16},
      {name: "eurUsdDate", field: "eur_usd_date", type: "date", required: true, example: "2026-10-20"},
      {name: "insuranceRate", field: "insurance_rate_pct", ...PCT, required: true, desc: "% of EXW + freight", example: 0.3},
      {name: "marginPct", field: "margin_pct", type: "number", required: true, min: 0, max: 1000, unit: "%", desc: "Margin on landed cost", example: 25},
      {name: "shipmentUnits", field: "shipment_units", type: "int", min: 1, max: 1e7, desc: "Garments per shipment in Landed Cost. Blank = keep current", example: 500},
    ]},
  };
  Object.values(TEMPLATES).forEach(t => { t.columns = t.columns.concat(PROVENANCE); });
  const TYPES = Object.keys(TEMPLATES);

  // ---- parsing
  const blank = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
  const headKey = h => String(h ?? "").replace(/\(.*?\)|\[.*?\]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const UNIT_WORDS = {"kg": ["kg", "kgs"], "cm": ["cm"], "%": ["%", "pct", "percent"], "EUR": ["eur", "€"], "days": ["days", "day", "d"],
    "currency": ["eur", "usd", "€", "$"], "USD per EUR": []};
  function parseNumber(v, unit){
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    let s = String(v).trim().replace(/[ \s]/g, "");
    const words = UNIT_WORDS[unit] || [];
    const low = s.toLowerCase();
    const w = words.find(x => low.endsWith(x) || low.startsWith(x));
    if (w) s = low.endsWith(w) ? s.slice(0, s.length - w.length) : s.slice(w.length);
    if (!/^[-+]?[\d.,]+$/.test(s)) return NaN;
    if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (s.includes(",")) s = /,\d{3}$/.test(s) && s.split(",").length > 2 ? s.replace(/,/g, "") : s.replace(",", ".");
    const n = Number(s); return Number.isFinite(n) ? n : NaN;
  }
  function parseDateStrict(v){
    if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    let y, m, d, mm;
    if ((mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) [y, m, d] = [mm[1], mm[2], mm[3]];
    else if ((mm = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) [y, m, d] = [mm[3], mm[2], mm[1]];
    else return null;
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
    if (+y < 1990 || +y > 2100) return null;
    return dt.toISOString().slice(0, 10);
  }
  function parseBoolStrict(v){
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    if (["true", "yes", "y", "1", "ja"].includes(s)) return true;
    if (["false", "no", "n", "0", "nee"].includes(s)) return false;
    return null;
  }

  /* Validate one file against a template.
     table = {headers: [...], rows: [[...]]} (first sheet, header row first); ctx = {toIso2, isCountry, providers,
     lanes, quotes, today, fileName}. Returns {ok, errors: [{row, column, message}], rows: [{field: value}]}. Row
     numbers are the file's rows: the header is row 1. */
  function validateFile(type, table, ctx){
    const T = TEMPLATES[type], errors = [], out = [];
    if (!T) return {ok: false, errors: [{row: 0, column: "", message: `Unknown data type ${type}`}], rows: []};
    const heads = (table.headers || []).map(h => String(h ?? "").trim());
    const byKey = new Map(T.columns.map(c => [headKey(c.name), c]));
    const colIdx = {};
    heads.forEach((h, i) => {
      if (!h) return;
      const c = byKey.get(headKey(h));
      if (!c) { errors.push({row: 1, column: h, message: `Unknown column "${h}". The ${T.label} template has: ${T.columns.map(x => x.name).join(", ")}`}); return; }
      if (c.name in colIdx) { errors.push({row: 1, column: h, message: `Column "${c.name}" appears twice`}); return; }
      colIdx[c.name] = i;
    });
    T.columns.filter(c => c.required && !(c.name in colIdx)).forEach(c => errors.push({row: 1, column: c.name, message: `Required column "${c.name}" is missing`}));
    if (errors.length) return {ok: false, errors, rows: []};
    const body = (table.rows || []);
    body.forEach((r, i) => {
      const rowNo = i + 2;
      if (!r || r.every(blank)) return;
      const o = {_row: rowNo};
      T.columns.forEach(c => {
        if (!(c.name in colIdx)) return;
        const raw = r[colIdx[c.name]];
        const err = message => errors.push({row: rowNo, column: c.name, message});
        if (blank(raw)) { if (c.required) err("Required value is empty"); o[c.field] = null; return; }
        let v;
        if (c.type === "number" || c.type === "int") {
          v = parseNumber(raw, c.unit);
          if (Number.isNaN(v)) return err(`"${raw}" is not a number${c.unit && c.unit !== "currency" ? " in " + c.unit : ""}`);
          if (c.type === "int" && !Number.isInteger(v)) return err(`"${raw}" is not a whole number`);
          if (c.min != null && v < c.min) return err(`${v} is below the minimum ${c.min}${c.unit === "%" ? "%" : ""}`);
          if (c.max != null && v > c.max) return err(`${v} is above the maximum ${c.max}${c.unit === "%" ? "%" : ""}${c.unit === "%" ? " (rates are in %, e.g. 12 for 12%)" : ""}`);
        } else if (c.type === "date") {
          v = parseDateStrict(raw); if (!v) return err(`"${raw}" is not a valid date. Use YYYY-MM-DD`);
        } else if (c.type === "bool") {
          v = parseBoolStrict(raw); if (v === null) return err(`"${raw}" is not true or false`);
        } else if (c.type === "enum") {
          const hit = c.allowed.find(a => a.toLowerCase() === String(raw).trim().toLowerCase());
          if (!hit) return err(`"${raw}" is not one of ${c.allowed.join(", ")}`);
          v = hit;
        } else if (c.type === "country") {
          v = ctx.toIso2(raw);
          if (!ctx.isCountry(v)) return err(`"${raw}" is not a known country`);
        } else v = String(raw).trim();
        o[c.field] = v;
      });
      out.push(o);
    });
    if (!out.length && !errors.length) errors.push({row: 2, column: "", message: "The file has no data rows"});
    const extra = TYPE_RULES[type] ? TYPE_RULES[type](out, ctx) : [];
    errors.push(...extra);
    // duplicates on the key
    const key = KEYS[type];
    if (key) {
      const seen = new Map();
      out.forEach(o => { const k = key(o); if (!k) return; if (seen.has(k)) errors.push({row: o._row, column: KEY_COL[type], message: `Duplicate of row ${seen.get(k)}`}); else seen.set(k, o._row); });
    }
    errors.sort((a, b) => a.row - b.row);
    return {ok: !errors.length, errors, rows: errors.length ? [] : out};
  }
  const KEYS = {suppliers: o => o.supplier_id, products: o => o.sku, customers: o => o.customer_id, logisticsProviders: o => (o.dc_id || "").toUpperCase() || "name:" + String(o.name).toLowerCase(),
    lanes: o => o.lane_id, quotes: o => o.quote_id, countries: o => o.country, settings: () => "main", salesHistory: o => o.order_id && o.sku ? o.order_id + "|" + o.sku : null};
  const KEY_COL = {suppliers: "supplierId", products: "sku", customers: "customerId", logisticsProviders: "name", lanes: "laneId", quotes: "quoteId", countries: "name", settings: "eurUsdRate", salesHistory: "orderId"};
  const slug = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Checks across columns and against Master Data; fills generated ids.
  const TYPE_RULES = {
    settings(rows){ return rows.length > 1 ? [{row: rows[1]._row, column: "", message: "Settings takes one row"}] : (rows.forEach(r => { r.settings_id = "main"; }), []); },
    lanes(rows){ rows.forEach(r => { if (blank(r.lane_id)) r.lane_id = `L-${slug(r.origin_id)}-${r.destination_id}-${String(r.mode).toUpperCase()}`; }); return []; },
    salesHistory(rows){ rows.forEach(r => { if (blank(r.order_id)) r.order_id = `${r.order_date}-${r.customer_id}`; }); return []; },
    logisticsProviders(rows, ctx){
      const errs = [], prov = ctx.providers || [];
      rows.forEach(r => {
        const t = r._type; delete r._type;
        r.dc_type = t === "3PL" ? "3pl" : "freight_forwarder"; r.provider_type = t === "3PL" ? "3PL" : "Freight forwarder";
        const byId = !blank(r.dc_id) && prov.find(p => String(p.dc_id).toUpperCase() === String(r.dc_id).toUpperCase());
        const byName = prov.find(p => String(p.name).trim().toLowerCase() === String(r.name).trim().toLowerCase());
        const hit = byId || (blank(r.dc_id) ? byName : null);
        if (hit && !["3pl", "freight_forwarder"].includes(hit.dc_type)) errs.push({row: r._row, column: blank(r.dc_id) ? "name" : "providerId", message: `${hit.dc_id} is a ${hit.dc_type} in Master Data, not a forwarder or 3PL`});
        if (hit) r.dc_id = hit.dc_id;
      });
      return errs;
    },
    quotes(rows, ctx){
      const errs = [], prov = ctx.providers || [], lanes = ctx.lanes || [];
      rows.forEach(r => {
        const p = prov.find(x => String(x.dc_id).toUpperCase() === String(r.provider_id).trim().toUpperCase()) ||
                  prov.find(x => String(x.name).trim().toLowerCase() === String(r.provider_id).trim().toLowerCase());
        if (!p) errs.push({row: r._row, column: "provider", message: `Provider "${r.provider_id}" is not in Logistics providers. Upload it there first`});
        else if (!["3pl", "freight_forwarder", "helmond_hub"].includes(p.dc_type) && !p.provider_type) errs.push({row: r._row, column: "provider", message: `${p.dc_id} is a ${p.dc_type}, not a forwarder or 3PL`});
        else r.provider_id = p.dc_id;
        if (!lanes.some(l => String(l.lane_id) === String(r.lane_id))) errs.push({row: r._row, column: "laneId", message: `Lane "${r.lane_id}" is not in Lanes. Upload the lane first`});
        if (r.valid_until && r.quote_date && r.valid_until < r.quote_date) errs.push({row: r._row, column: "validUntil", message: `validUntil ${r.valid_until} is before quoteDate ${r.quote_date}`});
        if (r.weight_from_kg != null && r.weight_to_kg != null && r.weight_to_kg <= r.weight_from_kg) errs.push({row: r._row, column: "weightToKg", message: "weightToKg must be above weightFromKg"});
        ["fuel_surcharge", "peak_surcharge", "war_risk_surcharge", "other_surcharge"].forEach(k => { if (r[k] == null) r[k] = 0; });
      });
      let n = Math.max(0, ...(ctx.quotes || []).map(q => { const m = String(q.quote_id).match(/^Q-(\d+)$/); return m ? +m[1] : 0; }));
      rows.forEach(r => { if (blank(r.quote_id)) r.quote_id = "Q-" + String(++n).padStart(4, "0"); });
      return errs;
    },
    countries(rows){ rows.forEach(r => { if (r.target == null) r.target = true; }); return []; },
  };

  /* Rows ready for the Master Data table: provenance defaults, ids for new providers. */
  function toTableRows(type, rows, ctx){
    const today = ctx.today, src = "upload: " + (ctx.fileName || "file");
    let nextPrv = Math.max(0, ...(ctx.providers || []).map(p => { const m = String(p.dc_id).match(/^PRV-(\d+)$/); return m ? +m[1] : 0; }));
    return rows.map(o => {
      const r = Object.assign({}, o); delete r._row;
      if (blank(r.source_ref)) r.source_ref = src;
      if (blank(r.source_date)) r.source_date = today;
      if (blank(r.data_status)) r.data_status = "estimate";
      r.data_source = "imported:" + (ctx.fileName || "file");
      if (type === "logisticsProviders") {
        if (blank(r.dc_id)) r.dc_id = "PRV-" + String(++nextPrv).padStart(4, "0");
        const old = (ctx.providers || []).find(p => p.dc_id === r.dc_id);
        if (!old && blank(r.status)) r.status = "candidate";
        if (old) { Object.keys(r).forEach(k => { if (r[k] === null && k in old) delete r[k]; }); }   // blank optional cells keep the stored value
      }
      if (type === "lanes" && blank(r.status)) r.status = "unproven";
      if (type === "settings" && r.shipment_units == null) delete r.shipment_units;
      return r;
    });
  }

  /* Merge into the table: update by key, add new; replace = drop the type's other rows first. */
  const TABLE_KEY = {suppliers: r => r.supplier_id, products: r => r.sku, customers: r => r.customer_id, distribution_centers: r => r.dc_id,
    lanes: r => r.lane_id, quotes: r => r.quote_id, countries: r => r.country, settings: r => r.settings_id || "main", sales_history: r => r.order_id + "|" + r.sku};
  function mergeInto(type, tableRows, incoming, replace){
    const T = TEMPLATES[type], key = TABLE_KEY[T.table];
    const mine = T.rows || (() => true);
    let base = replace ? tableRows.filter(r => !mine(r)) : tableRows.slice();
    const idx = new Map(base.map((r, i) => [String(key(r)), i]));
    let added = 0, updated = 0;
    incoming.forEach(r => {
      const k = String(key(r));
      if (idx.has(k)) { base[idx.get(k)] = Object.assign({}, base[idx.get(k)], r); updated++; }
      else { idx.set(k, base.length); base.push(r); added++; }
    });
    return {rows: base, added, updated, removed: replace ? tableRows.filter(mine).length - updated : 0};
  }

  /* Current rows in template columns (Download data). */
  function exportRows(type, tableRows){
    const T = TEMPLATES[type], mine = T.rows || (() => true);
    return tableRows.filter(mine).map(r => Object.fromEntries(T.columns.map(c => {
      let v = c.field === "_type" ? (r.dc_type === "3pl" ? "3PL" : "forwarder") : r[c.field];
      if (v === true || v === false) v = String(v);
      if (c.type === "date" && v) v = String(v).slice(0, 10);
      return [c.name, v == null ? "" : v];
    })));
  }
  function fieldSheet(type){
    return TEMPLATES[type].columns.map(c => ({column: c.name, required: c.required ? "yes" : "no", type: c.type === "enum" ? "one of: " + c.allowed.join(" / ") : c.type === "country" ? "country (ISO2 or name)" : c.type,
      unit: c.unit || "", range: c.min != null || c.max != null ? `${c.min ?? ""} to ${c.max ?? ""}` : "", description: c.desc || "", example: c.example ?? ""}));
  }

  // ---- provenance and coverage
  const statusOf = r => (r && String(r.data_status || "").toLowerCase() === "confirmed" ? "confirmed" : "estimate");
  const dataFields = type => TEMPLATES[type].columns.filter(c => !PROVENANCE.includes(c) && !String(c.field).startsWith("_")).map(c => c.field);
  /* Per data type: rows, confirmed rows, share. */
  function typeStatus(type, tableRows){
    const T = TEMPLATES[type], rows = tableRows.filter(T.rows || (() => true));
    const conf = rows.filter(r => statusOf(r) === "confirmed").length;
    return {rows: rows.length, confirmed: conf, share: rows.length ? conf / rows.length : 0};
  }
  /* Share of filled fields with status confirmed, per target country, over the rows tied to that country:
     its countries row, lanes and quotes to it, customers and sales in it, providers serving it. */
  function coverage(tables, countries){
    const T = tables, out = {};
    const laneTo = {}; (T.lanes || []).forEach(l => { laneTo[l.lane_id] = String(l.destination_id || "").toUpperCase(); });
    const servesOf = p => String(p.serves_countries || "").split(";").map(x => x.trim().toUpperCase()).filter(Boolean).concat(p.country ? [String(p.country).toUpperCase()] : []);
    countries.forEach(c => { out[c] = {fields: 0, confirmed: 0, rows: 0, byType: {}}; });
    const add = (c, type, r) => {
      const o = out[c]; if (!o) return;
      const n = dataFields(type).filter(f => r[f] !== null && r[f] !== undefined && String(r[f]).trim() !== "").length;
      const b = o.byType[type] = o.byType[type] || {fields: 0, confirmed: 0, rows: 0};
      const ok = statusOf(r) === "confirmed" ? n : 0;
      o.fields += n; o.confirmed += ok; o.rows++; b.fields += n; b.confirmed += ok; b.rows++;
    };
    (T.countries || []).forEach(r => add(String(r.country).toUpperCase(), "countries", r));
    (T.lanes || []).forEach(r => add(laneTo[r.lane_id], "lanes", r));
    (T.quotes || []).forEach(r => add(laneTo[r.lane_id], "quotes", r));
    (T.customers || []).forEach(r => add(String(r.country || "").toUpperCase(), "customers", r));
    (T.sales_history || []).forEach(r => add(String(r.country || "").toUpperCase(), "salesHistory", r));
    (T.distribution_centers || []).filter(TEMPLATES.logisticsProviders.rows).forEach(r => [...new Set(servesOf(r))].forEach(c => add(c, "logisticsProviders", r)));
    Object.values(out).forEach(o => { o.share = o.fields ? o.confirmed / o.fields : 0; });
    return out;
  }

  /* Target countries: rows of the countries table with target not false. */
  const targets = countryRows => (countryRows || []).filter(r => r.target !== false && String(r.target).toLowerCase() !== "false").map(r => String(r.country).toUpperCase());

  return {TEMPLATES, TYPES, PROVENANCE, validateFile, toTableRows, mergeInto, exportRows, fieldSheet, typeStatus, coverage, targets, statusOf,
    parseNumber, parseDateStrict, headKey};
});
