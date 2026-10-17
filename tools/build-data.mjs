// Builds the compact geodata that ships inside the skill from open sources.
// Run with `npm run build:data -- <raw-dir>`, where <raw-dir> holds the
// downloads listed in docs/data-sources.md. Output goes to skills/map-design/data.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { topology } from "topojson-server";
import { presimplify, simplify, quantile, filter, filterAttachedWeight, sphericalRingArea, sphericalTriangleArea } from "topojson-simplify";
import { quantize } from "topojson-client";

const raw = process.argv[2];
if (!raw) {
  console.error("usage: node tools/build-data.mjs <raw-dir>");
  process.exit(1);
}
const out = new URL("../skills/map-design/data/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const readJson = (f) => JSON.parse(readFileSync(join(raw, f), "utf8"));
const valid = (code) => code && code !== "-99" && code !== "-1";
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function write(name, data) {
  const text = JSON.stringify(data);
  writeFileSync(join(out, name), text);
  console.log(`${name.padEnd(28)} ${(text.length / 1024).toFixed(0).padStart(6)} KB`);
}

function shrink(objects, keep, quantization = 1e5, minRingArea = 0) {
  // Simplify in full precision on the sphere, drop slivers, then quantize and
  // delta-encode so the files stay small enough to ship inside the skill.
  let topo = presimplify(topology(objects), sphericalTriangleArea);
  // quantile() sorts weights in descending order, so this keeps the top `keep` share.
  if (keep < 1) topo = simplify(topo, quantile(topo, keep));
  // Drop small detached islands (for example the Arctic archipelagos) that cost
  // thousands of points but are invisible at map scale. Shared borders stay.
  if (minRingArea > 0) topo = filter(topo, filterAttachedWeight(topo, minRingArea, sphericalRingArea));
  topo = quantize(topo, quantization);
  // presimplify stores each point's weight as a third coordinate; drop it.
  topo.arcs = topo.arcs.map((arc) => arc.map(([x, y]) => [x, y]));
  return topo;
}

// Countries ---------------------------------------------------------------
function countryProps(p, official) {
  // ISO_A3 when assigned; otherwise the "EH" code unless a sovereign country
  // already owns it (dependencies such as Indian Ocean Ter. borrow AUS);
  // otherwise Natural Earth's own ADM0_A3 code.
  const iso3 = valid(p.ISO_A3)
    ? p.ISO_A3
    : valid(p.ISO_A3_EH) && !official.has(p.ISO_A3_EH)
      ? p.ISO_A3_EH
      : p.ADM0_A3;
  return {
    iso3,
    iso2: valid(p.ISO_A2_EH) ? p.ISO_A2_EH : valid(p.ISO_A2) ? p.ISO_A2 : undefined,
    n3: valid(p.ISO_N3_EH) ? p.ISO_N3_EH : valid(p.ISO_N3) ? p.ISO_N3 : undefined,
    wb: valid(p.WB_A3) ? p.WB_A3 : undefined,
    name: p.NAME,
    long: p.NAME_LONG !== p.NAME ? p.NAME_LONG : undefined,
    admin: p.ADMIN !== p.NAME ? p.ADMIN : undefined,
    formal: p.FORMAL_EN || undefined,
    alt: p.NAME_ALT || undefined,
    abbrev: p.ABBREV,
    sov: p.SOV_A3 !== iso3 ? p.SOV_A3 : undefined,
    continent: p.CONTINENT,
    region: p.REGION_UN,
    subregion: p.SUBREGION,
    pop: p.POP_EST,
    popYear: p.POP_YEAR,
    gdp: p.GDP_MD,
    gdpYear: p.GDP_YEAR,
    income: p.INCOME_GRP,
    label: [round(p.LABEL_X, 3), round(p.LABEL_Y, 3)],
    rank: p.LABELRANK,
  };
}

function countries(file, keep, outName) {
  const geo = readJson(file);
  const official = new Set(geo.features.map((f) => f.properties.ISO_A3).filter(valid));
  for (const f of geo.features) {
    f.properties = countryProps(f.properties, official);
    f.id = f.properties.iso3;
  }
  write(outName, shrink({ countries: geo }, keep));
  return geo.features.map((f) => f.properties);
}

const small = countries("ne_110m_admin_0_countries_lakes.geojson", 1, "world-110m.topo.json");
const medium = countries("ne_50m_admin_0_countries_lakes.geojson", 0.35, "world-50m.topo.json");

// A country index (codes, names, aliases, stats) without geometry.
const index = medium.map((p) => {
  const inSmall = small.some((s) => s.iso3 === p.iso3);
  return { ...p, small: inSmall || undefined };
});
write("countries.json", index);

// First-level subdivisions, one file per country so a render loads only what it needs.
{
  const geo = readJson("ne_10m_admin_1_states_provinces_lakes.geojson");
  const byCountry = new Map();
  for (const f of geo.features) {
    const p = f.properties;
    const code = valid(p.iso_3166_2) && !p.iso_3166_2.endsWith("~") ? p.iso_3166_2 : p.adm1_code;
    f.id = code;
    f.properties = {
      id: code,
      name: p.name || p.gn_name,
      en: p.name_en && p.name_en !== p.name ? p.name_en : undefined,
      country: p.adm0_a3,
      type: p.type_en || undefined,
      postal: p.postal || undefined,
      label: [round(p.longitude, 3), round(p.latitude, 3)],
      rank: p.labelrank,
    };
    if (!byCountry.has(p.adm0_a3)) byCountry.set(p.adm0_a3, []);
    byCountry.get(p.adm0_a3).push(f);
  }
  mkdirSync(join(out, "admin1"), { recursive: true });
  let total = 0;
  const list = [];
  for (const [country, features] of [...byCountry].sort()) {
    const points = features.reduce((n, f) => n + JSON.stringify(f.geometry.coordinates).split("],[").length, 0);
    const keep = Math.min(1, Math.max(0.001, 6000 / points));
    let topo = shrink({ admin1: { type: "FeatureCollection", features } }, keep, 1e4);
    if (topo.arcs.reduce((n, a) => n + a.length, 0) > 12000) {
      topo = shrink({ admin1: { type: "FeatureCollection", features } }, keep, 1e4, 3e-6);
    }
    const text = JSON.stringify(topo);
    writeFileSync(join(out, "admin1", `${country}.topo.json`), text);
    total += text.length;
    list.push([country, features.length]);
  }
  console.log(`admin1/*.topo.json (${list.length} files) ${(total / 1024).toFixed(0).padStart(6)} KB`);
}

// Lakes and rivers for atlas-style themes --------------------------------------
{
  const lakes = readJson("ne_50m_lakes.geojson");
  for (const f of lakes.features) f.properties = { name: f.properties.name, rank: f.properties.scalerank };
  const rivers = readJson("ne_50m_rivers_lake_centerlines.geojson");
  for (const f of rivers.features) f.properties = { name: f.properties.name, rank: f.properties.scalerank };
  write("physical-50m.topo.json", shrink({ lakes, rivers }, 0.4));
}

// Populated places -------------------------------------------------------------
{
  const geo = readJson("ne_10m_populated_places_simple.geojson");
  const rows = geo.features.map(({ properties: p }) => {
    let flags = "";
    if (p.adm0cap) flags += "C";
    if (p.megacity) flags += "M";
    if (p.worldcity) flags += "W";
    const clean = (v) => (v ? String(v).replace(/\s+/g, " ").trim() : v);
    p.name = clean(p.name);
    p.nameascii = clean(p.nameascii);
    return [
      p.name,
      p.nameascii !== p.name ? p.nameascii : "",
      p.namealt || "",
      p.adm0_a3,
      p.adm1name || "",
      round(p.latitude, 4),
      round(p.longitude, 4),
      p.pop_max,
      p.scalerank,
      flags,
    ];
  });
  rows.sort((a, b) => b[7] - a[7]);
  write("places.json", {
    columns: ["name", "ascii", "alt", "country", "admin1", "lat", "lon", "pop", "rank", "flags"],
    source: "Natural Earth 1:10m populated places (public domain)",
    rows,
  });
}

// Airports ---------------------------------------------------------------------
{
  const text = readFileSync(join(raw, "airports.csv"), "utf8");
  const lines = parseCsv(text);
  const head = lines.shift();
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const rows = [];
  for (const r of lines) {
    const type = r[col.type];
    const iata = r[col.iata_code];
    if (!iata || !/^[A-Z0-9]{3}$/.test(iata)) continue;
    if (type !== "large_airport" && type !== "medium_airport") continue;
    if (r[col.scheduled_service] !== "yes") continue;
    rows.push([
      iata,
      r[col.icao_code] || r[col.gps_code] || "",
      r[col.name],
      r[col.municipality] || "",
      r[col.iso_country],
      round(Number(r[col.latitude_deg]), 4),
      round(Number(r[col.longitude_deg]), 4),
      type === "large_airport" ? "L" : "M",
    ]);
  }
  rows.sort((a, b) => (a[7] === b[7] ? a[0].localeCompare(b[0]) : a[7] === "L" ? -1 : 1));
  write("airports.json", {
    columns: ["iata", "icao", "name", "city", "country2", "lat", "lon", "size"],
    source: "OurAirports (public domain), large and medium airports with scheduled service",
    rows,
  });
}

// US states and counties (us-atlas, from the US Census Bureau, public domain) -----
for (const f of ["states-10m.json", "counties-10m.json"]) {
  copyFileSync(new URL(`../node_modules/us-atlas/${f}`, import.meta.url), join(out, `us-${f.replace("-10m.json", "")}.topo.json`));
  console.log(`us-${f.replace("-10m.json", "")}.topo.json copied`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
