// Bundles the renderer's third-party code into dependency-free files that ship
// inside the skill. Run with `npm run build:vendor`.
//   vendor/geo.mjs, vendor/geo.iife.js  d3-geo, d3-array, topojson-client
//   vendor/vtile.mjs                     pbf and @mapbox/vector-tile (vector tile decoding)
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

const licenses = new URL("../skills/map-design/scripts/vendor/licenses/", import.meta.url);
mkdirSync(licenses, { recursive: true });
const pkg = (name) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url)));
const LICENSE_FILE = { "@mapbox/vector-tile": "LICENSE.txt" };
const copyLicense = (name) =>
  copyFileSync(new URL(`../node_modules/${name}/${LICENSE_FILE[name] ?? "LICENSE"}`, import.meta.url), new URL(`${name.replace("@mapbox/", "mapbox-")}-LICENSE`, licenses));

function banner(dependencies) {
  return [
    "// Vendored for map-design. Do not edit; rebuild with `npm run build:vendor`.",
    ...dependencies.map((n) => {
      const p = pkg(n);
      return `// ${n} ${p.version} (${p.license}) ${typeof p.repository === "string" ? p.repository : p.repository?.url}`;
    }),
    "// Full upstream licenses are bundled in ./licenses/; see ../../THIRD_PARTY_NOTICES.md.",
  ].join("\n");
}

const geoDeps = ["d3-geo", "d3-array", "topojson-client"];
geoDeps.forEach(copyLicense);
const geo = {
  entryPoints: [new URL("./vendor-entry.mjs", import.meta.url).pathname],
  bundle: true,
  minify: true,
  legalComments: "none",
  banner: { js: banner(geoDeps) },
  logLevel: "info",
};
await build({ ...geo, format: "esm", platform: "node", outfile: "skills/map-design/scripts/vendor/geo.mjs" });
await build({ ...geo, format: "iife", globalName: "MapGeo", platform: "browser", outfile: "skills/map-design/scripts/vendor/geo.iife.js" });

const tileDeps = ["pbf", "@mapbox/vector-tile", "@mapbox/point-geometry"];
tileDeps.forEach(copyLicense);
await build({
  entryPoints: [new URL("./vendor-vtile-entry.mjs", import.meta.url).pathname],
  bundle: true,
  minify: true,
  legalComments: "none",
  banner: { js: banner(tileDeps) },
  logLevel: "info",
  format: "esm",
  platform: "node",
  outfile: "skills/map-design/scripts/vendor/vtile.mjs",
});
