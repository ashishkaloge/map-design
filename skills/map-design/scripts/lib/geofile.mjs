// The user's own geometry: GeoJSON, TopoJSON, GPX and KML files read into one
// GeoJSON FeatureCollection, checked and wound the way the renderer expects.
// Nothing is reprojected or guessed: coordinates that are not longitude and
// latitude stop with an error that says how to convert them.
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname, basename } from "node:path";
import { G } from "./geo.mjs";
import { SpecError } from "./errors.mjs";

/** Rows read from a geo file carry their geometry under this key. */
export const GEOMETRY = Symbol("geometry");

const GEO_EXTENSIONS = new Set([".geojson", ".topojson", ".gpx", ".kml"]);
const CONVERT = "Convert it to GeoJSON in longitude/latitude (WGS 84), for example `npx mapshaper in.shp -proj wgs84 -o format=geojson out.geojson` or `ogr2ogr -t_srs EPSG:4326 out.geojson in.shp`.";

export const isGeoPath = (value) => typeof value === "string" && GEO_EXTENSIONS.has(extname(value).toLowerCase());

/**
 * Read a geo file named by a spec. Returns { collection, format, notes }.
 * `object` picks one object out of a TopoJSON file with several.
 */
export function readGeoFile(value, base, { field = "file", object, rows = false } = {}) {
  if (typeof value !== "string") throw new SpecError(`${field} must be a path to a GeoJSON, TopoJSON, GPX or KML file.`);
  const file = resolve(base, value);
  const ext = extname(file).toLowerCase();
  if (ext === ".shp" || ext === ".zip" || ext === ".gpkg") throw new SpecError(`${value}: shapefiles and GeoPackages are not read directly. ${CONVERT}`);
  if (ext === ".kmz") throw new SpecError(`${value}: KMZ is a zipped KML. Unzip it (\`unzip ${basename(value)}\`) and use the doc.kml inside.`);
  if (!existsSync(file)) throw new SpecError(`${field} file not found: ${value} (looked in ${base}).`);
  return parseGeo(readFileSync(file, "utf8"), { name: value, ext, object, rows });
}

/**
 * Parse geo text. `ext` decides between XML formats and JSON. With `rows`,
 * features without geometry are kept (as table rows) instead of dropped.
 */
export function parseGeo(text, { name = "file", ext = ".geojson", object, rows = false } = {}) {
  const notes = [];
  let format;
  let collection;
  let coordinateSystemError;
  if (ext === ".gpx" || ext === ".kml" || /^\s*(<\?xml|<gpx|<kml)/i.test(text)) {
    const root = parseXml(text);
    const top = root.children.find((c) => c.name === "gpx" || c.name === "kml");
    if (!top) throw new SpecError(`${name} is XML but neither GPX nor KML.`);
    format = top.name === "gpx" ? "GPX" : "KML";
    collection = format === "GPX" ? fromGpx(top) : fromKml(top);
  } else {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new SpecError(`${name} is not valid JSON: ${e.message}`);
    }
    coordinateSystemError = crsError(parsed?.crs, name);
    if (coordinateSystemError && !rows) throw coordinateSystemError;
    ({ format, collection } = fromJson(parsed, name, object, notes));
  }
  collection = prepareCollection(collection, name, notes, rows, coordinateSystemError);
  return { collection, format, notes };
}

function fromJson(parsed, name, object, notes) {
  if (parsed?.type === "Topology") {
    const keys = Object.keys(parsed.objects ?? {});
    if (!keys.length) throw new SpecError(`${name} is a TopoJSON file with no objects.`);
    let key = object;
    if (key != null && !keys.includes(key)) throw new SpecError(`${name} has no TopoJSON object "${key}". Objects: ${keys.join(", ")}.`);
    if (key == null) {
      const size = (k) => parsed.objects[k]?.geometries?.length ?? 1;
      key = [...keys].sort((a, b) => size(b) - size(a))[0];
      if (keys.length > 1) notes.push(`${name}: used TopoJSON object "${key}" (others: ${keys.filter((k) => k !== key).join(", ")}; pick one with "object").`);
    }
    let out;
    try {
      out = G.feature(parsed, parsed.objects[key]);
    } catch {
      throw new SpecError(`${name} has invalid TopoJSON geometry in object "${key}". Check its geometry and arc arrays.`);
    }
    if (!out) throw new SpecError(`${name} has invalid TopoJSON geometry in object "${key}".`);
    return { format: "TopoJSON", collection: out.type === "FeatureCollection" ? out : { type: "FeatureCollection", features: [out] } };
  }
  if (parsed?.type === "FeatureCollection" && Array.isArray(parsed.features)) return { format: "GeoJSON", collection: parsed };
  if (parsed?.type === "Feature") return { format: "GeoJSON", collection: { type: "FeatureCollection", features: [parsed] } };
  if (parsed && typeof parsed.type === "string" && (parsed.coordinates || parsed.geometries)) {
    return { format: "GeoJSON", collection: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: parsed }] } };
  }
  throw new SpecError(`${name} is not GeoJSON or TopoJSON (expected a FeatureCollection, Feature or Topology).`);
}

function crsError(crs, name) {
  if (crs == null) return null;
  const label = typeof crs === "string" ? crs : crs.properties?.name
    ?? (typeof crs.type === "string" && crs.type.toLowerCase() === "epsg" ? `EPSG:${crs.properties?.code}` : null);
  const id = String(label ?? "").trim();
  const geographic = /^(?:WGS ?84|(?:OGC:)?CRS84|EPSG:+(?:4326|4269))$/i.test(id)
    || /^urn:(?:x-)?ogc:def:crs:EPSG:(?:[^:]*:)?(?:4326|4269)$/i.test(id)
    || /^urn:(?:x-)?ogc:def:crs:OGC:(?:[^:]*:)?CRS84$/i.test(id)
    || /^https?:\/\/www\.opengis\.net\/def\/crs\/(?:EPSG\/[^/]+\/(?:4326|4269)|OGC\/[^/]+\/CRS84)$/i.test(id)
    || /^https?:\/\/www\.opengis\.net\/gml\/srs\/epsg\.xml#(?:4326|4269)$/i.test(id);
  return geographic ? null : new SpecError(`${name} declares an unsupported coordinate system (${label ?? "unknown CRS"}); geometry must use longitude/latitude. ${CONVERT}`);
}

/**
 * Check every coordinate, densify long edges and wind polygons for d3. Features
 * without usable geometry are dropped and counted, not silently kept. As table
 * rows (`keepEmpty`) they stay, without geometry, and a bad coordinate becomes
 * a note: the table's other columns may be all the map needs.
 */
function prepareCollection(fc, name, notes, keepEmpty, coordinateSystemError) {
  const out = [];
  let empty = 0;
  let vertices = 0;
  let unusable = null;
  for (const [i, f] of (fc.features ?? []).entries()) {
    if (!f) continue;
    if (!f.geometry) {
      if (keepEmpty) out.push({ type: "Feature", properties: f.properties ?? {}, geometry: null });
      else empty++;
      continue;
    }
    let geometry;
    try {
      const error = coordinateSystemError ?? crsError(f.crs, name);
      if (error) throw error;
      geometry = cleanGeometry(f.geometry, (pos) => {
        const [lon, lat] = pos;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new SpecError(`${name}: feature ${i + 1} has a coordinate that is not a number (${JSON.stringify(pos)}).`);
        if (Math.abs(lat) > 90 || Math.abs(lon) > 360) {
          throw new SpecError(`${name}: coordinates such as [${lon}, ${lat}] are not longitude/latitude; the file is in a projected coordinate system. ${CONVERT}`);
        }
        vertices++;
      }, name);
    } catch (e) {
      if (!keepEmpty || !(e instanceof SpecError)) throw e;
      unusable ??= e.message;
      geometry = null;
    }
    if (!geometry) {
      if (keepEmpty) out.push({ type: "Feature", properties: f.properties ?? {}, geometry: null });
      else empty++;
      continue;
    }
    out.push({ type: "Feature", ...(f.id != null ? { id: f.id } : {}), properties: f.properties ?? {}, geometry });
  }
  if (!out.length || (!keepEmpty && !out.some((f) => f.geometry))) throw new SpecError(`${name} has no features with usable geometry.`);
  if (empty) notes.push(`${name}: ${empty} feature(s) without usable geometry were left out.`);
  if (unusable) notes.push(`${unusable} Geometry was ignored; rows are located by their other columns.`);
  if (vertices > 400000) notes.push(`${name}: ${vertices.toLocaleString("en-US")} vertices. The drawing is thinned to the map's resolution, but a smaller file renders faster (\`npx mapshaper ${name} -simplify 10% -o out.geojson\`).`);
  return { type: "FeatureCollection", features: out };
}

function cleanGeometry(g, check, name) {
  if (!g || typeof g !== "object" || Array.isArray(g)) throw new SpecError(`${name}: geometry must be an object with a type and coordinates.`);
  const error = crsError(g.crs, name);
  if (error) throw error;
  const pos = (p) => {
    if (!Array.isArray(p) || p.length < 2) throw new SpecError(`${name}: every position must be an array with longitude and latitude.`);
    check(p);
    return p;
  };
  switch (g.type) {
    case "Point": {
      const c = array(g.coordinates, name);
      return c.length ? { type: "Point", coordinates: pos(c) } : null;
    }
    case "MultiPoint": {
      const c = array(g.coordinates, name).map(pos);
      return c.length ? { type: "MultiPoint", coordinates: c } : null;
    }
    case "LineString": {
      const c = line(g.coordinates, pos, name);
      return c ? { type: "LineString", coordinates: c } : null;
    }
    case "MultiLineString": {
      const c = array(g.coordinates, name).map((l) => line(l, pos, name)).filter(Boolean);
      return c.length ? { type: "MultiLineString", coordinates: c } : null;
    }
    case "Polygon": {
      const c = polygon(g.coordinates, pos, name);
      return c ? { type: "Polygon", coordinates: c } : null;
    }
    case "MultiPolygon": {
      const c = array(g.coordinates, name).map((p) => polygon(p, pos, name)).filter(Boolean);
      return c.length ? { type: "MultiPolygon", coordinates: c } : null;
    }
    case "GeometryCollection": {
      const c = array(g.geometries, name, "geometries").map((x) => cleanGeometry(x, check, name)).filter(Boolean);
      return c.length ? { type: "GeometryCollection", geometries: c } : null;
    }
    default:
      throw new SpecError(`${name}: unsupported geometry type "${g.type}".`);
  }
}

function array(value, name, field = "coordinates") {
  if (!Array.isArray(value)) throw new SpecError(`${name}: geometry ${field} must be an array.`);
  return value;
}

function line(coords, pos, name) {
  const c = array(coords, name).map(pos);
  return c.length >= 2 ? densify(c) : null;
}

function polygon(rings, pos, name) {
  array(rings, name);
  const out = [];
  for (const [i, ring] of rings.entries()) {
    const c = array(ring, name).map(pos);
    // d3 treats the last position as a copy of the first; close open rings so no vertex is lost.
    if (c.length && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1])) c.push(c[0]);
    if (c.length < 4) {
      if (i === 0) return null;
      continue;
    }
    out.push(wind(densify(c), i === 0));
  }
  return out.length ? out : null;
}

/**
 * GIS tools draw an edge as a straight line in longitude/latitude; d3 follows
 * the great circle. Long edges (a border along a parallel, a hand-drawn box)
 * would bow toward the pole, so they get intermediate points every degree.
 */
function densify(coords) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    let dx = x1 - x0;
    // An edge across the antimeridian goes the short way round.
    if (dx > 180) dx -= 360;
    else if (dx < -180) dx += 360;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(y1 - y0)));
    for (let k = 1; k < steps; k++) {
      let x = x0 + (dx * k) / steps;
      if (x > 180) x -= 360;
      else if (x < -180) x += 360;
      out.push([x, y0 + ((y1 - y0) * k) / steps]);
    }
    out.push(coords[i]);
  }
  return out;
}

/**
 * d3 reads a ring as the smaller of the two areas it divides the sphere into
 * only when outer rings run clockwise and holes counterclockwise. GeoJSON
 * (RFC 7946) uses the opposite order, so each ring is checked and turned.
 */
function wind(ring, outer) {
  const area = G.geoArea({ type: "Polygon", coordinates: [ring] });
  const small = area <= 2 * Math.PI;
  return small === outer ? ring : [...ring].reverse();
}

// GPX: waypoints become points, routes and tracks become lines. Elevations
// stay in the coordinates as a third value.
function fromGpx(gpx) {
  const features = [];
  const position = (el) => {
    const lat = coordinate(el.attrs.lat);
    const lon = coordinate(el.attrs.lon);
    const ele = Number(text(child(el, "ele")));
    return Number.isFinite(ele) && text(child(el, "ele")) !== "" ? [lon, lat, ele] : [lon, lat];
  };
  const props = (el, kind) => {
    const p = { gpx: kind };
    for (const k of ["name", "desc", "cmt", "type", "time", "sym"]) {
      const v = text(child(el, k));
      if (v) p[k] = v;
    }
    const ele = text(child(el, "ele"));
    if (kind === "waypoint" && ele !== "" && Number.isFinite(Number(ele))) p.ele = Number(ele);
    return p;
  };
  for (const w of children(gpx, "wpt")) features.push({ type: "Feature", properties: props(w, "waypoint"), geometry: { type: "Point", coordinates: position(w) } });
  for (const r of children(gpx, "rte")) {
    features.push({ type: "Feature", properties: props(r, "route"), geometry: { type: "LineString", coordinates: children(r, "rtept").map(position) } });
  }
  for (const t of children(gpx, "trk")) {
    const segs = children(t, "trkseg").map((s) => children(s, "trkpt").map(position)).filter((s) => s.length >= 2);
    if (!segs.length) continue;
    features.push({
      type: "Feature", properties: props(t, "track"),
      geometry: segs.length === 1 ? { type: "LineString", coordinates: segs[0] } : { type: "MultiLineString", coordinates: segs },
    });
  }
  return { type: "FeatureCollection", features };
}

// KML: every Placemark, in any folder, with its name, description and
// ExtendedData values as properties.
function fromKml(kml) {
  const features = [];
  for (const pm of descendants(kml, "placemark")) {
    const properties = {};
    const name = text(child(pm, "name"));
    if (name) properties.name = name;
    const desc = text(child(pm, "description"));
    if (desc) properties.description = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    for (const d of descendants(child(pm, "extendeddata"), "data")) {
      if (d.attrs.name) properties[d.attrs.name] = coerce(text(child(d, "value")));
    }
    for (const d of descendants(child(pm, "extendeddata"), "simpledata")) {
      if (d.attrs.name) properties[d.attrs.name] = coerce(text(d));
    }
    const geometries = pm.children.map(kmlGeometry).filter(Boolean);
    if (!geometries.length) continue;
    features.push({ type: "Feature", properties, geometry: geometries.length === 1 ? geometries[0] : { type: "GeometryCollection", geometries } });
  }
  return { type: "FeatureCollection", features };
}

function kmlGeometry(el) {
  switch (el.name) {
    case "point": {
      const c = kmlCoords(child(el, "coordinates"));
      return c.length ? { type: "Point", coordinates: c[0] } : null;
    }
    case "linestring":
    case "linearring":
      return { type: "LineString", coordinates: kmlCoords(child(el, "coordinates")) };
    case "polygon": {
      const outer = descendants(child(el, "outerboundaryis"), "coordinates").map(kmlCoords);
      const inner = children(el, "innerboundaryis").flatMap((b) => descendants(b, "coordinates").map(kmlCoords));
      return outer.length ? { type: "Polygon", coordinates: [outer[0], ...inner] } : null;
    }
    case "multigeometry": {
      const parts = el.children.map(kmlGeometry).filter(Boolean);
      return parts.length ? { type: "GeometryCollection", geometries: parts } : null;
    }
    case "track": {
      const c = children(el, "coord").map((x) => text(x).split(/\s+/).map(coordinate));
      return c.length >= 2 ? { type: "LineString", coordinates: c } : null;
    }
    case "multitrack": {
      const parts = children(el, "track").map(kmlGeometry).filter(Boolean);
      return parts.length ? { type: "MultiLineString", coordinates: parts.map((p) => p.coordinates) } : null;
    }
    default:
      return null;
  }
}

function kmlCoords(el) {
  return text(el).split(/\s+/).filter(Boolean).map((t) => t.split(",").map(coordinate));
}

const coordinate = (value) => typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;

function coerce(v) {
  const t = v.trim();
  return t !== "" && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(t) && !/^0\d/.test(t) ? Number(t) : t;
}

// A small XML reader for GPX and KML: elements, attributes, text and CDATA.
// Entities other than the five predefined ones and character references are
// left as written; DOCTYPE declarations are skipped, never expanded.
export function parseXml(src) {
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      top().text += decode(src.slice(i));
      break;
    }
    if (lt > i) top().text += decode(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end < 0 ? src.length : end + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      top().text += src.slice(lt + 9, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + 3;
    } else if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (src.startsWith("<!", lt)) {
      // DOCTYPE, possibly with an internal subset in brackets.
      let depth = 0;
      let j = lt + 2;
      for (; j < src.length; j++) {
        if (src[j] === "[") depth++;
        else if (src[j] === "]") depth--;
        else if (src[j] === ">" && depth <= 0) break;
      }
      i = j + 1;
    } else {
      let j = lt + 1;
      let quote = null;
      for (; j < src.length; j++) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      const tag = src.slice(lt + 1, j);
      i = j + 1;
      if (tag.startsWith("/")) {
        const name = localName(tag.slice(1).trim());
        const at = stack.map((e) => e.name).lastIndexOf(name);
        if (at > 0) stack.length = at;
        continue;
      }
      const self = tag.endsWith("/");
      const body = self ? tag.slice(0, -1) : tag;
      const m = body.match(/^\s*([^\s/>]+)/);
      if (!m) continue;
      const el = { name: localName(m[1]), attrs: {}, children: [], text: "" };
      for (const a of body.slice(m[0].length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        el.attrs[localName(a[1])] = decode(a[2] ?? a[3] ?? "");
      }
      top().children.push(el);
      if (!self) stack.push(el);
    }
  }
  return root;
}

const localName = (n) => n.slice(n.indexOf(":") + 1).toLowerCase();

function decode(s) {
  if (!s.includes("&")) return s;
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "amp") return "&";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

const child = (el, name) => el?.children.find((c) => c.name === name) ?? null;
const children = (el, name) => el?.children.filter((c) => c.name === name) ?? [];
const text = (el) => (el ? el.text.trim() : "");

function descendants(el, name, out = []) {
  if (!el) return out;
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

/** Turn a FeatureCollection into data rows: the properties, with the geometry attached. */
export function rowsFromCollection(fc) {
  return fc.features.map((f) => ({ ...f.properties, [GEOMETRY]: f.geometry }));
}

const POLYGONAL = new Set(["Polygon", "MultiPolygon"]);
const LINEAR = new Set(["LineString", "MultiLineString"]);

/** The polygons, lines or points in a geometry, flattening collections. */
export function geometryParts(g, types) {
  if (!g) return [];
  if (g.type === "GeometryCollection") return g.geometries.flatMap((x) => geometryParts(x, types));
  return types.has(g.type) ? [g] : [];
}

export const isPolygonal = (g) => geometryParts(g, POLYGONAL).length > 0;
export const isLinear = (g) => geometryParts(g, LINEAR).length > 0;
export const polygonParts = (g) => geometryParts(g, POLYGONAL);
export const lineParts = (g) => geometryParts(g, LINEAR);

/** Lines of a geometry as arrays of positions. */
export function lineCoordinates(g) {
  return lineParts(g).flatMap((p) => (p.type === "LineString" ? [p.coordinates] : p.coordinates));
}

/**
 * A geoPath that drops vertices closer than `tolerance` pixels to the line
 * through their neighbours (Douglas-Peucker on projected points). A detailed
 * boundary or a GPS track with 100,000 points draws with the vertices the map
 * can show, so the SVG stays small without visible change.
 */
export function thinnedPath(projection, tolerance = 0.3) {
  const path = G.geoPath({ stream: (out) => projection.stream(thinStream(out, tolerance)) }).digits(1);
  // d3's whole-sphere clip circle (azimuthal projections) drops any vertex within
  // 1e-6 radians (~6 m) of the one before it, so a GPS track logged every few
  // metres loses whole stretches and draws straight chords. Clipping at the
  // antimeridian instead keeps every vertex; data near the map's centre never
  // reaches it. Narrower clips (a globe's back side) are left alone.
  const angle = projection.clipAngle?.();
  if (!angle || angle < 179) return path;
  const unclipped = (fn) => (object) => {
    projection.clipAngle(null);
    try {
      return fn(object);
    } finally {
      projection.clipAngle(angle);
    }
  };
  const draw = unclipped(path);
  for (const k of ["bounds", "area", "centroid", "measure"]) draw[k] = unclipped(path[k]);
  return draw;
}

function thinStream(out, tolerance) {
  let line = null;
  let polygon = false;
  return {
    point(x, y) {
      if (line) line.push([x, y]);
      else out.point(x, y);
    },
    lineStart() {
      line = [];
    },
    lineEnd() {
      const pts = simplify(line, tolerance);
      line = null;
      // Rings smaller than a pixel would only add noise; holes inside them are smaller still.
      if (polygon && (pts.length < 3 || Math.abs(ringArea(pts)) < 0.5)) return;
      out.lineStart();
      for (const [x, y] of pts) out.point(x, y);
      out.lineEnd();
    },
    polygonStart() {
      polygon = true;
      out.polygonStart();
    },
    polygonEnd() {
      polygon = false;
      out.polygonEnd();
    },
    sphere() {
      out.sphere?.();
    },
  };
}

export function simplify(pts, tolerance) {
  const count = pts.length;
  if (count <= 2) return pts;
  const keep = new Uint8Array(count);
  keep[0] = keep[count - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack = [[0, count - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d2 = ex * ex + ey * ey;
      if (d2 > worst) {
        worst = d2;
        at = i;
      }
    }
    if (worst > tol2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function ringArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return s / 2;
}
