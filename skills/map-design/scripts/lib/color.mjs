// Color utilities: hex parsing, OKLab interpolation and the named palettes.
// OKLab keeps ramps perceptually even, so classed maps read in order.

export function parseHex(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function toOklab(hex) {
  const [r, g, b] = parseHex(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return toHex([
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

export function mix(a, b, t) {
  const A = toOklab(a);
  const B = toOklab(b);
  return fromOklab(A.map((v, i) => v + (B[i] - v) * t));
}

/** Sample `n` colors evenly along a multi-stop ramp. */
export function ramp(stops, n) {
  if (n <= 1) return [stops[Math.floor(stops.length / 2)]];
  const out = [];
  for (let i = 0; i < n; i++) out.push(rampAt(stops, i / (n - 1)));
  return out;
}

export function rampAt(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

/** Relative luminance, for picking readable text on a fill. */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function alpha(hex, a) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Named palettes. Sequential ramps run light to dark; diverging ramps run
// negative to positive through a neutral middle; categorical sets are ordered
// so the first colors stay distinct for viewers with common color deficiencies.
export const PALETTES = {
  sequential: {
    teal: ["#EEF6F3", "#B9DDD3", "#6FB5AA", "#2E8483", "#0F5866", "#0A3846"],
    blue: ["#EFF4FA", "#BED3EA", "#7FA9D4", "#4378B5", "#1F4E8C", "#0E2E5C"],
    green: ["#F1F6E9", "#C9E1B1", "#8EC07F", "#509B5A", "#24703F", "#0F4A2A"],
    purple: ["#F4F0F8", "#D6C9E6", "#AC96CF", "#8061B3", "#573A8F", "#331D60"],
    red: ["#FCF0EA", "#F5C6B3", "#E58C70", "#C9533E", "#9A2C24", "#621616"],
    orange: ["#FFF4E5", "#FCD3A1", "#F5A35C", "#DD7128", "#AA4A10", "#6E2D07"],
    gray: ["#F3F1ED", "#D4CFC6", "#A9A296", "#7A7368", "#4E4942", "#26231F"],
    amber: ["#2A2118", "#5C3A16", "#93551A", "#C77B26", "#EDAA43", "#FFE19A"],
    magma: ["#FCFDBF", "#FEC287", "#FB8761", "#E1516A", "#B5367A", "#832681", "#51127C", "#1D1147"],
    viridis: ["#FDE725", "#A0DA39", "#4AC16D", "#1FA187", "#277F8E", "#365C8D", "#46327E", "#440154"],
    ice: ["#16202B", "#1F3B55", "#2D5F82", "#4A88A8", "#7FB4C6", "#C9E6EC"],
  },
  diverging: {
    "red-blue": ["#9E2B25", "#D46A4C", "#F0B49C", "#F3EFEA", "#A9C6DF", "#5C8EBF", "#245487"],
    "brown-teal": ["#7E4A16", "#C08745", "#E8CFA3", "#F2EFE8", "#A7D6CE", "#4FA39A", "#11615C"],
    "purple-green": ["#5E2C7C", "#9C73B8", "#D6C3E2", "#F2F0EE", "#BFE0B2", "#6FAE68", "#22652F"],
    "orange-blue": ["#A3460F", "#E08B45", "#F6CFA4", "#F2F0EC", "#B4CDE8", "#6A97CB", "#2A5895"],
  },
  categorical: {
    editorial: ["#2F6690", "#D1603D", "#4C9A6A", "#C9A227", "#7A5195", "#3BA8B5", "#B5577B", "#7B7368"],
    vivid: ["#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#17BECF", "#E377C2", "#8C564B"],
    muted: ["#5B7DA0", "#C08A6B", "#7FA383", "#C7B06B", "#9A86B3", "#77AEB3", "#B58397", "#8F8A82"],
    neon: ["#FF3DA6", "#29E7FF", "#FFD23F", "#7CFF6B", "#B48CFF", "#FF7A3D"],
  },
};

export function getPalette(name, kind) {
  for (const group of kind ? [kind] : ["sequential", "diverging", "categorical"]) {
    if (PALETTES[group]?.[name]) return { kind: group, stops: PALETTES[group][name] };
  }
  return null;
}

export function paletteNames() {
  return Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, Object.keys(v)]));
}
