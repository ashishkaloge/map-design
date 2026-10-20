// Hover targets for the HTML page: named features with their screen geometry,
// so the page can find the feature under the cursor, describe it and outline it.
// Geometry is stored as integers in tenths of a pixel, each point a delta from
// the previous one, which keeps the index small. It is written into the HTML
// only; the SVG and PNG exports stay as they are.

import { clipPolyline } from "./osm.mjs";

const SCALE = 10;

/** [[x, y], …] in SVG units -> [x0, y0, dx1, dy1, …] in tenths of a unit. */
export function encodePoints(pts) {
  const out = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < pts.length; i++) {
    const x = Math.round(pts[i][0] * SCALE);
    const y = Math.round(pts[i][1] * SCALE);
    if (i > 0 && x === px && y === py) continue;
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

/** Signed shoelace area of a ring in square SVG units. Holes wind the other
 *  way, so summing a polygon's rings and taking the absolute value nets them out. */
export function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

export function lineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/**
 * A hover item: `kind` "line" or "area", `name`, an `info` line, and screen
 * geometry (polylines or rings). Items with no geometry are dropped.
 */
export function hoverItem(kind, name, info, shapes) {
  const g = shapes.filter((s) => s.length >= (kind === "area" ? 3 : 2)).map(encodePoints);
  return g.length ? { k: kind === "area" ? "a" : "l", n: name, i: info, g } : null;
}

const fmt = (v) => (v >= 10 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1));
export const formatKm = (km) => `${km >= 0.95 ? fmt(km) : (Math.round(km * 1000 / 10) * 10).toString()} ${km >= 0.95 ? "km" : "m"}`;
export const formatHectares = (ha) => (ha >= 1 ? `${fmt(ha)} ha` : `${Math.round(ha * 10000).toLocaleString("en-US")} m²`);

/** Drop points closer than `tol` to the last kept one; ends are always kept. */
export function thin(pts, tol) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  const t2 = tol * tol;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [px, py] = out[out.length - 1];
    if ((x - px) ** 2 + (y - py) ** 2 >= t2) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Compact path data: one absolute move, then relative steps at 0.1 px. */
export function lineData(pts, close = false) {
  if (pts.length < 2) return "";
  let px = Math.round(pts[0][0] * 10);
  let py = Math.round(pts[0][1] * 10);
  let d = `M${px / 10},${py / 10}l`;
  let first = true;
  for (let i = 1; i < pts.length; i++) {
    const x = Math.round(pts[i][0] * 10);
    const y = Math.round(pts[i][1] * 10);
    if (x === px && y === py) continue;
    const dx = String((x - px) / 10);
    const dy = String((y - py) / 10);
    d += `${first || dx.startsWith("-") ? "" : " "}${dx}${dy.startsWith("-") ? "" : ","}${dy}`;
    first = false;
    px = x;
    py = y;
  }
  if (first) return "";
  return close ? `${d}z` : d;
}

/** A ring in screen space, or "" when it is sub-pixel or outside the frame. */
export function ringData(pts, tol, [x0, y0, x1, y1]) {
  let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
  for (const [x, y] of pts) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > e) e = y;
  }
  if (c < x0 || a > x1 || e < y0 || b > y1) return "";
  if (c - a < tol * 2.5 && e - b < tol * 2.5) return "";
  const t = thin(pts, tol);
  return t.length >= 3 ? lineData(t, true) : "";
}

const CLASS_LABEL = {
  motorway: "Motorway", trunk: "Trunk road", primary: "Main road", secondary: "Secondary road", tertiary: "Local road",
  residential: "Street", service: "Service road", path: "Path",
};
const CLASS_RANK = Object.fromEntries(["path", "service", "residential", "tertiary", "secondary", "primary", "trunk", "motorway"].map((c, i) => [c, i]));
const KIND_LABEL = {
  river: "River", canal: "Canal", park: "Park", garden: "Garden", cemetery: "Cemetery", nature_reserve: "Nature reserve",
  national_park: "National park", protected_area: "Protected area", museum: "Museum", monument: "Monument",
  attraction: "Attraction", place_of_worship: "Place of worship", castle: "Castle", stadium: "Stadium", theatre: "Theatre",
  library: "Library", townhall: "Town hall", college: "College", university: "University", hospital: "Hospital",
};
const kindLabel = (k) => KIND_LABEL[k] ?? (k ? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");
const UNNAMED_BUILDINGS_MAX = 15000;

/** Named features grouped by name, in screen space, with a one-line description. */
export function buildHover(layers, { drawn, carFree = false, toScreen, view, tol, kmPerPx, showParks = true, showWater = true, buildingsDrawn = false }) {
  const items = [];
  if (!layers.names) return items;
  const lineShapes = (lines) => {
    const out = [];
    for (const l of lines) for (const piece of clipPolyline(l.map(toScreen), view)) out.push(thin(piece.coords, tol));
    return out;
  };
  const ringShapes = (rings) => rings.map((r) => r.map(toScreen));
  const add = (item) => item && items.push(item);
  const english = (en) => (en ? `English: ${en}` : null);

  const streets = new Map();
  for (const s of layers.names.streets) {
    const cls = carFree && s.cls === "path" ? "path" : s.cls;
    if (!drawn.has(cls)) continue;
    const g = streets.get(s.name) ?? { cls, en: s.en, refs: new Set(), lines: [] };
    if (CLASS_RANK[cls] > CLASS_RANK[g.cls]) g.cls = cls;
    if (s.ref) g.refs.add(s.ref);
    g.lines.push(...lineShapes(s.lines));
    streets.set(s.name, g);
  }
  for (const [name, g] of streets) {
    const km = g.lines.reduce((t, l) => t + lineLength(l), 0) * kmPerPx;
    if (!km) continue;
    const info = [CLASS_LABEL[g.cls], [...g.refs].slice(0, 2).join(", ") || null, `${formatKm(km)} in view`, english(g.en)];
    add(hoverItem("line", name, info.filter(Boolean).join(" · "), g.lines));
  }
  if (showWater) {
    const water = new Map();
    for (const w of layers.names.water) {
      const g = water.get(w.name) ?? { kind: w.kind, en: w.en, lines: [] };
      g.lines.push(...lineShapes(w.lines));
      water.set(w.name, g);
    }
    for (const [name, g] of water) add(hoverItem("line", name, [kindLabel(g.kind), english(g.en)].filter(Boolean).join(" · "), g.lines));
  }
  const areas = (list, describe) => {
    const groups = new Map();
    for (const a of list) {
      const key = `${a.name}|${a.kind}`;
      const g = groups.get(key) ?? { ...a, shapes: [] };
      g.shapes.push(...ringShapes(a.rings));
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const shapes = g.shapes.filter((r) => r.some(([x, y]) => x >= view[0] && x <= view[2] && y >= view[1] && y <= view[3]));
      const ha = Math.abs(shapes.reduce((t, r) => t + ringArea(r), 0)) * kmPerPx * kmPerPx * 100;
      add(hoverItem("area", g.name, describe(g, ha), shapes));
    }
  };
  if (showParks) areas(layers.names.parks, (g, ha) => [kindLabel(g.kind), `${formatHectares(ha)} in view`, english(g.en)].filter(Boolean).join(" · "));
  if (buildingsDrawn) {
    const named = layers.buildings.filter((b) => b.name);
    areas(named, (g) => [kindLabel(g.kind), g.height ? `about ${Math.round(g.height)} m tall` : null, english(g.en)].filter(Boolean).join(" · "));
    const plain = layers.buildings.filter((b) => !b.name && b.height);
    if (plain.length <= UNNAMED_BUILDINGS_MAX) {
      for (const b of plain) {
        const shapes = ringShapes(b.rings).filter((r) => r.some(([x, y]) => x >= view[0] && x <= view[2] && y >= view[1] && y <= view[3]));
        add(hoverItem("area", "Building", `about ${Math.round(b.height)} m tall`, shapes));
      }
    }
  }
  return items;
}

