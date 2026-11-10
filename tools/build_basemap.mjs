// Build flexitog/assets/basemap.json: Mercator-projected SVG paths for every country (Antarctica
// left out), from Natural Earth 1:50m (world-atlas on npm).
//
//   npm pack world-atlas@2.0.2 topojson-client@3.1.0   (unpack both next to this script's cwd)
//   node tools/build_basemap.mjs <world-atlas dir> <topojson-client.js> <num2iso.json> <out.json>
import fs from "node:fs";
import { createRequire } from "node:module";

const [atlasDir, tjcPath, isoPath, outPath] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const topojson = require(tjcPath);
const world = JSON.parse(fs.readFileSync(`${atlasDir}/countries-50m.json`, "utf8"));
const num2iso = JSON.parse(fs.readFileSync(isoPath, "utf8"));

// Extent: the whole world from latitude 80N to 58S (Antarctica left out). The scale is fixed by
// the study area (lon -18 to 64 = 1000 units wide); the dashboard reads lonMin, k and yTop from the
// file, so the extent sets only the origin.
const VIEW = { lonMin: -180, lonMax: 180, latMin: -58, latMax: 80 };
const SCALE_LON = 82;
const rad = d => (d * Math.PI) / 180;
const my = lat => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const k = 1000 / rad(SCALE_LON);
const WIDTH = Math.round(k * rad(VIEW.lonMax - VIEW.lonMin));
const yTop = my(VIEW.latMax);
const HEIGHT = Math.round(k * (yTop - my(VIEW.latMin)));
const project = ([lon, lat]) => [k * rad(lon - VIEW.lonMin), k * (yTop - my(Math.max(-85, Math.min(85, lat))))];
// Simplification step in map units (1 unit is about 9 km at the equator). Finer in the study and
// supplier area, coarser elsewhere to keep the file small.
const STUDY = { lonMin: -30, lonMax: 130, latMin: -10, latMax: 72 };
const step = ([lon, lat]) => (lon >= STUDY.lonMin && lon <= STUDY.lonMax && lat >= STUDY.latMin && lat <= STUDY.latMax ? 0.6 : 1.4);
// Countries without an ISO numeric code in Natural Earth.
const ISO_BY_NAME = { Kosovo: "XK" };

// Label point: the interior point farthest from the ring's edge (grid search), so labels sit
// inside concave countries such as Croatia or Norway.
function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function edgeDist([x, y], ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i], dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
function labelPoint(ring, bb) {
  let best = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], bd = -1;
  const n = 40;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const p = [bb[0] + ((bb[2] - bb[0]) * i) / n, bb[1] + ((bb[3] - bb[1]) * j) / n];
    if (!inside(p, ring)) continue;
    const d = edgeDist(p, ring);
    if (d > bd) { bd = d; best = p; }
  }
  return best;
}

const geo = topojson.feature(world, world.objects.countries);
const pad = 60;
const countries = [];
let wraps = 0;
for (const f of geo.features) {
  if (f.properties.name === "Antarctica") continue;
  const iso = num2iso[String(f.id).padStart(3, "0")] || ISO_BY_NAME[f.properties.name] || null;
  const polys = f.geometry ? (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) : [];
  let d = "";
  let best = null;
  // A ring that crosses the antimeridian (Russia's Chukotka, Fiji) is drawn twice, unwrapped east
  // and west, so each side of the map shows its part without a line across the world.
  const rings = [];
  for (const poly of polys) for (const [ri, ring] of poly.entries()) {
    const wrapsHere = ring.some((p, i) => i && Math.abs(p[0] - ring[i - 1][0]) > 180);
    if (!wrapsHere) { rings.push([ri, ring]); continue; }
    rings.push([ri, ring.map(([lo, la]) => [lo < 0 ? lo + 360 : lo, la])]);
    rings.push([1, ring.map(([lo, la]) => [lo > 0 ? lo - 360 : lo, la])]);
  }
  {
    for (const [ri, ring] of rings) {
      const pts = ring.map(project);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      if (bb[2] < -pad || bb[0] > WIDTH + pad || bb[3] < -pad || bb[1] > HEIGHT + pad) continue;
      for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - pts[i - 1][0]) > WIDTH / 2) wraps++;
      let last = null, seg = "";
      for (const [i, p] of pts.entries()) {
        const q = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
        if (last && Math.abs(q[0] - last[0]) + Math.abs(q[1] - last[1]) < step([((ring[i][0] + 540) % 360) - 180, ring[i][1]])) continue;
        seg += (seg ? "L" : "M") + q[0] + "," + q[1];
        last = q;
      }
      if (seg.split("L").length < 3) continue;
      d += seg + "Z";
      const area = (bb[2] - bb[0]) * (bb[3] - bb[1]);
      if (ri === 0 && (!best || area > best.area)) best = { area, pts, bb };
    }
  }
  if (!d) continue;
  countries.push({ iso, name: f.properties.name, d, c: best ? labelPoint(best.pts, best.bb).map(v => Math.round(v)) : null });
}
if (wraps) console.warn(`${wraps} segment(s) jump across the antimeridian`);
const out = { view: VIEW, width: WIDTH, height: HEIGHT, k, yTop, source: "Natural Earth 1:50m via world-atlas 2.0.2", countries };
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`${countries.length} countries, ${WIDTH}x${HEIGHT}, ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`);
