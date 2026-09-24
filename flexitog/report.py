"""Self-contained HTML report of a batch run: scorecard, one sample order, data still needed.

The page has no external dependencies except Google Fonts, so it opens anywhere and can be shared.
"""
from __future__ import annotations

import html
import json
from datetime import date

import pandas as pd

from . import batch as B
from .datarequest import DATASETS
from .engine import CUSTOMER, FLEXITOG, PARTNER, SCENARIO_LABELS, Evaluation

SHORT = {"cif_baseline": "Baseline CIF", "distributor": "Distributor", "3pl": "3PL", "owned_warehouse": "Owned WH"}

METRIC_ROWS = [
    ("cost_per_unit_eur", "Cost to serve per unit", "€", 2),
    ("customer_cost_per_unit_eur", "Customer pays per unit", "€", 2),
    ("lead_time_days", "Lead time", "days", 1),
    ("hassle", "Customer paperwork score", "pts", 1),
    ("flexitog_paperwork", "FlexiTog paperwork per order", "steps", 1),
]


def _findings(sc: pd.DataFrame) -> list[str]:
    out = []
    for region in [r for r in B.STUDY_REGIONS if r in set(sc["region"])]:
        g = sc[sc["region"] == region].set_index("scenario")
        if "cif_baseline" not in g.index:
            continue
        base = g.loc["cif_baseline"]
        ins = g.drop("cif_baseline").dropna(subset=["cost_per_unit_eur"])
        if ins.empty:
            continue
        best = ins["cost_per_unit_eur"].idxmin()
        b = ins.loc[best]
        delta = 100 * (b["cost_per_unit_eur"] / base["cost_per_unit_eur"] - 1) if base["cost_per_unit_eur"] else 0
        out.append(
            f"<b>{html.escape(region)}</b>: {SCENARIO_LABELS[best]} is the cheapest in-scope option at "
            f"€{b['cost_per_unit_eur']:.2f} per unit, {delta:+.0f}% against the baseline. The customer pays "
            f"€{b['customer_cost_per_unit_eur']:.2f} per unit instead of €{base['customer_cost_per_unit_eur']:.2f}, "
            f"and lead time drops from {base['lead_time_days']:.0f} to {b['lead_time_days']:.0f} days. "
            f"FlexiTog paperwork rises from {base['flexitog_paperwork']:.0f} to {b['flexitog_paperwork']:.0f} "
            f"steps per order.")
    return out


def _sample(ev: Evaluation | None, customer: dict) -> dict | None:
    if ev is None or ev.recommended is None:
        return None
    rec = ev.recommended
    routes = [{
        "label": r.label, "short": SHORT[r.scenario] + ("" if not r.dc_id else f" · {r.dc_id}"),
        "scenario": r.scenario, "flexitog": round(r.paid(FLEXITOG), 0), "partner": round(r.paid(PARTNER), 0),
        "customer": round(r.paid(CUSTOMER), 0), "total": round(r.cost_to_serve, 0),
        "lead": round(r.lead_time_days, 0), "lane": r.lane_status, "premium": r.risk_premium_pct,
        "recommended": r is rec, "feasible": r.feasible,
    } for r in ev.routes]
    steps = [{"step": s.step, "cost": round(s.cost_eur, 0), "days": s.days, "paid_by": s.paid_by,
              "party": s.party, "customs": s.customs} for s in rec.steps if s.category != "receipt"]
    return {"order_id": ev.order_id, "customer": customer.get("name", ""), "city": customer.get("city", ""),
            "country": rec.customer_country, "value": round(rec.order_value_eur, 0), "pallets": rec.pallets,
            "units": rec.units, "reason": ev.reason, "recommended": rec.label, "routes": routes, "steps": steps}


def build_html(results: pd.DataFrame, method: str, source: str, sample: Evaluation | None = None,
               sample_customer: dict | None = None, demo: bool = True) -> str:
    sc = B.scorecard(results, method)
    ok = results[results["available"]]
    payload = {
        "meta": {"generated": date.today().strftime("%d %b %Y"), "source": source,
                 "orders": int(results["order_id"].nunique()),
                 "placeholder_share": float(ok["placeholder_cost_share"].mean()) if len(ok) else 1.0,
                 "method": B.HASSLE_METHODS[method][0], "demo": demo},
        "regions": [r for r in B.STUDY_REGIONS if r in set(sc["region"])],
        "scenarios": [{"key": k, "short": SHORT[k], "label": SCENARIO_LABELS[k]} for k in SHORT],
        "metrics": [{"key": k, "label": l, "unit": u, "dp": d} for k, l, u, d in METRIC_ROWS],
        "scorecard": json.loads(sc.to_json(orient="records")),
        "method": json.loads(B.method_check(results).to_json(orient="records")),
        "sample": _sample(sample, sample_customer or {}),
        "datasets": [{"sheet": d[0], "priority": d[3], "why": d[4], "where": d[5], "target": d[6]}
                     for d in DATASETS],
    }
    findings = "".join(f"<li>{f}</li>" for f in _findings(sc))
    return (TEMPLATE.replace("/*DATA*/null", json.dumps(payload, ensure_ascii=False).replace("</", "<\\/"))
            .replace("<!--FINDINGS-->", findings))


TEMPLATE = r"""<title>FlexiTog Route Simulator</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{
  --ground:#f3f5f7; --surface:#ffffff; --ink:#15222e; --muted:#566471; --faint:#8894a0; --rule:#d8dee4;
  --accent:#1f3a55; --accent-soft:#e3eaf1; --warn:#8c2f1b; --warn-soft:#f6e6e1; --band:#fff4d6;
  --s-cif_baseline:#8a8984; --s-distributor:#2a78d6; --s-3pl:#eb6834; --s-owned_warehouse:#1baf7a;
  --p-flexitog:#4a3aa7; --p-partner:#eda100; --p-customer:#e87ba4;
  --display:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;
  --body:"IBM Plex Sans",-apple-system,"Segoe UI",Arial,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  color-scheme:dark;
  --ground:#0e141a; --surface:#151d25; --ink:#e6edf3; --muted:#a2afbb; --faint:#6f7d8a; --rule:#27333e;
  --accent:#9cc0e3; --accent-soft:#1c2b3a; --warn:#f0a08a; --warn-soft:#35201b; --band:#2e2716;
  --s-cif_baseline:#8f8e89; --s-distributor:#3987e5; --s-3pl:#d95926; --s-owned_warehouse:#199e70;
  --p-flexitog:#9085e9; --p-partner:#c98500; --p-customer:#d55181;
}}
:root[data-theme="dark"]{
  color-scheme:dark;
  --ground:#0e141a; --surface:#151d25; --ink:#e6edf3; --muted:#a2afbb; --faint:#6f7d8a; --rule:#27333e;
  --accent:#9cc0e3; --accent-soft:#1c2b3a; --warn:#f0a08a; --warn-soft:#35201b; --band:#2e2716;
  --s-cif_baseline:#8f8e89; --s-distributor:#3987e5; --s-3pl:#d95926; --s-owned_warehouse:#199e70;
  --p-flexitog:#9085e9; --p-partner:#c98500; --p-customer:#d55181;
}
*{box-sizing:border-box}
body{background:var(--ground);color:var(--ink);font:15px/1.55 var(--body);margin:0}
.wrap{max-width:1120px;margin:0 auto;padding-inline:20px;padding-block:28px 64px;display:flex;flex-direction:column;gap:40px}
h1,h2,h3{font-family:var(--display);text-wrap:balance;margin:0;letter-spacing:.005em}
h1{font-size:clamp(28px,4.4vw,40px);font-weight:700;line-height:1.1}
h2{font-size:23px;font-weight:600}
h3{font-size:16px;font-weight:600}
p{margin:0;max-width:68ch}
.eyebrow{font:500 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
header{display:flex;flex-direction:column;gap:12px}
.lede{color:var(--muted);font-size:16px}
.meta{display:flex;flex-wrap:wrap;gap:8px 20px;font:13px var(--mono);color:var(--muted)}
.meta b{color:var(--ink);font-weight:500}
.demo{display:flex;gap:12px;align-items:flex-start;background:var(--band);border-left:4px solid #d9a400;padding:12px 16px;border-radius:4px}
.demo b{font-family:var(--display);font-size:15px}
section{display:flex;flex-direction:column;gap:16px}
.sechead{display:flex;flex-direction:column;gap:6px;border-top:2px solid var(--ink);padding-top:14px}
.findings{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px;max-width:80ch}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
.grid{display:grid;grid-template-columns:170px repeat(var(--cols),minmax(0,1fr));gap:0 18px;align-items:center}
.grid .colhead{font:600 14px var(--display);padding-bottom:6px;border-bottom:1px solid var(--rule)}
.grid .rowhead{font-size:13px;color:var(--muted);padding-right:8px;line-height:1.3}
.grid .rowhead b{display:block;color:var(--ink);font-weight:600;font-size:14px}
.cell{padding:10px 0;border-bottom:1px solid var(--rule)}
.cell svg{width:100%;height:auto;display:block;overflow:visible}
svg text{font-family:var(--mono);font-size:10.5px;fill:var(--muted)}
svg text.val{fill:var(--ink)}
svg text.best{fill:var(--ink);font-weight:600}
.tablewrap{overflow-x:auto;background:var(--surface);border:1px solid var(--rule);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font:600 12px var(--display);letter-spacing:.03em;text-transform:uppercase;color:var(--muted);background:var(--surface);position:sticky;top:0}
td.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
tr:last-child td{border-bottom:0}
details summary{cursor:pointer;color:var(--accent);font-weight:500}
details summary:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.order{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:24px}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:16px;display:flex;flex-direction:column;gap:12px}
.facts{display:flex;flex-wrap:wrap;gap:6px 18px;font:13px var(--mono);color:var(--muted)}
.facts b{color:var(--ink);font-weight:500}
.rec{background:var(--accent-soft);border-radius:4px;padding:10px 12px;font-size:14px}
.steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.steps li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px dashed var(--rule);font-size:13px}
.steps li:last-child{border-bottom:0}
.steps .amt{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;min-width:62px}
.chip{font:500 11px/1 var(--mono);padding:4px 7px;border-radius:999px;white-space:nowrap}
.chip.FlexiTog{background:color-mix(in srgb,var(--p-flexitog) 18%,transparent);color:var(--ink)}
.chip.partner{background:color-mix(in srgb,var(--p-partner) 24%,transparent);color:var(--ink)}
.chip.customer{background:color-mix(in srgb,var(--p-customer) 24%,transparent);color:var(--ink)}
.customs{font:500 10px var(--mono);color:var(--warn);margin-left:6px;letter-spacing:.04em}
.prio{font:600 11px/1 var(--mono);padding:4px 8px;border-radius:3px;text-transform:uppercase;letter-spacing:.05em}
.prio.High{background:var(--warn-soft);color:var(--warn)}
.prio.Medium{background:var(--band);color:var(--ink)}
.prio.Low{background:var(--accent-soft);color:var(--muted)}
.verdict{font:500 12px var(--mono)}
.yes{color:var(--s-owned_warehouse)} .no{color:var(--warn)}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--ground);font:12px/1.4 var(--mono);padding:6px 9px;border-radius:4px;z-index:9;max-width:260px}
code{font-family:var(--mono);font-size:13px;background:var(--accent-soft);padding:1px 5px;border-radius:3px}
footer{color:var(--faint);font-size:13px;border-top:1px solid var(--rule);padding-top:14px}
@media (max-width:760px){
  .grid{grid-template-columns:minmax(0,1fr);gap:0}
  .grid .colhead.first,.grid .rowhead.spacer{display:none}
  .order{grid-template-columns:minmax(0,1fr)}
}
</style>

<div class="wrap">
  <header>
    <span class="eyebrow">FlexiTog EU · Helmond hub · Route simulator</span>
    <h1>FlexiTog Route Simulator</h1>
    <p class="lede">How a customer order from Helmond performs under three distribution models against today's CIF-to-port baseline, per region, on cost, lead time and paperwork.</p>
    <div class="meta" id="meta"></div>
    <div class="demo" id="demo" hidden><div><b>Dummy data.</b> Every customer, SKU, rate and order on this page is a placeholder. Use it to read the tool, not to decide. Section 5 lists the company data that replaces it.</div></div>
  </header>

  <section>
    <div class="sechead"><span class="eyebrow">1 · Results</span><h2>What the run shows</h2></div>
    <ul class="findings"><!--FINDINGS--></ul>
  </section>

  <section>
    <div class="sechead"><span class="eyebrow">2 · Scorecard</span><h2>Each scenario per region</h2>
      <p class="lede" style="font-size:14px">Lower is better on every row. Scales are shared across regions so bar lengths compare directly. Bold value = best in-scope scenario.</p></div>
    <div class="legend" id="legend"></div>
    <div class="grid" id="grid"></div>
    <details><summary>Show the scorecard as a table</summary><div class="tablewrap" style="margin-top:10px"><table id="sctable"></table></div></details>
  </section>

  <section>
    <div class="sechead"><span class="eyebrow">3 · One order</span><h2>A single order, route by route</h2></div>
    <div class="order" id="order"></div>
  </section>

  <section>
    <div class="sechead"><span class="eyebrow">4 · Hassle</span><h2>Does the hassle score separate the scenarios?</h2>
      <p class="lede" style="font-size:14px">The customer-first score targets zero paperwork for the customer. FlexiTog paperwork shows what you take on to cover it. The check below shows which methods tell the scenarios apart.</p></div>
    <div class="tablewrap"><table id="mtable"></table></div>
  </section>

  <section>
    <div class="sechead"><span class="eyebrow">5 · Data request</span><h2>Company data that replaces the placeholders</h2>
      <p class="lede" style="font-size:14px">Collect in this order. The Excel pack <code>templates/FlexiTog_data_request_pack.xlsx</code> has one sheet per row with the exact column headers the tool imports.</p></div>
    <div class="tablewrap"><table id="dtable"></table></div>
  </section>

  <footer id="foot"></footer>
</div>
<div id="tip" hidden></div>

<script>
const D = /*DATA*/null;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = (v, dp) => v == null || Number.isNaN(v) ? "n/a" : Number(v).toLocaleString("en-GB", {minimumFractionDigits: dp, maximumFractionDigits: dp});
const pct = v => Math.round(v * 100) + "%";

// ---- header
document.getElementById("meta").innerHTML =
  `<span>Generated <b>${esc(D.meta.generated)}</b></span><span>Batch <b>${D.meta.orders} orders</b> from ${esc(D.meta.source)}</span>` +
  `<span>Hassle method <b>${esc(D.meta.method)}</b></span><span>Placeholder share of cost <b>${pct(D.meta.placeholder_share)}</b></span>`;
document.getElementById("demo").hidden = !D.meta.demo;

// ---- legend
document.getElementById("legend").innerHTML = D.scenarios.map(s =>
  `<span><i class="sw" style="background:var(--s-${s.key})"></i>${esc(s.label)}</span>`).join("");

// ---- tooltip
const tip = document.getElementById("tip");
function showTip(e, text){ tip.textContent = text; tip.hidden = false; moveTip(e); }
function moveTip(e){ tip.style.left = Math.min(e.clientX + 12, innerWidth - 270) + "px"; tip.style.top = (e.clientY + 14) + "px"; }
function hideTip(){ tip.hidden = true; }
function bindTips(root){
  root.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("mouseenter", e => showTip(e, el.dataset.tip));
    el.addEventListener("mousemove", moveTip);
    el.addEventListener("mouseleave", hideTip);
  });
}

// ---- small multiples
const grid = document.getElementById("grid");
grid.style.setProperty("--cols", D.regions.length);
const byKey = {}; D.scorecard.forEach(r => byKey[r.region + "|" + r.scenario] = r);
let html = `<div class="colhead first"></div>` + D.regions.map(r => `<div class="colhead">${esc(r)}</div>`).join("");
D.metrics.forEach(m => {
  const vals = D.scorecard.map(r => r[m.key]).filter(v => v != null && !Number.isNaN(v));
  const max = Math.max(...vals, 0) || 1;
  html += `<div class="rowhead"><b>${esc(m.label)}</b>${esc(m.unit)}</div>`;
  D.regions.forEach(region => {
    const W = 300, L = 78, R = 44, bh = 13, gap = 7, H = D.scenarios.length * (bh + gap);
    const inScope = D.scenarios.filter(s => s.key !== "cif_baseline").map(s => byKey[region + "|" + s.key]?.[m.key]).filter(v => v != null);
    const best = inScope.length ? Math.min(...inScope) : null;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.label)}, ${esc(region)}">`;
    svg += `<line x1="${L}" x2="${L}" y1="0" y2="${H - gap}" style="stroke:var(--rule)"/>`;
    D.scenarios.forEach((s, i) => {
      const row = byKey[region + "|" + s.key]; const v = row ? row[m.key] : null; const y = i * (bh + gap);
      svg += `<text x="${L - 6}" y="${y + bh - 3}" text-anchor="end">${esc(s.short)}</text>`;
      if (v == null) { svg += `<text x="${L + 4}" y="${y + bh - 3}">not served</text>`; return; }
      const w = Math.max((W - L - R) * v / max, v > 0 ? 2 : 0);
      const isBest = s.key !== "cif_baseline" && best != null && Math.abs(v - best) <= Math.max(1e-9, Math.abs(best) * 0.005);
      const cov = row.coverage < 1 ? `, covers ${pct(row.coverage)} of orders` : "";
      svg += `<rect x="${L}" y="${y}" width="${w}" height="${bh}" rx="3" style="fill:var(--s-${s.key})" data-tip="${esc(s.label)} · ${esc(region)}: ${fmt(v, m.dp)} ${esc(m.unit)}${cov}"/>`;
      svg += `<rect x="${L}" y="${y - 3}" width="${W - L}" height="${bh + 6}" fill="transparent" data-tip="${esc(s.label)} · ${esc(region)}: ${fmt(v, m.dp)} ${esc(m.unit)}${cov}"/>`;
      svg += `<text class="${isBest ? "best" : "val"}" x="${L + w + 5}" y="${y + bh - 3}">${fmt(v, m.dp)}${isBest ? " ◂" : ""}</text>`;
    });
    html += `<div class="cell">${svg}</svg></div>`;
  });
});
grid.innerHTML = html; bindTips(grid);

// ---- scorecard table
const cols = [["region","Region"],["scenario_label","Scenario"],["orders","Orders",0],["coverage","Coverage","%"],
  ["cost_per_unit_eur","Cost/unit €",2],["cost_pct_of_value","Cost % value",1],["customer_cost_per_unit_eur","Customer/unit €",2],
  ["flexitog_cost_per_unit_eur","FlexiTog/unit €",2],["lead_time_days","Lead days",1],["hassle","Customer paperwork",1],
  ["flexitog_paperwork","FlexiTog paperwork",1],["proven_lane_share","Proven lanes","%"]];
document.getElementById("sctable").innerHTML = `<thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>` +
  D.scorecard.map(r => `<tr>${cols.map(([k,, dp]) => dp === undefined ? `<td>${esc(r[k])}</td>` :
    `<td class="num">${dp === "%" ? (r[k] == null ? "n/a" : pct(r[k])) : fmt(r[k], dp)}</td>`).join("")}</tr>`).join("") + "</tbody>";

// ---- sample order
const S = D.sample, orderEl = document.getElementById("order");
if (!S) { orderEl.innerHTML = `<p>No test order with a feasible route.</p>`; }
else {
  const maxT = Math.max(...S.routes.map(r => r.total)) || 1;
  const W = 460, L = 150, bh = 16, gap = 12, H = S.routes.length * (bh + gap) + 4;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost to serve per route, split by who pays">`;
  S.routes.forEach((r, i) => {
    const y = i * (bh + gap); let x = L;
    svg += `<text x="${L - 8}" y="${y + bh - 4}" text-anchor="end" class="${r.recommended ? "best" : ""}">${esc(r.short)}${r.recommended ? " ★" : ""}</text>`;
    [["flexitog","FlexiTog"],["partner","partner"],["customer","customer"]].forEach(([k, lab]) => {
      const w = (W - L - 60) * r[k] / maxT; if (w <= 0) return;
      svg += `<rect x="${x}" y="${y}" width="${Math.max(w - 2, 1)}" height="${bh}" rx="2" style="fill:var(--p-${k})" data-tip="${esc(r.label)}: ${lab} pays €${fmt(r[k],0)}"/>`;
      x += w;
    });
    svg += `<text class="val" x="${x + 4}" y="${y + bh - 4}">€${fmt(r.total, 0)}</text>`;
  });
  svg += "</svg>";
  const rows = S.routes.map(r => `<tr><td>${esc(r.label)}${r.recommended ? " <b>★</b>" : ""}</td><td class="num">€${fmt(r.total,0)}</td><td class="num">€${fmt(r.customer,0)}</td><td class="num">${fmt(r.lead,0)}</td><td>${esc(r.lane)}</td></tr>`).join("");
  const steps = S.steps.map(s => `<li><span>${esc(s.step)}${s.customs ? '<span class="customs">CUSTOMS</span>' : ""}<br><span style="color:var(--faint);font-size:12px">${esc(s.party)}${s.days ? ` · ${fmt(s.days,0)} d` : ""}</span></span><span class="chip ${esc(s.paid_by)}">${esc(s.paid_by)}</span><span class="amt">€${fmt(s.cost,0)}</span></li>`).join("");
  orderEl.innerHTML = `
    <div class="card">
      <h3>Order ${esc(S.order_id)}</h3>
      <div class="facts"><span><b>${esc(S.customer)}</b></span><span>${esc(S.city)}, ${esc(S.country)}</span><span>€${fmt(S.value,0)}</span><span>${fmt(S.units,0)} units</span><span>${fmt(S.pallets,0)} pallet(s)</span></div>
      <div class="rec"><b>Recommended: ${esc(S.recommended)}.</b> ${esc(S.reason)}</div>
      <div class="legend"><span><i class="sw" style="background:var(--p-flexitog)"></i>FlexiTog pays</span><span><i class="sw" style="background:var(--p-partner)"></i>Partner pays</span><span><i class="sw" style="background:var(--p-customer)"></i>Customer pays</span></div>
      ${svg}
      <div class="tablewrap"><table><thead><tr><th>Route</th><th>Cost to serve</th><th>Customer pays</th><th>Lead days</th><th>Lane</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="card"><h3>Steps on the recommended route</h3><ul class="steps">${steps}</ul></div>`;
  bindTips(orderEl);
}

// ---- method check
const mrows = D.method.map(r => `<tr><td>${esc(r.method)}</td><td>${esc(r.region)}</td>` +
  ["baseline", ...D.scenarios.filter(s => s.key !== "cif_baseline").map(s => s.label)].map(k => `<td class="num">${fmt(r[k],1)}</td>`).join("") +
  `<td class="verdict ${r["separates from baseline"] ? "yes" : "no"}">${r["separates from baseline"] ? "yes" : "no"}</td>` +
  `<td class="verdict ${r["separates in-scope scenarios"] ? "yes" : "no"}">${r["separates in-scope scenarios"] ? "yes" : "no"}</td></tr>`).join("");
document.getElementById("mtable").innerHTML = `<thead><tr><th>Method</th><th>Region</th><th>Baseline</th>` +
  D.scenarios.filter(s => s.key !== "cif_baseline").map(s => `<th>${esc(s.short)}</th>`).join("") +
  `<th>Separates from baseline</th><th>Separates in-scope</th></tr></thead><tbody>${mrows}</tbody>`;

// ---- data request
document.getElementById("dtable").innerHTML = `<thead><tr><th>Priority</th><th>Dataset</th><th>Why it matters</th><th>Where to get it</th><th>Upload in tool</th></tr></thead><tbody>` +
  D.datasets.map(d => `<tr><td><span class="prio ${esc(d.priority)}">${esc(d.priority)}</span></td><td><b>${esc(d.sheet)}</b></td><td>${esc(d.why)}</td><td>${esc(d.where)}</td><td>${esc(d.target)}</td></tr>`).join("") + "</tbody>";

document.getElementById("foot").textContent = "Built by the FlexiTog route simulator. Cost to serve covers everything between Helmond stock and goods at the customer, excluding the goods themselves and recoverable import VAT. Stocked scenarios assume stock on hand in the region.";
</script>
"""
