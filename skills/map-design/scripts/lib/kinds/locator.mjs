// "Where is it?" maps: highlight countries, regions or places with context
// and an inset globe.
import { findCountry, features, placeList, findAdmin1, hasAdmin1 } from "../data.mjs";
import { resolveLocation } from "../locate.mjs";
import { mainland, G } from "../geo.mjs";
import { SpecError } from "../errors.mjs";
import { esc, n } from "../svg.mjs";
import { project, symbolLabels, areaLabels } from "./common.mjs";
import { textBlock, measureLines } from "../labels.mjs";
import { labelPointFromPath } from "../polylabel.mjs";

export function prepare(ctx) {
  const { spec, theme } = ctx;
  const list = [].concat(spec.highlight ?? spec.data ?? []);
  if (!list.length) throw new SpecError('A locator needs "highlight": a country, a region ({ "admin1", "country" }) or places.');
  const areas = [];
  const pts = [];
  for (const h of list) {
    const ref = typeof h === "object" && !Array.isArray(h) ? h : { value: h };
    const label = ref.label;
    if (ref.admin1 && ref.country) {
      const c = findCountry(ref.country);
      const f = c && hasAdmin1(c.iso3) ? findAdmin1(c.iso3, ref.admin1) : null;
      if (!f) throw new SpecError(`Could not find region "${ref.admin1}" in "${ref.country}".`);
      areas.push({ feature: f, label: label ?? f.properties.name, country: c.iso3, kind: "admin1" });
      ctx.report.resolved.push({ ref: JSON.stringify(h), as: `region ${f.properties.id}` });
      continue;
    }
    const asCountry = typeof h === "string" ? findCountry(h) : ref.country && !ref.place && !ref.city ? findCountry(ref.country) : null;
    if (asCountry) {
      const f = features("world-50m", "countries").features.find((x) => x.properties.iso3 === asCountry.iso3);
      areas.push({ feature: f, label: label ?? asCountry.name, country: asCountry.iso3, kind: "country" });
      ctx.report.resolved.push({ ref: typeof h === "string" ? h : JSON.stringify(h), as: `country ${asCountry.iso3}` });
      continue;
    }
    const loc = resolveLocation(typeof h === "object" ? h : h);
    if (loc.warning) ctx.report.warnings.push(loc.warning);
    ctx.report.resolved.push({ ref: typeof h === "string" ? h : JSON.stringify(h), as: loc.how, lon: loc.lon, lat: loc.lat });
    pts.push({ loc, label: label ?? loc.label, sub: ref.sub ?? ref.note });
  }

  // Frame: the highlighted areas with generous context, or the points.
  let dataObject;
  if (areas.length) {
    const fc = { type: "FeatureCollection", features: areas.map((a) => mainland(a.kind === "country" ? a.feature : countryOf(a.country))) };
    const [[w, s], [e, nn]] = G.geoBounds(fc);
    const span = Math.max(e - w < 0 ? e - w + 360 : e - w, nn - s);
    const ctr = G.geoCentroid(fc);
    // Show the area with roughly its own size of context on each side.
    const radius = Math.max(2.5, Math.min(55, span * (spec.context ?? 0.95)));
    dataObject = G.geoCircle().center(ctr).radius(radius)();
    if (areas.some((a) => a.kind === "admin1")) dataObject = fc;
  } else {
    const r = spec.radiusKm ?? 700;
    const coords = pts.map((p) => [p.loc.lon, p.loc.lat]);
    const ctr = G.geoCentroid({ type: "MultiPoint", coordinates: coords });
    const far = Math.max(...coords.map((c) => G.geoDistance(c, ctr) * 6371));
    dataObject = G.geoCircle().center(ctr).radius((far + r) / 111.2)();
  }
  const focusCountries = [...new Set(areas.map((a) => a.country))];

  return {
    dataObject,
    defaultRegion: "auto",
    focus: [],
    admin1Of: areas.find((a) => a.kind === "admin1")?.country ?? (spec.regions ? focusCountries[0] : null),
    draw(env) {
      const { path, projection, unit, theme: t, placer } = env;
      if (spec.inset !== false) {
        const [[, y0], [x1]] = env.rect;
        const r = Math.min(env.rect[1][0] - env.rect[0][0], env.rect[1][1] - y0) * (spec.insetSize ?? 0.12);
        placer.block([x1 - 2 * r - 30 * unit, y0, x1, y0 + 2 * r + 30 * unit]);
      }
      const fills = [];
      const symbols = [];
      const labels = [];
      for (const a of areas) {
        fills.push(`<path d="${path(a.feature)}" fill="${spec.color ?? t.accent}" fill-opacity="${spec.opacity ?? 0.88}" stroke="${t.halo}" stroke-width="${n(0.8 * unit, 2)}"/>`);
      }
      // Points: a marker with a soft ring.
      const ptItems = [];
      for (const d of pts) {
        const p = project(projection, d.loc);
        if (!p) continue;
        const c = spec.color ?? t.accent;
        symbols.push(`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(16 * unit)}" fill="${c}" fill-opacity="0.16"/>`);
        symbols.push(`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(6.5 * unit)}" fill="${c}" stroke="${t.halo}" stroke-width="${n(2 * unit, 2)}"/>`);
        placer.blockCircle(p[0], p[1], 7 * unit);
        ptItems.push({ x: p[0], y: p[1], r: 8 * unit, label: d.label, sub: d.sub });
      }
      labels.push(...symbolLabels(ptItems, env, { size: 17 * unit }));

      // Cities inside the highlighted countries claim their space first.
      if (spec.cities) {
        const want = typeof spec.cities === "number" ? spec.cities : 6;
        const cities = placeList().filter((p) => focusCountries.includes(p.country)).slice(0, want);
        const items = [];
        for (const c of cities) {
          const p = project(projection, c);
          if (!p) continue;
          const r = (c.capital ? 4.2 : 3.2) * unit;
          symbols.push(c.capital
            ? `<rect x="${n(p[0] - r)}" y="${n(p[1] - r)}" width="${n(2 * r)}" height="${n(2 * r)}" fill="${t.text}" stroke="${t.halo}" stroke-width="${n(1.2 * unit, 2)}"/>`
            : `<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(r)}" fill="${t.text}" stroke="${t.halo}" stroke-width="${n(1.2 * unit, 2)}"/>`);
          placer.blockCircle(p[0], p[1], r + 1);
          items.push({ x: p[0], y: p[1], r, label: c.name });
        }
        labels.push(...symbolLabels(items, env, { size: 13.5 * unit, weight: 500 }));
      }
      // Highlight names: inside the shape when they fit, otherwise beside it.
      for (const a of areas) {
        const size = (spec.labelSize ?? 22) * unit;
        const lines = [{ text: a.label.toUpperCase(), size, weight: 700, fill: t.text, letterSpacing: n(size * 0.08) }];
        const m = measureLines(lines, t.fonts.label);
        const pole = labelPointFromPath(path(a.feature));
        let spot = null;
        if (pole && m.w / 2 <= pole.r * 1.8 && m.h / 2 <= pole.r) spot = placer.placeCentered({ x: pole.x, y: pole.y, w: m.w, h: m.h });
        if (!spot) {
          const [[bx0, by0], [bx1, by1]] = path.bounds(a.feature);
          const cx = (bx0 + bx1) / 2;
          spot = placer.placePoint({ x: cx, y: by0, w: m.w, h: m.h, gap: 10 * unit, positions: ["top", "top-right", "top-left"] })
            ?? placer.placePoint({ x: cx, y: by1, w: m.w, h: m.h, gap: 10 * unit, positions: ["bottom", "bottom-right", "bottom-left"] });
        }
        if (spot) labels.push(textBlock({ x: spot.x, y: spot.y, anchor: spot.anchor, lines, halo: t.halo, haloWidth: size * 0.3, family: t.fonts.label }));
      }
      // Context: neighbor names, small and quiet, placed in the visible part of each neighbor.
      if (spec.contextLabels !== false) {
        const exclude = new Set(focusCountries);
        const [[rx0, ry0], [rx1, ry1]] = env.rect;
        const prevClip = projection.clipExtent ? projection.clipExtent() : null;
        if (projection.clipExtent) projection.clipExtent([[rx0, ry0], [rx1, ry1]]);
        const size = 12 * unit;
        const fam = t.fonts.label;
        const items = [];
        for (const f of features("world-50m", "countries").features) {
          if (exclude.has(f.properties.iso3)) continue;
          const d = path(f);
          if (!d) continue;
          const pole = labelPointFromPath(d);
          if (!pole || pole.r < size) continue;
          items.push({ f, pole });
        }
        if (projection.clipExtent) projection.clipExtent(prevClip);
        items.sort((a, b) => b.pole.r - a.pole.r);
        for (const { f, pole } of items) {
          const text = f.properties.name.toUpperCase();
          const lines = [{ text, size, weight: 500, fill: t.muted, letterSpacing: n(size * 0.1) }];
          const m = measureLines(lines, fam);
          if (m.w / 2 > pole.r * 1.9) continue;
          const spot = placer.placeCentered({ x: pole.x, y: pole.y, w: m.w, h: m.h });
          if (spot) labels.push(textBlock({ x: spot.x, y: spot.y, anchor: "middle", lines, family: fam, halo: t.halo, haloWidth: size * 0.25 }));
        }
      }
      const overlay = spec.inset === false ? "" : insetGlobe(env, areas, pts, spec);
      return { fills, symbols, labels, overlay };
    },
  };
}

function countryOf(iso3) {
  return features("world-50m", "countries").features.find((x) => x.properties.iso3 === iso3);
}

/** A small orthographic globe in the map's top-right corner showing where the frame is. */
function insetGlobe(env, areas, pts, spec) {
  const { rect, theme: t, unit } = env;
  const [[x0, y0], [x1, y1]] = rect;
  const r = Math.min(x1 - x0, y1 - y0) * (spec.insetSize ?? 0.12);
  const cx = x1 - r - 14 * unit;
  const cy = y0 + r + 14 * unit;
  const focus = areas.length
    ? G.geoCentroid({ type: "FeatureCollection", features: areas.map((a) => mainland(a.feature)) })
    : G.geoCentroid({ type: "MultiPoint", coordinates: pts.map((p) => [p.loc.lon, p.loc.lat]) });
  const proj = G.geoOrthographic().rotate([-focus[0], -Math.max(-55, Math.min(55, focus[1]))]).translate([cx, cy]).scale(r).precision(0.3);
  const path = G.geoPath(proj).digits(1);
  const land = features("world-110m", "countries");
  const out = [
    `<g class="inset">`,
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r + 5 * unit)}" fill="${t.bg}" fill-opacity="0.9"/>`,
    `<path d="${path({ type: "Sphere" })}" fill="${t.ocean}" stroke="${t.muted}" stroke-width="${n(0.9 * unit, 2)}"/>`,
    `<path d="${path(G.geoGraticule10())}" fill="none" stroke="${t.dark ? t.bg : "#FFFFFF"}" stroke-opacity="0.5" stroke-width="${n(0.5 * unit, 2)}"/>`,
    `<path d="${path(land)}" fill="${t.ocean === t.bg ? t.land : t.land}" stroke="${t.coast}" stroke-width="${n(0.4 * unit, 2)}"/>`,
  ];
  for (const a of areas) out.push(`<path d="${path(a.feature)}" fill="${spec.color ?? t.accent}"/>`);
  // Outline of the main map's frame, as a rough rectangle on the globe.
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => env.projection.invert?.(p)).filter(Boolean);
  if (corners.length === 4) {
    const ring = [...corners, corners[0]];
    out.push(`<path d="${path({ type: "LineString", coordinates: ring })}" fill="none" stroke="${t.text}" stroke-width="${n(1.1 * unit, 2)}"/>`);
  }
  for (const p of pts) {
    const q = proj([p.loc.lon, p.loc.lat]);
    if (q) out.push(`<circle cx="${n(q[0])}" cy="${n(q[1])}" r="${n(3 * unit)}" fill="${spec.color ?? t.accent}" stroke="${t.halo}" stroke-width="${n(0.8 * unit, 2)}"/>`);
  }
  out.push(`</g>`);
  return out.join("");
}

export { esc };
