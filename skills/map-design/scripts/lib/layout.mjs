// Page composition: title block, legend band, map area and footer.
import { esc, n, wrap, textWidth, formatNumber } from "./svg.mjs";

export const SIZES = {
  landscape: [1600, 1000],
  wide: [1600, 900],
  square: [1200, 1200],
  portrait: [1200, 1500],
  story: [1080, 1920],
  poster: [1200, 1600],
  a4: [1240, 1754],
};

export function resolveSize(size, fallback = "landscape") {
  if (size && typeof size === "object") return [Number(size.width), Number(size.height)];
  const s = SIZES[size ?? fallback];
  if (!s) throw new Error(`Unknown size "${size}". Use ${Object.keys(SIZES).join(", ")} or { "width": W, "height": H }.`);
  return s;
}

/**
 * Compute regions of the page and render the text furniture.
 * Returns { width, height, map: [[x0,y0],[x1,y1]], legendAt: {x, y, maxWidth}, header, footer, unit }.
 */
export function compose({ width, height, theme, spec, legend }) {
  const unit = Math.min(width, height * 1.4) / 1600; // 1 at the 1600px reference width
  const margin = Math.round(Math.max(28, 54 * unit));
  const inner = width - margin * 2;
  const titleSize = Math.round(Math.max(26, 46 * unit));
  const subSize = Math.round(Math.max(15, 21 * unit));
  const footSize = Math.round(Math.max(11, 13.5 * unit));
  const f = theme.fonts;
  const parts = [];
  let y = margin;

  if (spec.kicker) {
    const ks = Math.round(Math.max(11, 14 * unit));
    parts.push(`<text x="${margin}" y="${n(y + ks)}" font-family="${esc(f.body)}" font-size="${ks}" font-weight="700" letter-spacing="${n(ks * 0.12)}" fill="${theme.accent}">${esc(String(spec.kicker).toUpperCase())}</text>`);
    y += ks * 1.9;
  }
  if (spec.title) {
    const lines = wrap(spec.title, inner, titleSize, f.title, { weight: theme.titleWeight }).slice(0, 3);
    for (const line of lines) {
      y += titleSize * 1.08;
      parts.push(`<text x="${margin}" y="${n(y)}" font-family="${esc(f.title)}" font-size="${titleSize}" font-weight="${theme.titleWeight}" fill="${theme.text}" letter-spacing="${n(-0.01 * titleSize)}">${esc(line)}</text>`);
    }
    y += titleSize * 0.32;
  }
  if (spec.subtitle) {
    const lines = wrap(spec.subtitle, Math.min(inner, subSize * 46), subSize, f.body).slice(0, 4);
    for (const line of lines) {
      y += subSize * 1.32;
      parts.push(`<text x="${margin}" y="${n(y)}" font-family="${esc(f.body)}" font-size="${subSize}" fill="${theme.muted}">${esc(line)}</text>`);
    }
    y += subSize * 0.4;
  }
  let legendAt = null;
  if (legend) {
    const size = Math.round(Math.max(11, 13.5 * unit));
    if (legend.placement === "right" && legend.width) {
      // Size legends sit to the right of the title block instead of under it.
      const probe = { x: 0, y: 0, maxWidth: inner, unit, size };
      const w = legend.width(probe);
      const top = margin + (spec.kicker ? 0 : 6 * unit);
      legendAt = { x: width - margin - w, y: top, maxWidth: w, unit, size };
      y = Math.max(y, top + legend.height(legendAt));
    } else {
      y += Math.round(16 * unit);
      legendAt = { x: margin, y, maxWidth: inner, unit, size };
      y += legend.height(legendAt);
    }
  }
  const headerBottom = spec.title || spec.subtitle || legend ? y + Math.round(18 * unit) : margin * 0.6;

  // Footer: source, note and credit, wrapped to the page width.
  const footBits = [];
  if (spec.note) footBits.push({ text: spec.note, italic: false });
  const credits = [spec.source && `Source: ${String(spec.source).replace(/^source:\s*/i, "")}`, spec.credit, spec.attribution].filter(Boolean).join("  ·  ");
  if (credits) footBits.push({ text: credits });
  const footLines = footBits.flatMap((b) => wrap(b.text, inner, footSize, f.body).map((t) => ({ t })));
  const footerHeight = footLines.length ? footLines.length * footSize * 1.45 + margin * 0.55 : margin * 0.6;
  let fy = height - footerHeight + footSize * 1.1;
  if (footLines.length) fy = height - margin * 0.55 - (footLines.length - 1) * footSize * 1.45;
  for (const { t } of footLines) {
    parts.push(`<text x="${margin}" y="${n(fy)}" font-family="${esc(f.body)}" font-size="${footSize}" fill="${theme.faint}">${esc(t)}</text>`);
    fy += footSize * 1.45;
  }

  const map = [
    [spec.bleed ? 0 : margin, headerBottom],
    [spec.bleed ? width : width - margin, height - footerHeight - Math.round(10 * unit)],
  ];
  return { width, height, unit, margin, map, legendAt, furniture: parts.join("\n"), footSize };
}

// ---------------------------------------------------------------------------
// Legends. Each returns { height(at), svg(at) }.

export function classedLegend({ scale, theme, title, format, noData }) {
  const swatchH = 12;
  const metrics = (at) => {
    const count = scale.colors.length;
    const sw = Math.min(78 * at.unit, (at.maxWidth * 0.6) / count);
    return { sw, swatchH: swatchH * at.unit, count };
  };
  return {
    height: (at) => (title ? at.size * 1.6 : 0) + swatchH * at.unit + at.size * 1.6,
    svg: (at) => {
      const { sw, swatchH: h, count } = metrics(at);
      const f = theme.fonts.body;
      let y = at.y;
      const out = [];
      if (title) {
        y += at.size;
        out.push(`<text x="${at.x}" y="${n(y)}" font-family="${esc(f)}" font-size="${at.size}" font-weight="600" fill="${theme.text}">${esc(title)}</text>`);
        y += at.size * 0.6;
      }
      for (let i = 0; i < count; i++) {
        out.push(`<rect x="${n(at.x + i * sw)}" y="${n(y)}" width="${n(sw - 2 * at.unit)}" height="${n(h)}" fill="${scale.colors[i]}"/>`);
      }
      const ty = y + h + at.size * 1.15;
      for (let i = 0; i < scale.breaks.length; i++) {
        const x = at.x + (i + 1) * sw - at.unit;
        out.push(`<text x="${n(x)}" y="${n(ty)}" text-anchor="middle" font-family="${esc(f)}" font-size="${at.size}" fill="${theme.muted}">${esc(formatNumber(scale.breaks[i], format))}</text>`);
      }
      if (noData) {
        const x = at.x + count * sw + 22 * at.unit;
        out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(sw * 0.5)}" height="${n(h)}" fill="${theme.noData}" stroke="${theme.faint}" stroke-width="0.6" stroke-dasharray="2 2"/>`);
        out.push(`<text x="${n(x + sw * 0.5 + 8 * at.unit)}" y="${n(y + h - 1)}" font-family="${esc(f)}" font-size="${at.size}" fill="${theme.muted}">No data</text>`);
      }
      return out.join("");
    },
  };
}

export function continuousLegend({ scale, theme, title, format, id = "lg" }) {
  return {
    height: (at) => (title ? at.size * 1.6 : 0) + 12 * at.unit + at.size * 1.6,
    svg: (at) => {
      const f = theme.fonts.body;
      const w = Math.min(340 * at.unit, at.maxWidth * 0.5);
      const h = 12 * at.unit;
      let y = at.y;
      const out = [];
      if (title) {
        y += at.size;
        out.push(`<text x="${at.x}" y="${n(y)}" font-family="${esc(f)}" font-size="${at.size}" font-weight="600" fill="${theme.text}">${esc(title)}</text>`);
        y += at.size * 0.6;
      }
      const stops = scale.stops.map((c, i) => `<stop offset="${n((i / (scale.stops.length - 1)) * 100)}%" stop-color="${c}"/>`).join("");
      out.push(`<defs><linearGradient id="${id}">${stops}</linearGradient></defs>`);
      out.push(`<rect x="${at.x}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#${id})"/>`);
      const ty = y + h + at.size * 1.15;
      out.push(`<text x="${at.x}" y="${n(ty)}" font-family="${esc(f)}" font-size="${at.size}" fill="${theme.muted}">${esc(formatNumber(scale.min, format))}</text>`);
      out.push(`<text x="${n(at.x + w)}" y="${n(ty)}" text-anchor="end" font-family="${esc(f)}" font-size="${at.size}" fill="${theme.muted}">${esc(formatNumber(scale.max, format))}</text>`);
      return out.join("");
    },
  };
}

export function categoricalLegend({ items, theme, title, shape = "square" }) {
  const layout = (at) => {
    const f = theme.fonts.body;
    const gap = 22 * at.unit;
    const box = at.size * 0.85;
    let x = at.x;
    let row = 0;
    const placed = items.map((it) => {
      const w = box + 7 * at.unit + textWidth(it.label, at.size, f);
      if (x + w > at.x + at.maxWidth && x > at.x) {
        x = at.x;
        row++;
      }
      const p = { ...it, x, row };
      x += w + gap;
      return p;
    });
    return { placed, rows: row + 1, box };
  };
  return {
    height: (at) => (title ? at.size * 1.6 : 0) + layout(at).rows * at.size * 1.55,
    svg: (at) => {
      const f = theme.fonts.body;
      const { placed, box } = layout(at);
      let y0 = at.y;
      const out = [];
      if (title) {
        y0 += at.size;
        out.push(`<text x="${at.x}" y="${n(y0)}" font-family="${esc(f)}" font-size="${at.size}" font-weight="600" fill="${theme.text}">${esc(title)}</text>`);
        y0 += at.size * 0.55;
      }
      for (const p of placed) {
        const y = y0 + p.row * at.size * 1.55;
        if (shape === "circle") out.push(`<circle cx="${n(p.x + box / 2)}" cy="${n(y + box / 2)}" r="${n(box / 2)}" fill="${p.color}" stroke="${p.stroke ?? "none"}"/>`);
        else if (shape === "line") out.push(`<line x1="${n(p.x)}" x2="${n(p.x + box)}" y1="${n(y + box / 2)}" y2="${n(y + box / 2)}" stroke="${p.color}" stroke-width="${n(3 * at.unit)}" stroke-dasharray="${p.dash ?? ""}"/>`);
        else out.push(`<rect x="${n(p.x)}" y="${n(y)}" width="${n(box)}" height="${n(box)}" rx="${n(box * 0.18)}" fill="${p.color}"/>`);
        out.push(`<text x="${n(p.x + box + 7 * at.unit)}" y="${n(y + box * 0.88)}" font-family="${esc(f)}" font-size="${at.size}" fill="${theme.muted}">${esc(p.label)}</text>`);
      }
      return out.join("");
    },
  };
}

export function sizeLegend({ values, radius, theme, title, format, fill, stroke, shape = "circle", spikeWidth = 7 }) {
  return {
    height: (at) => (title ? at.size * 1.6 : 0) + Math.max(radius(values[0]) * (shape === "spike" ? 1 : 2), at.size * 1.2) + 6 * at.unit,
    svg: (at) => {
      const f = theme.fonts.body;
      let y = at.y;
      const out = [];
      if (title) {
        y += at.size;
        out.push(`<text x="${at.x}" y="${n(y)}" font-family="${esc(f)}" font-size="${at.size}" font-weight="600" fill="${theme.text}">${esc(title)}</text>`);
        y += at.size * 0.6;
      }
      const big = radius(values[0]);
      let x = at.x;
      if (shape === "spike") {
        const base = y + big;
        for (const v of values) {
          const h = radius(v);
          out.push(`<path d="M${n(x)},${n(base)}L${n(x + spikeWidth / 2)},${n(base - h)}L${n(x + spikeWidth)},${n(base)}Z" fill="${fill}" fill-opacity="0.35" stroke="${stroke}" stroke-width="1"/>`);
          out.push(`<text x="${n(x + spikeWidth + 5 * at.unit)}" y="${n(base)}" font-family="${esc(f)}" font-size="${at.size}" fill="${theme.muted}">${esc(formatNumber(v, format))}</text>`);
          x += spikeWidth + 14 * at.unit + textWidth(formatNumber(v, format), at.size, f);
        }
        return out.join("");
      }
      const base = y + big * 2;
      const cx = at.x + big;
      for (const v of values) {
        const r = radius(v);
        out.push(`<circle cx="${n(cx)}" cy="${n(base - r)}" r="${n(r)}" fill="none" stroke="${theme.muted}" stroke-width="0.8"/>`);
        out.push(`<line x1="${n(cx)}" x2="${n(cx + big + 8 * at.unit)}" y1="${n(base - 2 * r)}" y2="${n(base - 2 * r)}" stroke="${theme.faint}" stroke-width="0.6" stroke-dasharray="2 2"/>`);
        out.push(`<text x="${n(cx + big + 11 * at.unit)}" y="${n(base - 2 * r + at.size * 0.35)}" font-family="${esc(f)}" font-size="${at.size}" fill="${theme.muted}">${esc(formatNumber(v, format))}</text>`);
      }
      return out.join("");
    },
  };
}

/** Pick 3 tidy reference values for a size legend. */
export function legendValues(max) {
  if (!(max > 0)) return [1];
  const mag = 10 ** Math.floor(Math.log10(max));
  const lead = max / mag;
  const top = (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * mag;
  return [top, top / 4, top / 20].filter((v) => v > 0).map((v) => Number(v.toPrecision(2)));
}

/** Combine legends side by side in one band. */
export function legendRow(legends, gapUnits = 48) {
  return {
    height: (at) => Math.max(...legends.map((l) => l.height(at))),
    svg: (at) => {
      let x = at.x;
      const out = [];
      for (const l of legends) {
        const w = l.width ? l.width(at) : at.maxWidth / legends.length;
        out.push(l.svg({ ...at, x, maxWidth: w }));
        x += w + gapUnits * at.unit;
      }
      return out.join("");
    },
  };
}
