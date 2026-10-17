// Helpers shared by the map kinds.
import { resolveLocation } from "../locate.mjs";
import { textBlock, measureLines } from "../labels.mjs";
import { luminance } from "../color.mjs";
import { esc, n, formatNumber } from "../svg.mjs";
import { SpecError } from "../errors.mjs";
import { G } from "../geo.mjs";
import { labelPointFromPath } from "../polylabel.mjs";

const LOCATION_KEYS = ["lon", "lng", "longitude", "lat", "latitude", "iata", "airport", "place", "city", "country", "state", "admin1", "location"];

/** Resolve each row's location. Rows that fail are reported, not guessed. */
export function locateRows(rows, ctx, { prefer, field } = {}) {
  const out = [];
  for (const [i, row] of rows.entries()) {
    const ref = field && row[field] != null ? row[field] : refFromRow(row);
    if (ref == null) {
      ctx.report.unmatched.push({ row: i + 1, reason: `no location field (use one of ${LOCATION_KEYS.join(", ")})` });
      continue;
    }
    try {
      const loc = resolveLocation(ref, { prefer });
      if (loc.warning) ctx.report.warnings.push(loc.warning);
      ctx.report.resolved.push({ ref: typeof ref === "object" ? JSON.stringify(ref) : String(ref), as: loc.how, lon: round(loc.lon), lat: round(loc.lat) });
      out.push({ row, loc });
    } catch (e) {
      if (!(e instanceof SpecError)) throw e;
      ctx.report.unmatched.push({ row: i + 1, reason: e.message });
    }
  }
  if (rows.length && !out.length) throw new SpecError(`None of the ${rows.length} rows could be located. First problem: ${ctx.report.unmatched[0]?.reason}`);
  return out;
}

function refFromRow(row) {
  if (row.location != null) return row.location;
  if (row.lon != null || row.lng != null || row.longitude != null) return row;
  if (row.iata || row.airport) return { iata: row.iata ?? row.airport, label: row.label };
  if (row.place || row.city) return { place: row.place ?? row.city, country: row.country, state: row.state, label: row.label };
  if (row.admin1 && row.country) return { admin1: row.admin1, country: row.country, label: row.label };
  if (row.state) return { state: row.state, label: row.label };
  if (row.country) return { country: row.country, label: row.label };
  return null;
}

const round = (v) => Math.round(v * 1e4) / 1e4;

export function numeric(rows, field, ctx, kind) {
  if (!field) return rows.map(() => NaN);
  let bad = 0;
  const values = rows.map((r) => {
    const raw = r.row ? r.row[field] : r[field];
    const v = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[,%$€£\s]/g, ""));
    if (!Number.isFinite(v)) bad++;
    return v;
  });
  if (bad) ctx.report.warnings.push(`${bad} row(s) have no numeric "${field}" value and are left out of the ${kind}.`);
  if (bad === rows.length) throw new SpecError(`No numeric values in "${field}". Check the column name and its values.`);
  return values;
}

/** Project a location, honoring projections (albers-usa) that return null. */
export function project(projection, loc) {
  const p = projection([loc.lon, loc.lat]);
  if (!p || !Number.isFinite(p[0])) return null;
  // Orthographic: hide points on the far side of the globe.
  if (projection.clipAngle && projection.clipAngle() && projection.clipAngle() <= 90) {
    const r = projection.rotate();
    if (G.geoDistance([loc.lon, loc.lat], [-r[0], -r[1]]) > Math.PI / 2) return null;
  }
  return p;
}

/** Labels for symbols, highest priority first. */
export function symbolLabels(items, env, { size, weight = 600, sublineField, format } = {}) {
  const { theme, placer } = env;
  const fam = theme.fonts.label;
  const out = [];
  for (const it of items) {
    if (!it.label) continue;
    const lines = [{ text: it.label, size, weight, fill: theme.text }];
    if (it.sub != null) lines.push({ text: it.sub, size: size * 0.86, weight: 400, fill: theme.muted });
    const m = measureLines(lines, fam);
    const spot = placer.placePoint({ x: it.x, y: it.y, w: m.w, h: m.h, gap: (it.r ?? 3) + 4, name: it.label });
    if (!spot) continue;
    out.push(textBlock({ x: spot.x, y: spot.y, anchor: spot.anchor, lines, halo: theme.halo, haloWidth: size * 0.28, family: fam }));
  }
  return out;
}

/**
 * Label areas (countries, regions) at their pole of inaccessibility, only
 * when the text fits inside the shape. `minFit` > 1 lets context labels run
 * slightly past the edge.
 */
export function areaLabels(items, env, { size, uppercase = false, fillFor, minFit = 1, report = true }) {
  const { theme, placer, path } = env;
  const fam = theme.fonts.label;
  const out = [];
  for (const it of items) {
    const text = uppercase ? it.text.toUpperCase() : it.text;
    const ls = uppercase ? size * 0.08 : 0;
    const lines = [{ text, size, weight: it.weight ?? 600, letterSpacing: ls }];
    if (it.sub) lines.push({ text: it.sub, size: size * 0.92, weight: 400 });
    const m = measureLines(lines, fam);
    let p = null;
    if (it.at && minFit > 1) p = { x: it.at[0], y: it.at[1], r: Infinity };
    else {
      const pole = labelPointFromPath(path(it.feature));
      if (!pole) continue;
      p = pole;
      if (m.w / 2 > p.r * 1.5 * minFit || m.h / 2 > p.r * minFit) continue;
    }
    if (!Number.isFinite(p.x)) continue;
    // Areas whose label point is off the map are simply not labeled.
    const [bx0, by0, bx1, by1] = placer.bounds;
    if (p.x < bx0 || p.x > bx1 || p.y < by0 || p.y > by1) continue;
    const spot = placer.placeCentered({ x: p.x, y: p.y, w: m.w, h: m.h, name: report ? text : undefined });
    if (!spot) continue;
    it.placed = true;
    const fill = fillFor ? fillFor(it) : theme.text;
    out.push(textBlock({
      x: spot.x, y: spot.y, anchor: "middle", family: fam, halo: it.halo ?? null, haloWidth: size * 0.25,
      lines: lines.map((l) => ({ ...l, fill })),
    }));
  }
  return out;
}

export function contrastText(fill, theme) {
  if (!fill) return theme.text;
  return luminance(fill) > 0.32 ? "#1E1C19" : "#FFFFFF";
}

/** Annotation callouts: a short leader line and a text block. */
export function annotations(list, env, ctx) {
  if (!Array.isArray(list) || !list.length) return [];
  const { theme, projection, unit } = env;
  const out = [];
  for (const a of list) {
    let loc;
    try {
      loc = resolveLocation(a.at ?? a.location ?? a);
    } catch (e) {
      ctx.report.warnings.push(`Annotation "${a.text}": ${e.message}`);
      continue;
    }
    const p = project(projection, loc);
    if (!p) continue;
    const size = (a.size ?? 15) * unit;
    const dx = (a.dx ?? 40) * unit;
    const dy = (a.dy ?? -30) * unit;
    const tx = p[0] + dx;
    const ty = p[1] + dy;
    const anchor = a.anchor ?? (dx < -1 ? "end" : dx > 1 ? "start" : "middle");
    const lines = String(a.text).split("\n").map((t, i) => ({
      text: t, size: i === 0 ? size : size * 0.92, weight: i === 0 && a.bold !== false ? 600 : 400,
      fill: i === 0 ? theme.text : theme.muted,
    }));
    const elbowX = tx - (anchor === "end" ? -4 : anchor === "start" ? 4 : 0) * unit;
    out.push(`<path d="M${n(p[0])},${n(p[1])}L${n(elbowX)},${n(ty)}" fill="none" stroke="${theme.text}" stroke-width="${n(0.9 * unit, 2)}"/>`);
    out.push(`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(2.6 * unit)}" fill="${theme.text}"/>`);
    out.push(textBlock({ x: tx, y: ty + (lines.length - 1) * size * 0.55, anchor, lines, halo: theme.halo, haloWidth: size * 0.3, family: theme.fonts.label }));
    env.placer.block([tx - 200, ty - size, tx + 200, ty + size * lines.length]);
  }
  return out;
}

export function tooltip(name, value) {
  return `<title>${esc(value != null && value !== "" ? `${name}: ${value}` : name)}</title>`;
}

export { formatNumber };
