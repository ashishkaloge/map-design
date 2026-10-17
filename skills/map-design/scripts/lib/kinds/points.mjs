// Locations as dots, optionally colored by category.
import { colorScale } from "../scales.mjs";
import { categoricalLegend } from "../layout.mjs";
import { SpecError } from "../errors.mjs";
import { esc, n } from "../svg.mjs";
import { locateRows, project, symbolLabels, tooltip } from "./common.mjs";
import { G } from "../geo.mjs";

export function multipoint(items) {
  if (!items.length) return null;
  return { type: "MultiPoint", coordinates: items.map((d) => [d.loc.lon, d.loc.lat]) };
}

export function latSpan(items) {
  const lats = items.map((d) => d.loc.lat);
  return lats.length ? [Math.min(...lats), Math.max(...lats)] : [0, 0];
}

/** World when the points span the globe, otherwise frame the points. */
export function defaultRegion(items) {
  if (!items.length) return "world";
  const [[w, s], [e, nn]] = G.geoBounds(multipoint(items));
  let span = e - w;
  if (span < 0) span += 360;
  return span > 110 || nn - s > 75 ? "world" : "auto";
}

export function prepare(ctx) {
  const { spec, theme, rows } = ctx;
  if (!rows.length) throw new SpecError('A points map needs "data": rows with a location.');
  const items = locateRows(rows, ctx, { field: spec.location });
  let colorOf = () => spec.color ?? theme.symbol;
  let legend = null;
  if (spec.category) {
    const scale = colorScale(items.map((d) => d.row[spec.category]), { type: "categorical", ...(spec.scale ?? {}) }, theme);
    colorOf = (d) => scale.color(d.row[spec.category]) ?? theme.faint;
    if (spec.legend !== false) {
      legend = categoricalLegend({ items: scale.categories.map((c) => ({ label: c, color: scale.color(c) })), theme, title: spec.legend?.title, shape: "circle" });
    }
  }
  return {
    latRange: latSpan(items),
    legend,
    dataObject: multipoint(items),
    defaultRegion: defaultRegion(items),
    draw(env) {
      const { projection, unit, theme: t } = env;
      const r = (spec.radius ?? 5) * unit;
      const symbols = [];
      const labelItems = [];
      for (const d of items) {
        const p = project(projection, d.loc);
        if (!p) continue;
        const name = (spec.label ? d.row[spec.label] : null) ?? d.row.label ?? d.row.name ?? d.loc.label;
        const color = colorOf(d);
        symbols.push(`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(r)}" fill="${color}" stroke="${t.symbolStroke}" stroke-width="${n(1.1 * unit, 2)}" data-name="${esc(name ?? "")}">${tooltip(name ?? "", spec.category ? d.row[spec.category] : null)}</circle>`);
        env.placer.blockCircle(p[0], p[1], r);
        if (spec.labels !== false && name) labelItems.push({ x: p[0], y: p[1], r, label: name, sub: spec.sublabel ? d.row[spec.sublabel] : null });
      }
      const limit = spec.labelTop ?? (labelItems.length <= 40 ? labelItems.length : 25);
      return { symbols, labels: symbolLabels(labelItems.slice(0, limit), env, { size: (spec.labelSize ?? 13.5) * unit }) };
    },
  };
}
