// Journeys: ordered stops joined by great-circle, straight or arced lines, or
// a recorded track (GPX, KML, GeoJSON) drawn as it was travelled.
// Supports one route (`stops` or `track`) or several (`routes`).
import { categoricalLegend } from "../layout.mjs";
import { getPalette } from "../color.mjs";
import { SpecError } from "../errors.mjs";
import { esc, n, formatNumber } from "../svg.mjs";
import { locateRows, project, symbolLabels } from "./common.mjs";
import { defaultRegion } from "./points.mjs";
import { distanceKm, latitudeRange, G } from "../geo.mjs";
import { loadRows } from "../spec.mjs";
import { GEOMETRY, isLinear, lineCoordinates, thinnedPath } from "../geofile.mjs";

export function prepare(ctx) {
  const { spec, theme, base } = ctx;
  // A track file gives the line; its waypoints (or "stops") become markers.
  const group = (name, stopsValue, trackValue, at, extra = {}, fallback = []) => {
    let stops = stopsValue != null ? loadRows(stopsValue, base, `${at}stops`, ctx.report) : fallback;
    let lines = [];
    let source = null;
    if (trackValue != null) {
      const rows = loadRows(trackValue, base, `${at}track`, ctx.report, { strictGeometry: true });
      lines = rows.flatMap((r) => lineCoordinates(r[GEOMETRY]));
      if (!lines.length) throw new SpecError(`${trackValue} has no lines to draw (GPX tracks or routes, KML or GeoJSON LineStrings).`);
      if (stopsValue == null) stops = rows.filter((r) => r[GEOMETRY] && !isLinear(r[GEOMETRY]));
      source = rows.find((r) => isLinear(r[GEOMETRY]));
    } else if (stops.some((r) => r && isLinear(r[GEOMETRY]))) {
      lines = stops.flatMap((r) => lineCoordinates(r[GEOMETRY]));
      source = stops.find((r) => isLinear(r[GEOMETRY]));
      stops = stops.filter((r) => r[GEOMETRY] && !isLinear(r[GEOMETRY]));
    }
    return { name: name ?? source?.name ?? "Route", lines, stops, ...extra };
  };
  const groups = spec.routes
    ? spec.routes.map((r, i) => {
      const g = group(r.name, r.stops, r.track, "routes[].", { color: r.color, dash: r.dash });
      return r.name || g.lines.length ? g : { ...g, name: `Route ${i + 1}` };
    })
    : [group(spec.title, spec.stops, spec.track, "", {}, ctx.rows)];
  if (!groups.length || groups.some((g) => !g.lines.length && g.stops.length < 2)) {
    throw new SpecError('A route needs "stops": at least two locations in order, or "track": a GPX, KML or GeoJSON file with a line (or "routes": [{ "name", "stops" | "track" }]).');
  }
  const prefer = spec.mode === "flight" ? "airport" : undefined;
  const palette = getPalette(theme.categorical, "categorical").stops;
  let total = 0;
  let tracked = 0;
  for (const [gi, g] of groups.entries()) {
    g.items = g.stops.length ? locateRows(g.stops.map((s) => (typeof s === "string" || Array.isArray(s) ? { location: s } : s)), ctx, { prefer }) : [];
    g.color = g.color ?? (groups.length > 1 ? palette[gi % palette.length] : theme.route);
    g.km = 0;
    if (g.lines.length) {
      g.km = G.geoLength({ type: "MultiLineString", coordinates: g.lines }) * 6371.0088;
      tracked += g.km;
      continue;
    }
    for (let i = 1; i < g.items.length; i++) {
      g.km += distanceKm([g.items[i - 1].loc.lon, g.items[i - 1].loc.lat], [g.items[i].loc.lon, g.items[i].loc.lat]);
    }
    total += g.km;
  }
  const km = (v) => `${formatNumber(v, { decimals: v < 100 ? 1 : 0 })} km (${formatNumber(v * 0.621371, { decimals: v < 100 ? 1 : 0 })} mi)`;
  if (groups.some((g) => !g.lines.length)) ctx.report.notes.push(`Great-circle length: ${km(total)}.`);
  if (groups.some((g) => g.lines.length)) ctx.report.notes.push(`Track length: ${km(tracked)}.`);
  // Track points stand in for stops when framing and choosing the region.
  const trackPoints = groups.flatMap((g) => g.lines.flatMap((l) => thin(l, 200)).map(([lon, lat]) => ({ loc: { lon, lat } })));
  const all = groups.flatMap((g) => g.items);
  const legend = groups.length > 1 && spec.legend !== false
    ? categoricalLegend({ items: groups.map((g) => ({ label: g.name, color: g.color, dash: g.dash })), theme, title: spec.legend?.title, shape: "line" })
    : null;
  const line = spec.line ?? "great-circle";
  const segments = groups.filter((g) => !g.lines.length).flatMap((g) => g.items.slice(1).map((d, i) => [[g.items[i].loc.lon, g.items[i].loc.lat], [d.loc.lon, d.loc.lat]]));
  const lats = trackPoints.map((d) => d.loc.lat);
  const [lo, hi] = segments.length ? latitudeRange(segments, line === "great-circle") : [Infinity, -Infinity];
  const latRange = lats.length ? [Math.min(lo, ...lats), Math.max(hi, ...lats)] : [lo, hi];
  const seaDash = spec.mode === "voyage" || spec.mode === "sea";
  const tracks = groups.flatMap((g) => g.lines);
  // A local track (a run, a ride, a walk) frames tightly and has no use for
  // 1:50m coastlines; streets come from the basemap when asked for.
  let local = false;
  if (tracks.length) {
    const [[w, s], [e, nn]] = G.geoBounds({ type: "MultiPoint", coordinates: [...trackPoints, ...all].map((d) => [d.loc.lon, d.loc.lat]) });
    const lonSpan = e >= w ? e - w : e + 360 - w;
    local = Math.max(lonSpan * Math.cos((((s + nn) / 2) * Math.PI) / 180), nn - s) < 2.5;
    if (local && !spec.basemap) ctx.report.notes.push('This track is local, so country outlines are left out; add "basemap": "streets" to draw the streets under it.');
  }

  return {
    latRange,
    legend,
    dataObject: {
      type: "GeometryCollection",
      geometries: [
        { type: "MultiPoint", coordinates: all.map((d) => [d.loc.lon, d.loc.lat]) },
        ...(tracks.length ? [{ type: "MultiLineString", coordinates: tracks }] : []),
      ],
    },
    defaultRegion: tracks.length ? "auto" : defaultRegion(all),
    tight: tracks.length > 0,
    context: !local,
    draw(env) {
      const { path, projection, unit, theme: t } = env;
      const halo = [];
      const lines = [];
      const marks = [];
      const labelItems = [];
      const width = (spec.lineWidth ?? 2.2) * unit;
      const trackPath = thinnedPath(projection, 0.25);
      for (const g of groups) {
        const pts = g.items.map((d) => ({ ...d, p: project(projection, d.loc) }));
        const segs = [];
        if (g.lines.length) {
          const d = trackPath({ type: "MultiLineString", coordinates: g.lines });
          if (d) segs.push(d);
          // Without waypoints, mark where the track starts and ends.
          if (!pts.length) {
            const ends = [g.lines[0][0], g.lines.at(-1).at(-1)];
            for (const [lon, lat] of ends) pts.push({ row: {}, loc: { lon, lat }, p: project(projection, { lon, lat }) });
          }
        }
        for (let i = 1; i < pts.length && !g.lines.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          let d;
          if (line === "great-circle") {
            d = path({ type: "LineString", coordinates: [[a.loc.lon, a.loc.lat], [b.loc.lon, b.loc.lat]] });
          } else if (a.p && b.p) {
            if (line === "arc") {
              const [mx, my] = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
              const [dx, dy] = [b.p[0] - a.p[0], b.p[1] - a.p[1]];
              const k = spec.curvature ?? 0.2;
              d = `M${n(a.p[0])},${n(a.p[1])}Q${n(mx + dy * k)},${n(my - dx * k)} ${n(b.p[0])},${n(b.p[1])}`;
            } else d = `M${n(a.p[0])},${n(a.p[1])}L${n(b.p[0])},${n(b.p[1])}`;
          }
          if (d) segs.push(d);
        }
        const dash = g.dash ?? (seaDash ? `${n(7 * unit)} ${n(5 * unit)}` : null);
        halo.push(`<path d="${segs.join("")}" fill="none" stroke="${t.halo}" stroke-opacity="0.75" stroke-width="${n(width + 3.5 * unit, 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
        lines.push(`<path class="route" d="${segs.join("")}" fill="none" stroke="${g.color}" stroke-width="${n(width, 2)}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""} data-name="${esc(g.name)}"><title>${esc(`${g.name}: ${formatNumber(g.km, { decimals: 0 })} km`)}</title></path>`);

        // Stops: waypoints are invisible shaping points. A stop that returns
        // to an earlier position (a round trip) keeps the earlier marker.
        let index = 0;
        const seen = [];
        for (const [i, d] of pts.entries()) {
          if (!d.p || d.row.waypoint) continue;
          index++;
          if (seen.some((q) => Math.hypot(q[0] - d.p[0], q[1] - d.p[1]) < 2)) continue;
          seen.push(d.p);
          const first = i === 0;
          const last = i === pts.length - 1;
          const numbered = spec.numbered ?? (groups.length === 1 && !g.lines.length && pts.filter((x) => !x.row.waypoint).length <= 30);
          const r = (numbered ? 10.5 : first || last ? 6 : 4.2) * unit;
          if (numbered) {
            marks.push(`<circle cx="${n(d.p[0])}" cy="${n(d.p[1])}" r="${n(r)}" fill="${g.color}" stroke="${t.halo}" stroke-width="${n(1.6 * unit, 2)}"/>`);
            marks.push(`<text x="${n(d.p[0])}" y="${n(d.p[1] + 4 * unit)}" text-anchor="middle" font-family="${esc(t.fonts.body)}" font-size="${n(11.5 * unit)}" font-weight="600" fill="#FFFFFF">${index}</text>`);
          } else {
            marks.push(`<circle cx="${n(d.p[0])}" cy="${n(d.p[1])}" r="${n(r)}" fill="${first || last ? g.color : t.bg}" stroke="${g.color}" stroke-width="${n(1.8 * unit, 2)}"/>`);
          }
          env.placer.blockCircle(d.p[0], d.p[1], r);
          const name = d.row.label ?? d.row.name ?? d.loc.label;
          if (name && spec.labels !== false) {
            labelItems.push({ x: d.p[0], y: d.p[1], r, label: name, sub: d.row.date ?? d.row.note ?? null, order: first || last ? 0 : 1 });
          }
        }
      }
      labelItems.sort((a, b) => a.order - b.order);
      const labels = symbolLabels(labelItems, env, { size: (spec.labelSize ?? 14) * unit });
      return { fills: [], symbols: [...halo, ...lines, ...marks], labels };
    },
  };
}

/** At most `max` evenly spaced positions of a line, keeping both ends. */
function thin(line, max) {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]);
}
