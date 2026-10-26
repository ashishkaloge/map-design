// Regions, projections and fitting.
import * as G from "../vendor/geo.mjs";
import { features, findCountry, suggestCountries } from "./data.mjs";
import { SpecError } from "./errors.mjs";

const RAD = Math.PI / 180;

// Hand-tuned frames for common regions: [projection, rotate, bbox w,s,e,n].
const REGIONS = {
  europe: { proj: "azimuthal-equal-area", rotate: [-14, -52], bbox: [-24, 34, 42, 71] },
  africa: { proj: "azimuthal-equal-area", rotate: [-18, -2], bbox: [-19, -36, 53, 38] },
  asia: { proj: "azimuthal-equal-area", rotate: [-92, -38], bbox: [26, -11, 150, 77] },
  "north america": { proj: "azimuthal-equal-area", rotate: [100, -48], bbox: [-168, 8, -52, 78] },
  "south america": { proj: "azimuthal-equal-area", rotate: [60, 20], bbox: [-82, -56, -34, 13] },
  oceania: { proj: "azimuthal-equal-area", rotate: [-150, 22], bbox: [110, -48, -150, 2] },
  "middle east": { proj: "azimuthal-equal-area", rotate: [-45, -28], bbox: [25, 12, 63, 42] },
  "south asia": { proj: "azimuthal-equal-area", rotate: [-80, -22], bbox: [60, 5, 98, 37] },
  "east asia": { proj: "azimuthal-equal-area", rotate: [-115, -36], bbox: [73, 18, 146, 54] },
  "southeast asia": { proj: "azimuthal-equal-area", rotate: [-115, -5], bbox: [92, -11, 141, 28] },
  "central america": { proj: "azimuthal-equal-area", rotate: [80, -15], bbox: [-93, 7, -59, 24] },
  caribbean: { proj: "azimuthal-equal-area", rotate: [72, -18], bbox: [-86, 10, -59, 27] },
  "western europe": { proj: "azimuthal-equal-area", rotate: [-5, -48], bbox: [-11, 36, 16, 59] },
  nordics: { proj: "azimuthal-equal-area", rotate: [-15, -63], bbox: [-25, 54, 32, 71.5] },
  "arctic": { proj: "azimuthal-equal-area", rotate: [0, -90], bbox: [-180, 60, 180, 90] },
};

const PROJECTIONS = {
  "equal-earth": () => G.geoEqualEarth(),
  "natural-earth": () => G.geoNaturalEarth1(),
  mercator: () => G.geoMercator(),
  "transverse-mercator": () => G.geoTransverseMercator(),
  orthographic: () => G.geoOrthographic(),
  globe: () => G.geoOrthographic(),
  "albers-usa": () => G.geoAlbersUsa(),
  albers: () => G.geoAlbers(),
  "conic-equal-area": () => G.geoConicEqualArea(),
  "conic-conformal": () => G.geoConicConformal(),
  "azimuthal-equal-area": () => G.geoAzimuthalEqualArea(),
  equirectangular: () => G.geoEquirectangular(),
  stereographic: () => G.geoStereographic(),
};

export const projectionNames = () => Object.keys(PROJECTIONS);

export function makeProjection(name) {
  const make = PROJECTIONS[name];
  if (!make) throw new SpecError(`Unknown projection "${name}". Use one of: ${projectionNames().join(", ")}.`);
  return make();
}

const isUsa = (r) => typeof r === "string" && ["usa", "us", "united states", "united states of america", "conus"].includes(r.toLowerCase());

function bboxCorners([w, s, e, n]) {
  // Densify the edges so curved projections fit the whole frame. Handles
  // boxes that cross the antimeridian (w > e).
  const span = e >= w ? e - w : e + 360 - w;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    let lon = w + (span * i) / 16;
    if (lon > 180) lon -= 360;
    pts.push([lon, s], [lon, n]);
  }
  for (let i = 0; i <= 8; i++) pts.push([w, s + ((n - s) * i) / 8], [e, s + ((n - s) * i) / 8]);
  return { type: "MultiPoint", coordinates: pts };
}

function bboxCenter([w, s, e, n]) {
  let lon = e >= w ? (w + e) / 2 : (w + e + 360) / 2;
  if (lon > 180) lon -= 360;
  return [lon, (s + n) / 2];
}

/**
 * The polygons of a country that a map of it should frame: the largest one
 * plus anything chained to it within ~5°. Leaves out far territories such as
 * French Guiana or the Canary Islands, which still draw if they fall in frame.
 */
export function mainland(feature) {
  const g = feature.geometry;
  if (!g || g.type !== "MultiPolygon") return feature;
  const parts = g.coordinates.map((coords) => {
    const f = { type: "Feature", geometry: { type: "Polygon", coordinates: coords } };
    return { coords, area: G.geoArea(f), box: G.geoBounds(f) };
  });
  parts.sort((a, b) => b.area - a.area);
  const kept = [parts[0]];
  const pool = parts.slice(1).filter((p) => p.area >= parts[0].area * 1e-4);
  let box = [...parts[0].box[0], ...parts[0].box[1]];
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = pool.length - 1; i >= 0; i--) {
      const [[w, s], [e, n]] = pool[i].box;
      const dx = Math.max(0, box[0] - e, w - box[2]);
      const dy = Math.max(0, box[1] - n, s - box[3]);
      if (Math.hypot(dx, dy) <= 5 && e - w < 300) {
        kept.push(pool[i]);
        box = [Math.min(box[0], w), Math.min(box[1], s), Math.max(box[2], e), Math.max(box[3], n)];
        pool.splice(i, 1);
        grew = true;
      }
    }
  }
  return { type: "Feature", properties: feature.properties, geometry: { type: "MultiPolygon", coordinates: kept.map((p) => p.coords) } };
}

export function countryFeature(code, resolution = "50m") {
  const c = findCountry(code);
  if (!c) {
    const s = suggestCountries(code);
    throw new SpecError(`Unknown country "${code}".${s.length ? ` Did you mean ${s.join(", ")}?` : ""}`);
  }
  const f = features(`world-${resolution}`, "countries").features.find((x) => x.properties.iso3 === c.iso3);
  if (!f) throw new SpecError(`${c.name} has no outline at ${resolution} resolution.`);
  return f;
}

/** Pick a projection that suits the extent of `object` (a GeoJSON). */
function autoProjection(object) {
  const [[w, s], [e, n]] = G.geoBounds(object);
  let lonSpan = e - w;
  if (lonSpan < 0) lonSpan += 360;
  const latSpan = n - s;
  const [clon, clat] = G.geoCentroid(object);
  if (lonSpan > 150 || latSpan > 100) return { name: "equal-earth", rotate: [-clon, 0] };
  if (lonSpan > 35 && Math.abs(clat) > 15 && Math.abs(clat) < 75) {
    const p1 = s + latSpan / 6;
    const p2 = n - latSpan / 6;
    return { name: "conic-equal-area", rotate: [-clon, 0], parallels: [p1, p2] };
  }
  return { name: "azimuthal-equal-area", rotate: [-clon, -clat] };
}

function configure(projection, opts, name = "") {
  // Cylindrical projections are only conformal/valid unrotated in latitude:
  // `autoProjection` hands back a rotate with the centre latitude in it (meant for
  // azimuthal/conic), and applying that to mercator tilts the sphere — imagery and
  // graticule stop being axis-aligned. Keep the longitude shift, drop the rest.
  if (opts.rotate && projection.rotate) {
    const cylindrical = name === "mercator" || name === "equirectangular";
    projection.rotate(cylindrical ? [opts.rotate[0] ?? 0, 0] : opts.rotate);
  }
  if (opts.parallels && projection.parallels) projection.parallels(opts.parallels);
  if (opts.center && projection.center) projection.center(opts.center);
  return projection;
}

/**
 * Resolve spec.region + spec.projection into a fitted projection.
 * `extent` is [[x0,y0],[x1,y1]] in SVG pixels. `dataObject` is a GeoJSON used
 * when the region is "auto".
 */
export function frame(spec, extent, dataObject) {
  const region = spec.region ?? "world";
  const userProj = typeof spec.projection === "string" ? { name: spec.projection } : spec.projection ?? {};
  let fit;
  let choice;
  let isWorld = false;
  let usa = false;

  let cropped = false;
  if (region === "world") {
    isWorld = true;
    choice = { name: "equal-earth", rotate: [-11, 0] };
    // Editorial world maps leave out Antarctica unless asked; it is a fifth of
    // the frame and rarely carries data.
    cropped = spec.antarctica !== true;
    // Widen the crop when the data itself reaches past 56°S or 84°N.
    const [lo, hi] = spec._latRange ?? [0, 0];
    const south = Math.max(-90, Math.min(-56, lo - 3));
    const north = Math.min(90, Math.max(84, hi + 3));
    if (south <= -70) cropped = false;
    fit = cropped ? worldGrid(-(userProj.rotate?.[0] ?? choice.rotate[0]), south, north) : { type: "Sphere" };
  } else if (isUsa(region)) {
    usa = true;
    choice = { name: "albers-usa" };
    fit = features("us-states", "nation");
  } else if (typeof region === "string" && REGIONS[region.toLowerCase()]) {
    const r = REGIONS[region.toLowerCase()];
    fit = bboxCorners(r.bbox);
    choice = { name: r.proj, rotate: r.rotate };
  } else if (region === "auto") {
    if (!dataObject) throw new SpecError('region "auto" needs data with locations.');
    // Lines and areas frame to their own extent; scattered points get a minimum frame.
    fit = spec._tight ? padObject(dataObject, spec.padding ?? 0.08, 0, 0) : padObject(dataObject, spec.padding ?? 0.12);
    choice = autoProjection(fit);
  } else if (Array.isArray(region) && region.length === 4 && region.every((v) => typeof v === "number")) {
    fit = bboxCorners(region);
    choice = autoProjection(fit);
    choice.rotate = [-bboxCenter(region)[0], choice.rotate?.[1] ?? 0];
    if (choice.name === "azimuthal-equal-area") choice.rotate = [-bboxCenter(region)[0], -bboxCenter(region)[1]];
  } else if (region && typeof region === "object" && !Array.isArray(region) && region.bbox) {
    return frame({ ...spec, region: region.bbox }, extent, dataObject);
  } else if (region && typeof region === "object" && !Array.isArray(region) && region.center) {
    const km = region.radiusKm ?? 500;
    fit = G.geoCircle().center(region.center).radius(km / 111.2)();
    choice = { name: "azimuthal-equal-area", rotate: [-region.center[0], -region.center[1]] };
  } else {
    const codes = Array.isArray(region) ? region : [region];
    const feats = codes.map((c) => mainland(countryFeature(c)));
    if (codes.length === 1 && findCountry(codes[0])?.iso3 === "USA") {
      usa = true;
      choice = { name: "albers-usa" };
      fit = features("us-states", "nation");
    } else {
      fit = { type: "FeatureCollection", features: feats };
      choice = autoProjection(fit);
    }
  }

  const name = userProj.name ?? choice.name;
  if (name === "globe" || name === "orthographic") {
    const [lon, lat] = userProj.rotate ? [-userProj.rotate[0], -userProj.rotate[1]] : G.geoCentroid(isWorld ? (dataObject ?? fit) : fit);
    const projection = G.geoOrthographic().rotate(userProj.rotate ?? [-lon, -Math.max(-60, Math.min(60, lat))]).precision(0.2);
    projection.fitExtent(extent, { type: "Sphere" });
    return { projection, name: "orthographic", isWorld: true, globe: true, usa: false };
  }
  const projection = makeProjection(name);
  configure(projection, { ...choice, ...userProj }, name);
  if (name === "albers-usa" && !usa) usa = true;
  if (name !== "albers-usa" && usa && region !== "usa") usa = false;
  projection.fitExtent(extent, name === "albers-usa" ? features("us-states", "nation") : fit);
  if (projection.precision) projection.precision(0.3);
  return { projection, name, isWorld: isWorld && name !== "albers-usa", usa: name === "albers-usa", fit, cropped };
}

/** Points spanning the whole width of a world map between two latitudes. */
function worldGrid(centerLon, south = -56, north = 84) {
  const pts = [];
  for (let lat = south; lat <= north + 1e-9; lat += (north - south) / 20) {
    for (let i = 0; i <= 72; i++) pts.push([centerLon - 179.9 + (359.8 * i) / 72, lat]);
  }
  return { type: "MultiPoint", coordinates: pts };
}

function padObject(obj, pad, minSpan = 1.2, minPad = 0.15) {
  const [[w, s], [e, n]] = G.geoBounds(obj);
  let span = e - w;
  if (span < 0) span += 360;
  const dx = Math.max(span * pad, (minSpan - span) / 2, minPad, 1e-4);
  const dy = Math.max((n - s) * pad, (minSpan - (n - s)) / 2, minPad, 1e-4);
  return bboxCorners([w - dx, Math.max(-89, s - dy), e + dx, Math.min(89, n + dy)]);
}

/** Great-circle points between two [lon, lat] positions. */
export function greatCircle(a, b, steps) {
  const d = G.geoDistance(a, b);
  const k = steps ?? Math.max(8, Math.ceil((d / RAD) * 1.5));
  const interp = G.geoInterpolate(a, b);
  return Array.from({ length: k + 1 }, (_, i) => interp(i / k));
}

/** Lowest and highest latitude reached by segments, following great circles when asked. */
export function latitudeRange(segments, geodesic = true) {
  let lo = 90;
  let hi = -90;
  for (const [a, b] of segments) {
    const pts = geodesic ? greatCircle(a, b, 48) : [a, b];
    for (const [, lat] of pts) {
      if (lat < lo) lo = lat;
      if (lat > hi) hi = lat;
    }
  }
  return lo > hi ? [0, 0] : [lo, hi];
}

export function distanceKm(a, b) {
  return G.geoDistance(a, b) * 6371.0088;
}

export { G };
