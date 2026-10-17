// Journeys: ordered stops joined by great-circle, straight or arced lines.
// Supports one route (`stops`) or several (`routes`).
import { categoricalLegend } from "../layout.mjs";
import { getPalette } from "../color.mjs";
import { SpecError } from "../errors.mjs";
import { esc, n, formatNumber } from "../svg.mjs";
import { locateRows, project, symbolLabels } from "./common.mjs";
import { defaultRegion } from "./points.mjs";
import { distanceKm, latitudeRange } from "../geo.mjs";
import { loadRows } from "../spec.mjs";

export function prepare(ctx) {
  const { spec, theme, base } = ctx;
  const groups = spec.routes
    ? spec.routes.map((r, i) => ({ name: r.name ?? `Route ${i + 1}`, color: r.color, stops: loadRows(r.stops, base, "routes[].stops"), dash: r.dash }))
    : [{ name: spec.title ?? "Route", stops: spec.stops ? loadRows(spec.stops, base, "stops") : ctx.rows }];
  if (!groups.length || groups.some((g) => g.stops.length < 2)) throw new SpecError('A route needs "stops": at least two locations in order (or "routes": [{ "name", "stops" }]).');
  const prefer = spec.mode === "flight" ? "airport" : undefined;
  const palette = getPalette(theme.categorical, "categorical").stops;
  let total = 0;
  for (const [gi, g] of groups.entries()) {
    g.items = locateRows(g.stops.map((s) => (typeof s === "string" || Array.isArray(s) ? { location: s } : s)), ctx, { prefer });
    g.color = g.color ?? (groups.length > 1 ? palette[gi % palette.length] : theme.route);
    g.km = 0;
    for (let i = 1; i < g.items.length; i++) {
      g.km += distanceKm([g.items[i - 1].loc.lon, g.items[i - 1].loc.lat], [g.items[i].loc.lon, g.items[i].loc.lat]);
    }
    total += g.km;
  }
  ctx.report.notes.push(`Great-circle length: ${formatNumber(total, { decimals: 0 })} km (${formatNumber(total * 0.621371, { decimals: 0 })} mi).`);
  const all = groups.flatMap((g) => g.items);
  const legend = groups.length > 1 && spec.legend !== false
    ? categoricalLegend({ items: groups.map((g) => ({ label: g.name, color: g.color, dash: g.dash })), theme, title: spec.legend?.title, shape: "line" })
    : null;
  const line = spec.line ?? "great-circle";
  const latRange = latitudeRange(groups.flatMap((g) => g.items.slice(1).map((d, i) => [[g.items[i].loc.lon, g.items[i].loc.lat], [d.loc.lon, d.loc.lat]])), line === "great-circle");
  const seaDash = spec.mode === "voyage" || spec.mode === "sea";

  return {
    latRange,
    legend,
    dataObject: { type: "MultiPoint", coordinates: all.map((d) => [d.loc.lon, d.loc.lat]) },
    defaultRegion: defaultRegion(all),
    draw(env) {
      const { path, projection, unit, theme: t } = env;
      const halo = [];
      const lines = [];
      const marks = [];
      const labelItems = [];
      const width = (spec.lineWidth ?? 2.2) * unit;
      for (const g of groups) {
        const pts = g.items.map((d) => ({ ...d, p: project(projection, d.loc) }));
        const segs = [];
        for (let i = 1; i < pts.length; i++) {
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
          const numbered = spec.numbered ?? (groups.length === 1 && pts.filter((x) => !x.row.waypoint).length <= 30);
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
