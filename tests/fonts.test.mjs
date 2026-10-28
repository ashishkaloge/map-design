import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../skills/map-design/scripts/lib/render.mjs";

const base = dirname(fileURLToPath(import.meta.url));

for (const [kind, spec] of [
  ["editorial", { kind: "points", data: [{ place: "Oslo" }], title: "Oslo & surroundings" }],
  ["poster", { kind: "poster", center: [10, 50], radiusKm: 1, osm: "fixtures/mini-osm.json", title: "A & B" }],
]) {
  test(`${kind} SVG embeds fonts with XML-compatible style attributes`, async () => {
    const { svg } = await render(spec, { base });
    const styles = [...svg.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)];
    assert.ok(styles.length > 0, "the default export embeds its fonts");
    for (const [, attributes, css] of styles) {
      // Standalone SVG uses XML: every attribute must have a quoted value.
      // HTML accepts bare attributes, so an HTML/PNG preview misses this defect.
      assert.match(attributes, /^(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*$/);
      assert.match(css, /@font-face\{/);
      assert.match(css, /src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/);
    }
    assert.match(svg, /&amp;/, "text remains escaped for standalone XML");
    const withoutFonts = await render(spec, { base, embedFonts: false });
    assert.doesNotMatch(withoutFonts.svg, /<style\b|@font-face/);
  });
}
