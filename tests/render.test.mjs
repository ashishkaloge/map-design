import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render } from "../skills/map-design/scripts/lib/render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const opts = { base: here, embedFonts: false };
const count = (svg, re) => (svg.match(re) ?? []).length;

test("world choropleth from built-in data", async () => {
  const r = await render({ kind: "choropleth", data: "builtin:countries", value: "density", title: "Density" }, opts);
  assert.ok(r.svg.startsWith("<svg"));
  assert.ok(count(r.svg, /data-name=/g) > 150);
  assert.equal(r.report.unmatched.length, 0);
  assert.match(r.svg, /<title>Density<\/title>/);
});

test("unmatched rows are reported with suggestions, not guessed", async () => {
  const r = await render({
    kind: "choropleth", value: "v",
    data: [{ country: "Germany", v: 1 }, { country: "Frnace", v: 2 }, { country: "Atlantis", v: 3 }],
  }, opts);
  assert.equal(r.report.unmatched.length, 2);
  assert.match(r.report.unmatched[0].reason, /France/);
});

test("raw counts trigger a normalization note", async () => {
  const r = await render({ kind: "choropleth", data: "builtin:countries", value: "population" }, opts);
  assert.ok(r.report.notes.some((n) => /raw count/.test(n)));
});

test("missing numeric values stay uncolored while a real zero is retained", async () => {
  const data = [
    { country: "Chile", v: 0 }, { country: "France", v: null },
    { country: "Germany", v: "" }, { country: "Spain" }, { country: "Italy", v: " $ " },
  ];
  for (const scale of [undefined, { type: "continuous" }]) {
    const r = await render({ kind: "choropleth", value: "v", scale, data }, opts);
    assert.equal(count(r.svg, /data-name=/g), 1);
    assert.match(r.svg, /data-name="Chile" data-value="0"/);
    assert.ok(r.report.warnings.some((w) => /4 row\(s\) have no numeric/.test(w)));
  }
  const r = await render({ kind: "bubbles", value: "v", data }, opts);
  assert.equal(count(r.svg, /<circle [^>]*data-name/g), 1);
  assert.match(r.svg, /data-name="Chile" data-value="0"/);
});

test("US states and counties", async () => {
  const s = await render({ kind: "choropleth", region: "usa", value: "v", data: [{ state: "TX", v: 1 }, { state: "CA", v: 2 }, { state: "New York", v: 3 }] }, opts);
  assert.equal(count(s.svg, /data-name=/g), 3);
  const c = await render({ kind: "choropleth", region: "usa", geography: "us-counties", value: "v", data: [{ fips: "06037", v: 9 }, { fips: 1001, v: 2 }] }, opts);
  assert.equal(c.report.unmatched.length, 0);
});

test("admin-1 regions of a country", async () => {
  const r = await render({ kind: "choropleth", region: "IND", value: "v", data: [{ state: "Kerala", v: 1 }, { state: "Punjab", v: 2 }, { state: "IN-TN", v: 3 }] }, opts);
  assert.equal(r.report.unmatched.length, 0);
  assert.match(r.svg, /Kerala/);
});

test("bubbles locate places and label the largest", async () => {
  const r = await render({ kind: "bubbles", value: "pop", data: [{ place: "Tokyo", pop: 37 }, { place: "Delhi", pop: 32 }, { place: "Lagos", pop: 15 }] }, opts);
  assert.equal(count(r.svg, /<circle [^>]*data-name/g), 3);
  assert.equal(r.report.resolved.length, 3);
  assert.match(r.svg, />Tokyo</);
});

test("bubbles support a continuous color legend", async () => {
  const r = await render({
    kind: "bubbles", value: "v", color: { field: "c", scale: { type: "continuous" } },
    data: [{ place: "Paris", v: 1, c: 2 }, { place: "Berlin", v: 2, c: 4 }],
  }, opts);
  assert.equal(count(r.svg, /<circle [^>]*data-name/g), 2);
  assert.match(r.svg, /<linearGradient/);
  assert.doesNotMatch(r.svg, /NaN|Infinity/);
});

test("numeric bubble colors distinguish missing values from zero", async () => {
  const data = [
    { lon: 2, lat: 48, label: "Zero", v: 1, c: 0 },
    { lon: 13, lat: 52, label: "Ten", v: 1, c: 10 },
    { lon: 12, lat: 42, label: "Null", v: 1, c: null },
    { lon: -3, lat: 40, label: "Empty", v: 1, c: "" },
    { lon: 10, lat: 55, label: "Absent", v: 1 },
  ];
  for (const scale of [undefined, { type: "continuous" }]) {
    const r = await render({ kind: "bubbles", value: "v", color: { field: "c", scale }, data }, opts);
    const fill = (label) => r.svg.match(new RegExp(`<circle [^>]*data-name="${label}"[^>]*>`))?.[0].match(/fill="([^"]+)"/)[1];
    assert.equal(count(r.svg, /<circle [^>]*data-name/g), data.length);
    assert.notEqual(fill("Zero"), r.theme.faint);
    for (const label of ["Null", "Empty", "Absent"]) assert.equal(fill(label), r.theme.faint);
    assert.ok(r.report.warnings.some((w) => /3 row\(s\) have no numeric "c"/.test(w)));
    assert.doesNotMatch(r.svg, /NaN|Infinity/);
  }
});

test("spikes, points, flows and locator render", async () => {
  for (const spec of [
    { kind: "spikes", value: "v", data: [{ place: "Berlin", v: 3 }, { place: "Paris", country: "FRA", v: 10 }] },
    { kind: "points", category: "t", data: [{ lon: 2.35, lat: 48.85, t: "a", label: "P" }, { lon: 13.4, lat: 52.5, t: "b", label: "B" }] },
    { kind: "flows", mode: "flight", flows: [{ from: "LHR", to: "JFK", value: 5 }, { from: "JFK", to: "LAX", value: 3 }] },
    { kind: "locator", highlight: "Bhutan", cities: 3 },
    { kind: "locator", highlight: [{ place: "Reykjavik" }] },
  ]) {
    const r = await render(spec, opts);
    assert.ok(r.svg.length > 1000, spec.kind);
    assert.equal(r.report.unmatched.length, 0, spec.kind);
  }
});

test("routes measure great-circle length and support waypoints", async () => {
  const r = await render({ kind: "route", mode: "flight", stops: ["LHR", "JFK"] }, opts);
  const km = Number(r.report.notes[0].match(/([\d,]+) km/)[1].replace(/,/g, ""));
  assert.ok(km > 5500 && km < 5600, `LHR-JFK ${km} km`);
  const v = await render({ kind: "route", mode: "voyage", stops: [{ place: "Lisbon" }, { lon: -20, lat: 30, waypoint: true }, { place: "Salvador", country: "BRA" }] }, opts);
  assert.match(v.svg, /stroke-dasharray/);
});

test("polar flights widen the world crop", async () => {
  const r = await render({ kind: "flows", mode: "flight", region: "world", flows: [{ from: "SIN", to: "JFK", value: 1 }] }, opts);
  assert.ok(r.svg.length > 1000);
});

test("flows omit missing and non-positive volumes without invalid geometry", async () => {
  const flows = [{ from: "Paris", to: "Berlin", value: 5 }, ...[0, -1, null, "", undefined].map((value) => ({ from: "Narnia", to: "Atlantis", value }))];
  const r = await render({ kind: "flows", flows }, opts);
  assert.equal(r.report.resolved.length, 2);
  assert.equal(r.report.unmatched.length, 0);
  assert.equal(r.report.warnings.length, 5);
  assert.doesNotMatch(r.svg, /NaN|Infinity|stroke-width="-/);
  for (const value of [0, -1, null, "", undefined]) {
    await assert.rejects(render({ kind: "flows", flows: [{ from: "Paris", to: "Berlin", value }] }, opts), /No flows could be drawn/);
  }
});

test("annotations and themes", async () => {
  for (const theme of ["paper", "atlas", "ink", "antique", "swiss", "blueprint"]) {
    const r = await render({ kind: "points", theme, data: [{ place: "Nairobi" }], annotations: [{ at: "Nairobi", text: "Here" }] }, opts);
    assert.match(r.svg, />Here</, theme);
  }
});

test("bad specs fail with a clear message", async () => {
  await assert.rejects(render({ kind: "heatmap" }, opts), /Unknown kind/);
  await assert.rejects(render({ kind: "bubbles", data: [{ place: "Rome", v: 1 }] }, opts), /Set "value"/);
  await assert.rejects(render({ kind: "route", stops: ["LHR"] }, opts), /at least two/);
  await assert.rejects(render({ kind: "choropleth", theme: "neon", data: "builtin:countries", value: "density" }, opts), /Unknown theme/);
});

test("a poster renders offline from an Overpass export", async () => {
  const r = await render({ kind: "poster", center: [10, 50], radiusKm: 1, osm: "fixtures/mini-osm.json", title: "Testburg", theme: "paper" }, opts);
  assert.match(r.svg, /TESTBURG/);
  assert.match(r.svg, /class="road primary"/);
  assert.match(r.svg, /class="road motorway"/);
  assert.doesNotMatch(r.svg, /class="road service"/, "tunnels are skipped");
  assert.match(r.svg, /© OpenStreetMap contributors/);
  // Coastline south of center: sea rectangle plus a land polygon.
  assert.match(r.svg, /<rect width="1200" height="1600" fill="#D6E0E1"\/>/);
});

test("fonts are embedded only for faces in use", async () => {
  const r = await render({ kind: "points", data: [{ place: "Oslo" }], title: "Oslo" }, { base: here });
  assert.match(r.svg, /@font-face\{font-family:'Source Serif 4'/);
  assert.doesNotMatch(r.svg, /font-family:'Jost'/);
});

test("colors and dashes cannot inject markup", async () => {
  await assert.rejects(render({ kind: "points", color: '#fff" onload="alert(1)', data: [{ place: "Oslo" }] }, opts), /must be a color/);
  await assert.rejects(render({ kind: "choropleth", value: "v", scale: { type: "categorical", colors: { a: "url(javascript:x)" } }, data: [{ country: "Chile", v: "a" }] }, opts), /must be colors/);
  const r = await render({ kind: "points", data: [{ place: "Oslo", label: '<script>alert(1)</script>' }], label: "label" }, opts);
  assert.doesNotMatch(r.svg, /<script>/);
});

test("opacity must be numeric and cannot inject markup", async () => {
  for (const spec of [
    { kind: "bubbles", value: "v", data: [{ place: "Oslo", v: 1 }] },
    { kind: "locator", highlight: "Bhutan" },
  ]) {
    for (const opacity of ['0.5"/><script>alert(1)</script><circle fill-opacity="0.5', "0.5", -0.1, 1.1]) {
      await assert.rejects(render({ ...spec, opacity }, opts), /opacity must be a number between 0 and 1/);
    }
    for (const opacity of [0, 1]) {
      const r = await render({ ...spec, opacity }, opts);
      assert.match(r.svg, new RegExp(`fill-opacity="${opacity}"`));
    }
  }
});

test("poster check rejects invalid coordinates and offsets before downloading", async () => {
  const base = { kind: "poster", center: [10, 50], radiusKm: 1 };
  const check = { ...opts, check: true };
  for (const center of [[10], [10, 50, 1], [10, "bad"], [10, null], [181, 50], [10, 95], [10, 90], [10, -90]]) {
    await assert.rejects(render({ ...base, center }, check), /center must be|Could not locate|excluding the poles/);
  }
  for (const offset of [[1], [0, "1"], [171, 0], [0, 45]]) {
    await assert.rejects(render({ ...base, offset }, check), /offset must be|Could not locate/);
  }
  const r = await render({ ...base, offset: [0.1, -0.1] }, check);
  assert.doesNotMatch(r.report.notes.join(" "), /NaN|Infinity/);
});

test("posters take labeled pins, at the center or at a location", async () => {
  const base = { kind: "poster", center: [10, 50], radiusKm: 1, osm: "fixtures/mini-osm.json", title: "Testburg" };
  const r = await render({ ...base, markers: [{ label: "Home" }, { lon: 10.005, lat: 50.004, label: "Lake", color: "#00AA88" }] }, opts);
  assert.equal((r.svg.match(/<g class="pin">/g) ?? []).length, 2);
  assert.match(r.svg, />Home</);
  assert.match(r.svg, /#00AA88/);
  const far = await render({ ...base, markers: [{ lon: 11, lat: 51, label: "Far" }] }, opts);
  assert.doesNotMatch(far.svg, /class="pin"/);
  assert.ok(far.report.warnings.some((w) => /outside the poster frame/.test(w)));
  await assert.rejects(render({ ...base, markers: [{ label: "x", color: "red;}" }] }, opts), /must be a color/);
});
