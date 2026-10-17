// Bundled geodata: loading, name matching and offline geocoding.
// Nothing here guesses. A name either matches real data or the caller gets
// a list of close matches to choose from.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { feature, mesh } from "../vendor/geo.mjs";

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data");
const cache = new Map();

function load(name) {
  if (!cache.has(name)) {
    const file = join(DATA_DIR, name);
    if (!existsSync(file)) throw new Error(`Missing bundled data file ${name}. Reinstall the skill.`);
    cache.set(name, JSON.parse(readFileSync(file, "utf8")));
  }
  return cache.get(name);
}

export function topology(name) {
  return load(`${name}.topo.json`);
}

export function features(name, object) {
  const key = `features:${name}:${object}`;
  if (!cache.has(key)) {
    const topo = topology(name);
    cache.set(key, feature(topo, topo.objects[object]));
  }
  return cache.get(key);
}

export function meshOf(name, object, filter) {
  const topo = topology(name);
  return mesh(topo, topo.objects[object], filter);
}

// ---------------------------------------------------------------------------
// Names

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function closest(query, candidates, limit = 3) {
  const q = normalize(query);
  return candidates
    .map((c) => ({ c, d: levenshtein(q, normalize(c)) / Math.max(q.length, 1) }))
    .filter((x) => x.d <= 0.45 || normalize(x.c).startsWith(q) || q.startsWith(normalize(x.c)))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Countries

// Common alternative spellings, including World Bank and UN naming. Keys are
// normalized with normalize(); values are the ISO 3166-1 alpha-3 codes used in
// the bundled Natural Earth data.
const COUNTRY_ALIASES = {
  usa: "USA", us: "USA", "united states": "USA", "united states of america": "USA", america: "USA",
  uk: "GBR", "united kingdom": "GBR", "great britain": "GBR", britain: "GBR",
  russia: "RUS", "russian federation": "RUS",
  "south korea": "KOR", "korea rep": "KOR", "republic of korea": "KOR", "korea republic of": "KOR", korea: "KOR",
  "north korea": "PRK", "korea dem peoples rep": "PRK", dprk: "PRK", "democratic peoples republic of korea": "PRK",
  iran: "IRN", "iran islamic rep": "IRN", "iran islamic republic of": "IRN",
  "egypt arab rep": "EGY", syria: "SYR", "syrian arab republic": "SYR",
  vietnam: "VNM", "viet nam": "VNM", laos: "LAO", "lao pdr": "LAO", "lao peoples democratic republic": "LAO",
  czechia: "CZE", "czech republic": "CZE", turkey: "TUR", turkiye: "TUR",
  "ivory coast": "CIV", "cote divoire": "CIV",
  drc: "COD", "dr congo": "COD", "congo dem rep": "COD", "democratic republic of the congo": "COD", "congo kinshasa": "COD",
  "republic of the congo": "COG", "congo rep": "COG", "congo brazzaville": "COG", congo: "COG",
  tanzania: "TZA", "united republic of tanzania": "TZA",
  bolivia: "BOL", "bolivia plurinational state of": "BOL", venezuela: "VEN", "venezuela rb": "VEN",
  slovakia: "SVK", "slovak republic": "SVK", kyrgyzstan: "KGZ", "kyrgyz republic": "KGZ",
  yemen: "YEM", "yemen rep": "YEM", gambia: "GMB", "gambia the": "GMB", bahamas: "BHS", "bahamas the": "BHS",
  micronesia: "FSM", "micronesia fed sts": "FSM", macedonia: "MKD", "north macedonia": "MKD",
  eswatini: "SWZ", swaziland: "SWZ", "cabo verde": "CPV", "cape verde": "CPV", burma: "MMR", myanmar: "MMR",
  "timor leste": "TLS", "east timor": "TLS", brunei: "BRN", "brunei darussalam": "BRN",
  moldova: "MDA", "republic of moldova": "MDA",
  palestine: "PSE", "state of palestine": "PSE", "west bank and gaza": "PSE",
  "hong kong": "HKG", "hong kong sar china": "HKG", macao: "MAC", macau: "MAC", "macao sar china": "MAC",
  taiwan: "TWN", "chinese taipei": "TWN", "taiwan china": "TWN",
  "st lucia": "LCA", "st kitts and nevis": "KNA", "st vincent and the grenadines": "VCT",
  "sao tome and principe": "STP", vatican: "VAT", "holy see": "VAT", falklands: "FLK",
  bosnia: "BIH", uae: "ARE", "united arab emirates": "ARE", xkx: "KOS", kosovo: "KOS",
  "the netherlands": "NLD", holland: "NLD",
};

let countryIndex;
function countryTables() {
  if (countryIndex) return countryIndex;
  const list = load("countries.json");
  const byCode = new Map();
  const byName = new Map();
  for (const c of list) {
    for (const code of [c.iso3, c.iso2, c.n3, c.wb]) if (code) byCode.set(String(code).toUpperCase(), c);
    for (const n of [c.name, c.long, c.admin, c.formal, c.abbrev, ...(c.alt ? c.alt.split(/[|,]/) : [])]) {
      if (n && !byName.has(normalize(n))) byName.set(normalize(n), c);
    }
  }
  for (const [alias, iso3] of Object.entries(COUNTRY_ALIASES)) {
    const c = byCode.get(iso3);
    if (c) byName.set(alias, c);
  }
  countryIndex = { list, byCode, byName };
  return countryIndex;
}

export function countryList() {
  return countryTables().list;
}

/** Find a country by ISO code (alpha-2, alpha-3, numeric), World Bank code or name. */
export function findCountry(query) {
  if (query == null || query === "") return null;
  const { byCode, byName } = countryTables();
  const raw = String(query).trim();
  if (/^\d{1,3}$/.test(raw)) return byCode.get(raw.padStart(3, "0")) ?? null;
  if (/^[A-Za-z]{2,3}$/.test(raw) && byCode.has(raw.toUpperCase())) return byCode.get(raw.toUpperCase());
  return byName.get(normalize(raw)) ?? null;
}

export function suggestCountries(query) {
  return closest(query, countryTables().list.map((c) => c.name));
}

// ---------------------------------------------------------------------------
// First-level subdivisions (states, provinces, regions)

export function hasAdmin1(iso3) {
  return existsSync(join(DATA_DIR, "admin1", `${iso3}.topo.json`));
}

export function admin1Features(iso3) {
  const key = `admin1:${iso3}`;
  if (!cache.has(key)) {
    if (!hasAdmin1(iso3)) throw new Error(`No first-level subdivisions are bundled for ${iso3}.`);
    const topo = load(`admin1/${iso3}.topo.json`);
    cache.set(key, { topo, collection: feature(topo, topo.objects.admin1) });
  }
  return cache.get(key).collection;
}

export function admin1Mesh(iso3) {
  admin1Features(iso3);
  const { topo } = cache.get(`admin1:${iso3}`);
  return mesh(topo, topo.objects.admin1, (a, b) => a !== b);
}

export function findAdmin1(iso3, query) {
  const fc = admin1Features(iso3);
  const q = normalize(query);
  const raw = String(query).trim().toUpperCase();
  return (
    fc.features.find((f) => f.properties.id?.toUpperCase() === raw || f.properties.id?.toUpperCase() === `${iso3.slice(0, 2)}-${raw}`) ??
    fc.features.find((f) => f.properties.postal?.toUpperCase() === raw) ??
    fc.features.find((f) => normalize(f.properties.name) === q || normalize(f.properties.en) === q) ??
    null
  );
}

// ---------------------------------------------------------------------------
// United States (Census boundaries via us-atlas)

export const US_STATES = [
  ["01", "AL", "Alabama"], ["02", "AK", "Alaska"], ["04", "AZ", "Arizona"], ["05", "AR", "Arkansas"],
  ["06", "CA", "California"], ["08", "CO", "Colorado"], ["09", "CT", "Connecticut"], ["10", "DE", "Delaware"],
  ["11", "DC", "District of Columbia"], ["12", "FL", "Florida"], ["13", "GA", "Georgia"], ["15", "HI", "Hawaii"],
  ["16", "ID", "Idaho"], ["17", "IL", "Illinois"], ["18", "IN", "Indiana"], ["19", "IA", "Iowa"],
  ["20", "KS", "Kansas"], ["21", "KY", "Kentucky"], ["22", "LA", "Louisiana"], ["23", "ME", "Maine"],
  ["24", "MD", "Maryland"], ["25", "MA", "Massachusetts"], ["26", "MI", "Michigan"], ["27", "MN", "Minnesota"],
  ["28", "MS", "Mississippi"], ["29", "MO", "Missouri"], ["30", "MT", "Montana"], ["31", "NE", "Nebraska"],
  ["32", "NV", "Nevada"], ["33", "NH", "New Hampshire"], ["34", "NJ", "New Jersey"], ["35", "NM", "New Mexico"],
  ["36", "NY", "New York"], ["37", "NC", "North Carolina"], ["38", "ND", "North Dakota"], ["39", "OH", "Ohio"],
  ["40", "OK", "Oklahoma"], ["41", "OR", "Oregon"], ["42", "PA", "Pennsylvania"], ["44", "RI", "Rhode Island"],
  ["45", "SC", "South Carolina"], ["46", "SD", "South Dakota"], ["47", "TN", "Tennessee"], ["48", "TX", "Texas"],
  ["49", "UT", "Utah"], ["50", "VT", "Vermont"], ["51", "VA", "Virginia"], ["53", "WA", "Washington"],
  ["54", "WV", "West Virginia"], ["55", "WI", "Wisconsin"], ["56", "WY", "Wyoming"], ["60", "AS", "American Samoa"],
  ["66", "GU", "Guam"], ["69", "MP", "Northern Mariana Islands"], ["72", "PR", "Puerto Rico"],
  ["78", "VI", "United States Virgin Islands"],
];

export function findUsState(query) {
  const raw = String(query ?? "").trim();
  if (/^\d{1,2}$/.test(raw)) return US_STATES.find((s) => s[0] === raw.padStart(2, "0")) ?? null;
  const up = raw.toUpperCase().replace(/^US-/, "");
  return US_STATES.find((s) => s[1] === up) ?? US_STATES.find((s) => normalize(s[2]) === normalize(raw)) ?? null;
}

export function usStateFeatures() {
  const fc = features("us-states", "states");
  for (const f of fc.features) {
    const s = findUsState(f.id);
    if (s) f.properties = { ...f.properties, id: s[0], postal: s[1], name: s[2] };
  }
  return fc;
}

export function usCountyFeatures() {
  const fc = features("us-counties", "counties");
  for (const f of fc.features) {
    if (!f.properties.state) {
      const s = findUsState(String(f.id).slice(0, 2));
      f.properties = { ...f.properties, id: String(f.id), state: s?.[1] };
    }
  }
  return fc;
}

// ---------------------------------------------------------------------------
// Places and airports (offline geocoding)

let placeIndex;
function placeTables() {
  if (placeIndex) return placeIndex;
  const { columns, rows } = load("places.json");
  const col = Object.fromEntries(columns.map((c, i) => [c, i]));
  const places = rows.map((r) => ({
    name: r[col.name],
    country: r[col.country],
    admin1: r[col.admin1] || undefined,
    lat: r[col.lat],
    lon: r[col.lon],
    pop: r[col.pop],
    capital: r[col.flags].includes("C"),
    alt: [r[col.ascii], ...String(r[col.alt] || "").split(/[|;]/)].filter(Boolean),
  }));
  const byName = new Map();
  for (const p of places) {
    for (const n of new Set([p.name, ...p.alt].map(normalize))) {
      if (!n) continue;
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(p);
    }
  }
  placeIndex = { places, byName };
  return placeIndex;
}

export function placeList() {
  return placeTables().places;
}

/**
 * Find a populated place by name, optionally within a country.
 * Returns { place, alternatives } where alternatives are other matches the
 * caller should mention when the choice is ambiguous.
 */
export function findPlace(name, country) {
  let query = String(name ?? "").trim();
  let countryHint = country;
  if (!countryHint && query.includes(",")) {
    const i = query.lastIndexOf(",");
    const maybe = findCountry(query.slice(i + 1).trim()) || findUsState(query.slice(i + 1).trim());
    if (maybe) {
      countryHint = query.slice(i + 1).trim();
      query = query.slice(0, i).trim();
    }
  }
  let matches = placeTables().byName.get(normalize(query)) ?? [];
  if (countryHint) {
    // A hint can be a country, a US state (Georgia is both) or a region name.
    const c = findCountry(countryHint);
    const st = findUsState(countryHint);
    const inCountry = c ? matches.filter((p) => p.country === c.iso3 || (c.sov && p.country === c.sov)) : [];
    const inState = st ? matches.filter((p) => p.country === "USA" && normalize(p.admin1) === normalize(st[2])) : [];
    const inRegion = matches.filter((p) => normalize(p.admin1) === normalize(countryHint));
    matches = inCountry.length ? inCountry : inState.length ? inState : inRegion;
  }
  if (!matches.length) return { place: null, alternatives: [] };
  const sorted = [...matches].sort((a, b) => b.pop - a.pop);
  const [best, ...rest] = sorted;
  const alternatives = rest.filter((p) => p.country !== best.country || p.admin1 !== best.admin1);
  return { place: best, alternatives };
}

export function suggestPlaces(name, limit = 4) {
  const q = normalize(name);
  const out = [];
  for (const [n, list] of placeTables().byName) {
    if (n[0] !== q[0]) continue;
    const d = levenshtein(q, n) / Math.max(q.length, 1);
    if (d <= 0.34) out.push({ d, p: list[0] });
  }
  return out.sort((a, b) => a.d - b.d || b.p.pop - a.p.pop).slice(0, limit).map(({ p }) => `${p.name} (${p.country})`);
}

let airportIndex;
function airportTables() {
  if (airportIndex) return airportIndex;
  const { columns, rows } = load("airports.json");
  const col = Object.fromEntries(columns.map((c, i) => [c, i]));
  const byCode = new Map();
  for (const r of rows) {
    const a = {
      iata: r[col.iata], icao: r[col.icao], name: r[col.name], city: r[col.city],
      country2: r[col.country2], lat: r[col.lat], lon: r[col.lon], large: r[col.size] === "L",
    };
    byCode.set(a.iata, a);
    if (a.icao && !byCode.has(a.icao)) byCode.set(a.icao, a);
  }
  airportIndex = { byCode, rows };
  return airportIndex;
}

export function findAirport(code) {
  return airportTables().byCode.get(String(code ?? "").trim().toUpperCase()) ?? null;
}

export function searchAirports(query, limit = 8) {
  const q = normalize(query);
  const out = [];
  for (const a of airportTables().byCode.values()) {
    if (out.includes(a)) continue;
    if (normalize(a.name).includes(q) || normalize(a.city).includes(q)) out.push(a);
  }
  return out.sort((a, b) => Number(b.large) - Number(a.large)).slice(0, limit);
}
