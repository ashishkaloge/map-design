// Classification and color scales for thematic maps.
import { getPalette, ramp, rampAt, PALETTES } from "./color.mjs";
import { SpecError } from "./errors.mjs";

const sorted = (values) => values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);

/** Round a break to two significant figures so legends read cleanly. */
export function niceBreak(v) {
  if (v === 0 || !Number.isFinite(v)) return v;
  const mag = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / mag) * mag;
}

function quantileBreaks(values, k) {
  const s = sorted(values);
  const out = [];
  for (let i = 1; i < k; i++) {
    const h = (s.length - 1) * (i / k);
    const lo = Math.floor(h);
    out.push(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (h - lo));
  }
  return out;
}

function equalBreaks(values, k) {
  const s = sorted(values);
  const [min, max] = [s[0], s[s.length - 1]];
  return Array.from({ length: k - 1 }, (_, i) => min + ((max - min) * (i + 1)) / k);
}

/** Fisher-Jenks natural breaks (exact, O(k·n²)). Samples above 2,000 values. */
export function jenksBreaks(values, k) {
  let s = sorted(values);
  if (s.length > 2000) {
    const step = s.length / 2000;
    s = Array.from({ length: 2000 }, (_, i) => s[Math.floor(i * step)]);
  }
  const n = s.length;
  if (n <= k) return s.slice(1);
  const lower = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  const variance = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j++) {
    lower[1][j] = 1;
    variance[1][j] = 0;
  }
  for (let l = 2; l <= n; l++) {
    let sum = 0;
    let sumSq = 0;
    let w = 0;
    let v = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1;
      const val = s[i3 - 1];
      w++;
      sum += val;
      sumSq += val * val;
      v = sumSq - (sum * sum) / w;
      const i4 = i3 - 1;
      if (i4 !== 0) {
        for (let j = 2; j <= k; j++) {
          if (variance[l][j] >= v + variance[i4][j - 1]) {
            lower[l][j] = i3;
            variance[l][j] = v + variance[i4][j - 1];
          }
        }
      }
    }
    lower[l][1] = 1;
    variance[l][1] = v;
  }
  const breaks = [];
  let idx = n;
  for (let j = k; j >= 2; j--) {
    const id = lower[idx][j] - 1;
    breaks.unshift(s[id - 1] !== undefined ? (s[id - 1] + s[id]) / 2 : s[id]);
    idx = id;
  }
  return breaks;
}

/**
 * Build a color scale.
 * spec.scale: { type: quantile|equal|jenks|threshold|continuous|categorical,
 *               classes, breaks, palette, reverse, center, colors }
 */
export function colorScale(values, scale = {}, theme) {
  const type = scale.type ?? (scale.breaks ? "threshold" : "quantile");
  if (type === "categorical") return categoricalScale(values, scale, theme);

  const nums = sorted(values.map(Number));
  if (!nums.length) throw new SpecError("No numeric values to color. Check the `value` field name.");
  const diverging = scale.center != null || getPalette(scale.palette ?? "", "diverging") != null;
  const paletteName = scale.palette ?? (diverging ? theme.diverging : theme.sequential);
  const pal = getPalette(paletteName);
  if (!pal) throw new SpecError(`Unknown palette "${paletteName}". Try: ${Object.keys(PALETTES.sequential).join(", ")}, or diverging ${Object.keys(PALETTES.diverging).join(", ")}.`);
  let stops = scale.colors ?? pal.stops;
  if (scale.reverse) stops = [...stops].reverse();
  const [min, max] = [nums[0], nums[nums.length - 1]];

  if (type === "continuous") {
    const lo = scale.domain?.[0] ?? min;
    const hi = scale.domain?.[1] ?? max;
    let at = (v) => (v - lo) / (hi - lo || 1);
    if (diverging) {
      const c = scale.center ?? 0;
      const span = Math.max(Math.abs(hi - c), Math.abs(lo - c)) || 1;
      at = (v) => 0.5 + (v - c) / (2 * span);
    }
    return { type, stops, min: lo, max: hi, color: (v) => rampAt(stops, at(v)), diverging };
  }

  let breaks;
  const k = Math.max(2, Math.min(9, scale.classes ?? 5));
  if (type === "threshold" || scale.breaks) {
    if (!Array.isArray(scale.breaks) || !scale.breaks.length) throw new SpecError("scale.type threshold needs scale.breaks, e.g. [10, 20, 40].");
    breaks = [...scale.breaks].map(Number).sort((a, b) => a - b);
  } else if (type === "quantile") breaks = quantileBreaks(nums, k).map(niceBreak);
  else if (type === "equal") breaks = equalBreaks(nums, k).map(niceBreak);
  else if (type === "jenks") breaks = jenksBreaks(nums, k).map(niceBreak);
  else throw new SpecError(`Unknown scale.type "${type}". Use quantile, equal, jenks, threshold, continuous or categorical.`);
  breaks = [...new Set(breaks)].filter((b) => b > min && b <= max);
  if (type === "threshold") breaks = [...new Set(scale.breaks.map(Number))].sort((a, b) => a - b);

  const classes = breaks.length + 1;
  let colors;
  if (diverging && scale.center != null) {
    // Split the ramp at the center so classes below it are warm and above cool.
    const below = breaks.filter((b) => b <= scale.center).length;
    const above = classes - below;
    const left = stops.slice(0, Math.ceil(stops.length / 2));
    const right = stops.slice(Math.floor(stops.length / 2));
    colors = [
      ...ramp(left, below + 1).slice(0, below),
      ...ramp(right, above + 1).slice(1),
    ];
  } else colors = ramp(stops, classes);
  const color = (v) => {
    if (!Number.isFinite(v)) return null;
    let i = 0;
    while (i < breaks.length && v >= breaks[i]) i++;
    return colors[i];
  };
  return { type, breaks, colors, min, max, color, diverging };
}

function categoricalScale(values, scale, theme) {
  const cats = scale.order ?? [...new Set(values.filter((v) => v != null && v !== ""))];
  const pal = getPalette(scale.palette ?? theme.categorical, "categorical") ?? getPalette(theme.categorical, "categorical");
  const given = scale.colors && !Array.isArray(scale.colors) ? scale.colors : {};
  const list = Array.isArray(scale.colors) ? scale.colors : pal.stops;
  const map = new Map(cats.map((c, i) => [String(c), given[c] ?? list[i % list.length]]));
  return { type: "categorical", categories: cats.map(String), color: (v) => map.get(String(v)) ?? null, map };
}

/** Square-root scale for circle areas. */
export function radiusScale(values, maxRadius, minRadius = 0) {
  const max = Math.max(...values.filter(Number.isFinite).map(Math.abs), 0) || 1;
  return (v) => (Number.isFinite(v) ? Math.max(minRadius, Math.sqrt(Math.abs(v) / max) * maxRadius) : 0);
}

/** Linear scale for spike heights and flow widths. */
export function linearScale(values, maxOut, minOut = 0) {
  const max = Math.max(...values.filter(Number.isFinite).map(Math.abs), 0) || 1;
  return (v) => (Number.isFinite(v) ? minOut + (Math.abs(v) / max) * (maxOut - minOut) : 0);
}
