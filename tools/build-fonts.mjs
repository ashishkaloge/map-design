// Copies the open-licensed (SIL OFL 1.1) fonts the themes use into the skill,
// with a manifest of unicode ranges so renders embed only what a map needs.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const out = join(root, "skills/map-design/fonts");
mkdirSync(out, { recursive: true });

const families = {
  "Libre Franklin": { pkg: "libre-franklin", faces: ["400-normal", "600-normal", "800-normal", "400-italic"] },
  "Source Serif 4": { pkg: "source-serif-4", faces: ["400-normal", "600-normal", "400-italic"] },
  Jost: { pkg: "jost", faces: ["300-normal", "400-normal", "600-normal"] },
  "EB Garamond": { pkg: "eb-garamond", faces: ["400-normal", "600-normal", "400-italic"] },
  "IBM Plex Mono": { pkg: "ibm-plex-mono", faces: ["400-normal", "500-normal"] },
};
const subsets = ["latin", "latin-ext", "vietnamese"];

const manifest = [];
for (const [family, { pkg, faces }] of Object.entries(families)) {
  for (const face of faces) {
    const [weight, style] = face.split("-");
    const css = readFileSync(join(root, "node_modules/@fontsource", pkg, style === "italic" ? `${weight}-italic.css` : `${weight}.css`), "utf8");
    for (const subset of subsets) {
      const file = `${pkg}-${subset}-${weight}-${style}.woff2`;
      const src = join(root, "node_modules/@fontsource", pkg, "files", file);
      if (!existsSync(src)) continue;
      const block = css.split("/*").find((b) => b.startsWith(` ${pkg}-${subset}-${weight}-${style} */`));
      const range = block?.match(/unicode-range:\s*([^;]+);/)?.[1];
      copyFileSync(src, join(out, file));
      manifest.push({ family, weight: Number(weight), style, subset, file, range });
    }
  }
}
writeFileSync(join(out, "fonts.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`${manifest.length} font files copied`);
