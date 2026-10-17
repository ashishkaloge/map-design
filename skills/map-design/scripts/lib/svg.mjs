// Small SVG, text and number helpers shared by every renderer.

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const n = (v, d = 1) => {
  const k = 10 ** d;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? 0 : r;
};

export function attrs(o) {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${esc(typeof v === "number" ? n(v, 2) : v)}"`))
    .join(" ");
}

export const el = (tag, a = {}, body) => (body == null ? `<${tag} ${attrs(a)}/>` : `<${tag} ${attrs(a)}>${body}</${tag}>`);

// Approximate advance widths in em, per glyph class. Good enough to keep
// labels from colliding; real metrics would need the font files parsed.
const WIDTH = {
  narrow: 0.27, // i j l | ' . , : ; !
  slim: 0.36, // f t r I ( ) - space
  lower: 0.53,
  wide: 0.8, // m w
  upper: 0.66,
  upperWide: 0.88, // M W
  digit: 0.56,
};
const FAMILY_FACTOR = [
  [/Mono/i, 1.08],
  [/Garamond/i, 0.9],
  [/Jost/i, 0.95],
  [/Serif/i, 0.97],
];

export function textWidth(text, size, family = "", { letterSpacing = 0, weight = 400 } = {}) {
  let em = 0;
  for (const ch of String(text)) {
    if (/[ijl|'.,:;!]/.test(ch)) em += WIDTH.narrow;
    else if (/[ftrI()\- ]/.test(ch)) em += WIDTH.slim;
    else if (/[mw]/.test(ch)) em += WIDTH.wide;
    else if (/[MW]/.test(ch)) em += WIDTH.upperWide;
    else if (/[A-Z]/.test(ch)) em += WIDTH.upper;
    else if (/[0-9]/.test(ch)) em += WIDTH.digit;
    else em += WIDTH.lower;
  }
  const mono = /Mono/i.test(family);
  if (mono) em = String(text).length * 0.6;
  const factor = mono ? 1 : FAMILY_FACTOR.find(([re]) => re.test(family))?.[1] ?? 1;
  const bold = weight >= 600 ? 1.06 : 1;
  return em * size * factor * bold + Math.max(0, String(text).length - 1) * letterSpacing;
}

export function wrap(text, maxWidth, size, family, opts) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && textWidth(next, size, family, opts) > maxWidth) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Format a number for labels and legends. */
export function formatNumber(v, fmt = {}) {
  if (v == null || Number.isNaN(v)) return "";
  const { prefix = "", suffix = "", decimals, compact = false } = fmt;
  let s;
  if (compact && Math.abs(v) >= 1000) {
    const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    const [div, unit] = units.find(([d]) => Math.abs(v) >= d);
    const x = v / div;
    const d = decimals ?? (Math.abs(x) < 100 ? 1 : 0);
    s = `${trimZeros(x.toFixed(d))}${unit}`;
  } else {
    const d = decimals ?? autoDecimals(v);
    s = Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  return `${prefix}${s}${suffix}`;
}

function trimZeros(s) {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

function autoDecimals(v) {
  const a = Math.abs(v);
  if (a === 0 || a >= 100 || Number.isInteger(v)) return 0;
  if (a >= 10) return 1;
  if (a >= 1) return 1;
  return 2;
}

/** Degrees as 38.7223° N, 9.1393° W. */
export function formatCoords(lon, lat, d = 4) {
  return `${Math.abs(lat).toFixed(d)}° ${lat >= 0 ? "N" : "S"}  ·  ${Math.abs(lon).toFixed(d)}° ${lon >= 0 ? "E" : "W"}`;
}
