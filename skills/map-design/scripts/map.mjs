#!/usr/bin/env node
// map-design CLI. Zero dependencies; Node 20+.
//
//   node map.mjs render spec.json [--out path/name] [--no-png] [--scale 2] [--json]
//   node map.mjs check spec.json
//   node map.mjs find "Springfield" [--country USA]
//   node map.mjs poster --place "Lisbon" [--country PRT] [--theme azulejo] [--radius 4]
//   node map.mjs themes
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname, basename, extname, join } from "node:path";
import { render } from "./lib/render.mjs";
import { readSpec } from "./lib/spec.mjs";
import { toHtml } from "./lib/html.mjs";
import { exportPng, findBrowser } from "./lib/export.mjs";
import { SpecError } from "./lib/errors.mjs";
import { EDITORIAL, POSTER } from "./lib/themes.mjs";
import { paletteNames } from "./lib/color.mjs";
import { findPlace, findCountry, findAirport, searchAirports, findUsState, suggestPlaces, placeList, normalize, admin1Features, hasAdmin1 } from "./lib/data.mjs";
import { projectionNames } from "./lib/geo.mjs";
import { SIZES } from "./lib/layout.mjs";

const HELP = `map-design: real maps from a JSON spec.

Commands
  render <spec.json>   Write <name>.html, <name>.svg and <name>.png next to the spec
      --out <path>     Output path without extension (default: next to the spec)
      --no-png         Skip the PNG (it needs a local Chrome, Edge, Brave or Chromium)
      --scale <n>      PNG pixel density (default 2; posters 3)
      --json           Print the report as JSON
  check <spec.json>    Validate, resolve every location and join, write nothing
  find <name>          Look up a place, airport, country or region in the bundled data
      --country <c>    Limit place results to one country
  poster               Shortcut for a city poster
      --place <name>   City or town (from the gazetteer) or use --lat/--lon
      --country <c>    Disambiguate the place
      --theme <name>   ${Object.keys(POSTER).join(", ")}
      --radius <km>    Half-width of the map in km (default 4)
      --lat, --lon     Center on coordinates instead of a gazetteer place
      --title <text>   City line on the poster (also names the files)
      --osm <file>     Use a saved Overpass JSON export instead of downloading
      --out <path>     Output path without extension
  themes               List themes, palettes, projections and sizes

Docs: references/spec.md inside the skill.`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (key.startsWith("no-")) args[key.slice(3)] = false;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) args[key] = argv[++i];
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function kb(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function doRender(spec, base, outBase, args) {
  const result = await render(spec, { base });
  mkdirSync(dirname(outBase), { recursive: true });
  const files = {};
  const svgFile = `${outBase}.svg`;
  writeFileSync(svgFile, result.svg);
  files.svg = svgFile;
  if (args.html !== false) {
    const htmlFile = `${outBase}.html`;
    const bg = result.theme?.bg;
    writeFileSync(htmlFile, toHtml({ svg: result.svg, width: result.width, height: result.height, title: spec.title ?? spec.kind, dark: result.theme?.dark ?? isDark(bg), bg, fileBase: basename(outBase) }));
    files.html = htmlFile;
  }
  let png = null;
  if (args.png !== false) {
    const scale = Number(args.scale ?? (spec.kind === "poster" ? 3 : 2));
    const pngFile = `${outBase}.png`;
    png = exportPng(result.svg, result.width, result.height, pngFile, { scale });
    if (png.ok) files.png = pngFile;
  }
  const report = result.report;
  if (png && !png.ok) report.warnings.push(png.reason);
  if (args.json) {
    console.log(JSON.stringify({ files, size: [result.width, result.height], report }, null, 2));
    return;
  }
  console.log(`map-design: ${spec.kind} map written`);
  for (const [k, f] of Object.entries(files)) console.log(`  ${k.padEnd(4)} ${f}  (${kb(statSync(f).size)})`);
  summarize(report);
}

function isDark(hex) {
  if (!hex) return false;
  const v = parseInt(hex.slice(1), 16);
  return ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11 < 90;
}

function summarize(report) {
  if (report.resolved.length) {
    console.log(`  located ${report.resolved.length} reference(s):`);
    for (const r of report.resolved.slice(0, 12)) console.log(`    ${r.ref} → ${r.as}`);
    if (report.resolved.length > 12) console.log(`    … and ${report.resolved.length - 12} more (use --json for all)`);
  }
  if (report.unmatched.length) {
    console.log(`  NOT MATCHED (${report.unmatched.length}):`);
    for (const u of report.unmatched.slice(0, 20)) console.log(`    row ${u.row}: ${u.reason}`);
  }
  for (const w of report.warnings) console.log(`  warning: ${w}`);
  for (const nt of report.notes) console.log(`  note: ${nt}`);
  if (report.dropped.length) console.log(`  labels left out to avoid overlap: ${report.dropped.slice(0, 10).join(", ")}${report.dropped.length > 10 ? ", …" : ""}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, target] = args._;
  if (!cmd || cmd === "help" || args.help) {
    console.log(HELP);
    return;
  }
  if (cmd === "render" || cmd === "check") {
    if (!target) throw new SpecError(`Usage: map.mjs ${cmd} <spec.json>`);
    const { spec, base } = readSpec(target);
    if (cmd === "check") {
      const result = await render(spec, { base, embedFonts: false, check: true });
      console.log(`map-design: ${spec.kind} spec is valid (${result.width}×${result.height})`);
      summarize(result.report);
      if (result.report.unmatched.length) process.exitCode = 2;
      return;
    }
    const outBase = args.out ? resolve(args.out.replace(/\.(svg|html|png)$/i, "")) : join(dirname(resolve(target)), basename(target, extname(target)));
    await doRender(spec, base, outBase, args);
    return;
  }
  if (cmd === "poster") {
    const spec = {
      kind: "poster",
      place: args.place,
      country: args.country,
      center: args.lat && args.lon ? [Number(args.lon), Number(args.lat)] : undefined,
      theme: args.theme,
      radiusKm: args.radius ? Number(args.radius) : undefined,
      title: args.title,
      subtitle: args.subtitle,
      detail: args.detail,
      osm: args.osm,
    };
    if (!spec.place && !spec.center) throw new SpecError("poster needs --place <name> or --lat and --lon.");
    const name = String(args.title ?? args.place ?? "poster").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "poster";
    const outBase = resolve(args.out ? args.out.replace(/\.(svg|html|png)$/i, "") : `${name}-${spec.theme ?? "noir"}`);
    await doRender(spec, process.cwd(), outBase, args);
    return;
  }
  if (cmd === "find") {
    const q = args._.slice(1).join(" ");
    if (!q) throw new SpecError("Usage: map.mjs find <name> [--country X]");
    const c = findCountry(q);
    if (c) console.log(`country   ${c.name} (${c.iso3}${c.iso2 ? `/${c.iso2}` : ""})  label point ${c.label.join(", ")}  ${c.continent}`);
    const st = findUsState(q);
    if (st && q.length > 1) console.log(`US state  ${st[2]} (${st[1]}, FIPS ${st[0]})`);
    const a = findAirport(q);
    if (a) console.log(`airport   ${a.iata} ${a.name}, ${a.city} ${a.country2}  ${a.lon}, ${a.lat}`);
    const { place, alternatives } = findPlace(q, args.country);
    if (place) {
      for (const p of [place, ...alternatives].slice(0, 6)) console.log(`place     ${p.name}${p.admin1 ? `, ${p.admin1}` : ""}, ${p.country}  ${p.lon}, ${p.lat}  pop ${p.pop.toLocaleString("en-US")}`);
    } else {
      const s = suggestPlaces(q);
      if (s.length) console.log(`no exact place; close: ${s.join(", ")}`);
    }
    if (args.country) {
      const cc = findCountry(args.country);
      if (cc && hasAdmin1(cc.iso3)) {
        const hit = admin1Features(cc.iso3).features.filter((f) => normalize(f.properties.name).includes(normalize(q)));
        for (const f of hit.slice(0, 5)) console.log(`region    ${f.properties.name} (${f.properties.id})  ${f.properties.type ?? ""}`);
      }
    }
    for (const ap of searchAirports(q, 4)) if (ap !== a) console.log(`airport   ${ap.iata} ${ap.name}, ${ap.city} ${ap.country2}`);
    void placeList;
    return;
  }
  if (cmd === "themes") {
    console.log("Editorial themes (choropleth, bubbles, spikes, points, route, flows, locator):");
    for (const [k, t] of Object.entries(EDITORIAL)) console.log(`  ${k.padEnd(11)} ${t.label}`);
    console.log("\nPoster themes:");
    for (const [k, t] of Object.entries(POSTER)) console.log(`  ${k.padEnd(11)} ${t.label}`);
    console.log("\nPalettes:");
    for (const [k, v] of Object.entries(paletteNames())) console.log(`  ${k.padEnd(11)} ${v.join(", ")}`);
    console.log(`\nProjections: ${projectionNames().join(", ")}`);
    console.log(`Sizes: ${Object.entries(SIZES).map(([k, v]) => `${k} ${v.join("×")}`).join(", ")}`);
    console.log(`PNG export browser: ${findBrowser() ?? "none found"}`);
    return;
  }
  throw new SpecError(`Unknown command "${cmd}". Run with --help.`);
}

main().catch((e) => {
  if (e instanceof SpecError || e?.name === "SpecError") {
    console.error(`map-design: ${e.message}`);
    process.exitCode = 1;
  } else {
    console.error(e?.stack ?? e);
    process.exitCode = 1;
  }
});
