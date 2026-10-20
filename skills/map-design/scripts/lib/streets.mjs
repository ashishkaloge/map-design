// "basemap": "streets" — a vector street basemap for city-scale data maps, drawn
// from the same OpenMapTiles vector tiles as posters and coloured from the map's
// own theme. Unlike raster tiles it stays sharp at any export size, works in any
// projection, and keeps quiet under the data: roads, water, parks and (at the
// closest zoom) buildings, with no labels baked in. Named streets, waterways and
// parks become hover targets in the HTML.
import { SpecError } from "./errors.mjs";
import { mix } from "./color.mjs";
import { chooseVectorZoom, fetchVectorTiles, decodeTiles, LIMITS, VECTOR_ATTRIBUTION } from "./vtiles.mjs";
import { clipPolyline } from "./osm.mjs";
import { buildHover, thin, lineData, ringData } from "./hover.mjs";
import { n } from "./svg.mjs";

const ORDER = ["path", "service", "residential", "tertiary", "secondary", "primary", "trunk", "motorway"];
// Road tone as a share of the way from land colour to text colour, and width at
// a 1500 px map. Muted on purpose: the data sits on top.
const TONE = { motorway: 0.46, trunk: 0.43, primary: 0.38, secondary: 0.32, tertiary: 0.26, residential: 0.18, service: 0.12, path: 0.1 };
const WIDTH = { motorway: 2.2, trunk: 2, primary: 1.7, secondary: 1.3, tertiary: 1.05, residential: 0.65, service: 0.45, path: 0.4 };

export function isStreetBasemap(basemap) {
  return basemap === "streets" || (basemap != null && typeof basemap === "object" && !Array.isArray(basemap) && basemap.preset === "streets");
}

/** Validate { preset: "streets", maxTiles, zoom, opacity }. */
export function resolveStreetBasemap(basemap) {
  const cfg = typeof basemap === "string" ? {} : { ...basemap };
  const int = (v, name, lo, hi) => {
    if (v == null) return null;
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new SpecError(`basemap.${name} must be an integer between ${lo} and ${hi}, got ${JSON.stringify(v)}.`);
    return v;
  };
  for (const k of Object.keys(cfg)) {
    if (!["preset", "maxTiles", "zoom", "opacity"].includes(k)) throw new SpecError(`basemap.${k} is not an option of the streets basemap (use maxTiles, zoom or opacity).`);
  }
  if (cfg.opacity != null && (typeof cfg.opacity !== "number" || !(cfg.opacity >= 0 && cfg.opacity <= 1))) {
    throw new SpecError(`basemap.opacity must be a number between 0 and 1, got ${JSON.stringify(cfg.opacity)}.`);
  }
  return { maxTiles: int(cfg.maxTiles, "maxTiles", 1, LIMITS.tiles) ?? 144, zoom: int(cfg.zoom, "zoom", 0, 14), opacity: cfg.opacity ?? 1, attribution: VECTOR_ATTRIBUTION };
}

/** Lon/lat bounds of a pixel rect, sampled along its edges. */
function frameBox(projection, [[x0, y0], [x1, y1]]) {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    for (const p of [[x0 + t * (x1 - x0), y0], [x0 + t * (x1 - x0), y1], [x0, y0 + t * (y1 - y0)], [x1, y0 + t * (y1 - y0)]]) {
      const ll = projection.invert(p);
      if (!ll || !ll.every(Number.isFinite)) continue;
      west = Math.min(west, ll[0]);
      east = Math.max(east, ll[0]);
      south = Math.min(south, ll[1]);
      north = Math.max(north, ll[1]);
    }
  }
  return { west, east, south: Math.max(-85, south), north: Math.min(85, north) };
}

/**
 * Draw the street basemap for a framed map. Returns { group, notes, hover }.
 * The zoom follows the map's scale (one tile pixel per map pixel or a little
 * finer), then steps down until the tile count fits `maxTiles`.
 */
export async function streetBasemap({ cfg, theme, projection, rect, log }) {
  const [[x0, y0], [x1, y1]] = rect;
  const box = frameBox(projection, rect);
  if (!(box.east > box.west && box.north > box.south)) throw new SpecError("basemap: cannot work out the area this map shows.");
  if (box.east - box.west > 60) throw new SpecError('The "streets" basemap is for city and regional maps; this frame spans more than 60° of longitude.');
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const a = projection.invert([cx, cy]);
  const b = projection.invert([cx + 1, cy]);
  const metersPerPx = Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110540);
  const ideal = Math.log2((40075016 * Math.cos((a[1] * Math.PI) / 180)) / (256 * metersPerPx));
  const want = cfg.zoom ?? Math.max(0, Math.min(14, Math.round(ideal) + 1));
  const pick = chooseVectorZoom(box, { maxZoom: want, budgets: {}, maxTiles: cfg.maxTiles });
  const got = await fetchVectorTiles(pick, { log });
  const layers = decodeTiles(got.tiles);

  const W = x1 - x0;
  const unit = W / 1500;
  const tol = 0.3 * unit;
  const view = [x0 - 10, y0 - 10, x1 + 10, y1 + 10];
  const toScreen = (p) => projection(p);
  const lines = (list) => {
    const out = [];
    for (const l of list) for (const piece of clipPolyline(l.map(toScreen), view)) out.push(lineData(thin(piece.coords, tol)));
    return out.join("");
  };
  const polys = (list) => list.map((rings) => rings.map((r) => ringData(r.map(toScreen), tol, view)).join("")).join("");
  const ink = (t) => mix(theme.land, theme.text, t);
  const park = mix(theme.land, "#5E9A55", theme.dark ? 0.16 : 0.24);
  const water = theme.water ?? theme.ocean;

  const parts = [`<rect x="${n(x0)}" y="${n(y0)}" width="${n(W)}" height="${n(y1 - y0)}" fill="${theme.land}"/>`];
  const add = (cls, d, attrs) => d && parts.push(`<path class="${cls}" d="${d}" ${attrs}/>`);
  add("streets-park", polys(layers.parks), `fill="${park}"`);
  add("streets-water", polys(layers.water), `fill="${water}"`);
  add("streets-river", lines(layers.rivers.map((r) => r.line)), `fill="none" stroke="${water}" stroke-width="${n(1.6 * unit, 2)}" stroke-linecap="round"`);
  const buildings = polys(layers.buildings.map((bd) => bd.rings));
  if (buildings.length <= 4e6) add("streets-buildings", buildings, `fill="${ink(0.06)}"`);
  add("streets-rail", lines(layers.rail), `fill="none" stroke="${ink(0.3)}" stroke-width="${n(0.6 * unit, 2)}" stroke-dasharray="${n(3 * unit)} ${n(1.6 * unit)}"`);
  const drawn = new Set();
  for (const cls of ORDER) {
    const d = lines(layers.roads[cls] ?? []);
    if (!d) continue;
    drawn.add(cls);
    add(`streets-road ${cls}`, d, `fill="none" stroke="${ink(TONE[cls])}" stroke-width="${n(WIDTH[cls] * unit, 2)}" stroke-linecap="round" stroke-linejoin="round"`);
  }
  const hover = buildHover(layers, { drawn, toScreen, view, tol, kmPerPx: metersPerPx / 1000 });
  const notes = [
    `basemap: ${got.count} vector tiles at zoom ${got.zoom} from OpenFreeMap${got.downloaded ? `, ${got.downloaded} downloaded (${(got.bytes / 1e6).toFixed(1)} MB)` : ", all cached"} (${VECTOR_ATTRIBUTION})`,
  ];
  if (hover.length) notes.push(`Hover details in the HTML: ${hover.length} named streets, waterways and parks.`);
  const style = cfg.opacity < 1 ? ` opacity="${n(cfg.opacity, 2)}"` : "";
  return { group: `<g class="basemap-streets"${style}>${parts.join("")}</g>`, notes, hover };
}
