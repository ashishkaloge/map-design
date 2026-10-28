// Embeds fonts as base64 @font-face rules so the SVG and HTML render the same
// everywhere, offline. Only the faces (family, weight, style) the map's text
// uses and only the unicode subsets its characters need are included.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fonts");
let manifest;

function faces() {
  manifest ??= JSON.parse(readFileSync(join(FONT_DIR, "fonts.json"), "utf8"));
  return manifest;
}

function inRange(code, range) {
  return range.split(",").some((part) => {
    const [a, b] = part.trim().replace(/U\+/g, "").split("-").map((h) => parseInt(h, 16));
    return b == null ? code === a : code >= a && code <= b;
  });
}

const firstFamily = (stack) => String(stack).split(",")[0].trim().replace(/^['"]|['"]$/g, "");
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Find every (family, weight, style) used by <text> elements and their characters. */
export function fontUsage(svg) {
  const uses = new Map();
  const re = /<text\b([^>]*)>([^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const attrs = decode(m[1]);
    const family = firstFamily(attrs.match(/font-family="([^"]+)"/)?.[1] ?? "");
    if (!family) continue;
    const weight = Number(attrs.match(/font-weight="(\d+)"/)?.[1] ?? 400);
    const style = /font-style="italic"/.test(attrs) ? "italic" : "normal";
    const key = `${family}|${weight}|${style}`;
    uses.set(key, (uses.get(key) ?? "") + decode(m[2]));
  }
  return uses;
}

/** CSS @font-face rules for the faces an SVG string uses. */
export function fontCssForSvg(svg) {
  const uses = fontUsage(svg);
  const all = faces();
  const picked = new Map();
  for (const [key, text] of uses) {
    const [family, weight, style] = key.split("|");
    const options = all.filter((f) => f.family === family && f.style === style);
    const pool = options.length ? options : all.filter((f) => f.family === family);
    if (!pool.length) continue;
    const best = pool.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a)).weight;
    const codes = new Set([...text].map((c) => c.codePointAt(0)));
    for (const f of pool.filter((x) => x.weight === best)) {
      if (f.subset !== "latin" && ![...codes].some((c) => inRange(c, f.range))) continue;
      // Register the face under the requested weight so the browser uses it as is.
      picked.set(`${f.file}|${weight}`, { ...f, weight: Number(weight) });
    }
  }
  return [...picked.values()]
    .map((f) => {
      const data = readFileSync(join(FONT_DIR, f.file)).toString("base64");
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${f.range}}`;
    })
    .join("");
}

/** Insert the font CSS into an SVG that has a <style data-fonts=""></style> slot. */
export function embedFonts(svg) {
  return svg.replace('<style data-fonts=""></style>', `<style data-fonts="">${fontCssForSvg(svg)}</style>`);
}
