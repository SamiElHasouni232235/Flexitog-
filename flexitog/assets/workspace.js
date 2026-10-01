/* FlexiTog dashboard: menu, master data editor and upload, saving, report extract.
 * Runs after the main dashboard script and shares its globals (PAYLOAD, MD, W, BASE, R, compute, renderView ...).
 */
"use strict";

// ============================================================ helpers
const CLAUDE = window.claude && typeof window.claude.use === "function" ? window.claude : null;
const DOWNLOADS = CLAUDE ? CLAUDE.use("downloads").catch(() => null) : Promise.resolve(null);
const isBlank = v => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || String(v).trim() === "";
const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]/g, "");
const nowIso = () => new Date().toISOString();
function toast(msg, kind){
  const t = $("toast"); t.textContent = msg; t.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = "toast"; }, 3200);
}
async function saveFile(filename, data){
  const dl = await DOWNLOADS;
  if (dl) {
    try { await dl.save({filename, data}); toast(`${filename} saved`); }
    catch (e) { if (e && e.code === "declined") return; toast(e && e.code === "rate_limited" ? "A save prompt is already open" : `Could not save ${filename}`, "bad"); }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data]);
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const csvCell = v => { if (v === null || v === undefined) return ""; const s = String(v); return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (cols, rows) => [cols.join(","), ...rows.map(r => cols.map(c => csvCell(r[c])).join(","))].join("\r\n");
const wbBytes = wb => XLSX.write(wb, {bookType: "xlsx", type: "array"});
const SCHEMA = PAYLOAD.schema;

// ============================================================ value parsing (mirrors importer.py)
function toIso2(v){
  if (isBlank(v)) return null;
  const t = String(v).trim();
  if (PAYLOAD.names.countries[t.toUpperCase()]) return t.toUpperCase();
  const k = norm(t);
  if (PAYLOAD.country_aliases[k]) return PAYLOAD.country_aliases[k];
  const hit = Object.entries(PAYLOAD.names.countries).find(([, n]) => norm(n) === k);
  return hit ? hit[0] : t.toUpperCase();
}
function cleanNum(v){ if (isBlank(v)) return null; return String(v).trim().replace(/ | /g, "").replace(/€|EUR|eur|\$|USD|%/g, ""); }
function detectDecimal(values){
  let comma = 0, dot = 0;
  values.forEach(v => { const s = cleanNum(v); if (!s || typeof v === "number") return;
    if (s.includes(",") && s.includes(".")) { if (s.lastIndexOf(",") > s.lastIndexOf(".")) comma++; else dot++; }
    else if (s.includes(",")) { if (s.split(",").pop().length !== 3) comma++; }
    else if (s.includes(".")) { if (s.split(".").pop().length !== 3) dot++; } });
  return comma > dot ? "," : ".";
}
function parseNum(v, dec){
  if (typeof v === "number") return v;
  const s = cleanNum(v); if (s === null || ["-", "n/a", "na", "nan", "none"].includes(s.toLowerCase())) return null;
  const th = dec === "," ? "." : ",";
  const n = Number(s.split(th).join("").replace(dec, "."));
  return Number.isFinite(n) ? n : NaN;
}
function parseDate(v){
  if (isBlank(v)) return null;
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : NaN;
}
function parseBool(v){
  if (typeof v === "boolean") return v; if (isBlank(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "ja", "j", "x", "required"].includes(s)) return true;
  if (["0", "false", "no", "n", "nee", "nan", "none"].includes(s)) return false;
  return null;
}
function coerce(field, v, dec){
  if (field.dtype === "float" || field.dtype === "int") { const n = parseNum(v, dec || "."); return n === null ? null : (field.dtype === "int" && Number.isFinite(n) ? Math.round(n) : n); }
  if (field.dtype === "date") return parseDate(v);
  if (field.dtype === "bool") return parseBool(v);
  if (field.dtype === "list") return isBlank(v) ? "" : String(v).replace(/[,|]/g, ";").split(";").map(x => x.trim()).filter(Boolean).join(";");
  return isBlank(v) ? null : String(v).trim();
}
function enrich(key, row){
  if ("country" in row && !isBlank(row.country)) row.country = toIso2(row.country);
  if ("country_of_origin" in row && !isBlank(row.country_of_origin)) row.country_of_origin = toIso2(row.country_of_origin);
  if (key === "distribution_centers" && !isBlank(row.serves_countries)) row.serves_countries = String(row.serves_countries).split(";").map(toIso2).filter(Boolean).join(";");
  if (SCHEMA[key].fields.some(f => f.name === "region") && isBlank(row.region) && row.country) row.region = regionOf(row.country);
  return row;
}

// ============================================================ file reading
function parseCsv(text){
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [";", "\t", ","].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
async function readFile(file){
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls)$/.test(name)) {
    if (typeof XLSX === "undefined") throw new Error("Excel reading is not available in this copy. Save the sheet as CSV.");
    const wb = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: false});
    const sheets = {}; wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, raw: true, defval: null, blankrows: true}); });
    return {sheets, names: wb.SheetNames};
  }
  let text;
  const buf = await file.arrayBuffer();
  try { text = new TextDecoder("utf-8", {fatal: true}).decode(buf); } catch (e) { text = new TextDecoder("windows-1252").decode(buf); }
  return {sheets: {[file.name]: parseCsv(text)}, names: [file.name]};
}

// ============================================================ column mapping (mirrors importer.guess_mapping)
function similarity(a, b){
  if (a === b) return 1; const m = a.length, n = b.length; if (!m || !n) return 0;
  const d = Array.from({length: m + 1}, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}
function guessMapping(headers, key){
  const fields = SCHEMA[key].fields, cand = {};
  fields.forEach(f => { cand[norm(f.name)] = f.name; (f.aliases || []).forEach(a => { if (!(norm(a) in cand)) cand[norm(a)] = f.name; }); });
  const map = {}, used = new Set();
  headers.forEach(h => { const t = cand[norm(h)]; if (t && !used.has(t)) { map[h] = t; used.add(t); } });
  headers.forEach(h => {
    if (map[h]) return;
    const k = norm(h); let best = null, bs = 0.82;
    Object.entries(cand).forEach(([c, f]) => { if (used.has(f)) return; const sc = similarity(k, c); if (sc >= bs) { bs = sc; best = f; } });
    if (best) { map[h] = best; used.add(best); } else map[h] = "(keep)";
  });
  return map;
}
function applyMapping(key, headers, body, map, filename){
  const fields = Object.fromEntries(SCHEMA[key].fields.map(f => [f.name, f]));
  const cols = headers.map((h, i) => ({h, i, target: map[h]})).filter(c => c.target && c.target !== "(ignore)");
  const decs = {};
  cols.forEach(c => { const f = fields[c.target]; if (f && (f.dtype === "float" || f.dtype === "int")) decs[c.target] = detectDecimal(body.map(r => r[c.i])); });
  const warn = {};
  const rows = body.map(r => {
    const o = {};
    cols.forEach(c => {
      const f = fields[c.target];
      const name = c.target === "(keep)" ? String(c.h).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "extra" : c.target;
      let v = r[c.i];
      if (f) { v = coerce(f, v, decs[c.target]); if (typeof v === "number" && Number.isNaN(v) || v !== v) { warn[f.name] = (warn[f.name] || 0) + 1; v = null; } }
      else v = isBlank(v) ? null : v;
      o[name] = v;
    });
    o.data_source = "imported:" + filename;
    return enrich(key, o);
  });
  const notes = Object.entries(warn).map(([f, n]) => `${f}: ${n} value(s) not readable, left blank`);
  return {rows, notes};
}
function validate(key, rows){
  const sc = SCHEMA[key], issues = [], seen = new Map();
  rows.forEach((r, i) => {
    sc.fields.forEach(f => {
      if (f.required && isBlank(r[f.name])) issues.push({row: i, field: f.name, issue: "required value missing"});
      if (f.allowed && !isBlank(r[f.name]) && !f.allowed.includes(String(r[f.name]))) issues.push({row: i, field: f.name, issue: `"${r[f.name]}" is not one of ${f.allowed.join(", ")}`});
    });
    const k = sc.primary_key.map(p => r[p]);
    if (k.every(x => !isBlank(x))) { const ks = k.join("\u0000"); if (seen.has(ks)) issues.push({row: i, field: sc.primary_key.join("+"), issue: `duplicate of row ${seen.get(ks) + 1}`}); else seen.set(ks, i); }
  });
  return issues;
}
function mergeRows(key, existing, incoming, mode){
  if (mode === "replace") return incoming;
  if (mode === "append") return existing.concat(incoming);
  const pk = SCHEMA[key].primary_key, keyOf = r => pk.map(p => r[p]).join("\u0000");
  const out = existing.slice(), idx = new Map(out.map((r, i) => [keyOf(r), i]));
  incoming.forEach(r => { const k = keyOf(r); if (idx.has(k)) out[idx.get(k)] = r; else { idx.set(k, out.length); out.push(r); } });
  return out;
}

// ============================================================ saving: artifact store when available, this browser otherwise
const STORE = {db: null, where: "browser", ready: false, err: null};
const CHUNK_BYTES = 180000;
function chunks(rows){
  const out = []; let cur = [], size = 2;
  rows.forEach(r => { const s = JSON.stringify(r).length + 1; if (cur.length && size + s > CHUNK_BYTES) { out.push(cur); cur = []; size = 2; } cur.push(r); size += s; });
  if (cur.length || !out.length) out.push(cur);
  return out;
}
async function storeInit(){
  if (CLAUDE) {
    try {
      const db = await CLAUDE.use("db");
      if (db) {
        STORE.db = db; STORE.where = "artifact";
        const meta = await db.doc("mdmeta/state").get();
        if (meta.exists) {
          const m = meta.data(); const changed = [];
          for (const [k, info] of Object.entries(m.entities || {})) {
            if (!MD_KEYS.includes(k)) continue;
            let rows = [];
            for (let i = 0; i < info.chunks; i++) { const d = await db.doc(`md/${k}__${i}`).get(); if (d.exists) rows = rows.concat(d.data().rows || []); }
            MD.t[k] = rows; MD.saved[k] = {updated: info.updated, where: "artifact", chunks: info.chunks}; changed.push(k);
          }
          MD.custom = [];
          for (const c of m.custom || []) {
            let rows = [];
            for (let i = 0; i < c.chunks; i++) { const d = await db.doc(`mdc/${c.id}__${i}`).get(); if (d.exists) rows = rows.concat(d.data().rows || []); }
            MD.custom.push({id: c.id, name: c.name, columns: c.columns, rows, updated: c.updated, chunks: c.chunks});
          }
          STORE.meta = m;
          if (changed.length || MD.custom.length) masterDataChanged(changed);
        }
      }
    } catch (e) { STORE.err = e && e.code ? e.code : "unavailable"; }
  }
  STORE.ready = true; renderStoreStatus();
}
function metaDoc(){
  const ents = {};
  Object.entries(MD.saved).forEach(([k, v]) => { if (v.where === "artifact") ents[k] = {chunks: v.chunks, updated: v.updated, rows: MD.t[k].length}; });
  return {version: 1, entities: ents, custom: MD.custom.map(c => ({id: c.id, name: c.name, columns: c.columns, chunks: c.chunks, updated: c.updated}))};
}
async function persist(key){
  const updated = nowIso();
  if (STORE.db) {
    const db = STORE.db, parts = chunks(MD.t[key]), old = (MD.saved[key] && MD.saved[key].chunks) || 0;
    for (let i = 0; i < parts.length; i++) await db.doc(`md/${key}__${i}`).set({rows: parts[i]});
    for (let i = parts.length; i < old; i++) await db.doc(`md/${key}__${i}`).delete();
    MD.saved[key] = {updated, where: "artifact", chunks: parts.length};
    await db.doc("mdmeta/state").set(metaDoc());
    return "artifact";
  }
  localStorage.setItem(MD_LOCAL + key, JSON.stringify({updated, rows: MD.t[key]}));
  MD.saved[key] = {updated, where: "browser"};
  return "browser";
}
async function unpersist(key){
  if (STORE.db) {
    const old = (MD.saved[key] && MD.saved[key].chunks) || 0;
    for (let i = 0; i < old; i++) await STORE.db.doc(`md/${key}__${i}`).delete();
    delete MD.saved[key]; await STORE.db.doc("mdmeta/state").set(metaDoc());
  } else { try { localStorage.removeItem(MD_LOCAL + key); } catch (e) {} delete MD.saved[key]; }
}
async function persistCustom(){
  if (STORE.db) {
    for (const c of MD.custom) {
      if (c._saved) continue;
      const parts = chunks(c.rows), old = c.chunks || 0;
      for (let i = 0; i < parts.length; i++) await STORE.db.doc(`mdc/${c.id}__${i}`).set({rows: parts[i]});
      for (let i = parts.length; i < old; i++) await STORE.db.doc(`mdc/${c.id}__${i}`).delete();
      c.chunks = parts.length; c._saved = true;
    }
    await STORE.db.doc("mdmeta/state").set(metaDoc());
  } else localStorage.setItem(MD_LOCAL + "custom", JSON.stringify(MD.custom.map(c => Object.assign({}, c, {_saved: undefined}))));
}
function storeErrorText(e){
  const code = e && e.code;
  if (code === "quota_exceeded") return "The artifact's storage is full. Remove a large table (for example old sales history) and save again.";
  if (code === "invalid_argument") return "You can view this dashboard but not change its saved data.";
  if (e && e.name === "QuotaExceededError") return "This browser's storage is full. Export the table to Excel and keep it in the tool instead.";
  return "Saving failed. Try again in a moment.";
}
function renderStoreStatus(){
  const where = STORE.where === "artifact" ? "Saved with this dashboard (shared with people you share it with)" : "Saved in this browser only";
  const n = Object.keys(MD.saved).length + (MD.custom.length ? 1 : 0);
  ["storeStatus", "menuStore"].forEach(id => { const el = $(id); if (el) el.textContent = `${where} · ${n ? n + " table(s) changed from the built-in data" : "built-in data"}`; });
}

// After master data is saved or loaded: rebuild the engine inputs and every view.
function masterDataChanged(keys){
  if (!keys || keys.includes("products")) { BASE.products = clone(MD.t.products); W.products = clone(MD.t.products); }
  if (!keys || keys.includes("distribution_centers")) { BASE.dcs = clone(MD.t.distribution_centers); W.dcs = clone(MD.t.distribution_centers); }
  compute(); renderView();
  if (VIEW.current === "md") renderMD();
  if (VIEW.current === "report") renderReport();
}

// ============================================================ views and menu
const VIEW = {current: "dash"};
function showView(v){
  VIEW.current = v;
  $("viewDash").hidden = v !== "dash"; $("viewMD").hidden = v !== "md"; $("viewReport").hidden = v !== "report";
  document.body.dataset.view = v;
  $("viewTitle").textContent = {dash: "FlexiTog Route Dashboard", md: "Master data", report: "Report extract"}[v];
  document.querySelectorAll("#menu [data-go]").forEach(b => b.setAttribute("aria-current", String(b.dataset.go === v)));
  if (v === "md") renderMD();
  if (v === "report") renderReport();
  window.scrollTo({top: 0});
}
function openMenu(open){
  $("menu").hidden = !open; $("menuBtn").setAttribute("aria-expanded", String(open));
  if (open) $("menu").querySelector("button").focus();
}
$("menuBtn").addEventListener("click", e => { e.stopPropagation(); openMenu($("menu").hidden); });
document.addEventListener("click", e => { if (!$("menu").hidden && !e.target.closest("#menu")) openMenu(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("menu").hidden) { openMenu(false); $("menuBtn").focus(); } });
$("menu").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  openMenu(false);
  if (b.dataset.go) showView(b.dataset.go);
  if (b.dataset.act === "params") openDrawer();
  if (b.dataset.act === "md-tab") { MDUI.tab = b.dataset.tab; showView("md"); }
});

// ============================================================ master data view
const MD_TABS = [
  ["products", "Products"], ["customers", "Customers"], ["suppliers", "Suppliers"], ["distribution_centers", "Logistics providers"],
  ["lanes", "Lanes"], ["sales_history", "Sales history"], ["demand_forecast", "Demand forecast"], ["orders", "Test orders"],
  ["order_lines", "Test order lines"], ["custom", "Other data"],
];
const MD_HINT = {
  products: "SKU master. Country of origin decides duty; units per pallet drives pallet counts.",
  customers: "Customers with country, city and port. Latitude and longitude are optional and only place the customer on the map.",
  suppliers: "Suppliers with the brands and SKUs they make. Shown in blue on the map with their route to Helmond. Inbound mode (road or sea) picks the inbound freight rate when a test order starts at a supplier.",
  distribution_centers: "Every logistics provider and stock point: distributors, 3PLs, owned warehouses and the Helmond hub. Set the countries each serves, its status, minimum order value and its commercial terms.",
  lanes: "Routes in use today. Proven lanes are preferred in the recommendation.",
  sales_history: "Order lines from the ERP. When this table has rows, the batch is built from it: one test order per historical order.",
  demand_forecast: "Forecast quantity per SKU, country and month. Kept for reporting.",
  orders: "Test orders for the order explorer. Pallet count is required.",
  order_lines: "SKU lines of the test orders.",
  custom: "Any other dataset: rate cards, quotes, shipment logs. Stored with the dashboard and listed in the report.",
};
const MDUI = {tab: "products", draft: {}, page: 0, filter: "", typeFilter: "all", upload: null};
const PAGE = 50;
const rowsOf = key => MDUI.draft[key] || MD.t[key];
const isDirty = key => !!MDUI.draft[key];
function draftOf(key){ if (!MDUI.draft[key]) MDUI.draft[key] = clone(MD.t[key]); return MDUI.draft[key]; }
function fieldsOf(key){
  const base = SCHEMA[key].fields.map(f => f.name);
  const extra = new Set(); rowsOf(key).forEach(r => Object.keys(r).forEach(k => { if (!base.includes(k) && k !== "data_source" && !k.startsWith("_")) extra.add(k); }));
  return {base, extra: [...extra]};
}
function renderMD(){
  const tabs = MD_TABS.map(([k, l]) => {
    const n = k === "custom" ? MD.custom.length : rowsOf(k).length;
    return `<button type="button" role="tab" data-tab="${k}" aria-selected="${MDUI.tab === k}">${esc(l)} <span class="cnt">${n}</span>${isDirty(k) ? '<span class="dot" title="Unsaved changes"></span>' : ""}${MD.saved[k] ? '<span class="sv" title="Changed from built-in data">●</span>' : ""}</button>`;
  }).join("");
  $("mdTabs").innerHTML = tabs;
  $("mdTabs").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { MDUI.tab = b.dataset.tab; MDUI.page = 0; MDUI.filter = ""; MDUI.upload = null; renderMD(); }));
  if (MDUI.tab === "custom") renderCustom(); else renderTable(MDUI.tab);
  renderStoreStatus();
}
function inputCell(f, v, ri){
  const bad = (f.required && isBlank(v)) || (f.allowed && !isBlank(v) && !f.allowed.includes(String(v)));
  const cls = bad ? ' class="bad"' : "";
  const a = `data-r="${ri}" data-f="${esc(f.name)}" aria-label="${esc(f.name)} row ${ri + 1}"${cls}`;
  if (f.allowed) return `<select ${a}><option value=""></option>${f.allowed.map(o => `<option${String(v) === o ? " selected" : ""}>${esc(o)}</option>`).join("")}${!isBlank(v) && !f.allowed.includes(String(v)) ? `<option selected>${esc(v)}</option>` : ""}</select>`;
  if (f.dtype === "bool") return `<input type="checkbox" ${a}${v === true ? " checked" : ""}>`;
  if (f.dtype === "float" || f.dtype === "int") return `<input type="number" step="any" ${a} value="${isBlank(v) ? "" : esc(v)}">`;
  if (f.dtype === "date") return `<input type="date" ${a} value="${isBlank(v) ? "" : esc(String(v).slice(0, 10))}">`;
  return `<input type="text" ${a} value="${isBlank(v) ? "" : esc(v)}">`;
}
function srcBadge(s){ s = String(s || "placeholder"); return s === "placeholder" ? '<span class="srcb ph" title="Placeholder data">placeholder</span>' : s.startsWith("imported:") ? `<span class="srcb im" title="${esc(s)}">imported</span>` : `<span class="srcb mn">${esc(s === "history" ? "history" : "entered")}</span>`; }
function renderTable(key){
  const sc = SCHEMA[key], rows = rowsOf(key), {base, extra} = fieldsOf(key);
  const fields = base.map(n => sc.fields.find(f => f.name === n)).concat(extra.map(n => ({name: n, dtype: "str", description: "Extra column kept from an upload"})));
  const q = MDUI.filter.trim().toLowerCase();
  let idx = rows.map((r, i) => i);
  if (key === "distribution_centers" && MDUI.typeFilter !== "all") idx = idx.filter(i => rows[i].dc_type === MDUI.typeFilter);
  if (q) idx = idx.filter(i => Object.values(rows[i]).some(v => String(v ?? "").toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(idx.length / PAGE)); MDUI.page = Math.min(MDUI.page, pages - 1);
  const shown = idx.slice(MDUI.page * PAGE, MDUI.page * PAGE + PAGE);
  const issues = validate(key, rows);
  const issueRows = new Set(issues.map(x => x.row));
  const typeSeg = key === "distribution_centers" ? `<div class="seg" role="group" aria-label="Provider type">${[["all", "All"], ["distributor", "Distributors"], ["3pl", "3PLs"], ["owned_warehouse", "Owned warehouses"], ["helmond_hub", "Helmond"]].map(([v, l]) => `<button type="button" data-tf="${v}" aria-pressed="${MDUI.typeFilter === v}">${l}</button>`).join("")}</div>` : "";
  const saved = MD.saved[key];
  $("mdPanel").innerHTML = `
    <div class="mdhead"><div><h2>${esc(MD_TABS.find(t => t[0] === key)[1])}</h2><p class="muted">${esc(MD_HINT[key])}</p></div>
      <div class="mdmeta faint">${rows.length} row(s) · ${saved ? `saved ${esc(new Date(saved.updated).toLocaleString("en-GB"))}` : "built-in data"}${issues.length ? ` · <span class="warnc">${new Set(issues.map(x => x.row)).size} row(s) need attention</span>` : ""}</div></div>
    <div class="mdbar">
      <input type="search" id="mdSearch" placeholder="Search rows" value="${esc(MDUI.filter)}" aria-label="Search rows">
      ${typeSeg}
      <span class="sp"></span>
      <button type="button" class="btn ghost" data-a="add">+ Add row</button>
      <button type="button" class="btn ghost" data-a="upload">Upload CSV / Excel</button>
      <button type="button" class="btn ghost" data-a="template">Template</button>
      <button type="button" class="btn ghost" data-a="export">Export CSV</button>
      <button type="button" class="btn ghost" data-a="reset" ${saved || isDirty(key) ? "" : "disabled"}>Reset to built-in</button>
      ${isDirty(key) ? '<button type="button" class="btn ghost" data-a="discard">Discard</button>' : ""}
      <button type="button" class="btn" data-a="save" ${isDirty(key) ? "" : "disabled"}>Save changes</button>
    </div>
    <div id="mdUpload"></div>
    ${issues.length ? `<details class="mdissues"><summary>${issues.length} issue(s) to fix</summary><ul>${issues.slice(0, 40).map(x => `<li>Row ${x.row + 1} · <b>${esc(x.field)}</b>: ${esc(x.issue)}</li>`).join("")}${issues.length > 40 ? `<li>… and ${issues.length - 40} more</li>` : ""}</ul></details>` : ""}
    <div class="tablewrap mdgrid"><table><thead><tr><th class="rn">#</th>${fields.map(f => `<th title="${esc((f.description || "") + (f.required ? " (required)" : ""))}">${esc(f.name)}${f.required ? ' <span class="req">*</span>' : ""}</th>`).join("")}<th>Source</th><th></th></tr></thead>
    <tbody>${shown.map(i => `<tr class="${issueRows.has(i) ? "hasissue" : ""}"><td class="rn">${i + 1}</td>${fields.map(f => `<td>${inputCell(f, rows[i][f.name], i)}</td>`).join("")}<td>${srcBadge(rows[i].data_source)}</td><td><button type="button" class="del" data-del="${i}" aria-label="Delete row ${i + 1}" title="Delete row">×</button></td></tr>`).join("") || `<tr><td colspan="${fields.length + 3}" class="empty">No rows${q ? " match the search" : ". Add a row or upload a file"}.</td></tr>`}</tbody></table></div>
    <div class="pager">${pages > 1 ? `<button type="button" class="btn ghost" data-pg="-1" ${MDUI.page ? "" : "disabled"}>Previous</button><span class="num">Page ${MDUI.page + 1} of ${pages} · ${idx.length} row(s)</span><button type="button" class="btn ghost" data-pg="1" ${MDUI.page < pages - 1 ? "" : "disabled"}>Next</button>` : `<span class="faint">${idx.length} row(s) shown</span>`}</div>`;
  const P = $("mdPanel");
  $("mdSearch").addEventListener("input", e => { MDUI.filter = e.target.value; MDUI.page = 0; const pos = e.target.selectionStart; renderTable(key); const s = $("mdSearch"); s.focus(); s.setSelectionRange(pos, pos); });
  P.querySelectorAll("[data-tf]").forEach(b => b.addEventListener("click", () => { MDUI.typeFilter = b.dataset.tf; MDUI.page = 0; renderTable(key); }));
  P.querySelectorAll("[data-pg]").forEach(b => b.addEventListener("click", () => { MDUI.page += Number(b.dataset.pg); renderTable(key); }));
  P.querySelectorAll("tbody [data-f]").forEach(el => el.addEventListener("change", () => {
    const d = draftOf(key), r = d[+el.dataset.r], f = sc.fields.find(x => x.name === el.dataset.f) || {name: el.dataset.f, dtype: "str"};
    let v = el.type === "checkbox" ? el.checked : el.value;
    v = f.dtype === "float" || f.dtype === "int" ? (v === "" ? null : Number(v)) : coerce(f, v);
    r[f.name] = v; enrich(key, r); r.data_source = "manual";
    renderMD();
  }));
  P.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { draftOf(key).splice(+b.dataset.del, 1); renderMD(); }));
  P.querySelector('[data-a="add"]').addEventListener("click", () => {
    const r = {}; sc.fields.forEach(f => { r[f.name] = null; });
    if (key === "distribution_centers" && MDUI.typeFilter !== "all") r.dc_type = MDUI.typeFilter;
    r.data_source = "manual"; draftOf(key).unshift(r); MDUI.page = 0; MDUI.filter = ""; renderMD();
    const first = $("mdPanel").querySelector("tbody [data-f]"); if (first) first.focus();
  });
  P.querySelector('[data-a="upload"]').addEventListener("click", () => { MDUI.upload = {key, step: "pick"}; renderUpload(); });
  P.querySelector('[data-a="template"]').addEventListener("click", () => {
    const cols = sc.fields.map(f => f.name), ex = MD_BUILTIN[key][0] || {};
    saveFile(`${key}_template.csv`, "﻿" + toCsv(cols, [ex]));
  });
  P.querySelector('[data-a="export"]').addEventListener("click", () => { const {base, extra} = fieldsOf(key); saveFile(`${key}.csv`, "﻿" + toCsv(base.concat(extra, ["data_source"]), rowsOf(key))); });
  P.querySelector('[data-a="reset"]').addEventListener("click", async () => {
    if (!confirmInline(P.querySelector('[data-a="reset"]'), "Click again to reset this table to the built-in data")) return;
    delete MDUI.draft[key]; MD.t[key] = clone(MD_BUILTIN[key]);
    try { await unpersist(key); toast("Reset to built-in data"); } catch (e) { toast(storeErrorText(e), "bad"); }
    masterDataChanged([key]);
  });
  const disc = P.querySelector('[data-a="discard"]'); if (disc) disc.addEventListener("click", () => { delete MDUI.draft[key]; renderMD(); });
  P.querySelector('[data-a="save"]').addEventListener("click", () => saveTable(key));
  if (MDUI.upload && MDUI.upload.key === key) renderUpload();
}
function confirmInline(btn, text){
  if (btn.dataset.armed === "1") return true;
  btn.dataset.armed = "1"; const old = btn.textContent; btn.textContent = "Confirm reset"; btn.title = text; toast(text);
  setTimeout(() => { btn.dataset.armed = ""; btn.textContent = old; }, 4000);
  return false;
}
async function saveTable(key){
  const btn = $("mdPanel").querySelector('[data-a="save"]'); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  const prev = MD.t[key];
  MD.t[key] = MDUI.draft[key]; delete MDUI.draft[key];
  try { const where = await persist(key); toast(where === "artifact" ? "Saved with the dashboard" : "Saved in this browser"); }
  catch (e) { MD.t[key] = prev; MDUI.draft[key] = clone(MD.t[key]); toast(storeErrorText(e), "bad"); renderMD(); return; }
  masterDataChanged([key]);
}

// ---- upload wizard
function renderUpload(){
  const U = MDUI.upload, el = $("mdUpload"); if (!el) return;
  if (!U) { el.innerHTML = ""; return; }
  const key = U.key, sc = SCHEMA[key];
  if (U.step === "pick") {
    el.innerHTML = `<div class="upcard"><div class="uph"><h3>Upload into ${esc(MD_TABS.find(t => t[0] === key)[1])}</h3><button type="button" class="iclose" data-u="cancel" aria-label="Close upload">×</button></div>
      <p class="muted">CSV (comma, semicolon or tab) or Excel. Column names are matched to the fields automatically; you check the match before anything changes.</p>
      <label class="drop" id="drop"><input type="file" id="upFile" accept=".csv,.txt,.xlsx,.xlsm,.xls"><span>Choose a file or drop it here</span></label>
      ${U.error ? `<p class="warnc">${esc(U.error)}</p>` : ""}</div>`;
    const f = $("upFile");
    f.addEventListener("change", () => f.files[0] && loadUpload(f.files[0]));
    const drop = $("drop");
    ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("over")));
    drop.addEventListener("drop", e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) loadUpload(file); });
  } else {
    const sheet = U.book.sheets[U.sheet] || [], hdr = sheet[U.header] || [], body = sheet.slice(U.header + 1).filter(r => r.some(c => !isBlank(c)));
    const headers = hdr.map((h, i) => isBlank(h) ? `column ${i + 1}` : String(h).trim());
    if (!U.map || U.mapFor !== U.sheet + "|" + U.header) { U.map = guessMapping(headers, key); U.mapFor = U.sheet + "|" + U.header; }
    const res = applyMapping(key, headers, body, U.map, U.file);
    const issues = validate(key, res.rows);
    const missing = sc.fields.filter(f => f.required && !Object.values(U.map).includes(f.name)).map(f => f.name);
    U.result = res;
    const opts = ["(ignore)", "(keep)"].concat(sc.fields.map(f => f.name));
    el.innerHTML = `<div class="upcard"><div class="uph"><h3>${esc(U.file)} → ${esc(MD_TABS.find(t => t[0] === key)[1])}</h3><button type="button" class="iclose" data-u="cancel" aria-label="Close upload">×</button></div>
      <div class="controls">
        ${U.book.names.length > 1 ? `<div class="ctl"><label for="upSheet">Sheet</label><select id="upSheet">${U.book.names.map(n => `<option${n === U.sheet ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></div>` : ""}
        <div class="ctl"><label for="upHdr">Header row</label><input type="number" id="upHdr" min="1" value="${U.header + 1}" style="width:80px"></div>
        <div class="ctl"><label>When rows already exist</label><div class="seg" id="upMode">${[["upsert", "Update matching, add new"], ["append", "Add all"], ["replace", "Replace table"]].map(([v, l]) => `<button type="button" data-m="${v}" aria-pressed="${U.mode === v}">${l}</button>`).join("")}</div></div>
      </div>
      <div class="upgrid">
        <div><h4>Column match</h4><div class="tablewrap"><table><thead><tr><th>Your column</th><th>Example</th><th>Goes to field</th></tr></thead><tbody>
          ${headers.map((h, i) => `<tr><td>${esc(h)}</td><td class="faint">${esc((body.find(r => !isBlank(r[i])) || [])[i] ?? "")}</td><td><select data-map="${esc(h)}">${opts.map(o => `<option value="${esc(o)}"${U.map[h] === o ? " selected" : ""}>${o === "(keep)" ? "keep as extra column" : o === "(ignore)" ? "ignore" : esc(o)}</option>`).join("")}</select></td></tr>`).join("")}
        </tbody></table></div></div>
        <div><h4>Check</h4>
          <ul class="checks">
            <li class="${missing.length ? "no" : "ok"}">${missing.length ? `Required field(s) not matched: <b>${missing.map(esc).join(", ")}</b>` : "All required fields are matched"}</li>
            <li class="ok">${res.rows.length} row(s) read</li>
            ${res.notes.map(n => `<li class="no">${esc(n)}</li>`).join("")}
            <li class="${issues.length ? "no" : "ok"}">${issues.length ? `${issues.length} issue(s): ${issues.slice(0, 3).map(x => `row ${x.row + 1} ${esc(x.field)} ${esc(x.issue)}`).join("; ")}${issues.length > 3 ? " …" : ""}` : "No row issues"}</li>
          </ul>
          <p class="faint">Countries are turned into ISO codes, numbers like 1.234,50 and dates like 13-09-2025 are read, and the region is filled from the country.</p>
          <div class="iact"><button type="button" class="btn" data-u="apply" ${missing.length ? "disabled" : ""}>Add ${res.rows.length} row(s) to the table</button><button type="button" class="btn ghost" data-u="cancel">Cancel</button></div>
        </div>
      </div>
      <h4>Preview</h4><div class="tablewrap"><table><thead><tr>${Object.keys(res.rows[0] || {}).filter(k => k !== "data_source").map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>
        ${res.rows.slice(0, 5).map(r => `<tr>${Object.keys(res.rows[0]).filter(k => k !== "data_source").map(k => `<td>${esc(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    const sh = $("upSheet"); if (sh) sh.addEventListener("change", e => { U.sheet = e.target.value; U.header = headerRow(U.book.sheets[U.sheet], key); renderUpload(); });
    $("upHdr").addEventListener("change", e => { U.header = Math.max(0, Number(e.target.value || 1) - 1); renderUpload(); });
    el.querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => { U.mode = b.dataset.m; renderUpload(); }));
    el.querySelectorAll("[data-map]").forEach(s => s.addEventListener("change", () => { U.map[s.dataset.map] = s.value; renderUpload(); }));
    el.querySelector('[data-u="apply"]').addEventListener("click", () => {
      MDUI.draft[key] = mergeRows(key, rowsOf(key), res.rows, U.mode);
      MDUI.upload = null; MDUI.page = 0; renderMD();
      toast(`${res.rows.length} row(s) added. Check them, then press Save changes.`);
    });
  }
  el.querySelectorAll('[data-u="cancel"]').forEach(b => b.addEventListener("click", () => { MDUI.upload = null; renderUpload(); }));
}
// The header is the row (of the first 15) whose cells match the most field names. Title rows above it are skipped.
function headerScore(row, key){
  const cells = (row || []).filter(c => !isBlank(c)).map(c => String(c).trim());
  if (!cells.length) return 0;
  const m = guessMapping(cells, key); return Object.values(m).filter(v => v !== "(keep)").length;
}
function headerRow(sheet, key){
  let best = 0, bs = 0;
  (sheet || []).slice(0, 15).forEach((r, i) => { const sc = headerScore(r, key); if (sc > bs) { bs = sc; best = i; } });
  if (!bs) best = Math.max(0, (sheet || []).findIndex(r => r && r.some(c => !isBlank(c))));
  return best;
}
function bestSheet(book, key){
  let best = book.names[0], bs = -1;
  book.names.forEach(n => { const sh = book.sheets[n]; const sc = headerScore(sh[headerRow(sh, key)], key); if (sc > bs) { bs = sc; best = n; } });
  return best;
}
async function loadUpload(file){
  const U = MDUI.upload;
  try {
    const book = await readFile(file);
    const sheet = bestSheet(book, U.key);
    Object.assign(U, {step: "map", file: file.name, book, sheet, header: headerRow(book.sheets[sheet], U.key), mode: Object.keys(MD.saved).includes(U.key) || MD.t[U.key].some(r => r.data_source !== "placeholder") ? "upsert" : "replace", map: null, error: null});
  } catch (e) { U.error = e.message || "Could not read the file"; }
  renderUpload();
}

// ---- other data (any dataset)
function renderCustom(){
  $("mdPanel").innerHTML = `
    <div class="mdhead"><div><h2>Other data</h2><p class="muted">${esc(MD_HINT.custom)}</p></div></div>
    <div class="mdbar"><label class="btn ghost filebtn">Upload CSV / Excel<input type="file" id="cuFile" accept=".csv,.txt,.xlsx,.xlsm,.xls"></label><span class="sp"></span></div>
    ${MD.custom.length ? MD.custom.map((c, i) => `<details class="custom" ${i === 0 ? "open" : ""}><summary><b>${esc(c.name)}</b> <span class="faint">${c.rows.length} row(s) · ${c.columns.length} column(s) · ${esc(new Date(c.updated).toLocaleDateString("en-GB"))}</span></summary>
      <div class="iact"><button type="button" class="btn ghost sm" data-cx="${i}">Export CSV</button><button type="button" class="btn ghost sm" data-cd="${i}">Delete</button></div>
      <div class="tablewrap"><table><thead><tr>${c.columns.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${c.rows.slice(0, 100).map(r => `<tr>${c.columns.map(h => `<td>${esc(r[h] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${c.rows.length > 100 ? `<p class="faint">First 100 of ${c.rows.length} rows shown.</p>` : ""}</details>`).join("") : '<p class="empty">No other datasets yet.</p>'}`;
  $("cuFile").addEventListener("change", async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const book = await readFile(file);
      for (const n of book.names) {
        const sh = book.sheets[n].filter(r => r && r.some(c => !isBlank(c))); if (!sh.length) continue;
        const columns = sh[0].map((h, i) => isBlank(h) ? `column ${i + 1}` : String(h).trim());
        const rows = sh.slice(1).map(r => Object.fromEntries(columns.map((h, i) => [h, r[i] ?? null])));
        const name = book.names.length > 1 ? `${file.name} · ${n}` : file.name;
        MD.custom.unshift({id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, columns, rows, updated: nowIso()});
      }
      await persistCustom(); toast("Dataset saved"); renderMD(); renderStoreStatus();
    } catch (err) { toast(err.message || storeErrorText(err), "bad"); }
  });
  $("mdPanel").querySelectorAll("[data-cx]").forEach(b => b.addEventListener("click", () => { const c = MD.custom[+b.dataset.cx]; saveFile(c.name.replace(/[^\w.-]+/g, "_").replace(/\.(xlsx?|csv|txt)$/i, "") + ".csv", "﻿" + toCsv(c.columns, c.rows)); }));
  $("mdPanel").querySelectorAll("[data-cd]").forEach(b => b.addEventListener("click", async () => {
    const c = MD.custom.splice(+b.dataset.cd, 1)[0];
    try { if (STORE.db) for (let i = 0; i < (c.chunks || 0); i++) await STORE.db.doc(`mdc/${c.id}__${i}`).delete(); await persistCustom(); toast("Dataset deleted"); } catch (e) { toast(storeErrorText(e), "bad"); }
    renderMD();
  }));
}

// ---- whole master data workbook (importable into the Python tool, sheet per table)
function masterWorkbook(){
  const wb = XLSX.utils.book_new();
  MD_TABS.filter(t => t[0] !== "custom").forEach(([k, label]) => {
    const {base, extra} = fieldsOf(k); const cols = base.concat(extra, ["data_source"]);
    const ws = XLSX.utils.aoa_to_sheet([cols, ...rowsOf(k).map(r => cols.map(c => r[c] ?? null))]);
    XLSX.utils.book_append_sheet(wb, ws, label.slice(0, 31));
  });
  MD.custom.forEach((c, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([c.columns, ...c.rows.map(r => c.columns.map(h => r[h] ?? null))]), `Other ${i + 1}`));
  return wb;
}
$("mdExportAll").addEventListener("click", () => saveFile("FlexiTog_master_data.xlsx", wbBytes(masterWorkbook())));
$("mdTemplates").addEventListener("click", () => {
  const wb = XLSX.utils.book_new();
  MD_TABS.filter(t => t[0] !== "custom").forEach(([k, label]) => {
    const cols = SCHEMA[k].fields.map(f => f.name), ex = MD_BUILTIN[k][0] || {};
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, cols.map(c => ex[c] ?? null)]), label.slice(0, 31));
  });
  saveFile("FlexiTog_upload_templates.xlsx", wbBytes(wb));
});

// ============================================================ report extract
const REP = {region: "All", appendix: true, html: "", data: null};
const COST_CATS = [["inbound", "Supplier freight"], ["freight", "Freight"], ["insurance", "Insurance"], ["export_docs", "Export docs"], ["clearance", "Customs clearance"], ["duty", "Import duty"],
  ["import_fees", "Other levies"], ["compliance", "Compliance"], ["handling", "Handling"], ["storage", "Storage"], ["working_capital", "Capital in stock"],
  ["fixed_cost", "Warehouse fixed cost"], ["margin", "Distributor margin"]];
const LT_BUCKETS = [["processing", "Processing and picking"], ["export", "Export clearance"], ["main", "Main transit"], ["regional", "Regional transit"],
  ["clearance", "Import clearance"], ["wait", "Compliance wait"], ["delivery", "Final delivery"]];
function ltBucket(s){
  if (s.category === "handling") return "processing";
  if (s.category === "export_docs") return "export";
  if (s.category === "inbound") return "main";
  if (s.category === "freight") return s.leg === "regional" ? "regional" : s.leg === "domestic" ? "delivery" : "main";
  if (s.category === "clearance") return "clearance";
  if (s.category === "compliance") return "wait";
  return "processing";
}
function reportData(){
  const regs = REP.region === "All" ? REGIONS : [REP.region];
  const rows = R.rows.filter(r => regs.includes(r.region));
  const sc = E.scorecard(rows, ui.method, r => r.region);
  const okRows = rows.filter(r => r.available);
  const costs = [], leads = [];
  regs.forEach(rg => SC.forEach(s => {
    const g = okRows.filter(r => r.region === rg && r.scenario === s); if (!g.length) return;
    const units = g.reduce((a, r) => a + r.units, 0), c = {region: rg, scenario: s}, l = {region: rg, scenario: s};
    COST_CATS.forEach(([k]) => { c[k] = g.reduce((a, r) => a + r.route.steps.filter(x => x.category === k).reduce((y, x) => y + x.cost_eur, 0), 0) / (units || 1); });
    c.total = COST_CATS.reduce((a, [k]) => a + c[k], 0);
    LT_BUCKETS.forEach(([k]) => { l[k] = g.reduce((a, r) => a + r.route.steps.filter(x => ltBucket(x) === k).reduce((y, x) => y + x.days, 0), 0) / g.length; });
    l.total = LT_BUCKETS.reduce((a, [k]) => a + l[k], 0);
    costs.push(c); leads.push(l);
  }));
  const base = rows.filter(r => r.scenario === "cif_baseline");
  const byC = {};
  base.forEach(r => { const c = byC[r.country] = byC[r.country] || {country: r.country, region: r.region, orders: 0, pallets: 0, units: 0, value: 0};
    c.orders++; c.pallets += r.pallets || 0; c.units += r.units || 0; c.value += r.order_value_eur || 0; });
  const demand = Object.values(byC).sort((a, b) => b.value - a.value);
  const countries = demand.map(d => d.country);
  const compliance = countries.map(c => {
    const d = R.data.duty(c) || {}; const items = R.data.complianceRows(c);
    return {country: c, eu: d.duty_pct_eu_origin, std: d.duty_pct_standard, vat: d.vat_pct, pref: d.preference_document, broker: d.clearance_broker_eur,
      days: R.data.lead("import_clearance", c)[0], items: items.map(x => `${x.item} (€${fmt(x.cost_eur)} ${String(x.basis).replace(/_/g, " ")})`), src: d.source};
  });
  const nodes = R.data.dcs.map(d => {
    const n = R.best.filter(r => r.route.dc_id === d.dc_id && regs.includes(r.region));
    return Object.assign({}, d, {orders: n.length, pallets: n.reduce((a, r) => a + r.pallets, 0)});
  });
  const lanes = {};
  R.best.filter(r => regs.includes(r.region)).forEach(r => { const ml = r.route.main_leg; if (!ml) return; const k = r.bestOf + "|" + ml.port;
    const L = lanes[k] = lanes[k] || {scenario: r.bestOf, port: ml.port, mode: ml.mode, orders: 0, pallets: 0, countries: new Set()}; L.orders++; L.pallets += r.pallets; L.countries.add(r.country); });
  const issues = issuesAll().filter(i => (i.countries || []).some(c => regs.includes(regionOf(c)))).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const quality = MD_TABS.filter(t => t[0] !== "custom").map(([k, l]) => { const rs = MD.t[k]; const ph = rs.filter(r => (r.data_source || "placeholder") === "placeholder").length; return {table: l, rows: rs.length, placeholder: ph, real: rs.length - ph}; })
    .concat(Object.entries(W.params).map(([k, rs]) => { const ph = rs.filter(r => r.source !== "real").length; return {table: "Parameters · " + k.replace(/_/g, " "), rows: rs.length, placeholder: ph, real: rs.length - ph}; }));
  const placeholderShare = okRows.length ? okRows.reduce((a, r) => a + r.placeholder_cost_share, 0) / okRows.length : 1;
  const findings = [], recs = [];
  regs.forEach(rg => {
    const g = sc.filter(x => x.group === rg), b = g.find(x => x.scenario === "cif_baseline"), ins = g.filter(x => x.scenario !== "cif_baseline" && x.cost_per_unit_eur != null);
    if (!b || !ins.length) return;
    const best = ins.reduce((a, x) => x.cost_per_unit_eur < a.cost_per_unit_eur ? x : a);
    const fast = ins.reduce((a, x) => x.lead_time_days < a.lead_time_days ? x : a);
    const d = b.cost_per_unit_eur ? 100 * (best.cost_per_unit_eur / b.cost_per_unit_eur - 1) : 0;
    findings.push(`${rg}: ${E.LABELS[best.scenario]} has the lowest cost to serve among the in-scope models at €${fmt(best.cost_per_unit_eur, 2)} per unit (${d >= 0 ? "+" : ""}${fmt(d, 0)}% against the CIF baseline of €${fmt(b.cost_per_unit_eur, 2)}). The customer pays €${fmt(best.customer_cost_per_unit_eur, 2)} per unit on top of the goods instead of €${fmt(b.customer_cost_per_unit_eur, 2)}, and lead time moves from ${fmt(b.lead_time_days, 0)} to ${fmt(best.lead_time_days, 0)} days. Fastest: ${E.LABELS[fast.scenario]} at ${fmt(fast.lead_time_days, 0)} days.`);
    recs.push(`${rg}: shortlist ${E.LABELS[best.scenario]}${fast.scenario !== best.scenario ? ` and compare it with ${E.LABELS[fast.scenario]} on service level` : ""}.`);
    ins.filter(x => x.coverage < 1).forEach(x => recs.push(`${rg}: ${E.LABELS[x.scenario]} serves ${pct(x.coverage)} of orders. Add a partner or extend served countries before deciding on it.`));
  });
  if (placeholderShare > 0.5) recs.push(`${pct(placeholderShare)} of the simulated cost rests on placeholder values. Collect, in this order: ${PAYLOAD.datasets.filter(d => d.priority === "High").map(d => d.sheet).join(", ")}.`);
  if (issues.some(i => i.severity === "critical")) recs.push(`Resolve or price the critical issues (${issues.filter(i => i.severity === "critical").map(i => i.title).join(", ")}) before committing volume.`);
  const orders = R.best.filter(r => regs.includes(r.region)).map(r => {
    const b = R.byOrder[r.order_id].find(x => x.scenario === "cif_baseline");
    return {order_id: r.order_id, customer_id: r.customer_id, country: r.country, region: r.region, value: r.order_value_eur, pallets: r.pallets, units: r.units,
      best: E.LABELS[r.bestOf], node: r.node, cost_unit: r.cost_to_serve_eur / (r.units || 1), base_cost_unit: b && b.available ? b.cost_to_serve_eur / (b.units || 1) : null,
      lead: r.lead_time_days, base_lead: b ? b.lead_time_days : null, customer_pays: r.customer_pays_eur, base_customer_pays: b ? b.customer_pays_eur : null};
  });
  // supply base: suppliers and the brand mix of the orders in scope
  const inScope = new Set(BATCH.orders.filter(o => { const c = R.data.customers.find(x => x.customer_id === o.customer_id); return c && regs.includes(regionOf(c.country)); }).map(o => o.order_id));
  const prod = Object.fromEntries(R.data.products.map(x => [x.sku, x]));
  const skuVal = {};
  BATCH.lines.forEach(l => { if (!inScope.has(l.order_id) || !prod[l.sku]) return; const v = skuVal[l.sku] = skuVal[l.sku] || {units: 0, value: 0}; v.units += Number(l.quantity) || 0; v.value += (Number(l.quantity) || 0) * (Number(prod[l.sku].unit_price_eur) || 0); });
  const totalVal = Object.values(skuVal).reduce((a, v) => a + v.value, 0) || 1;
  const brandMix = {};
  Object.entries(skuVal).forEach(([sku, v]) => { const p = prod[sku], k = (p.brand || "no brand") + "|" + (p.country_of_origin || "?");
    const b = brandMix[k] = brandMix[k] || {brand: p.brand || "no brand", origin: p.country_of_origin || "", skus: new Set(), units: 0, value: 0}; b.skus.add(sku); b.units += v.units; b.value += v.value; });
  const suppliers = (R.data.suppliers || []).map(sp => {
    const skus = String(sp.sku_ids || "").split(/[;,]/).map(x => x.trim()).filter(Boolean);
    const value = skus.reduce((a, k) => a + (skuVal[k] ? skuVal[k].value : 0), 0);
    return {id: sp.supplier_id, name: sp.name, country: sp.country, city: sp.city, brands: String(sp.brands || "").split(";").filter(Boolean).join(", "),
      skus, mode: supplierMode(sp), lead: sp.lead_time_days, incoterm: sp.incoterm, share: value / totalVal, value};
  }).sort((a, b) => b.value - a.value);
  // sourcing: how stock reaches the partner nodes
  const sourcing = [];
  regs.forEach(rg => SC.filter(x => x !== "cif_baseline").forEach(sc => {
    const g = okRows.filter(r => r.region === rg && r.scenario === sc); if (!g.length) return;
    let pal = 0, dpal = 0, dcost = 0, vcost = 0, vpal = 0;
    g.forEach(r => (r.route.sourcing || []).forEach(x => { pal += x.pallets; if (x.path === "direct") { dpal += x.pallets; dcost += x.direct_eur_per_pallet * x.pallets; if (x.via_helmond_eur_per_pallet != null) { vcost += x.via_helmond_eur_per_pallet * x.pallets; vpal += x.pallets; } } }));
    sourcing.push({region: rg, scenario: sc, share: pal ? dpal / pal : 0, direct_pp: dpal ? dcost / dpal : null, via_pp: vpal ? vcost / vpal : null});
  }));
  const dLanes = {};
  R.best.filter(r => regs.includes(r.region)).forEach(r => (r.route.sourcing || []).forEach(x => {
    if (x.path !== "direct") return;
    const k = x.supplier_id + ">" + r.route.dc_id;
    const L = dLanes[k] = dLanes[k] || {supplier: x.supplier_id, node: r.route.dc_id, mode: x.direct_mode, port: x.direct_port, pallets: 0, orders: 0, cost: 0, via: 0, vpal: 0};
    L.pallets += x.pallets; L.orders += 1; L.cost += x.direct_eur_per_pallet * x.pallets;
    if (x.via_helmond_eur_per_pallet != null) { L.via += x.via_helmond_eur_per_pallet * x.pallets; L.vpal += x.pallets; }
  }));
  const directLanes = Object.values(dLanes).sort((a, b) => b.pallets - a.pallets);
  // transport mode mix per region and scenario, pallet-weighted
  const mixText = o => { const t = Object.values(o).reduce((a, v) => a + v, 0); return t ? Object.entries(o).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${Math.round(100 * v / t)}%`).join(", ") : "–"; };
  const modeMix = [];
  regs.forEach(rg => SC.forEach(sc => {
    const g = okRows.filter(r => r.region === rg && r.scenario === sc); if (!g.length) return;
    const sup = {}, main = {}, cust = {};
    g.forEach(r => {
      const mm = E.M.modeMix(r.route);
      ["inbound", "direct"].forEach(k => Object.entries(mm[k] || {}).forEach(([m, v]) => { sup[m] = (sup[m] || 0) + v; }));
      Object.entries(mm.main || {}).forEach(([m, v]) => { main[m] = (main[m] || 0) + v; });
      Object.entries(mm.regional || mm.domestic || {}).forEach(([m, v]) => { cust[m] = (cust[m] || 0) + v; });
    });
    modeMix.push({region: rg, scenario: sc, supply: mixText(sup), main: mixText(main), customer: mixText(cust), lead: g.reduce((a, r) => a + r.lead_time_days, 0) / g.length});
  }));
  const modePolicy = (R.data.params.modes || []).map(m => ({group: m.leg_group, allowed: m.allowed_modes, pick: m.pick, preferred: m.preferred_mode}));
  const [dMode] = R.data.g("direct_sourcing_mode");
  const brands = Object.values(brandMix).map(b => Object.assign(b, {skus: [...b.skus], share: b.value / totalVal})).sort((a, b) => b.value - a.value);
  const dSum = sourcing.filter(x => x.share > 0);
  if (dSum.length) recs.push(`Direct sourcing to partner stock is cheaper per pallet in ${dSum.length} region-model combination(s). Agree direct delivery terms, labelling and quality checks with the suppliers before relying on it.`);
  const changes = diff().length + (whatIf.redSea ? 1 : 0) + (whatIf.euAll ? 1 : 0) + excluded.size;
  return {regs, sc, costs, leads, demand, compliance, nodes, lanes: Object.values(lanes), issues, quality, placeholderShare, findings, recs, orders, changes, suppliers, brands, sourcing, directLanes, dMode, modeMix, modePolicy,
    generated: new Date().toLocaleString("en-GB"), batchOrders: BATCH.orders.length, source: BATCH.source};
}
function reportHtml(D){
  const t = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const n = (v, dp = 2) => `<td class="n">${fmt(v, dp)}</td>`;
  const sec = (num, title, body, lead) => `<section class="rs"><h2><span>${num}</span>${esc(title)}</h2>${lead ? `<p class="lead">${lead}</p>` : ""}${body}</section>`;
  let h = `<header class="rh"><p class="ey">Cross-border supply chain review · FlexiTog EU, Helmond</p><h1>Distribution model review: ${esc(D.regs.join(", "))}</h1>
    <dl class="meta"><div><dt>Generated</dt><dd>${esc(D.generated)}</dd></div><div><dt>Order basis</dt><dd>${D.orders.length} orders (${esc(D.source)})</dd></div>
    <div><dt>Hassle method</dt><dd>${esc($("method").selectedOptions[0].textContent)}</dd></div><div><dt>Placeholder share of cost</dt><dd>${pct(D.placeholderShare)}</dd></div>
    <div><dt>What-if changes</dt><dd>${D.changes}</dd></div></dl>
    ${D.placeholderShare > 0.5 ? `<p class="warnbox">Most values in this report are placeholders. Read it as a demonstration of the method, not as a decision basis.</p>` : ""}</header>`;
  h += sec(1, "Executive summary", `<ul>${D.findings.map(f => `<li>${esc(f)}</li>`).join("")}</ul>`);
  h += sec(2, "Scope and method", `<p>Origin: Helmond EU hub. Destinations: ${esc(D.regs.join(", "))}. Four models compared: CIF to port (today's baseline: FlexiTog pays freight and insurance to the destination port, the customer clears and moves goods inland), distributor-held stock, 3PL presence and an owned non-EU warehouse. DAP direct and the US and UK operations are out of scope.</p>
    <p>Cost to serve covers every cost between the supplier and goods at the customer, excluding the goods themselves and recoverable import VAT. Stocked models assume stock is on hand in the region; refill freight is consolidated and per-shipment fees are spread over the refill. Partner stock is refilled through Helmond or straight from the supplier, per supplier (section 9). Each order uses the best node per model, chosen on cost with a risk premium for unproven lanes and unsigned partners.</p>`);
  h += sec(3, "Scenario scorecard", t(["Region", "Scenario", "Coverage", "Cost / unit €", "Cost % value", "Customer / unit €", "FlexiTog / unit €", "Lead days", "Customer paperwork", "FlexiTog paperwork"],
    D.sc.sort((a, b) => D.regs.indexOf(a.group) - D.regs.indexOf(b.group) || SC.indexOf(a.scenario) - SC.indexOf(b.scenario)).map(x => `<tr><td>${esc(x.group)}</td><td>${esc(E.LABELS[x.scenario])}</td><td class="n">${pct(x.coverage)}</td>${n(x.cost_per_unit_eur)}${n(x.cost_pct_of_value, 1)}${n(x.customer_cost_per_unit_eur)}${n(x.flexitog_cost_per_unit_eur)}${n(x.lead_time_days, 1)}${n(x.hassle, 1)}${n(x.flexitog_paperwork, 1)}</tr>`)),
    "Coverage is the share of orders a model can serve: a node covers the country and the order meets its minimum order value. Averages use covered orders.");
  h += sec(4, "Landed cost breakdown", t(["Region", "Scenario"].concat(COST_CATS.map(c => c[1] + " €/unit"), ["Total €/unit"]),
    D.costs.map(c => `<tr><td>${esc(c.region)}</td><td>${esc(E.LABELS[c.scenario])}</td>${COST_CATS.map(([k]) => n(c[k])).join("")}<td class="n"><b>${fmt(c.total, 2)}</b></td></tr>`)));
  h += sec(5, "Lead time breakdown", t(["Region", "Scenario"].concat(LT_BUCKETS.map(b => b[1]), ["Total days"]),
    D.leads.map(l => `<tr><td>${esc(l.region)}</td><td>${esc(E.LABELS[l.scenario])}</td>${LT_BUCKETS.map(([k]) => n(l[k], 1)).join("")}<td class="n"><b>${fmt(l.total, 1)}</b></td></tr>`)),
    "Stocked models show order lead time from regional stock. Refill lead time sits outside the order path.");
  h += sec(6, "Demand profile", t(["Country", "Region", "Orders", "Pallets", "Units", "Order value €", "Avg order €", "Avg pallets"],
    D.demand.map(d => `<tr><td>${esc(CNAME(d.country))}</td><td>${esc(d.region)}</td>${n(d.orders, 0)}${n(d.pallets, 0)}${n(d.units, 0)}${n(d.value, 0)}${n(d.value / d.orders, 0)}${n(d.pallets / d.orders, 1)}</tr>`)));
  h += sec(7, "Network: logistics providers and lanes", t(["Node", "Type", "Status", "Country", "Serves", "Min order €", "Orders (best)", "Pallets (best)"],
    D.nodes.map(d => `<tr><td>${esc(d.name)} <span class="faint">${esc(d.dc_id)}</span></td><td>${esc(PAYLOAD.names.dc_types[d.dc_type] || d.dc_type)}</td><td>${esc(d.status)}</td><td>${esc(CNAME(d.country))}</td><td>${esc(String(d.serves_countries || "").split(";").join(", "))}</td>${n(d.min_order_value_eur, 0)}${n(d.orders, 0)}${n(d.pallets, 0)}</tr>`))
    + t(["Main lane (best model per order)", "Model", "Mode", "Orders", "Pallets", "Destination countries"],
    D.lanes.sort((a, b) => b.pallets - a.pallets).map(l => `<tr><td>Helmond → ${esc(l.port)}</td><td>${esc(E.LABELS[l.scenario])}</td><td>${esc(l.mode)}</td>${n(l.orders, 0)}${n(l.pallets, 0)}<td>${esc([...l.countries].map(CNAME).join(", "))}</td></tr>`)));
  h += sec(8, "Supply base: suppliers and brands", t(["Supplier", "Location", "Brands", "SKUs", "To Helmond", "Lead time days", "Terms", "Share of order value"],
    D.suppliers.map(x => `<tr><td>${esc(x.name)} <span class="faint">${esc(x.id)}</span></td><td>${esc(x.city || "")} ${esc(CNAME(x.country))}</td><td>${esc(x.brands)}</td><td>${esc(x.skus.join(", "))}</td><td>${esc(x.mode)}</td>${n(x.lead, 0)}<td>${esc(x.incoterm || "")}</td><td class="n">${pct(x.share)}</td></tr>`))
    + t(["Brand", "Origin", "SKUs", "Units", "Order value €", "Share"], D.brands.map(b => `<tr><td>${esc(b.brand)}</td><td>${esc(CNAME(b.origin))}</td><td>${esc(b.skus.join(", "))}</td>${n(b.units, 0)}${n(b.value, 0)}<td class="n">${pct(b.share)}</td></tr>`)),
    "Origin decides the duty rate. Only EU-origin lines get the preferential rate in this model. Albanian and Serbian origin pays the standard rate until the preference rules are confirmed with the broker.");
  const modeText = ["always via Helmond", "direct from the supplier when that is cheaper per pallet", "direct from the supplier whenever a rate exists"][D.dMode] || "";
  h += sec(9, "Stock sourcing: via Helmond or direct to partners", t(["Region", "Scenario", "Pallets sourced direct", "Direct €/pallet", "Via Helmond €/pallet", "Saving €/pallet"],
    D.sourcing.map(x => `<tr><td>${esc(x.region)}</td><td>${esc(E.LABELS[x.scenario])}</td><td class="n">${pct(x.share)}</td>${n(x.direct_pp, 0)}${n(x.via_pp, 0)}${n(x.via_pp != null && x.direct_pp != null ? x.via_pp - x.direct_pp : null, 0)}</tr>`))
    + (D.directLanes.length ? t(["Direct lane (best model per order)", "Mode", "Pallets", "Orders", "Direct €/pallet", "Via Helmond €/pallet"],
      D.directLanes.map(l => `<tr><td>${esc(l.supplier)} → ${esc(l.node)}${l.port ? ` <span class="faint">${esc(l.port)}</span>` : ""}</td><td>${esc(l.mode)}</td>${n(l.pallets, 1)}${n(l.orders, 0)}${n(l.pallets ? l.cost / l.pallets : null, 0)}${n(l.vpal ? l.via / l.vpal : null, 0)}</tr>`)) : "<p class=\"faint\">No direct lanes in use.</p>"),
    `Setting: ${esc(modeText)}. Per supplier, a distributor, 3PL or owned warehouse is refilled either through Helmond (supplier to Helmond, Helmond handling, EU export, main leg) or straight from the supplier (direct freight plus origin export documents). The CIF baseline always ships from Helmond stock.`);
  h += sec(10, "Transport modes", t(["Leg", "Allowed modes", "Pick", "Preferred"], D.modePolicy.map(m => `<tr><td>${esc(m.group)}</td><td>${esc(String(m.allowed || "").split(";").join(", "))}</td><td>${esc(m.pick)}</td><td>${esc(m.preferred || "–")}</td></tr>`))
    + t(["Region", "Scenario", "Supply legs", "Helmond leg", "Leg to customer", "Lead days"], D.modeMix.map(x => `<tr><td>${esc(x.region)}</td><td>${esc(E.LABELS[x.scenario])}</td><td>${esc(x.supply)}</td><td>${esc(x.main)}</td><td>${esc(x.customer)}</td>${n(x.lead, 1)}</tr>`)),
    "Share of pallets per mode. Supply legs = supplier to Helmond or to the partner. Leg to customer = the cross-border regional leg where there is one, otherwise in-country delivery.");
  h += sec(11, "Trade compliance by country", t(["Country", "Duty EU origin %", "Duty standard %", "VAT %", "Preference proof", "Broker €", "Clearance days", "Certificates and documents"],
    D.compliance.map(c => `<tr><td>${esc(CNAME(c.country))}</td>${n(c.eu, 1)}${n(c.std, 1)}${n(c.vat, 1)}<td>${esc(c.pref || "")}</td>${n(c.broker, 0)}${n(c.days, 0)}<td>${esc(c.items.join("; ") || "none recorded")}</td></tr>`)),
    "Duty per order is value-weighted by SKU origin: EU-origin lines use the preferential rate with the preference proof shown.");
  h += sec(12, "Risk and issue register", t(["Severity", "Issue", "Countries", "Detail", "Lever", "Source"],
    D.issues.map(i => `<tr><td><span class="sev ${i.severity}">${esc(i.severity)}</span></td><td><b>${esc(i.title)}</b></td><td>${esc((i.countries || []).join(", "))}</td><td>${esc(i.detail)}</td><td>${esc(i.lever || "")}</td><td>${i.kind === "briefing" ? "briefing note, verify" : "computed"}</td></tr>`)));
  h += sec(13, "Data quality", t(["Table", "Rows", "Placeholder", "Real"], D.quality.map(q => `<tr><td>${esc(q.table)}</td>${n(q.rows, 0)}${n(q.placeholder, 0)}${n(q.real, 0)}</tr>`)),
    `Placeholder share of simulated cost: <b>${pct(D.placeholderShare)}</b>.`);
  h += sec(14, "Recommendations and next steps", `<ol>${D.recs.map(r => `<li>${esc(r)}</li>`).join("")}</ol>`);
  if (REP.appendix) h += sec("A", "Appendix: order results (best in-scope model per order)", t(["Order", "Customer", "Country", "Value €", "Pallets", "Best model", "Node", "Cost/unit €", "Baseline €/unit", "Lead days", "Baseline days", "Customer pays €", "Baseline customer €"],
    D.orders.slice(0, 150).map(o => `<tr><td>${esc(o.order_id)}</td><td>${esc(o.customer_id)}</td><td>${esc(o.country)}</td>${n(o.value, 0)}${n(o.pallets, 0)}<td>${esc(o.best)}</td><td>${esc(o.node)}</td>${n(o.cost_unit)}${n(o.base_cost_unit)}${n(o.lead, 0)}${n(o.base_lead, 0)}${n(o.customer_pays, 0)}${n(o.base_customer_pays, 0)}</tr>`))
    + (D.orders.length > 150 ? `<p class="faint">First 150 of ${D.orders.length} orders. The Excel export has all of them.</p>` : ""));
  return h;
}
const REPORT_CSS = `body{font:13px/1.5 Arial,sans-serif;color:#14212c;margin:24px auto;max-width:1100px;padding:0 16px}
.rh h1{font-size:24px;margin:4px 0 12px}.ey{font:600 11px Arial;letter-spacing:.08em;text-transform:uppercase;color:#56636f;margin:0}
.meta{display:flex;flex-wrap:wrap;gap:6px 24px;margin:0 0 12px}.meta dt{font-size:11px;color:#56636f}.meta dd{margin:0;font-weight:600}
.warnbox{background:#fff4d6;border-left:4px solid #d9a400;padding:8px 12px}
.rs{margin:22px 0}.rs h2{font-size:17px;border-bottom:2px solid #14212c;padding-bottom:4px;display:flex;gap:10px;align-items:baseline}.rs h2 span{font:600 12px Arial;color:#56636f}
.lead{color:#56636f}table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px}th,td{border-bottom:1px solid #d9dfe4;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#f2f4f6;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#56636f}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sev{font-size:10px;font-weight:700;text-transform:uppercase;padding:2px 5px;border-radius:3px;background:#6f8193;color:#fff}.sev.critical{background:#d03b3b}.sev.serious{background:#ec835a;color:#14212c}.sev.warning{background:#fab219;color:#14212c}
.faint{color:#8a95a0}`;
function renderReport(){
  if (!R) return;
  $("repRegion").innerHTML = ["All", ...REGIONS].map(r => `<option${r === REP.region ? " selected" : ""}>${esc(r)}</option>`).join("");
  $("repAppendix").checked = REP.appendix;
  REP.data = reportData();
  REP.html = reportHtml(REP.data);
  $("repBody").innerHTML = REP.html;
}
$("repRegion").addEventListener("change", e => { REP.region = e.target.value; renderReport(); });
$("repAppendix").addEventListener("change", e => { REP.appendix = e.target.checked; renderReport(); });
const repName = ext => `FlexiTog_cross_border_report_${(REP.region === "All" ? "all_regions" : REP.region).replace(/[^\w]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.${ext}`;
$("repHtml").addEventListener("click", () => saveFile(repName("html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlexiTog cross-border report</title><style>${REPORT_CSS}</style></head><body>${REP.html}</body></html>`));
$("repCsv").addEventListener("click", () => {
  const cols = ["order_id", "customer_id", "country", "region", "scenario", "node", "available", "units", "pallets", "order_value_eur", "cost_to_serve_eur", "customer_pays_eur", "flexitog_pays_eur", "partner_pays_eur", "lead_time_days", "lane_status", "customs_touchpoints", "doc_steps", "customer_paperwork_steps", "flexitog_paperwork", "placeholder_cost_share", "reason"];
  const regs = REP.data.regs; saveFile(repName("csv"), "﻿" + toCsv(cols, R.rows.filter(r => regs.includes(r.region))));
});
$("repXlsx").addEventListener("click", () => {
  const D = REP.data, wb = XLSX.utils.book_new(), add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const r2 = v => v == null || Number.isNaN(v) ? null : Math.round(v * 100) / 100;
  add("Summary", [["FlexiTog cross-border supply chain report"], ["Generated", D.generated], ["Regions", D.regs.join(", ")], ["Orders", D.orders.length], ["Order basis", D.source],
    ["Placeholder share of cost", r2(D.placeholderShare)], ["What-if changes", D.changes], [], ["Executive summary"], ...D.findings.map(f => [f]), [], ["Recommendations"], ...D.recs.map(x => [x])]);
  add("Scorecard", [["Region", "Scenario", "Orders", "Coverage", "Cost per unit EUR", "Cost % of value", "Customer per unit EUR", "FlexiTog per unit EUR", "Lead time days", "Hassle score", "Customer paperwork steps", "FlexiTog paperwork", "Proven lane share", "Placeholder share"],
    ...D.sc.map(x => [x.group, E.LABELS[x.scenario], x.orders, r2(x.coverage), r2(x.cost_per_unit_eur), r2(x.cost_pct_of_value), r2(x.customer_cost_per_unit_eur), r2(x.flexitog_cost_per_unit_eur), r2(x.lead_time_days), r2(x.hassle), r2(x.customer_paperwork_steps), r2(x.flexitog_paperwork), r2(x.proven_lane_share), r2(x.placeholder_cost_share)])]);
  add("Cost breakdown", [["Region", "Scenario", ...COST_CATS.map(c => c[1] + " EUR/unit"), "Total EUR/unit"], ...D.costs.map(c => [c.region, E.LABELS[c.scenario], ...COST_CATS.map(([k]) => r2(c[k])), r2(c.total)])]);
  add("Lead times", [["Region", "Scenario", ...LT_BUCKETS.map(b => b[1] + " days"), "Total days"], ...D.leads.map(l => [l.region, E.LABELS[l.scenario], ...LT_BUCKETS.map(([k]) => r2(l[k])), r2(l.total)])]);
  add("Demand", [["Country", "Region", "Orders", "Pallets", "Units", "Order value EUR"], ...D.demand.map(d => [CNAME(d.country), d.region, d.orders, d.pallets, d.units, Math.round(d.value)])]);
  add("Network nodes", [["dc_id", "Name", "Type", "Status", "Country", "Serves", "Min order EUR", "Orders (best)", "Pallets (best)"], ...D.nodes.map(d => [d.dc_id, d.name, d.dc_type, d.status, d.country, d.serves_countries, d.min_order_value_eur, d.orders, d.pallets])]);
  add("Network lanes", [["Main lane", "Model", "Mode", "Orders", "Pallets", "Countries"], ...D.lanes.map(l => ["Helmond -> " + l.port, E.LABELS[l.scenario], l.mode, l.orders, l.pallets, [...l.countries].join(", ")])]);
  add("Suppliers", [["Supplier ID", "Name", "Country", "City", "Brands", "SKUs", "Mode to Helmond", "Lead time days", "Incoterm", "Share of order value"], ...D.suppliers.map(x => [x.id, x.name, x.country, x.city, x.brands, x.skus.join(", "), x.mode, x.lead, x.incoterm, r2(x.share)])]);
  add("Stock sourcing", [["Region", "Scenario", "Pallets sourced direct", "Direct EUR/pallet", "Via Helmond EUR/pallet"], ...D.sourcing.map(x => [x.region, E.LABELS[x.scenario], r2(x.share), r2(x.direct_pp), r2(x.via_pp)]),
    [], ["Direct lane", "Mode", "Pallets", "Orders", "Direct EUR/pallet", "Via Helmond EUR/pallet"], ...D.directLanes.map(l => [l.supplier + " -> " + l.node, l.mode, r2(l.pallets), l.orders, r2(l.pallets ? l.cost / l.pallets : null), r2(l.vpal ? l.via / l.vpal : null)])]);
  add("Transport modes", [["Leg", "Allowed modes", "Pick", "Preferred"], ...D.modePolicy.map(m => [m.group, m.allowed, m.pick, m.preferred]), [],
    ["Region", "Scenario", "Supply legs", "Helmond leg", "Leg to customer", "Lead days"], ...D.modeMix.map(x => [x.region, E.LABELS[x.scenario], x.supply, x.main, x.customer, r2(x.lead)])]);
  add("Brand mix", [["Brand", "Origin", "SKUs", "Units", "Order value EUR", "Share"], ...D.brands.map(b => [b.brand, b.origin, b.skus.join(", "), b.units, Math.round(b.value), r2(b.share)])]);
  add("Trade compliance", [["Country", "Duty EU origin %", "Duty standard %", "VAT %", "Preference proof", "Broker EUR", "Clearance days", "Certificates and documents"], ...D.compliance.map(c => [CNAME(c.country), c.eu, c.std, c.vat, c.pref, c.broker, c.days, c.items.join("; ")])]);
  add("Risks", [["Severity", "Issue", "Countries", "Detail", "Lever", "Source"], ...D.issues.map(i => [i.severity, i.title, (i.countries || []).join(", "), i.detail, i.lever || "", i.kind === "briefing" ? "briefing note, verify" : "computed"])]);
  add("Data quality", [["Table", "Rows", "Placeholder", "Real"], ...D.quality.map(q => [q.table, q.rows, q.placeholder, q.real])]);
  add("Orders", [["Order", "Customer", "Country", "Region", "Value EUR", "Pallets", "Units", "Best model", "Node", "Cost/unit EUR", "Baseline cost/unit EUR", "Lead days", "Baseline lead days", "Customer pays EUR", "Baseline customer pays EUR"],
    ...D.orders.map(o => [o.order_id, o.customer_id, o.country, o.region, Math.round(o.value), o.pallets, o.units, o.best, o.node, r2(o.cost_unit), r2(o.base_cost_unit), r2(o.lead), r2(o.base_lead), Math.round(o.customer_pays), o.base_customer_pays == null ? null : Math.round(o.base_customer_pays)])]);
  saveFile(repName("xlsx"), wbBytes(wb));
});

// ============================================================ start
renderStoreStatus();
storeInit();
