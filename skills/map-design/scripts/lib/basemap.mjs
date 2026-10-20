// Base layers shared by every editorial map: water, graticule, land, borders,
// rivers and the antique coastal ripples.
import { G } from "./geo.mjs";
import { features, meshOf, usStateFeatures, admin1Mesh, hasAdmin1 } from "./data.mjs";
import { n } from "./svg.mjs";

export function pathFor(projection) {
  return G.geoPath(projection).digits(1);
}

/**
 * Draw the base map. Returns { under, over, countries, path } where `under`
 * goes below thematic layers and `over` (borders, sphere outline) above them.
 */
export function basemap({ framed, theme, rect, spec, focus = [], thematic = false, admin1Of, raster = "", coast = true }) {
  const { projection, isWorld, usa, globe, cropped } = framed;
  const path = pathFor(projection);
  const [[x0, y0], [x1, y1]] = rect;
  const unit = (x1 - x0) / 1500;
  const under = [];
  const over = [];
  const resolution = isWorld && !globe ? "110m" : globe ? "110m" : "50m";
  const showGraticule = spec.graticule ?? (theme.graticuleOn || globe);

  // Water
  if (isWorld || globe) {
    under.push(`<path d="${path({ type: "Sphere" })}" fill="${theme.ocean}"/>`);
  } else if (!usa) {
    under.push(`<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" fill="${theme.ocean}"/>`);
  }
  if (showGraticule && !usa) {
    under.push(`<path d="${path(G.geoGraticule10())}" fill="none" stroke="${theme.graticule}" stroke-width="${n(Math.max(0.5, 0.7 * unit), 2)}"/>`);
  }

  if (usa) {
    const nation = features("us-states", "nation");
    if (theme.ripples) under.push(ripples(path(nation), theme, unit));
    under.push(`<path d="${path(nation)}" fill="${theme.land}"/>`);
    const states = meshOf("us-states", "states", (a, b) => a !== b);
    over.push(`<path d="${path(states)}" fill="none" stroke="${thematic ? theme.border : theme.coast}" stroke-width="${n(Math.max(0.6, 0.9 * unit), 2)}" stroke-linejoin="round"/>`);
    over.push(`<path d="${path(meshOf("us-states", "nation"))}" fill="none" stroke="${theme.coast}" stroke-width="${n(Math.max(0.5, 0.7 * unit), 2)}"/>`);
    return { under, over, path, states: usStateFeatures(), resolution };
  }

  const countries = features(`world-${resolution}`, "countries");
  const land = `world-${resolution}`;
  const landPath = path(dropSeams(meshOf(land, "countries", (a, b) => a === b && !(cropped && a.properties.iso3 === "ATA"))));
  if (theme.ripples) {
    const coasts = cropped ? { type: "FeatureCollection", features: features(land, "countries").features.filter((f) => f.properties.iso3 !== "ATA") } : features(land, "countries");
    under.push(ripples(path(coasts), theme, unit));
  }
  const focusSet = new Set(focus);
  const ctx = [];
  const foc = [];
  for (const f of countries.features) {
    if (cropped && f.properties.iso3 === "ATA") continue;
    const d = path(f);
    if (!d) continue;
    (focusSet.size && !focusSet.has(f.properties.iso3) ? ctx : foc).push(d);
  }
  if (ctx.length) under.push(`<path d="${ctx.join("")}" fill="${theme.context}"/>`);
  if (foc.length) under.push(`<path d="${foc.join("")}" fill="${theme.land}"/>`);

  if (spec.rivers ?? theme.rivers) {
    const rivers = features("physical-50m", "rivers");
    const ranked = { ...rivers, features: rivers.features.filter((f) => f.properties.rank <= (isWorld ? 4 : 6)) };
    under.push(`<path d="${path(ranked)}" fill="none" stroke="${theme.river}" stroke-opacity="0.75" stroke-width="${n(Math.max(0.45, 0.65 * unit), 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  if (admin1Of && hasAdmin1(admin1Of)) {
    over.push(`<path d="${path(admin1Mesh(admin1Of))}" fill="none" stroke="${thematic ? theme.border : theme.coast}" stroke-width="${n(Math.max(0.4, 0.6 * unit), 2)}" stroke-dasharray="${thematic ? "" : `${n(3 * unit)} ${n(2 * unit)}`}" stroke-linejoin="round"/>`);
  }
  const borders = meshOf(land, "countries", (a, b) => a !== b);
  over.push(`<path d="${path(borders)}" fill="none" stroke="${theme.border}" stroke-width="${n(Math.max(0.6, (thematic ? 0.8 : 0.9) * unit), 2)}" stroke-linejoin="round"/>`);
  // A street basemap draws its own detailed shoreline; the 1:50m one would not match it.
  if (coast) over.push(`<path d="${landPath}" fill="none" stroke="${theme.coast}" stroke-width="${n(Math.max(0.4, 0.6 * unit), 2)}" stroke-linejoin="round"/>`);
  if (isWorld && !cropped) over.push(`<path d="${path({ type: "Sphere" })}" fill="none" stroke="${theme.sphere}" stroke-width="${n(Math.max(0.8, 1.1 * unit), 2)}"/>`);

  // A raster basemap replaces the whole vector under-layer (water, graticule,
  // land, context fills, rivers): keeping any of it would paint over the imagery.
  // Borders and coastline outlines still draw on top of the tiles.
  if (raster) {
    under.length = 0;
    under.push(raster);
  }
  return { under, over, path, countries, resolution };
}

/** Concentric strokes around coasts, drawn under the land fill. */
function ripples(d, theme, unit) {
  const rings = [
    [16, 0.05],
    [10, 0.08],
    [5.5, 0.12],
    [2.4, 0.2],
  ];
  return rings
    .map(([w, o]) => `<path d="${d}" fill="none" stroke="${theme.coast}" stroke-opacity="${o}" stroke-width="${n(w * unit, 2)}" stroke-linejoin="round"/>`)
    .join("");
}

/**
 * Natural Earth closes Antarctica along the antimeridian down to the pole.
 * That edge is not a coast, so leave it out of coastline strokes.
 */
function dropSeams(mesh) {
  const seam = ([lon, lat]) => Math.abs(Math.abs(lon) - 180) < 1e-6 || lat < -89.999;
  const lines = [];
  for (const line of mesh.coordinates) {
    let cur = [line[0]];
    for (let i = 1; i < line.length; i++) {
      if (seam(line[i - 1]) && seam(line[i])) {
        if (cur.length > 1) lines.push(cur);
        cur = [line[i]];
      } else cur.push(line[i]);
    }
    if (cur.length > 1) lines.push(cur);
  }
  return { type: "MultiLineString", coordinates: lines };
}
