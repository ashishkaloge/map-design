import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { buildHover, hoverItem } from "../skills/map-design/scripts/lib/hover.mjs";
import { toHtml } from "../skills/map-design/scripts/lib/html.mjs";
import { render } from "../skills/map-design/scripts/lib/render.mjs";

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const options = { drawn: new Set(), toScreen: (p) => p, view: [0, 0, 100, 100], tol: 0.1, kmPerPx: 0.001 };
const park = (rings) => buildHover({
  names: { streets: [], water: [], parks: [{ name: "Green", kind: "park", rings }] },
}, options);
const points = (encoded) => {
  let x = 0, y = 0;
  const out = [];
  for (let i = 0; i < encoded.length; i += 2) {
    x += encoded[i]; y += encoded[i + 1];
    out.push([x / 10, y / 10]);
  }
  return out;
};

test("hover areas retain enclosing polygons and measure only the visible area", () => {
  const enclosing = park([square(-50, -50, 150, 150)]);
  assert.equal(enclosing.length, 1);
  assert.equal(enclosing[0].i, "Park · 1.0 ha in view");
  assert.ok(points(enclosing[0].g[0]).every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100));

  const partial = park([square(50, 50, 150, 150)]);
  assert.equal(partial[0].i, "Park · 2,500 m² in view");
  const crossing = park([square(-50, 40, 150, 60)]);
  assert.equal(crossing[0].i, "Park · 2,000 m² in view", "crossing edges need no vertex inside the frame");
  assert.deepEqual(park([square(150, 150, 200, 200)]), []);
});

test("hover clipping preserves holes and clips unnamed building targets", () => {
  const result = park([square(-50, -50, 150, 150), square(25, 25, 75, 75).reverse()]);
  assert.equal(result[0].i, "Park · 7,500 m² in view");
  const buildings = buildHover({
    names: { streets: [], water: [], parks: [] },
    buildings: [{ rings: [square(-20, -20, 120, 120)], height: 20 }],
  }, { ...options, buildingsDrawn: true });
  assert.equal(buildings[0].n, "Building");
  assert.ok(points(buildings[0].g[0]).every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100));
});

// Run the generated page's own event handler with a small DOM stand-in. This
// verifies its geometric picking and bounded startup without a browser dependency.
function pageHover(features, view = { x: 0, y: 0, width: 100, height: 100 }) {
  const handlers = {};
  const node = () => ({ setAttribute() {}, replaceChildren() {}, append() {} });
  const svg = {
    ...node(), outerHTML: "<svg></svg>", viewBox: { baseVal: view },
    querySelectorAll: () => [],
    addEventListener: (name, fn) => { handlers[name] = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: view.width, height: view.height }),
  };
  const name = {}, info = {};
  const tip = { style: {}, offsetWidth: 40, querySelector: (q) => q === "b" ? name : info };
  const frame = { querySelector: () => svg, addEventListener() {} };
  const document = {
    querySelector: (q) => q === ".frame" ? frame : q === ".tip" ? tip : {},
    getElementById: () => ({ textContent: JSON.stringify(features) }),
    createElementNS: node,
  };
  const html = toHtml({ svg: "<svg></svg>", width: view.width, height: view.height, features });
  const code = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  runInNewContext(code, { document, innerWidth: 1000 }, { timeout: 1000 });
  return (x, y) => {
    handlers.pointermove({ clientX: x - view.x, clientY: y - view.y, target: { closest: () => null } });
    return tip.style.opacity === 1 ? name.textContent : null;
  };
}

test("HTML hover bounds its index to the page even for oversized geometry", () => {
  const pick = pageHover([hoverItem("area", "Large park", "", [square(-1e6, -1e6, 1e6, 1e6)])]);
  assert.equal(pick(50, 50), "Large park");
  const shifted = pageHover([hoverItem("area", "Shifted", "", [square(200, 300, 300, 400)])],
    { x: 200, y: 300, width: 100, height: 100 });
  assert.equal(shifted(250, 350), "Shifted");
});

test("HTML area picking matches nonzero SVG fill for holes and overlapping parts", () => {
  const hole = pageHover([hoverItem("area", "Park", "", [square(0, 0, 100, 100), square(25, 25, 75, 75).reverse()])]);
  assert.equal(hole(10, 10), "Park");
  assert.equal(hole(50, 50), null);
  const overlap = pageHover([hoverItem("area", "Park", "", [square(0, 0, 70, 100), square(30, 0, 100, 100)])]);
  assert.equal(overlap(50, 50), "Park", "overlapping same-winding pieces stay filled");
});

test("poster check validates source, detail and language without fetching", async (t) => {
  let fetches = 0;
  t.mock.method(globalThis, "fetch", () => { fetches++; throw new Error("unexpected download"); });
  const base = { kind: "poster", center: [10, 50], radiusKm: 1 };
  for (const [field, value] of [["source", "tiles"], ["source", "file"], ["detail", "tiny"], ["lang", "not a tag!"]]) {
    for (const check of [true, false]) {
      await assert.rejects(render({ ...base, [field]: value }, { check, embedFonts: false }), new RegExp(`${field} must be`));
    }
  }
  const checked = await render({ ...base, source: "vector", detail: "high", lang: "tr" }, { check: true });
  assert.equal(checked.svg, "");
  assert.equal(fetches, 0);
});
