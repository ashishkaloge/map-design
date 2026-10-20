// City posters from OpenStreetMap: streets, water, parks and coastline, with a
// typographic footer. Rendered in screen space with a local Mercator projection.
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { posterTheme } from "../themes.mjs";
import { resolveSize } from "../layout.mjs";
import { fetchOsm, classify, coastToLand, clipPolyline } from "../osm.mjs";
import { resolveLocation, countryAt } from "../locate.mjs";
import { findCountry } from "../data.mjs";
import { embedFonts } from "../fonts.mjs";
import { SpecError } from "../errors.mjs";
import { esc, n, formatCoords, textWidth } from "../svg.mjs";

const ORDER = ["path", "service", "residential", "tertiary", "secondary", "primary", "trunk", "motorway"];
const CASED = new Set(["secondary", "primary", "trunk", "motorway"]);
const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));

export async function renderPoster(spec, { base = process.cwd(), embedFonts: embed = true, check = false, log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const theme = posterTheme(spec.theme ?? "noir");
  const [W, H] = resolveSize(spec.size, "poster");
  const report = { warnings: [], notes: [], resolved: [], unmatched: [], dropped: [] };

  // Where.
  let center;
  let placeName = spec.title;
  let countryName = spec.subtitle;
  let countryCode = null;
  if (spec.center != null) {
    if (!Array.isArray(spec.center) || spec.center.length !== 2) throw new SpecError("center must be [longitude, latitude].");
    const loc = resolveLocation(spec.center);
    center = [loc.lon, loc.lat];
    report.resolved.push({ ref: JSON.stringify(spec.center), as: "coordinates", lon: center[0], lat: center[1] });
  } else if (spec.place) {
    const loc = resolveLocation({ place: spec.place, country: spec.country });
    if (loc.warning) report.warnings.push(loc.warning);
    report.resolved.push({ ref: spec.place, as: loc.how, lon: loc.lon, lat: loc.lat });
    center = [loc.lon, loc.lat];
    countryCode = loc.country ?? null;
    placeName ??= loc.label;
    countryName ??= loc.country ? findCountry(loc.country)?.name : undefined;
  } else throw new SpecError('A poster needs "place" (a city from the gazetteer) or "center": [lon, lat].');
  if (spec.offset != null) {
    if (!Array.isArray(spec.offset) || spec.offset.length !== 2 || !spec.offset.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new SpecError("offset must be two numbers: [dLon, dLat].");
    }
    center = [center[0] + spec.offset[0], center[1] + spec.offset[1]];
  }
  resolveLocation(center);
  if (Math.abs(center[1]) >= 90) throw new SpecError("Poster latitude must be between -90 and 90, excluding the poles.");
  placeName ??= "";

  // Frame: radiusKm is half the poster's width on the ground.
  const radiusKm = Number(spec.radiusKm ?? 4);
  if (!(radiusKm > 0.3 && radiusKm <= 30)) throw new SpecError("radiusKm must be between 0.3 and 30.");
  const kmPerDegLat = 111.32;
  const halfLon = radiusKm / (kmPerDegLat * Math.cos(center[1] * RAD));
  const k = W / (2 * halfLon * RAD); // pixels per radian of longitude
  const cy = mercY(center[1]);
  // y-up planar frame; screen y is H - Y.
  const project = ([lon, lat]) => [W / 2 + (lon - center[0]) * RAD * k, H / 2 + (mercY(lat) - cy) * k];
  const unproject = ([x, y]) => [center[0] + (x - W / 2) / k / RAD, (2 * Math.atan(Math.exp((y - H / 2) / k + cy)) - Math.PI / 2) / RAD];
  const [west, south] = unproject([-W * 0.03, -H * 0.03]);
  const [east, north] = unproject([W * 1.03, H * 1.03]);

  if (check) {
    report.notes.push(`Frame: ${south.toFixed(4)}, ${west.toFixed(4)} to ${north.toFixed(4)}, ${east.toFixed(4)} (south, west, north, east).`);
    return { svg: "", report, width: W, height: H, theme, spec };
  }
  // A local Overpass JSON export can stand in for the download.
  const osm = spec.osm
    ? JSON.parse(readFileSync(resolvePath(base, spec.osm), "utf8"))
    : await fetchOsm([south, west, north, east], { detail: spec.detail ?? (radiusKm > 9 ? "low" : "medium"), endpoint: spec.overpass, log });
  let layers = classify(osm);
  let roadCount = Object.values(layers.roads).reduce((s, r) => s + r.length, 0);
  const detail = spec.detail ?? (radiusKm > 9 ? "low" : "medium");
  let carFree = false;
  if (!spec.osm && !spec.detail && detail === "medium" && roadCount < 400) {
    carFree = true;
    // Car-free centers (Venice, old towns) are mostly footpaths; fetch those too.
    report.notes.push("Few streets for cars here; added footpaths and pedestrian streets (detail: high).");
    layers = classify(await fetchOsm([south, west, north, east], { detail: "high", endpoint: spec.overpass, log }));
    roadCount = Object.values(layers.roads).reduce((s, r) => s + r.length, 0);
  }
  if (!roadCount) report.warnings.push("No streets found here. Check the place or coordinates.");
  report.notes.push(`OpenStreetMap features: ${roadCount} streets, ${layers.water.length} water areas, ${layers.parks.length} green areas, ${layers.coast.length} coastline ways.`);

  const rect = [0, 0, W, H];
  const toScreen = ([x, y]) => `${n(x)},${n(H - y)}`;
  const ringPath = (ring) => `M${ring.map(toScreen).join("L")}Z`;
  const polyPath = (rings) => rings.map((r) => ringPath(r.map(project))).join("");
  const linePaths = (lines) => {
    const out = [];
    for (const l of lines) {
      for (const piece of clipPolyline(l.map(project), [-20, -20, W + 20, H + 20])) {
        out.push(`M${piece.coords.map(toScreen).join("L")}`);
      }
    }
    return out.join("");
  };

  const parts = [];
  // Land and sea.
  const coast = coastToLand(layers.coast, project, rect);
  if (coast && coast.sea) {
    parts.push(`<rect width="${W}" height="${H}" fill="${theme.water}"/>`);
    if (coast.land.length) parts.push(`<path d="${coast.land.map(ringPath).join("")}" fill="${theme.bg}" fill-rule="nonzero"/>`);
  } else {
    if (!coast) report.warnings.push("The coastline could not be closed cleanly; the sea is not shaded.");
    parts.push(`<rect width="${W}" height="${H}" fill="${theme.bg}"/>`);
  }
  const showParks = spec.layers?.parks !== false;
  const showWater = spec.layers?.water !== false;
  if (showParks && layers.parks.length) parts.push(`<path d="${layers.parks.map(polyPath).join("")}" fill="${theme.park}" fill-rule="evenodd"/>`);
  if (showWater && layers.water.length) parts.push(`<path d="${layers.water.map(polyPath).join("")}" fill="${theme.water}" fill-rule="evenodd"/>`);
  if (showWater && layers.rivers.length) parts.push(`<path d="${linePaths(layers.rivers.map((r) => r.line))}" fill="none" stroke="${theme.water}" stroke-width="${n(3 * W / 1200, 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  if (spec.layers?.rail !== false && layers.rail.length) {
    parts.push(`<path d="${linePaths(layers.rail)}" fill="none" stroke="${theme.rail}" stroke-width="${n(0.8 * W / 1200, 2)}" stroke-dasharray="${n(5 * W / 1200)} ${n(2.5 * W / 1200)}"/>`);
  }
  // Streets, minor first. Widths scale with the poster and shrink for wide areas.
  const scale = (W / 1200) * Math.max(0.55, Math.min(1.35, 4 / radiusKm) ** 0.45);
  for (const cls of ORDER) {
    const lines = layers.roads[cls];
    if (!lines?.length) continue;
    // Where footpaths are the streets, draw them like streets.
    const style = carFree && cls === "path" ? theme.roads.residential : theme.roads[cls];
    const faint = !carFree && (cls === "service" || cls === "path");
    const d = linePaths(lines);
    if (!d) continue;
    // A thin background-coloured casing lifts each artery off the streets it crosses.
    if (CASED.has(cls)) parts.push(`<path class="casing ${cls}" d="${d}" fill="none" stroke="${theme.casing ?? theme.bg}" stroke-width="${n((style.width + 1.1) * scale, 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    parts.push(`<path class="road ${cls}" d="${d}" fill="none" stroke="${style.color}" stroke-width="${n(style.width * scale, 2)}" stroke-linecap="round" stroke-linejoin="round"${faint ? ' stroke-opacity="0.7"' : ""}/>`);
  }

  // Typography.
  const locale = titleLocale(spec.lang, countryCode ?? countryAt(center[0], center[1]));
  const title = upper(spec.title ?? placeName, locale);
  const subtitle = spec.subtitle === false ? "" : upper(String(countryName ?? ""), locale);
  const u = W / 1200;
  const fadeTop = H * (spec.textBand ?? 0.73);
  const titleSize = Math.min(104 * u, (W * 0.8) / Math.max(4, title.length * 0.92));
  const ls = titleSize * 0.32;
  const baseY = H - 150 * u;
  const furniture = [
    `<defs><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${theme.bg}" stop-opacity="0"/><stop offset="0.45" stop-color="${theme.bg}" stop-opacity="0.9"/><stop offset="1" stop-color="${theme.bg}" stop-opacity="1"/></linearGradient></defs>`,
    `<rect x="0" y="${n(fadeTop)}" width="${W}" height="${n(H - fadeTop)}" fill="url(#fade)"/>`,
  ];
  furniture.push(...drawPins(spec.markers ?? spec.pins, { project, W, H, u, theme, report, fadeTop, center }));
  if (theme.accent) furniture.push(`<circle cx="${W / 2}" cy="${n(baseY - titleSize * 1.25)}" r="${n(13 * u)}" fill="${theme.accent}"/>`);
  furniture.push(
    `<text x="${n(W / 2 + ls / 2)}" y="${n(baseY)}" text-anchor="middle" font-family="${esc(theme.font)}" font-size="${n(titleSize)}" font-weight="600" letter-spacing="${n(ls)}" fill="${theme.text}">${esc(title)}</text>`,
    `<line x1="${n(W / 2 - 46 * u)}" x2="${n(W / 2 + 46 * u)}" y1="${n(baseY + 34 * u)}" y2="${n(baseY + 34 * u)}" stroke="${theme.text}" stroke-width="${n(1.4 * u, 2)}"/>`,
  );
  if (subtitle) {
    furniture.push(`<text x="${n(W / 2 + 6 * u)}" y="${n(baseY + 76 * u)}" text-anchor="middle" font-family="${esc(theme.sub)}" font-size="${n(26 * u)}" font-weight="300" letter-spacing="${n(10 * u)}" fill="${theme.text}">${esc(subtitle)}</text>`);
  }
  if (spec.coords !== false) {
    furniture.push(`<text x="${W / 2}" y="${n(baseY + 112 * u)}" text-anchor="middle" font-family="${esc(theme.mono)}" font-size="${n(15 * u)}" font-weight="400" letter-spacing="${n(1.5 * u)}" fill="${theme.muted}">${esc(formatCoords(center[0], center[1]))}</text>`);
  }
  furniture.push(`<text x="${n(W - 24 * u)}" y="${n(H - 20 * u)}" text-anchor="end" font-family="${esc(theme.mono)}" font-size="${n(10 * u)}" fill="${theme.muted}" fill-opacity="0.8">© OpenStreetMap contributors · https://www.openstreetmap.org/copyright</text>`);

  let svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Street map of ${placeName}`)}">`,
    `<title>${esc(`${placeName}${countryName ? `, ${countryName}` : ""}`)}</title>`,
    embed ? "<style data-fonts></style>" : "",
    `<defs><clipPath id="poster-clip"><rect width="${W}" height="${H}"/></clipPath></defs>`,
    `<g clip-path="url(#poster-clip)">${parts.join("")}</g>`,
    furniture.join(""),
    `</svg>`,
  ].join("\n");
  if (embed) svg = embedFonts(svg);
  report.notes.push("Map data © OpenStreetMap contributors (ODbL). Keep the credit on the poster.");
  return { svg, report, width: W, height: H, theme: { ...theme, dark: isDark(theme.bg) }, spec };
}

/**
 * Map pins: a teardrop marker with a label card. Positions accept any location
 * reference (coordinates, a gazetteer place); `color` overrides the theme's pin color.
 */
function drawPins(markers, { project, W, H, u, theme, report, fadeTop, center }) {
  if (!markers) return [];
  const list = Array.isArray(markers) ? markers : [markers];
  const out = [];
  for (const m of list) {
    const placed = ["lon", "lng", "longitude", "lat", "latitude", "place", "city", "iata", "country", "state"].some((k) => m[k] != null);
    const ref = m.at ?? m.location ?? (placed ? m : null);
    let loc;
    try {
      // A pin without a position marks the poster's center.
      loc = ref == null || ref === "center" ? { lon: center[0], lat: center[1], how: "poster center" } : resolveLocation(ref);
    } catch (e) {
      report.warnings.push(`Pin "${m.label ?? ""}": ${e.message}`);
      continue;
    }
    report.resolved.push({ ref: `pin ${m.label ?? ""}`.trim(), as: loc.how, lon: loc.lon, lat: loc.lat });
    const [px, py] = project([loc.lon, loc.lat]);
    const x = px;
    const y = H - py;
    if (x < 0 || x > W || y < 0 || y > H) {
      report.warnings.push(`Pin "${m.label ?? loc.label ?? ""}" is outside the poster frame; move the center or enlarge radiusKm.`);
      continue;
    }
    if (y > fadeTop) report.warnings.push(`Pin "${m.label ?? ""}" sits in the title band; use "offset" to move the map center south so the pin rises.`);
    const color = m.color ?? theme.pin ?? theme.text;
    const R = 21 * u * (m.size ?? 1);
    const Hp = 3.2 * R;
    const cyHead = y - Hp + R;
    const pin = `M${n(x)},${n(y)}C${n(x - R * 0.32)},${n(y - Hp * 0.36)} ${n(x - R)},${n(y - Hp * 0.5)} ${n(x - R)},${n(cyHead)}A${n(R)},${n(R)} 0 1 1 ${n(x + R)},${n(cyHead)}C${n(x + R)},${n(y - Hp * 0.5)} ${n(x + R * 0.32)},${n(y - Hp * 0.36)} ${n(x)},${n(y)}Z`;
    out.push(`<g class="pin">`);
    out.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(R * 0.75)}" ry="${n(R * 0.24)}" fill="#000000" fill-opacity="0.28"/>`);
    out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(R * 1.5)}" fill="none" stroke="${color}" stroke-opacity="0.55" stroke-width="${n(2 * u, 2)}"/>`);
    out.push(`<path d="${pin}" fill="${color}" stroke="${theme.bg}" stroke-width="${n(2.2 * u, 2)}" stroke-linejoin="round"/>`);
    out.push(`<circle cx="${n(x)}" cy="${n(cyHead)}" r="${n(R * 0.4)}" fill="${theme.bg}"/>`);
    const label = m.label ?? null;
    if (label) {
      const size = 24 * u * (m.size ?? 1);
      const family = theme.font;
      const w = textWidth(label, size, family, { weight: 600, letterSpacing: 1.2 * u }) + 30 * u;
      const h = size * 1.75;
      const right = x + R + 14 * u + w < W - 20 * u;
      const bx = right ? x + R + 12 * u : x - R - 12 * u - w;
      const by = cyHead - h / 2;
      out.push(`<rect x="${n(bx)}" y="${n(by)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="${theme.bg}" fill-opacity="0.94" stroke="${color}" stroke-width="${n(2 * u, 2)}"/>`);
      out.push(`<text x="${n(bx + w / 2)}" y="${n(cyHead + size * 0.36)}" text-anchor="middle" font-family="${esc(family)}" font-size="${n(size)}" font-weight="600" letter-spacing="${n(1.2 * u)}" fill="${theme.text}">${esc(label)}</text>`);
    }
    out.push(`</g>`);
  }
  return out;
}

// Languages whose capitals differ from the default Unicode mapping: Turkish and
// Azerbaijani keep the dot (i -> İ), Greek drops accents in all-caps text.
const CAPS_LOCALE = { TUR: "tr", AZE: "az", GRC: "el", CYP: "el" };

function titleLocale(lang, iso3) {
  if (lang != null) {
    try {
      return Intl.getCanonicalLocales(String(lang))[0];
    } catch {
      throw new SpecError(`lang must be a language tag such as "tr" or "el", got ${JSON.stringify(lang)}.`);
    }
  }
  return CAPS_LOCALE[iso3] ?? undefined;
}

function upper(text, locale) {
  return locale ? String(text).toLocaleUpperCase(locale) : String(text).toUpperCase();
}

function isDark(hex) {
  const v = parseInt(hex.slice(1), 16);
  return ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11 < 90;
}
