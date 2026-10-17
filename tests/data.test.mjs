import { test } from "node:test";
import assert from "node:assert/strict";
import { findCountry, findUsState, findPlace, findAirport, findAdmin1, normalize } from "../skills/map-design/scripts/lib/data.mjs";
import { resolveLocation } from "../skills/map-design/scripts/lib/locate.mjs";

test("countries resolve from codes, names and common variants", () => {
  const cases = {
    KEN: "KEN", ke: "KEN", "404": "KEN", Kenya: "KEN",
    "Korea, Rep.": "KOR", "Russian Federation": "RUS", "Türkiye": "TUR", Turkey: "TUR",
    "Côte d'Ivoire": "CIV", "Ivory Coast": "CIV", "Congo, Dem. Rep.": "COD", "United States": "USA",
    "Viet Nam": "VNM", Czechia: "CZE", France: "FRA", Norway: "NOR", Kosovo: "KOS",
  };
  for (const [q, iso3] of Object.entries(cases)) assert.equal(findCountry(q)?.iso3, iso3, q);
  assert.equal(findCountry("Atlantis"), null);
});

test("dependencies keep their own codes", () => {
  assert.equal(findCountry("AUS").name, "Australia");
  assert.equal(findCountry("IOA")?.iso3, "IOA");
});

test("US states resolve from postal, FIPS and name", () => {
  assert.equal(findUsState("TX")[2], "Texas");
  assert.equal(findUsState("48")[1], "TX");
  assert.equal(findUsState("new york")[0], "36");
  assert.equal(findUsState("US-CA")[2], "California");
});

test("places pick the largest match and report alternatives", () => {
  const { place, alternatives } = findPlace("Portland");
  assert.equal(place.country, "USA");
  assert.ok(alternatives.length >= 1);
  assert.equal(findPlace("Paris", "FRA").place.country, "FRA");
  assert.equal(findPlace("Sao Paulo").place.country, "BRA");
  assert.equal(findPlace("Lisbon, Portugal").place.country, "PRT");
});

test("airports resolve by IATA and ICAO", () => {
  assert.equal(findAirport("lhr").country2, "GB");
  assert.equal(findAirport("EGLL").iata, "LHR");
  assert.equal(findAirport("ZZZ"), null);
});

test("first-level regions resolve by ISO 3166-2 code and name", () => {
  assert.equal(findAdmin1("IND", "Kerala").properties.id, "IN-KL");
  assert.equal(findAdmin1("IND", "IN-KL").properties.name, "Kerala");
  assert.equal(findAdmin1("DEU", "Bayern")?.properties.country, "DEU");
});

test("resolveLocation handles every reference form", () => {
  assert.equal(resolveLocation([-9.1, 38.7]).how, "coordinates");
  assert.equal(resolveLocation("10.5, 20").lat, 20);
  assert.match(resolveLocation({ iata: "SIN" }).how, /airport SIN/);
  assert.match(resolveLocation("FRA", { prefer: "airport" }).how, /airport FRA/);
  assert.match(resolveLocation("FRA").how, /country FRA/);
  assert.match(resolveLocation({ place: "Kyoto" }).how, /place Kyoto/);
  assert.match(resolveLocation({ state: "Ohio" }).how, /US state OH/);
  assert.throws(() => resolveLocation({ place: "Xyzzyville" }), /Could not locate/);
  assert.throws(() => resolveLocation([200, 10]), /Could not locate/);
});

test("normalize folds accents, punctuation and articles", () => {
  assert.equal(normalize("The Gambia"), "gambia");
  assert.equal(normalize("Côte d’Ivoire"), "cote divoire");
  assert.equal(normalize("Bosnia & Herzegovina"), "bosnia and herzegovina");
});
