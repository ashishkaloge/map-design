// Bundles d3-geo, d3-array and topojson-client into one dependency-free file
// that ships inside the skill. Run with `npm run build:vendor`.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

const dependencies = ["d3-geo", "d3-array", "topojson-client"];
const licenses = new URL("../skills/map-design/scripts/vendor/licenses/", import.meta.url);
mkdirSync(licenses, { recursive: true });
for (const name of dependencies) {
  copyFileSync(new URL(`../node_modules/${name}/LICENSE`, import.meta.url), new URL(`${name}-LICENSE`, licenses));
}
const pkg = (name) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url)));
const banner = [
  "// Vendored for map-design. Do not edit; rebuild with `npm run build:vendor`.",
  ...dependencies.map((n) => {
    const p = pkg(n);
    return `// ${n} ${p.version} (${p.license}) ${typeof p.repository === "string" ? p.repository : p.repository?.url}`;
  }),
  "// Full upstream licenses are bundled in ./licenses/; see ../../THIRD_PARTY_NOTICES.md.",
].join("\n");

const common = {
  entryPoints: [new URL("./vendor-entry.mjs", import.meta.url).pathname],
  bundle: true,
  minify: true,
  legalComments: "none",
  banner: { js: banner },
  logLevel: "info",
};
await build({ ...common, format: "esm", platform: "node", outfile: "skills/map-design/scripts/vendor/geo.mjs" });
await build({ ...common, format: "iife", globalName: "MapGeo", platform: "browser", outfile: "skills/map-design/scripts/vendor/geo.iife.js" });
