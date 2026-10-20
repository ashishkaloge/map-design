// Spec in, map out. Orchestrates layout, projection, base map and the kind.
import { editorialTheme } from "./themes.mjs";
import { compose, resolveSize, legendRow } from "./layout.mjs";
import { frame, G } from "./geo.mjs";
import { basemap } from "./basemap.mjs";
import { rasterBasemap, resolveBasemap } from "./tiles.mjs";
import { Placer } from "./labels.mjs";
import { validate, loadRows } from "./spec.mjs";
import { annotations } from "./kinds/common.mjs";
import { embedFonts as withFonts } from "./fonts.mjs";
import { esc, n } from "./svg.mjs";
import * as choropleth from "./kinds/choropleth.mjs";
import * as bubbles from "./kinds/bubbles.mjs";
import * as points from "./kinds/points.mjs";
import * as route from "./kinds/route.mjs";
import * as flows from "./kinds/flows.mjs";
import * as locator from "./kinds/locator.mjs";
import { renderPoster } from "./kinds/poster.mjs";

const KIND_MODULES = { choropleth, bubbles, spikes: bubbles, points, route, flows, locator };

export const ATTRIBUTION = "Natural Earth";

export function newReport() {
  return { warnings: [], notes: [], resolved: [], unmatched: [], dropped: [] };
}

/** Render a spec to { svg, report, width, height, interactive }. */
export async function render(spec, { base = process.cwd(), embedFonts = true, check = false, log, fetchTile } = {}) {
  validate(spec);
  if (spec.kind === "poster") return renderPoster(spec, { base, embedFonts, check, ...(log ? { log } : {}) });
  const theme = editorialTheme(spec.theme ?? (spec.kind === "route" && spec.mode === "voyage" ? "antique" : "paper"));
  const report = newReport();
  // A raster basemap needs a conformal, axis-aligned projection: XYZ tiles are
  // Web Mercator squares and would shear under anything else. Credit them too.
  const rasterCfg = resolveBasemap(spec.basemap);
  if (rasterCfg) {
    const asked = typeof spec.projection === "string" ? spec.projection : spec.projection?.name;
    if (asked !== "mercator") {
      spec = { ...spec, projection: "mercator" };
      report.warnings.push("basemap: projection is mercator (XYZ tiles are Web Mercator)");
    }
  }
  const rows = loadRows(spec.data, base);
  const ctx = { spec, base, theme, rows, report };
  const kind = KIND_MODULES[spec.kind].prepare(ctx);
  const region = spec.region ?? kind.defaultRegion ?? "world";
  const [width, height] = resolveSize(spec.size ?? autoSize({ ...spec, region, _latRange: kind.latRange }, kind.dataObject));

  const legends = [kind.legend, kind.extraLegend].filter(Boolean);
  const legend = legends.length > 1 ? legendRow(legends) : legends[0] ?? null;
  const layout = compose({
    width, height, theme, spec, legend,
    mapAttribution: rasterCfg ? { text: rasterCfg.attribution, urls: rasterCfg.attributionUrls } : null,
  });
  const [[mx0, my0], [mx1, my1]] = layout.map;
  const pad = spec.region === "world" || spec.region == null ? 0 : Math.round(Math.min(mx1 - mx0, my1 - my0) * 0.03);
  const extent = [[mx0 + pad, my0 + pad], [mx1 - pad, my1 - pad]];
  const framed = frame({ ...spec, region, _latRange: kind.latRange }, extent, kind.dataObject);
  // A cropped world map is clipped to the crop, not to the whole map area.
  let [cy0, cy1] = [my0, my1];
  if (framed.cropped) {
    const b = G.geoPath(framed.projection).bounds(framed.fit);
    cy0 = Math.max(my0, b[0][1]);
    cy1 = Math.min(my1, b[1][1]);
  }
  const rect = [[mx0, cy0], [mx1, cy1]];
  const raster = rasterCfg && !check
    ? await rasterBasemap({ spec, projection: framed.projection, rect, ...(fetchTile ? { fetchTile } : {}) })
    : null;
  if (rasterCfg && check) {
    report.warnings.push(...rasterCfg.warnings.map((warning) => `basemap: ${warning}`));
    report.notes.push("basemap: configuration validated; check skips tile downloads and cache writes");
  }
  if (raster?.warnings?.length) {
    for (const w of raster.warnings) report.warnings.push(`basemap: ${w}`);
  }
  if (raster?.failures?.length) {
    report.warnings.push(
      `basemap: ${raster.failures.length}/${raster.requested} tile(s) failed (${raster.failures[0]}) — gaps are visible`
    );
  }
  if (raster?.tiles) {
    const zoomNote = raster.stretch && raster.stretch > 1.5 ? `, tiles upscaled ${raster.stretch.toFixed(1)}x — raise maxTiles for a sharper basemap` : "";
    report.notes.push(`basemap: ${raster.tiles} tile(s) at zoom ${raster.zoom}${zoomNote} (${raster.attribution})`);
  } else if (rasterCfg && !check) {
    report.warnings.push(`basemap: no tiles (${raster?.error ?? "unknown"}) — using the vector geography instead`);
  }
  const base0 = basemap({ framed, theme, rect, spec, focus: kind.focus ?? [], thematic: kind.thematic, admin1Of: kind.admin1Of, raster: raster?.group ?? "" });
  const unit = layout.unit;
  const placer = new Placer([mx0 + 2, cy0 + 2, mx1 - 2, cy1 - 2]);
  const env = { ...framed, path: base0.path, theme, unit, placer, rect, resolution: base0.resolution, report, layout };
  const drawn = kind.draw(env);
  const notes = annotations(spec.annotations, env, ctx);
  report.dropped.push(...placer.dropped);

  const clipId = "map-clip";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(spec.title ?? `${spec.kind} map`)}">`,
    `<title>${esc(spec.title ?? `${spec.kind} map`)}</title>`,
    spec.subtitle ? `<desc>${esc(spec.subtitle)}</desc>` : "",
    embedFonts ? "<style data-fonts></style>" : "",
    `<defs><clipPath id="${clipId}"><rect x="${n(mx0)}" y="${n(cy0)}" width="${n(mx1 - mx0)}" height="${n(cy1 - cy0)}"/></clipPath>${drawn.defs ?? ""}</defs>`,
    `<rect width="${width}" height="${height}" fill="${theme.bg}"/>`,
    `<g class="map" clip-path="url(#${clipId})">`,
    `<g class="base">${base0.under.join("")}</g>`,
    `<g class="data">${(drawn.fills ?? []).join("")}</g>`,
    `<g class="borders">${base0.over.join("")}</g>`,
    `<g class="symbols">${(drawn.symbols ?? []).join("")}</g>`,
    `<g class="labels">${(drawn.labels ?? []).join("")}</g>`,
    `<g class="annotations">${notes.join("")}</g>`,
    `</g>`,
    drawn.overlay ?? "",
    `<g class="furniture">${layout.furniture}${legend && layout.legendAt ? legend.svg(layout.legendAt) : ""}</g>`,
    `</svg>`,
  ].join("\n");
  return { svg: embedFonts ? withFonts(svg) : svg, report, width, height, theme, spec };
}

/** Page shape that suits the region: portrait for tall areas, square for compact ones. */
function autoSize(spec, dataObject) {
  if (spec.region === "world" || spec.projection === "globe" || spec.projection?.name === "globe") return spec.projection ? "square" : "landscape";
  try {
    const probe = frame(spec, [[0, 0], [1000, 1000]], dataObject);
    if (probe.usa) return "landscape";
    const [[x0, y0], [x1, y1]] = G.geoPath(probe.projection).bounds(probe.fit ?? { type: "Sphere" });
    const aspect = (x1 - x0) / Math.max(1, y1 - y0);
    if (aspect < 0.5) return "story";
    if (aspect < 0.8) return "portrait";
    if (aspect < 1.45) return "square";
  } catch {
    // Fall through to the default; the real frame() call reports problems.
  }
  return "landscape";
}
