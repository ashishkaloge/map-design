// Renders every example in examples/ and writes README previews to
// docs/assets/gallery/<name>.webp (needs a local Chrome and `cwebp`).
// Full outputs (HTML, SVG, PNG) go to out/gallery/, which is not committed.
//   node tools/build-gallery.mjs [name ...]
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { render } from "../skills/map-design/scripts/lib/render.mjs";
import { toHtml } from "../skills/map-design/scripts/lib/html.mjs";
import { exportPng } from "../skills/map-design/scripts/lib/export.mjs";

const root = new URL("..", import.meta.url).pathname;
const only = process.argv.slice(2);
const outDir = join(root, "out/gallery");
const previewDir = join(root, "docs/assets/gallery");
mkdirSync(outDir, { recursive: true });
mkdirSync(previewDir, { recursive: true });
const stats = [];

for (const name of readdirSync(join(root, "examples")).sort()) {
  if (only.length && !only.includes(name)) continue;
  const dir = join(root, "examples", name);
  const specFile = join(dir, "spec.json");
  const specText = readFileSync(specFile, "utf8");
  const spec = JSON.parse(specText);
  const t0 = Date.now();
  const r = await render(spec, { base: dir });
  const ms = Date.now() - t0;
  writeFileSync(join(outDir, `${name}.svg`), r.svg);
  writeFileSync(join(outDir, `${name}.html`), toHtml({ svg: r.svg, width: r.width, height: r.height, title: spec.title ?? name, dark: r.theme?.dark, bg: r.theme?.bg, fileBase: name }));
  const png = join(outDir, `${name}.png`);
  const ok = exportPng(r.svg, r.width, r.height, png, { scale: 1 });
  if (!ok.ok) throw new Error(`${name}: ${ok.reason}`);
  const webp = join(previewDir, `${name}.webp`);
  const cw = spawnSync("cwebp", ["-quiet", "-q", spec.kind === "poster" ? "80" : "88", png, "-o", webp]);
  if (cw.status !== 0) throw new Error(`${name}: cwebp failed`);
  const geometry = r.svg.replace(/<style data-fonts>[\s\S]*?<\/style>/, "").length;
  stats.push({ name, kind: spec.kind, specBytes: Buffer.byteLength(specText), svgBytes: geometry, ms, warnings: r.report.warnings, unmatched: r.report.unmatched.length });
  console.log(`${name.padEnd(22)} ${spec.kind.padEnd(10)} spec ${String(Buffer.byteLength(specText)).padStart(5)} B → svg ${(geometry / 1024).toFixed(0).padStart(5)} KB  preview ${(statSync(webp).size / 1024).toFixed(0)} KB  ${ms} ms${r.report.unmatched.length ? `  UNMATCHED ${r.report.unmatched.length}` : ""}`);
  for (const w of r.report.warnings) console.log(`   warning: ${w}`);
}
writeFileSync(join(outDir, "stats.json"), JSON.stringify(stats, null, 2));
