// Origin-destination flows as curved arrows whose width encodes volume.
import { SpecError } from "../errors.mjs";
import { esc, n, formatNumber, textWidth } from "../svg.mjs";
import { resolveLocation } from "../locate.mjs";
import { project, symbolLabels } from "./common.mjs";
import { defaultRegion } from "./points.mjs";
import { loadRows } from "../spec.mjs";
import { G, latitudeRange } from "../geo.mjs";

/** A flow drawn along the great circle, with an arrowhead aligned to its end. */
function geodesicArrow(f, w, env, color, format) {
  const { path, projection, unit } = env;
  const A = [f.a.loc.lon, f.a.loc.lat];
  const B = [f.b.loc.lon, f.b.loc.lat];
  const full = { type: "LineString", coordinates: [A, B] };
  const len = path.measure(full) || 1;
  const head = Math.max(7 * unit, w * 2.2);
  const interp = G.geoInterpolate(A, B);
  const tEnd = Math.max(0.5, 1 - (head * 0.85) / len);
  const steps = 64;
  const coords = Array.from({ length: steps + 1 }, (_, i) => interp((i / steps) * tEnd));
  const q = projection(B);
  const pre = projection(interp(Math.max(0, 1 - (head * 1.2) / len)));
  const out = [];
  const name = `${f.a.loc.label} → ${f.b.loc.label}`;
  out.push(`<path d="${path({ type: "LineString", coordinates: coords })}" fill="none" stroke="${color}" stroke-opacity="0.72" stroke-width="${n(w, 2)}" stroke-linecap="butt" data-name="${esc(name)}" data-value="${esc(formatNumber(f.v, format))}"><title>${esc(`${name}: ${formatNumber(f.v, format)}`)}</title></path>`);
  if (q && pre && Math.hypot(q[0] - pre[0], q[1] - pre[1]) < head * 3) {
    const ang = Math.atan2(q[1] - pre[1], q[0] - pre[0]);
    const hw = Math.max(5 * unit, w * 1.25);
    const left = [q[0] - Math.cos(ang) * head - Math.sin(ang) * hw, q[1] - Math.sin(ang) * head + Math.cos(ang) * hw];
    const right = [q[0] - Math.cos(ang) * head + Math.sin(ang) * hw, q[1] - Math.sin(ang) * head - Math.cos(ang) * hw];
    out.push(`<path d="M${n(q[0])},${n(q[1])}L${n(left[0])},${n(left[1])}L${n(right[0])},${n(right[1])}Z" fill="${color}" fill-opacity="0.85"/>`);
  }
  return out;
}

export function prepare(ctx) {
  const { spec, theme, base } = ctx;
  const rows = spec.flows ? loadRows(spec.flows, base, "flows") : ctx.rows;
  if (!rows.length) throw new SpecError('A flow map needs "flows": rows with "from", "to" and "value".');
  const prefer = spec.mode === "flight" ? "airport" : undefined;
  const value = spec.value ?? "value";
  const nodes = new Map();
  const flows = [];
  const locate = (ref, i) => {
    const key = typeof ref === "object" ? JSON.stringify(ref) : String(ref);
    if (!nodes.has(key)) {
      try {
        const loc = resolveLocation(ref, { prefer });
        if (loc.warning) ctx.report.warnings.push(loc.warning);
        ctx.report.resolved.push({ ref: key, as: loc.how, lon: loc.lon, lat: loc.lat });
        nodes.set(key, { loc, total: 0 });
      } catch (e) {
        ctx.report.unmatched.push({ row: i + 1, reason: e.message });
        nodes.set(key, null);
      }
    }
    return nodes.get(key);
  };
  for (const [i, r] of rows.entries()) {
    const raw = r[value];
    const v = raw == null || (typeof raw === "string" && raw.trim() === "") ? NaN : Number(raw);
    if (!Number.isFinite(v)) {
      ctx.report.warnings.push(`Flow row ${i + 1} has no numeric "${value}".`);
      continue;
    }
    if (v <= 0) {
      ctx.report.warnings.push(`Flow row ${i + 1} has a non-positive "${value}" and is left out.`);
      continue;
    }
    const a = locate(r.from ?? r.origin ?? r.source, i);
    const b = locate(r.to ?? r.destination ?? r.target, i);
    if (!a || !b) continue;
    a.total += v;
    b.total += v;
    flows.push({ a, b, v, row: r });
  }
  if (!flows.length) throw new SpecError("No flows could be drawn. Check the from/to locations and the value column.");
  const max = Math.max(...flows.map((f) => f.v));
  const format = spec.format ?? {};
  const ref = { u: 1 };
  const widthOf = (v) => (1.2 + (Math.abs(v) / max) * ((spec.maxWidth ?? 14) - 1.2)) * ref.u;
  const samples = [max, max / 2, max / 6].map((v) => Number(v.toPrecision(2)));
  const legend = spec.legend === false ? null : {
    height: (at) => (spec.legend?.title ? at.size * 1.6 : 0) + Math.max(widthOf(max), at.size) + 10 * at.unit,
    width: (at) => 420 * at.unit,
    svg: (at) => {
      ref.u = at.unit;
      const f = theme.fonts.body;
      let y = at.y;
      const out = [];
      if (spec.legend?.title) {
        y += at.size;
        out.push(`<text x="${at.x}" y="${n(y)}" font-family="${esc(f)}" font-size="${at.size}" font-weight="600" fill="${theme.text}">${esc(spec.legend.title)}</text>`);
        y += at.size * 0.6;
      }
      const cy = y + Math.max(widthOf(max), at.size) / 2 + 2 * at.unit;
      let x = at.x;
      for (const v of samples) {
        out.push(`<line x1="${n(x)}" x2="${n(x + 44 * at.unit)}" y1="${n(cy)}" y2="${n(cy)}" stroke="${spec.color ?? theme.route}" stroke-opacity="0.8" stroke-width="${n(widthOf(v), 2)}" stroke-linecap="butt"/>`);
        const label = formatNumber(v, format);
        out.push(`<text x="${n(x + 52 * at.unit)}" y="${n(cy + at.size * 0.35)}" font-family="${esc(f)}" font-size="${at.size}" fill="${theme.muted}">${esc(label)}</text>`);
        x += 70 * at.unit + textWidth(label, at.size, f);
      }
      return out.join("");
    },
  };
  const all = [...nodes.values()].filter(Boolean);
  const geodesicLines = (spec.line ?? (spec.mode === "flight" ? "great-circle" : "curve")) === "great-circle";
  const latRange = latitudeRange(flows.map((f) => [[f.a.loc.lon, f.a.loc.lat], [f.b.loc.lon, f.b.loc.lat]]), geodesicLines);
  return {
    latRange,
    legend,
    dataObject: { type: "MultiPoint", coordinates: all.map((d) => [d.loc.lon, d.loc.lat]) },
    defaultRegion: defaultRegion(all),
    draw(env) {
      ref.u = env.unit;
      const { projection, unit, theme: t } = env;
      const color = spec.color ?? t.route;
      const symbols = [];
      const sorted = [...flows].sort((a, b) => b.v - a.v);
      const geodesic = (spec.line ?? (spec.mode === "flight" ? "great-circle" : "curve")) === "great-circle";
      for (const f of sorted) {
        const p = project(projection, f.a.loc);
        const q = project(projection, f.b.loc);
        if (!p || !q) continue;
        const w = widthOf(f.v);
        if (geodesic) {
          symbols.push(...geodesicArrow(f, w, env, color, format));
          continue;
        }
        const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
        const len = Math.hypot(dx, dy) || 1;
        const k = spec.curvature ?? 0.22;
        const c = [(p[0] + q[0]) / 2 + dy * k, (p[1] + q[1]) / 2 - dx * k];
        // Stop the shaft short of the target so the arrowhead sits on it.
        const head = Math.max(7 * unit, w * 2.2);
        const tx = q[0] - c[0];
        const ty = q[1] - c[1];
        const tl = Math.hypot(tx, ty) || 1;
        const end = [q[0] - (tx / tl) * head * 0.9, q[1] - (ty / tl) * head * 0.9];
        const name = `${f.a.loc.label} → ${f.b.loc.label}`;
        symbols.push(`<path d="M${n(p[0])},${n(p[1])}Q${n(c[0])},${n(c[1])} ${n(end[0])},${n(end[1])}" fill="none" stroke="${color}" stroke-opacity="0.72" stroke-width="${n(w, 2)}" stroke-linecap="round" data-name="${esc(name)}" data-value="${esc(formatNumber(f.v, format))}"><title>${esc(`${name}: ${formatNumber(f.v, format)}`)}</title></path>`);
        const ang = Math.atan2(ty, tx);
        const hw = Math.max(5 * unit, w * 1.25);
        const left = [q[0] - Math.cos(ang) * head - Math.sin(ang) * hw, q[1] - Math.sin(ang) * head + Math.cos(ang) * hw];
        const right = [q[0] - Math.cos(ang) * head + Math.sin(ang) * hw, q[1] - Math.sin(ang) * head - Math.cos(ang) * hw];
        symbols.push(`<path d="M${n(q[0])},${n(q[1])}L${n(left[0])},${n(left[1])}L${n(right[0])},${n(right[1])}Z" fill="${color}" fill-opacity="0.85"/>`);
        void len;
      }
      const nodeItems = [];
      for (const d of all) {
        const p = project(projection, d.loc);
        if (!p) continue;
        symbols.push(`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(3.4 * unit)}" fill="${t.text}" stroke="${t.halo}" stroke-width="${n(1 * unit, 2)}"/>`);
        nodeItems.push({ x: p[0], y: p[1], r: 3.4 * unit, label: d.loc.label, total: d.total });
      }
      nodeItems.sort((a, b) => b.total - a.total);
      return { symbols, labels: symbolLabels(nodeItems.slice(0, spec.labelTop ?? 14), env, { size: (spec.labelSize ?? 13.5) * unit }) };
    },
  };
}
