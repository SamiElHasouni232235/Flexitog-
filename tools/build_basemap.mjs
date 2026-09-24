// Build flexitog/assets/basemap.json: Mercator-projected SVG paths for Europe, North Africa and
// the Middle East, from Natural Earth 1:50m (world-atlas on npm).
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

// View: Atlantic coast of Morocco to Oman, Sahel to southern Scandinavia.
const VIEW = { lonMin: -18, lonMax: 64, latMin: 10, latMax: 57 };
const WIDTH = 1000;
const rad = d => (d * Math.PI) / 180;
const my = lat => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const k = WIDTH / rad(VIEW.lonMax - VIEW.lonMin);
const yTop = my(VIEW.latMax);
const HEIGHT = Math.round(k * (yTop - my(VIEW.latMin)));
const project = ([lon, lat]) => [k * rad(lon - VIEW.lonMin), k * (yTop - my(Math.max(-80, Math.min(80, lat))))];

const geo = topojson.feature(world, world.objects.countries);
const pad = 60;
const countries = [];
for (const f of geo.features) {
  const iso = num2iso[String(f.id).padStart(3, "0")] || null;
  const polys = f.geometry ? (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) : [];
  let d = "";
  let best = null;
  for (const poly of polys) {
    for (const [ri, ring] of poly.entries()) {
      const pts = ring.map(project);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      if (bb[2] < -pad || bb[0] > WIDTH + pad || bb[3] < -pad || bb[1] > HEIGHT + pad) continue;
      let last = null, seg = "";
      for (const p of pts) {
        const q = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
        if (last && Math.abs(q[0] - last[0]) + Math.abs(q[1] - last[1]) < 0.6) continue;
        seg += (seg ? "L" : "M") + q[0] + "," + q[1];
        last = q;
      }
      if (seg.split("L").length < 3) continue;
      d += seg + "Z";
      const area = (bb[2] - bb[0]) * (bb[3] - bb[1]);
      if (ri === 0 && (!best || area > best.area)) best = { area, c: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] };
    }
  }
  if (!d) continue;
  countries.push({ iso, name: f.properties.name, d, c: best ? best.c.map(v => Math.round(v)) : null });
}
const out = { view: VIEW, width: WIDTH, height: HEIGHT, k, yTop, source: "Natural Earth 1:50m via world-atlas 2.0.2", countries };
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`${countries.length} countries, ${WIDTH}x${HEIGHT}, ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`);
