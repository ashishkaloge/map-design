// Turns a location reference from a spec into coordinates, using only bundled
// data. Every resolution is recorded so the agent can show its work.
import { geoCentroid, geoContains } from "../vendor/geo.mjs";
import {
  features, findAirport, findCountry, findPlace, findUsState, suggestCountries, suggestPlaces,
  usStateFeatures, admin1Features, findAdmin1,
} from "./data.mjs";
import { SpecError } from "./errors.mjs";

const num = (v) => (v === "" || v == null ? NaN : Number(v));

function fromCoords(lon, lat, label) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lon, lat, label, how: "coordinates" };
}

function country(c) {
  return { lon: c.label[0], lat: c.label[1], label: c.name, how: `country ${c.iso3}`, country: c.iso3 };
}

function airport(a) {
  return {
    lon: a.lon, lat: a.lat, label: a.city || a.name, how: `airport ${a.iata} (${a.name})`,
    code: a.iata, country2: a.country2,
  };
}

function place(p, alternatives) {
  const r = {
    lon: p.lon, lat: p.lat, label: p.name,
    how: `place ${p.name}${p.admin1 ? `, ${p.admin1}` : ""}, ${p.country} (pop ${p.pop.toLocaleString("en-US")})`,
    country: p.country,
  };
  if (alternatives.length) {
    const alt = alternatives.slice(0, 3).map((a) => `${a.name}${a.admin1 ? `, ${a.admin1}` : ""} (${a.country})`).join("; ");
    r.warning = `"${p.name}" is ambiguous; used the largest match. Others: ${alt}. Add a country to be explicit.`;
  }
  return r;
}

function usState(s) {
  const f = usStateFeatures().features.find((x) => x.properties.id === s[0]);
  const [lon, lat] = f ? geoCentroid(f) : [NaN, NaN];
  return { lon, lat, label: s[2], how: `US state ${s[1]}` };
}

function fail(ref, hint) {
  const shown = typeof ref === "string" ? `"${ref}"` : JSON.stringify(ref);
  throw new SpecError(`Could not locate ${shown}.${hint ? ` ${hint}` : ""}`);
}

/**
 * Resolve a reference. Accepted forms:
 *   [lon, lat] | "lon,lat" | { lon, lat } | { iata } | { place, country? } |
 *   { city, country? } | { country } | { state } | { admin1, country } | "Name" | "Name, Country"
 * `prefer` = "airport" makes three-letter strings resolve as IATA codes first.
 */
export function resolveLocation(ref, { prefer } = {}) {
  if (Array.isArray(ref)) {
    const r = fromCoords(num(ref[0]), num(ref[1]));
    return r ?? fail(ref, "Coordinates are [longitude, latitude].");
  }
  if (ref && typeof ref === "object") {
    const lon = num(ref.lon ?? ref.lng ?? ref.longitude);
    const lat = num(ref.lat ?? ref.latitude);
    const label = ref.label ?? ref.name;
    if (Number.isFinite(lon) || Number.isFinite(lat)) {
      return fromCoords(lon, lat, label) ?? fail(ref, "lon must be within ±180 and lat within ±90.");
    }
    if (ref.iata || ref.airport) {
      const a = findAirport(ref.iata ?? ref.airport);
      return a ? { ...airport(a), label: label ?? airport(a).label } : fail(ref.iata ?? ref.airport, "Not a known IATA or ICAO code with scheduled service.");
    }
    if (ref.place || ref.city) {
      const name = ref.place ?? ref.city;
      const { place: p, alternatives } = findPlace(name, ref.country ?? ref.state);
      if (!p) {
        const s = suggestPlaces(name);
        return fail(name, `${s.length ? `Close matches: ${s.join(", ")}. ` : ""}Small towns are not in the gazetteer; pass lon/lat instead.`);
      }
      const r = place(p, ref.country ? [] : alternatives);
      return { ...r, label: label ?? r.label };
    }
    if (ref.admin1 && ref.country) {
      const c = findCountry(ref.country) ?? fail(ref.country);
      const f = findAdmin1(c.iso3, ref.admin1) ?? fail(ref.admin1, `Not a first-level region of ${c.name}.`);
      return { lon: f.properties.label[0], lat: f.properties.label[1], label: label ?? f.properties.name, how: `region ${f.properties.id}` };
    }
    if (ref.state) {
      const s = findUsState(ref.state) ?? fail(ref.state, "Not a US state name, postal code or FIPS code.");
      const r = usState(s);
      return { ...r, label: label ?? r.label };
    }
    if (ref.country) {
      const c = findCountry(ref.country);
      if (!c) fail(ref.country, suggest(ref.country));
      const r = country(c);
      return { ...r, label: label ?? r.label };
    }
    return fail(ref, "Give lon/lat, iata, place (with optional country), state or country.");
  }
  if (typeof ref === "string" || typeof ref === "number") {
    const s = String(ref).trim();
    const pair = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (pair) return fromCoords(Number(pair[1]), Number(pair[2])) ?? fail(s, "Coordinates are \"lon,lat\".");
    const code = /^[A-Z]{3}$/.test(s);
    if (code && prefer === "airport") {
      const a = findAirport(s);
      if (a) return airport(a);
    }
    const { place: p, alternatives } = findPlace(s);
    if (p) return place(p, alternatives);
    // Three capitals: an ISO country code first, then an airport code.
    const c = findCountry(s);
    if (c) return country(c);
    if (code) {
      const a = findAirport(s);
      if (a) return airport(a);
    }
    const st = findUsState(s);
    if (st && s.length > 2) return usState(st);
    const sp = suggestPlaces(s);
    return fail(s, sp.length ? `Close matches: ${sp.join(", ")}.` : "Use { lon, lat } for places outside the gazetteer.");
  }
  return fail(ref);
}

function suggest(q) {
  const s = suggestCountries(q);
  return s.length ? `Did you mean ${s.join(", ")}?` : "";
}

/** The admin-1 feature for a reference, used by locator highlights. */
export function admin1For(countryRef, name) {
  const c = findCountry(countryRef);
  if (!c) return null;
  return findAdmin1(c.iso3, name) ?? null;
}

/** ISO3 code of the country at a point (Natural Earth 1:50m). Points on water
 *  at that scale, such as a city centre on a strait, take the nearest country
 *  within about 25 km. Returns null in open sea. */
export function countryAt(lon, lat) {
  const countries = features("world-50m", "countries").features;
  const hit = ([x, y]) => countries.find((f) => geoContains(f, [x, y]))?.properties.iso3 ?? null;
  const here = hit([lon, lat]);
  if (here) return here;
  const kmLon = 111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  for (const km of [3, 8, 15, 25]) {
    for (let a = 0; a < 360; a += 45) {
      const r = (a * Math.PI) / 180;
      const found = hit([lon + (km * Math.cos(r)) / kmLon, lat + (km * Math.sin(r)) / 111.32]);
      if (found) return found;
    }
  }
  return null;
}

export { admin1Features };
