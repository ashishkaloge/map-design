// Proportional symbols: circles sized by area, or spikes sized by height.
import { radiusScale, linearScale, colorScale } from "../scales.mjs";
import { sizeLegend, legendValues, categoricalLegend, classedLegend } from "../layout.mjs";
import { SpecError } from "../errors.mjs";
import { esc, n, formatNumber } from "../svg.mjs";
import { locateRows, numeric, project, symbolLabels, tooltip } from "./common.mjs";
import { defaultRegion, multipoint, latSpan } from "./points.mjs";

export function prepare(ctx) {
  const { spec, theme, rows } = ctx;
  const spikes = spec.kind === "spikes";
  if (!rows.length) throw new SpecError(`A ${spec.kind} map needs "data": rows with a location and a value.`);
  if (!spec.value) throw new SpecError(`Set "value" to the numeric column that sizes the ${spikes ? "spikes" : "bubbles"}.`);
  const located = locateRows(rows, ctx, { field: spec.location });
  const values = numeric(located, spec.value, ctx, spec.kind);
  const items = located.map((l, i) => ({ ...l, value: values[i] })).filter((d) => Number.isFinite(d.value));
  const format = spec.format ?? {};
  const max = Math.max(...items.map((d) => Math.abs(d.value)));

  // Optional color encoding: a fixed color, or { field, scale }.
  let colorOf = () => spec.color ?? theme.symbol;
  let colorLegend = null;
  if (spec.color && typeof spec.color === "object") {
    const field = spec.color.field;
    const raw = items.map((d) => d.row[field]);
    const scale = colorScale(raw.map((v) => (spec.color.scale?.type === "categorical" || typeof v === "string" ? v : Number(v))), { type: typeof raw[0] === "string" ? "categorical" : undefined, ...(spec.color.scale ?? {}) }, theme);
    colorOf = (d) => scale.color(scale.type === "categorical" ? d.row[field] : Number(d.row[field])) ?? theme.faint;
    colorLegend = scale.type === "categorical"
      ? categoricalLegend({ items: scale.categories.map((c) => ({ label: c, color: scale.color(c) })), theme, title: spec.color.title, shape: "circle" })
      : classedLegend({ scale, theme, title: spec.color.title, format: spec.color.format ?? {} });
  }

  const legendTitle = spec.legend?.title ?? null;
  // Spike legends show a mid-size reference so they stay short beside the title.
  const refValues = () => (spikes ? legendValues(max / 2.5).slice(0, 3) : legendValues(max));
  let sizeFn;
  const ref = { u: 1 };
  if (spikes) sizeFn = (v) => linearScale([max], (spec.maxHeight ?? 190) * ref.u)(v);
  else sizeFn = (v) => radiusScale([max], (spec.maxRadius ?? 46) * ref.u, 1.2 * ref.u)(v);
  const legend = spec.legend === false ? null : {
    height: (at) => { ref.u = at.unit; return sizeLegend({ values: refValues(), radius: sizeFn, theme, title: legendTitle, format, shape: spikes ? "spike" : "circle" }).height(at); },
    svg: (at) => { ref.u = at.unit; return sizeLegend({ values: refValues(), radius: sizeFn, theme, title: legendTitle, format, fill: theme.symbol, stroke: theme.symbol, shape: spikes ? "spike" : "circle", spikeWidth: (spec.spikeWidth ?? 8) * at.unit }).svg(at); },
    width: (at) => (spikes ? 300 : 210) * at.unit,
    placement: "right",
  };

  return {
    latRange: latSpan(items),
    legend,
    extraLegend: colorLegend,
    dataObject: multipoint(items),
    defaultRegion: defaultRegion(items),
    draw(env) {
      ref.u = env.unit;
      const { projection, unit, theme: t, placer } = env;
      const symbols = [];
      const placed = [];
      for (const d of items) {
        const p = project(projection, d.loc);
        if (!p) {
          ctx.report.warnings.push(`${d.loc.label ?? "A point"} falls outside this projection and is not drawn.`);
          continue;
        }
        placed.push({ ...d, x: p[0], y: p[1], size: sizeFn(d.value), color: colorOf(d) });
      }
      const label = (d) => (spec.label ? d.row[spec.label] : null) ?? d.row.label ?? d.loc.label;
      if (spikes) {
        const w = (spec.spikeWidth ?? 8) * unit;
        placed.sort((a, b) => a.y - b.y);
        for (const d of placed) {
          const h = d.size;
          symbols.push(`<path d="M${n(d.x - w / 2)},${n(d.y)}L${n(d.x)},${n(d.y - h)}L${n(d.x + w / 2)},${n(d.y)}" fill="${d.color}" fill-opacity="0.32" stroke="${d.color}" stroke-width="${n(1 * unit, 2)}" stroke-linejoin="round" data-name="${esc(label(d))}" data-value="${esc(formatNumber(d.value, format))}">${tooltip(label(d), formatNumber(d.value, format))}</path>`);
        }
        for (const d of placed) placer.block([d.x - w / 2, d.y - d.size, d.x + w / 2, d.y]);
      } else {
        placed.sort((a, b) => b.value - a.value);
        for (const d of placed) {
          symbols.push(`<circle cx="${n(d.x)}" cy="${n(d.y)}" r="${n(d.size)}" fill="${d.color}" fill-opacity="${spec.opacity ?? 0.45}" stroke="${d.color}" stroke-width="${n(0.9 * unit, 2)}" data-name="${esc(label(d))}" data-value="${esc(formatNumber(d.value, format))}">${tooltip(label(d), formatNumber(d.value, format))}</circle>`);
        }
      }
      const top = [...placed].sort((a, b) => b.value - a.value).slice(0, spec.labelTop ?? (spikes ? 8 : 10));
      const labels = symbolLabels(
        top.map((d) => ({
          x: d.x, y: spikes ? d.y - d.size : d.y, r: spikes ? 2 : d.size * 0.35,
          label: label(d), sub: spec.labelValues === false ? null : formatNumber(d.value, format),
        })),
        env,
        { size: (spec.labelSize ?? 14) * unit },
      );
      return { symbols, labels };
    },
  };
}
