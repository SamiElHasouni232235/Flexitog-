/* FlexiTog dashboard: SVG chart helpers shared by the Benchmarking and Forecast views.
 * Plain SVG strings, no library. Screen charts use the page's CSS tokens (light and dark); print charts
 * (PDF, Word) use fixed hex colours and render to PNG through a canvas.
 * Uses the main script's esc() and fmt().
 */
(function (root) {
"use strict";
const PAL = {
  screen: {ink: "var(--ink)", muted: "var(--muted)", rule: "var(--rule)", TR: "var(--r-TR)", NAF: "var(--r-NAF)", GCC: "var(--r-GCC)", OTH: "var(--r-OTH)",
           q: ["var(--q1)", "var(--q2)", "var(--q3)", "var(--q4)", "var(--q5)"], accent: "var(--accent)", font: "var(--mono)", bg: null, band: "color-mix(in srgb,var(--accent) 22%,transparent)"},
  print: {ink: "#14212c", muted: "#56636f", rule: "#d9dfe4", TR: "#2a78d6", NAF: "#eb6834", GCC: "#1baf7a", OTH: "#8a8984",
          q: ["#b9b0ea", "#8070d6", "#6553c7", "#4f3db0", "#281d66"], accent: "#1f3a55", font: "Arial, Helvetica, sans-serif", bg: "#ffffff", band: "#e2e9f0"},
};
function sfmt(v){ const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e4 ? Math.round(v / 1e3) + "k" : a >= 1e3 ? (v / 1e3).toFixed(1) + "k" : String(Math.round(v * 10) / 10); }
// Nice axis from min (0 or below) to max: about n steps of 1, 2, 2.5 or 5 x 10^k.
function axis(max, n, min){
  min = Math.min(0, min || 0);
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / (n || 4), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step - 1e-9) * step, bottom = Math.floor(min / step + 1e-9) * step, list = [];
  for (let v = bottom; v <= top + step * 1e-6; v += step) list.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return {max: top, min: bottom, list};
}
const svgOpen = (w, h, pal, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label || "chart")}">` + (pal.bg ? `<rect width="${w}" height="${h}" fill="${pal.bg}"/>` : "");
const tx = (pal, x, y, s, o = {}) => `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" text-anchor="${o.a || "start"}" style="fill:${o.fill || pal.muted};font-family:${pal.font};font-size:${o.size || 10.5}px${o.w ? ";font-weight:" + o.w : ""}">${esc(s)}</text>`;
function legendSvg(pal, items, x, y, w){
  let s = "", cx = x, cy = y;
  items.forEach(it => {
    const tw = 22 + String(it.name).length * 6.2;
    if (cx + tw > x + w) { cx = x; cy += 16; }
    s += it.line ? `<line x1="${cx}" x2="${cx + 14}" y1="${cy - 3.5}" y2="${cy - 3.5}" style="stroke:${it.color};stroke-width:3"${it.dash ? ` stroke-dasharray="${it.dash}"` : ""}/>` : `<rect x="${cx}" y="${cy - 9}" width="11" height="11" rx="2" style="fill:${it.color}"/>`;
    s += tx(pal, cx + 18, cy, it.name, {fill: pal.ink, size: 11}); cx += tw + 10;
  });
  return {svg: s, height: cy - y + 16};
}
function frame(pal, o, max, m, w, h, min){
  const t = axis(max, 4, min), ih = h - m.t - m.b, y = v => m.t + ih - ih * (v - t.min) / (t.max - t.min);
  let s = "";
  t.list.forEach(v => { s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" style="stroke:${v === 0 && t.min < 0 ? pal.muted : pal.rule};stroke-width:1"/>` + tx(pal, m.l - 6, y(v) + 3.5, o.fmt ? o.fmt(v) : sfmt(v), {a: "end"}); });
  if (o.yLabel) s += tx(pal, 4, m.t - 12, o.yLabel, {size: 10});
  return {s, y, t};
}
// Show every k-th x label so long monthly axes stay readable.
const labelStep = (n, w) => Math.max(1, Math.ceil(n * 46 / Math.max(200, w - 70)));
// Line chart. Options: labels, series [{name, color, values, width, dash}], ref (horizontal line),
// band {lo: [], hi: [], color} (shaded range), marker (index of a vertical divider, e.g. forecast start).
function lineChart(o){
  const pal = o.pal || PAL.screen, w = o.w || 980;
  const leg = o.legend ? legendSvg(pal, o.series.map(se => ({name: se.name, color: se.color, line: true, dash: se.dash})), 54, 14, w - 70) : {svg: "", height: 0};
  const m = {l: 54, r: 14, t: 14 + leg.height + (o.yLabel ? 16 : 0), b: 26}, h = (o.h || 250) + leg.height;
  const vals = o.series.flatMap(se => se.values.filter(v => v != null)).concat(o.band ? o.band.hi.filter(v => v != null) : []);
  const F = frame(pal, o, Math.max(o.ref || 0, ...vals, 0) * 1.06, m, w, h), n = o.labels.length, iw = w - m.l - m.r;
  const x = i => m.l + iw * (i + 0.5) / n, k = labelStep(n, w);
  let s = svgOpen(w, h, pal, o.label) + leg.svg + F.s;
  if (o.band) {
    const idx = o.band.lo.map((v, i) => i).filter(i => o.band.lo[i] != null && o.band.hi[i] != null);
    if (idx.length) s += `<path d="${idx.map((i, j) => (j ? "L" : "M") + x(i).toFixed(1) + "," + F.y(o.band.hi[i]).toFixed(1)).join("")}${idx.slice().reverse().map(i => "L" + x(i).toFixed(1) + "," + F.y(o.band.lo[i]).toFixed(1)).join("")}Z" style="fill:${o.band.color || pal.band};opacity:.75"><title>${esc(o.band.name || "Range")}</title></path>`;
  }
  if (o.marker != null) s += `<line x1="${(x(o.marker) - iw / n / 2).toFixed(1)}" x2="${(x(o.marker) - iw / n / 2).toFixed(1)}" y1="${m.t}" y2="${h - m.b}" stroke-dasharray="3 3" style="stroke:${pal.muted};stroke-width:1"/>` + (o.markerLabel ? tx(pal, x(o.marker) - iw / n / 2 + 4, m.t + 10, o.markerLabel, {size: 10}) : "");
  o.labels.forEach((l, i) => { if (i % k === 0) s += tx(pal, x(i), h - 9, l, {a: "middle"}); });
  if (o.ref != null) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${F.y(o.ref).toFixed(1)}" y2="${F.y(o.ref).toFixed(1)}" stroke-dasharray="5 4" style="stroke:${pal.muted};stroke-width:1.2"/>`;
  o.series.forEach(se => {
    let d = "", pen = false;
    se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + F.y(v).toFixed(1); pen = true; });
    s += `<path d="${d}" fill="none" stroke-linejoin="round" stroke-linecap="round"${se.dash ? ` stroke-dasharray="${se.dash}"` : ""} style="stroke:${se.color};stroke-width:${se.width || 2}"/>`;
    if (se.dots !== false) se.values.forEach((v, i) => { if (v != null) s += `<circle cx="${x(i).toFixed(1)}" cy="${F.y(v).toFixed(1)}" r="${se.width > 2 ? 3.2 : 2.6}" style="fill:${se.color}"><title>${esc(se.name)} · ${esc(o.labels[i])}: ${esc(o.tip ? o.tip(v) : fmt(v))}</title></circle>`; });
  });
  return s + "</svg>";
}
// Vertical bars, grouped or stacked. Negative values draw below the zero line.
function barsV(o){
  const pal = o.pal || PAL.screen, w = o.w || 980;
  const leg = o.legend ? legendSvg(pal, o.series.map(se => ({name: se.name, color: se.color})), 54, 14, w - 70) : {svg: "", height: 0};
  const m = {l: 54, r: 14, t: 14 + leg.height + (o.yLabel ? 16 : 0), b: 26}, h = (o.h || 250) + leg.height, n = o.labels.length, iw = w - m.l - m.r;
  const pos = i => o.series.reduce((a, se) => a + Math.max(0, se.values[i] || 0), 0), neg = i => o.series.reduce((a, se) => a + Math.min(0, se.values[i] || 0), 0);
  const all = o.series.flatMap(se => se.values.map(v => v || 0));
  const max = o.stacked ? Math.max(0, ...o.labels.map((_, i) => pos(i))) : Math.max(0, ...all);
  const min = o.stacked ? Math.min(0, ...o.labels.map((_, i) => neg(i))) : Math.min(0, ...all);
  const F = frame(pal, o, max * 1.06, m, w, h, min * 1.06), band = iw / n, pad = band * 0.16, inner = band - 2 * pad, k = labelStep(n, w);
  let s = svgOpen(w, h, pal, o.label) + leg.svg + F.s;
  o.labels.forEach((l, i) => {
    const x0 = m.l + band * i + pad;
    if (i % k === 0) s += tx(pal, m.l + band * (i + 0.5), h - 9, l, {a: "middle"});
    let up = 0, down = 0;
    o.series.forEach((se, j) => {
      const v = se.values[i] || 0; if (!v) return;
      const bw = o.stacked ? inner : inner / o.series.length, bx = o.stacked ? x0 : x0 + bw * j;
      const from = o.stacked ? (v > 0 ? up : down) : 0, to = from + v;
      const y1 = F.y(Math.max(from, to)), y0 = F.y(Math.min(from, to));
      s += `<rect x="${bx.toFixed(1)}" y="${y1.toFixed(1)}" width="${Math.max(1, bw - (o.stacked ? 0 : 1.5)).toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" style="fill:${se.colorFor ? se.colorFor(v) : se.color}"><title>${esc(se.name)} · ${esc(l)}: ${esc(o.tip ? o.tip(v) : fmt(v))}</title></rect>`;
      if (o.stacked) { if (v > 0) up += v; else down += v; }
    });
  });
  if (o.line) {
    const x = i => m.l + band * (i + 0.5);
    s += `<path d="${o.line.values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + F.y(v).toFixed(1)).join("")}" fill="none" style="stroke:${o.line.color};stroke-width:2"${o.line.dash ? ` stroke-dasharray="${o.line.dash}"` : ""}/>`;
  }
  return s + "</svg>";
}
function barsH(o){
  const pal = o.pal || PAL.screen, w = o.w || 980, lw = o.labelW || 190, row = 22, m = {l: lw, r: 16 + 6.6 * Math.max(6, ...o.items.map(i => String(i.text || "").length)), t: 8, b: 8};
  const h = m.t + m.b + o.items.length * row, max = Math.max(0, ...o.items.map(i => i.value)) || 1, iw = w - m.l - m.r;
  let s = svgOpen(w, h, pal, o.label);
  o.items.forEach((it, i) => {
    const y = m.t + i * row, bw = iw * it.value / max, lab = String(it.label);
    s += tx(pal, m.l - 8, y + 15, lab.length > 30 ? lab.slice(0, 29) + "…" : lab, {a: "end", fill: pal.ink});
    s += `<rect x="${m.l}" y="${y + 4}" width="${Math.max(1, bw).toFixed(1)}" height="${row - 8}" rx="2" style="fill:${it.color}"><title>${esc(lab)}: ${esc(it.tip || fmt(it.value))}</title></rect>`;
    s += tx(pal, m.l + bw + 6, y + 15, it.text || sfmt(it.value));
  });
  return s + "</svg>";
}
const legendHtml = items => `<div class="blegend">${items.map(i => `<span><i class="${i.sq ? "sq" : ""}" style="background:${i.color}${i.dash ? ";background:repeating-linear-gradient(90deg," + i.color + " 0 4px,transparent 4px 7px)" : ""}"></i>${esc(i.name)}</span>`).join("")}</div>`;
function svgToPng(svg, w, h, scale){
  scale = scale || 2;
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = w * scale; c.height = h * scale;
        const g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/png"), bin = atob(url.split(",")[1]), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        res({url, bytes, w, h});
      } catch (e) { rej(e); }
    };
    img.onerror = () => rej(new Error("chart image failed"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}
const svgSize = svg => { const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return m ? [+m[1], +m[2]] : [760, 260]; };
root.FlexCharts = {PAL, sfmt, axis, svgOpen, tx, legendSvg, frame, lineChart, barsV, barsH, legendHtml, svgToPng, svgSize};
})(window);
