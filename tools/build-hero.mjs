// Composes the README hero from rendered gallery PNGs (run `npm run gallery` first).
//   node tools/build-hero.mjs
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { findBrowser } from "../skills/map-design/scripts/lib/export.mjs";

const root = new URL("..", import.meta.url).pathname;
const gallery = join(root, "out/gallery");
const W = 2400;
const H = 1520;
const rows = [
  ["lisbon", "us-population-change", "san-francisco"],
  ["tokyo", "beagle-voyage", "manhattan"],
];
for (const name of rows.flat()) if (!existsSync(join(gallery, `${name}.png`))) throw new Error(`Missing out/gallery/${name}.png; run npm run gallery`);

const rowH = 660;
const card = (name) => {
  const poster = !["us-population-change", "beagle-voyage", "world-density"].includes(name);
  const w = poster ? rowH * 0.75 : rowH * 1.6;
  return `<figure style="width:${w}px;height:${rowH}px"><img src="${pathToFileURL(join(gallery, `${name}.png`)).href}"></figure>`;
};
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;background:#EEEAE2;overflow:hidden}
  main{display:flex;flex-direction:column;gap:44px;align-items:center;justify-content:center;height:100%}
  .row{display:flex;gap:44px}
  figure{margin:0;border-radius:10px;overflow:hidden;box-shadow:0 2px 4px rgba(40,30,20,.10),0 18px 48px rgba(40,30,20,.16)}
  img{width:100%;height:100%;object-fit:cover;display:block}
</style></head><body><main>${rows.map((r) => `<div class="row">${r.map(card).join("")}</div>`).join("")}</main></body></html>`;

const tmp = join(root, "out/hero");
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, "hero.html"), html);
const browser = findBrowser();
if (!browser) throw new Error("No browser found for the screenshot");
const png = join(tmp, "hero.png");
const r = spawnSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${join(tmp, "profile")}`, "--allow-file-access-from-files", `--window-size=${W},${H}`, "--force-device-scale-factor=1", "--virtual-time-budget=5000", `--screenshot=${png}`, pathToFileURL(join(tmp, "hero.html")).href], { encoding: "utf8" });
if (r.status !== 0) throw new Error(r.stderr);
const out = join(root, "docs/assets/hero.webp");
const cw = spawnSync("cwebp", ["-quiet", "-q", "84", png, "-o", out]);
if (cw.status !== 0) throw new Error("cwebp failed");
console.log(`wrote ${out}`);
