// Reading specs and their data files.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { SpecError } from "./errors.mjs";
import { countryList, features } from "./data.mjs";
import { G } from "./geo.mjs";

export const KINDS = ["choropleth", "bubbles", "spikes", "points", "route", "flows", "locator", "poster"];

export function readSpec(file) {
  if (!existsSync(file)) throw new SpecError(`Spec file not found: ${file}`);
  let spec;
  try {
    spec = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new SpecError(`${file} is not valid JSON: ${e.message}`);
  }
  return { spec, base: dirname(resolve(file)) };
}

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d.,\s%]+\)|hsla?\([\d.,\s%deg]+\))$/i;
const SAFE_DASH = /^[\d.\s,]+$/;

/** Colors and dash patterns go into SVG attributes, so only plain values are allowed. */
function checkAttributes(value, path = "spec") {
  if (Array.isArray(value)) return value.forEach((v, i) => checkAttributes(v, `${path}[${i}]`));
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    if ((k === "color" || k === "colors") && typeof v === "string" && !SAFE_COLOR.test(v)) {
      throw new SpecError(`${path}.${k} must be a color such as "#C2412D" or "teal", got ${JSON.stringify(v)}.`);
    }
    if (k === "colors" && v && typeof v === "object") {
      for (const c of Object.values(v)) {
        if (typeof c !== "string" || !SAFE_COLOR.test(c)) throw new SpecError(`${path}.colors entries must be colors, got ${JSON.stringify(c)}.`);
      }
      continue;
    }
    if (k === "dash" && v != null && !SAFE_DASH.test(String(v))) throw new SpecError(`${path}.dash must be numbers like "6 4".`);
    if (k === "data" || k === "stops" || k === "flows" || k === "highlight") continue;
    checkAttributes(v, `${path}.${k}`);
  }
}

export function validate(spec) {
  if (!spec || typeof spec !== "object") throw new SpecError("The spec must be a JSON object.");
  if (!spec.kind) throw new SpecError(`Missing "kind". Use one of: ${KINDS.join(", ")}.`);
  if (!KINDS.includes(spec.kind)) throw new SpecError(`Unknown kind "${spec.kind}". Use one of: ${KINDS.join(", ")}.`);
  checkAttributes(spec);
  if (Array.isArray(spec.routes)) spec.routes.forEach((r, i) => checkAttributes({ color: r.color, dash: r.dash }, `spec.routes[${i}]`));
  return spec;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const delim = text.split("\n", 1)[0].includes("\t") && !text.split("\n", 1)[0].includes(",") ? "\t" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const [head, ...body] = clean;
  if (!head) return [];
  const keys = head.map((h) => h.trim().replace(/^﻿/, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, coerce(r[i])])));
}

function coerce(v) {
  if (v == null) return null;
  const t = v.trim();
  if (t === "") return null;
  const num = t.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(num) && !/^0\d/.test(num)) return Number(num);
  return t;
}

/** Built-in table of country statistics from Natural Earth, for quick maps. */
function builtinCountries() {
  const areas = new Map(
    features("world-50m", "countries").features.map((f) => [f.properties.iso3, G.geoArea(f) * 6371.0088 ** 2]),
  );
  // Antarctica's research-station population makes per-person figures meaningless.
  return countryList().filter((c) => c.iso3 !== "ATA").map((c) => {
    const area = areas.get(c.iso3);
    return {
      iso3: c.iso3, name: c.name, continent: c.continent, region: c.region, subregion: c.subregion,
      population: c.pop, populationYear: c.popYear, gdpMillionsUsd: c.gdp, gdpYear: c.gdpYear,
      gdpPerCapita: c.pop > 0 && c.gdp > 0 ? (c.gdp * 1e6) / c.pop : null,
      areaKm2: area ? Math.round(area) : null,
      density: area && c.pop ? c.pop / area : null,
      income: c.income?.replace(/^\d\.\s*/, ""),
    };
  });
}

/** Load spec.data (or another rows field) into an array of row objects. */
export function loadRows(value, base, field = "data") {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    if (value === "builtin:countries") return builtinCountries();
    const file = resolve(base, value);
    if (!existsSync(file)) throw new SpecError(`${field} file not found: ${value} (looked in ${base}).`);
    const text = readFileSync(file, "utf8");
    const ext = extname(file).toLowerCase();
    if (ext === ".json" || ext === ".geojson") {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.type === "FeatureCollection") {
        return parsed.features.map((f) => ({ ...f.properties, __geometry: f.geometry }));
      }
      if (Array.isArray(parsed.rows)) return parsed.rows;
      throw new SpecError(`${value} must hold an array of rows or a FeatureCollection.`);
    }
    return parseCsv(text);
  }
  throw new SpecError(`${field} must be an array of rows or a path to a CSV or JSON file.`);
}

/** Pick the first column that exists in the rows. */
export function pickColumn(rows, wanted, label) {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]);
  const lower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  for (const w of wanted) {
    if (keys.includes(w)) return w;
    if (lower.has(w.toLowerCase())) return lower.get(w.toLowerCase());
  }
  if (label) throw new SpecError(`Could not find a ${label} column. Columns are: ${keys.join(", ")}. Set it explicitly in the spec.`);
  return null;
}
