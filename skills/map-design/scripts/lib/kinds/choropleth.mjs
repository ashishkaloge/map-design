// Areas shaded by a value: countries, first-level regions, US states or US counties.
import { findCountry, findAdmin1, findUsState, admin1Features, usCountyFeatures, usStateFeatures, features, closest, normalize, hasAdmin1, meshOf } from "../data.mjs";
import { colorScale } from "../scales.mjs";
import { classedLegend, continuousLegend, categoricalLegend } from "../layout.mjs";
import { pickColumn } from "../spec.mjs";
import { SpecError } from "../errors.mjs";
import { esc, n, formatNumber } from "../svg.mjs";
import { areaLabels, contrastText, tooltip, numeric } from "./common.mjs";
import { G } from "../geo.mjs";
import { GEOMETRY, readGeoFile, isPolygonal, polygonParts, thinnedPath } from "../geofile.mjs";

const KEY_COLUMNS = {
  countries: ["iso3", "iso_a3", "ISO3", "iso", "code", "country_code", "Country Code", "id", "country", "Country", "name", "Country Name", "Entity"],
  admin1: ["id", "iso_3166_2", "code", "region", "state", "province", "name", "Name"],
  "us-states": ["state", "State", "postal", "fips", "code", "name", "Name"],
  "us-counties": ["fips", "FIPS", "geoid", "GEOID", "county_fips", "id"],
};

// Codes before names, so a table with both joins on the code.
const RANK = ["iso3", "iso_a3", "ISO3", "iso", "code", "country_code", "Country Code", "fips", "FIPS", "geoid", "GEOID", "county_fips", "iso_3166_2", "id", "postal", "state", "State", "province", "region", "country", "Country", "name", "Name", "Country Name", "Entity"];
const keyRank = (a, b) => (RANK.indexOf(a) + 1 || 99) - (RANK.indexOf(b) + 1 || 99);

const isUsa = (r) => typeof r === "string" && ["usa", "us", "united states", "united states of america"].includes(r.toLowerCase());

function detectGeography(spec, rows, key) {
  if (spec.geography) return spec.geography;
  const region = spec.region ?? "world";
  const sample = rows.slice(0, 60).map((r) => String(r[key] ?? ""));
  if (isUsa(region)) return sample.filter((v) => /^\d{4,5}$/.test(v)).length > sample.length / 2 ? "us-counties" : "us-states";
  if (typeof region === "string" && region !== "world" && findCountry(region)) {
    const asCountries = sample.filter((v) => findCountry(v)).length;
    return asCountries > sample.length / 2 ? "countries" : "admin1";
  }
  return "countries";
}

export function prepare(ctx) {
  const { spec, rows } = ctx;
  if (spec.boundaries || rows.some((r) => isPolygonal(r[GEOMETRY]))) return prepareCustom(ctx);
  if (!rows.length) throw new SpecError('A choropleth needs "data": rows with a key column and a value column.');
  const candidates = spec.geography ? KEY_COLUMNS[spec.geography] ?? [] : [...new Set(Object.values(KEY_COLUMNS).flat())].sort(keyRank);
  const key = spec.join ?? spec.key ?? pickColumn(rows, candidates, "key");
  const geography = detectGeography(spec, rows, key);
  const valueField = spec.value ?? pickColumn(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== key && typeof v === "number"))), Object.keys(rows[0]).filter((k) => k !== key && typeof rows[0][k] === "number"), "numeric value");
  if (!spec.value) ctx.report.warnings.push(`No "value" given; using the "${valueField}" column.`);
  if (geography === "admin1") {
    const c = findCountry(spec.region);
    if (!c || !hasAdmin1(c.iso3)) throw new SpecError(`admin1 choropleths need "region" set to a single country with bundled subdivisions.`);
    ctx.admin1Country = c.iso3;
  }

  // Join rows to features.
  const pool = poolFor(geography, ctx);
  const joined = new Map();
  const unmatched = [];
  for (const [i, row] of rows.entries()) {
    const k = row[key];
    const f = match(geography, k, pool, ctx);
    if (!f) {
      unmatched.push({ row: i + 1, key: k, suggestions: suggest(geography, k, pool) });
      continue;
    }
    const id = f.id ?? f.properties.id ?? f.properties.iso3;
    if (joined.has(id)) {
      ctx.report.warnings.push(`Two rows match ${f.properties.name ?? id}; kept the first (row ${joined.get(id).index}).`);
      continue;
    }
    joined.set(id, { feature: f, row, index: i + 1 });
  }
  for (const u of unmatched) {
    ctx.report.unmatched.push({
      row: u.row,
      reason: `"${u.key}" matched no ${geography} feature${u.suggestions.length ? ` (close: ${u.suggestions.join(", ")})` : ""}`,
    });
  }
  if (!joined.size) throw new SpecError(`No rows matched any ${geography} feature using the "${key}" column. First key: "${rows[0][key]}".`);

  const entries = [...joined.values()];
  const { scale, legend, format } = encode(ctx, entries, valueField, geography === "countries" ? true : pool.features.length > joined.size);

  return {
    legend,
    focus: geography === "admin1" ? [ctx.admin1Country] : [],
    admin1Of: geography === "admin1" ? ctx.admin1Country : null,
    thematic: true,
    draw(env) {
      const { path, theme: t, unit } = env;
      const fills = [];
      const dots = [];
      const stroke = geography === "us-counties" ? t.border : null;
      for (const e of entries) {
        const color = scale.color(e.value);
        if (!color) continue;
        let f = e.feature;
        if (geography === "countries" && env.resolution === "110m") {
          const small = features("world-110m", "countries").features.find((x) => x.properties.iso3 === f.properties.iso3);
          if (!small) {
            // Too small to draw at world scale: show a dot so the data is not lost.
            const c = findCountry(f.properties.iso3);
            const p = env.projection(c.label);
            if (p) dots.push(`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(3.2 * unit)}" fill="${color}" stroke="${t.bg}" stroke-width="${n(0.8 * unit, 2)}">${tooltip(f.properties.name, label(e))}</circle>`);
            continue;
          }
          f = small;
        }
        const d = path(f);
        if (!d) {
          if (env.usa) {
            ctx.report.warnings.push(`${f.properties.name ?? e.row[key]} has data but is outside Albers USA, which shows the 50 states and DC.`);
          } else if (f.properties.label) {
            // Too small to survive simplification: keep the data visible as a dot.
            const p = env.projection(f.properties.label);
            const [[x0, y0], [x1, y1]] = env.rect;
            if (p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) {
              dots.push(`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(3.2 * unit)}" fill="${color}" stroke="${t.bg}" stroke-width="${n(0.8 * unit, 2)}">${tooltip(f.properties.name, label(e))}</circle>`);
            }
          }
          continue;
        }
        const name = f.properties.name ?? e.row[key];
        fills.push(`<path d="${d}" fill="${color}"${stroke ? ` stroke="${stroke}" stroke-width="${n(0.25 * unit, 2)}"` : ""} data-name="${esc(name)}" data-value="${esc(label(e))}">${tooltip(name, label(e))}</path>`);
      }
      if (geography === "us-counties") {
        // State lines over the county mosaic.
        fills.push(`<path d="${path(meshOf("us-counties", "states", (a, b) => a !== b))}" fill="none" stroke="${t.border}" stroke-width="${n(1.1 * unit, 2)}"/>`);
      }

      const labels = [];
      const mode = spec.labels ?? (geography === "admin1" || geography === "us-states" ? "names" : false);
      if (mode) {
        const size = (spec.labelSize ?? (geography === "us-states" ? 12 : 12.5)) * unit;
        const items = [];
        for (const e of entries) {
          if (Array.isArray(mode) && !mode.includes(e.row[key])) continue;
          const f = e.feature;
          const p = f.properties;
          const text = geography === "us-states" ? (mode === "names" ? p.name : p.postal) : geography === "countries" ? p.name : p.en ?? p.name;
          const sub = mode === "values" || spec.labelValues ? formatNumber(e.value, format) : null;
          const at = p.label ? env.projection(p.label) : null;
          items.push({ feature: drawnFeature(f, env), text: mode === "values" && !spec.labelNames ? formatNumber(e.value, format) : text, sub: mode === "values" ? null : sub, at, fill: scale.color(e.value), weight: 600, area: G.geoArea(f) });
        }
        items.sort((a, b) => b.area - a.area);
        const statesByName = geography === "us-states" && mode === "names";
        let placed = areaLabels(items, env, { size, fillFor: (it) => contrastText(it.fill, t), report: !statesByName });
        if (statesByName) {
          // Fall back to postal codes where names do not fit.
          const rest = items.filter((it) => !it.placed).map((it) => ({ ...it, text: it.feature.properties.postal ?? it.text }));
          placed = placed.concat(areaLabels(rest, env, { size: size * 0.92, fillFor: (it) => contrastText(it.fill, t) }));
        }
        labels.push(...placed);
      }
      return { fills, symbols: dots, labels };

      function label(e) {
        return scale.type === "categorical" ? String(e.value) : formatNumber(e.value, format);
      }
    },
  };
}

/** Values, color scale, legend and the raw-count check, shared by every choropleth. */
function encode(ctx, entries, valueField, hasNoData) {
  const { spec, theme } = ctx;
  const categorical = spec.scale?.type === "categorical";
  const values = categorical ? entries.map((e) => e.row[valueField]) : numeric(entries, valueField, ctx, "choropleth");
  entries.forEach((e, i) => (e.value = values[i]));
  const scale = colorScale(values, spec.scale ?? {}, theme);
  const format = spec.format ?? {};
  const legendTitle = spec.legend?.title ?? spec.legendTitle ?? null;
  let legend = null;
  if (spec.legend !== false) {
    if (scale.type === "categorical") legend = categoricalLegend({ items: scale.categories.map((c) => ({ label: c, color: scale.color(c) })), theme, title: legendTitle });
    else if (scale.type === "continuous") legend = continuousLegend({ scale, theme, title: legendTitle, format });
    else legend = classedLegend({ scale, theme, title: legendTitle, format, noData: hasNoData && spec.legend?.noData !== false });
  }

  if (!spec.value || /count|total|number|population$|^pop$/i.test(valueField)) {
    if (scale.type !== "categorical" && !/per|rate|share|pct|percent|density|capita|ratio|index|avg|average|median|%/i.test(valueField + (legendTitle ?? ""))) {
      ctx.report.notes.push(`"${valueField}" looks like a raw count. Choropleths of counts mostly show which areas are big; consider a rate (per person or per km²) or a bubble map.`);
    }
  }
  return { scale, legend, format };
}

// Areas from the user's own file: districts, wards, ZIP codes, constituencies,
// sales territories. Either "boundaries" names the file and "data" holds the
// values, or "data" is itself a polygon file with the values in its properties.

const NAME_KEYS = ["name", "Name", "NAME", "label", "title", "en", "name_en", "NAME_EN"];

function areaGeometry(geometry) {
  const parts = polygonParts(geometry);
  return parts.length === 1 ? parts[0] : { type: "GeometryCollection", geometries: parts };
}

function prepareCustom(ctx) {
  const { spec, base, report } = ctx;
  const cfg = typeof spec.boundaries === "string" ? { file: spec.boundaries } : spec.boundaries ?? null;
  if (cfg && typeof cfg.file !== "string") throw new SpecError('"boundaries" is a file path, or { "file": "areas.geojson", "id": "code", "name": "label" }.');
  let polys;
  let entries;
  let source;
  let keyField = null;
  if (cfg) {
    const { collection, format: kind, notes } = readGeoFile(cfg.file, base, { field: "boundaries", object: cfg.object });
    report.notes.push(...notes);
    polys = collection.features.filter((f) => isPolygonal(f.geometry))
      .map((f) => ({ ...f, geometry: areaGeometry(f.geometry) }));
    if (!polys.length) throw new SpecError(`${cfg.file} has no areas (polygons) to shade.`);
    if (polys.length < collection.features.length) report.notes.push(`${cfg.file}: ${collection.features.length - polys.length} feature(s) that are not areas were ignored.`);
    source = `${cfg.file} (${kind}, ${polys.length} areas)`;
    if (ctx.rows.length) {
      const j = joinRows(ctx, polys, cfg);
      entries = j.entries;
      keyField = j.column;
      source += `, joined on column "${j.column}" = property "${j.property}"`;
    } else {
      entries = polys.map((f, i) => ({ feature: f, row: f.properties, index: i + 1 }));
    }
  } else {
    // The data file is the boundaries.
    polys = [];
    entries = [];
    for (const [i, row] of ctx.rows.entries()) {
      if (!isPolygonal(row[GEOMETRY])) {
        report.unmatched.push({ row: i + 1, reason: "no area geometry" });
        continue;
      }
      const f = { type: "Feature", properties: row, geometry: areaGeometry(row[GEOMETRY]) };
      polys.push(f);
      entries.push({ feature: f, row, index: i + 1 });
    }
    source = `${typeof spec.data === "string" ? spec.data : "data"} (${polys.length} areas)`;
  }
  const props = entries[0].row;
  const valueField = spec.value ?? pickValue(entries.map((e) => e.row), keyField, cfg?.id);
  if (!spec.value) report.warnings.push(`No "value" given; using the "${valueField}" column.`);
  const nameKey = cfg?.name ?? NAME_KEYS.find((k) => entries.some((e) => typeof e.row[k] === "string" || typeof e.feature.properties[k] === "string"))
    ?? Object.keys(props).find((k) => /(^|_)(name|nm)$|name$/i.test(k) && typeof props[k] === "string");
  const nameOf = (e) => String(e.row[nameKey] ?? e.feature.properties[nameKey] ?? (keyField ? e.row[keyField] : null) ?? `Area ${e.index}`);
  report.notes.push(`boundaries: ${source}.`);

  const matched = new Set(entries.flatMap((e) => e.parts ?? [e.feature]));
  const noData = polys.filter((f) => !matched.has(f));
  const missing = entries.some((e) => e.row[valueField] == null || e.row[valueField] === "");
  const { scale, legend, format } = encode(ctx, entries, valueField, noData.length > 0 || missing);
  const colorOf = (e) => (e.value == null || (typeof e.value === "number" && !Number.isFinite(e.value)) ? null : scale.color(e.value));
  if (noData.length) report.notes.push(`${noData.length} of ${polys.length} areas have no data and are drawn in the no-data color.`);

  // Missing values are part of the map too: keep every supplied area in view.
  const frameObject = { type: "FeatureCollection", features: polys };
  const [[w, s], [e0, nn]] = G.geoBounds(frameObject);
  const lonSpan = e0 >= w ? e0 - w : e0 + 360 - w;
  const midLat = ((s + nn) / 2) * (Math.PI / 180);
  // Detailed local areas (a city's wards) sit badly on 1:50m coastlines and
  // borders, so those are left out and the areas stand on the page alone.
  const local = Math.max(lonSpan * Math.cos(midLat), nn - s) < 2.5;
  if (local && !spec.basemap) report.notes.push('These areas are local, so country outlines are left out; add "basemap": "streets" to draw streets and water under them.');

  return {
    legend,
    dataObject: frameObject,
    defaultRegion: lonSpan > 150 && nn - s > 60 ? "world" : "auto",
    latRange: [s, nn],
    // The user's areas are the subject; every country around them is quiet context.
    quiet: true,
    tight: true,
    thematic: true,
    context: !local,
    draw(env) {
      const { projection, theme: t, unit } = env;
      const path = thinnedPath(projection, 0.25);
      const count = polys.length;
      const sw = n((count > 600 ? 0.18 : count > 80 ? 0.3 : 0.55) * unit, 2);
      const fills = [];
      const dots = [];
      for (const f of noData) {
        const d = path(f);
        const name = String(f.properties[nameKey] ?? "");
        if (d) fills.push(`<path d="${d}" fill="${t.noData}" stroke="${t.border}" stroke-width="${sw}"${name ? ` data-name="${esc(name)}" data-value="No data"` : ""}>${name ? tooltip(name, "No data") : ""}</path>`);
      }
      for (const e of entries) {
        const color = colorOf(e) ?? t.noData;
        const value = colorOf(e) ? label(e) : "No data";
        const name = nameOf(e);
        const d = path(e.feature);
        if (!d) {
          // Smaller than the thinning tolerance: keep the value visible as a dot.
          const p = projection(G.geoCentroid(e.feature));
          const [[x0, y0], [x1, y1]] = env.rect;
          if (p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) {
            dots.push(`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${n(3.2 * unit)}" fill="${color}" stroke="${t.bg}" stroke-width="${n(0.8 * unit, 2)}" data-name="${esc(name)}" data-value="${esc(value)}">${tooltip(name, value)}</circle>`);
          }
          continue;
        }
        fills.push(`<path d="${d}" fill="${color}" stroke="${t.border}" stroke-width="${sw}" data-name="${esc(name)}" data-value="${esc(value)}">${tooltip(name, value)}</path>`);
      }

      const labels = [];
      const mode = spec.labels ?? (entries.length <= 60 ? "names" : false);
      if (mode) {
        const size = (spec.labelSize ?? 12) * unit;
        const items = [];
        for (const e of entries) {
          if (Array.isArray(mode) && !mode.includes(nameOf(e)) && !(keyField && mode.includes(e.row[keyField]))) continue;
          const text = mode === "values" && !spec.labelNames ? (colorOf(e) ? label(e) : null) : nameOf(e);
          if (!text) continue;
          const sub = mode !== "values" && spec.labelValues && colorOf(e) ? label(e) : null;
          items.push({ feature: e.feature, text, sub, fill: colorOf(e) ?? t.noData, weight: 600, area: G.geoArea(e.feature) });
        }
        items.sort((a, b) => b.area - a.area);
        labels.push(...areaLabels(items, { ...env, path }, { size, fillFor: (it) => contrastText(it.fill, t) }));
      }
      return { fills, symbols: dots, labels };

      function label(e) {
        return scale.type === "categorical" ? String(e.value) : formatNumber(e.value, format);
      }
    },
  };
}

/** The numeric column to shade by, when the spec does not say. Never an id or a geometry size. */
function pickValue(rows, ...exclude) {
  const skip = /^(id|fid|gid|objectid|object_id|ogc_fid|shape_?area|shape_?leng(th)?|shape_?length|area|perimeter|len(gth)?|x|y|lon|lat|lng|longitude|latitude)$/i;
  const keys = Object.keys(rows[0] ?? {}).filter((k) => !exclude.includes(k) && !skip.test(k) && rows.some((r) => typeof r[k] === "number"));
  if (keys.length === 1) return keys[0];
  throw new SpecError(keys.length
    ? `Set "value" to the column to shade by. Numeric columns: ${keys.join(", ")}.`
    : `Set "value": no numeric column found. Columns: ${Object.keys(rows[0] ?? {}).join(", ")}.`);
}

/**
 * A key for joining codes and names: case, accents and punctuation ignored, any
 * script kept; "06037" equals 6037. Dots separate ("St. Louis" = "St Louis")
 * rather than vanish, so code 1.5 never meets code 15.
 */
export function joinKey(v) {
  if (v == null || v === "") return "";
  let k = String(v).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (/^\d+$/.test(k)) k = k.replace(/^0+(?=\d)/, "");
  return k;
}

/**
 * Join data rows to boundary features. `join` names the data column and
 * `boundaries.id` the feature property; either or both are found by trying
 * unique keys and keeping the pair that matches the most rows. Equally good
 * pairs must identify the same features; otherwise the user must choose.
 */
function joinRows(ctx, polys, cfg) {
  const { spec, rows, report } = ctx;
  const propKeys = [...new Set(polys.flatMap((f) => Object.keys(f.properties)))];
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const column = spec.join ?? spec.key ?? null;
  if (column && !rows.some((r) => r[column] != null)) throw new SpecError(`No "${column}" column in the data. Columns: ${columns.join(", ")}.`);
  if (cfg.id && !propKeys.includes(cfg.id)) throw new SpecError(`No "${cfg.id}" property in ${cfg.file}. Properties: ${propKeys.join(", ")}.`);
  const index = new Map();
  const indexFor = (p) => {
    if (!index.has(p)) {
      const m = new Map();
      for (const f of polys) {
        const k = joinKey(f.properties[p]);
        if (!k) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(f);
      }
      index.set(p, m);
    }
    return index.get(p);
  };
  const candidates = column ? [column] : columns.filter((c) => c !== spec.value && rows.some((r) => typeof r[c] === "string" || typeof r[c] === "number"));
  // A repeated property may describe several distinct areas. Only an explicit
  // boundaries.id authorizes treating those features as one multipart area.
  const properties = cfg.id ? [cfg.id] : propKeys.filter((p) =>
    polys.some((f) => typeof f.properties[p] === "string" || typeof f.properties[p] === "number")
    && [...indexFor(p).values()].every((parts) => parts.length === 1));
  const keysFor = new Map();
  let bestHits = 0;
  let bestPairs = [];
  for (const c of candidates) {
    const keys = rows.map((r) => joinKey(r[c]));
    keysFor.set(c, keys);
    const present = keys.filter(Boolean);
    // Repeated metadata such as country or category cannot identify data rows.
    // Explicit joins still allow duplicates and report the retained first row.
    if (!column && new Set(present).size !== present.length) continue;
    for (const p of properties) {
      const m = indexFor(p);
      let hits = 0;
      for (const k of keys) if (m.has(k)) hits++;
      if (hits > bestHits) {
        bestHits = hits;
        bestPairs = [{ c, p, hits }];
      } else if (hits && hits === bestHits) bestPairs.push({ c, p, hits });
    }
  }
  if (!bestPairs.length) {
    throw new SpecError(`No unique data-to-area join found in ${cfg.file}. Set "join" to the data column and "boundaries": { "file", "id" } to the matching property. Columns: ${columns.join(", ")}. Properties: ${propKeys.join(", ")}.`);
  }
  bestPairs.sort((a, b) => a.c < b.c ? -1 : a.c > b.c ? 1 : a.p < b.p ? -1 : a.p > b.p ? 1 : 0);
  const best = bestPairs[0];
  const sameMatches = (other) => {
    const a = indexFor(best.p);
    const b = indexFor(other.p);
    return keysFor.get(best.c).every((k, i) => {
      const left = a.get(k) ?? [];
      const right = b.get(keysFor.get(other.c)[i]) ?? [];
      return left.length === right.length && left.every((f, j) => f === right[j]);
    });
  };
  if (bestPairs.some((pair) => !sameMatches(pair))) {
    const choices = bestPairs.slice(0, 6).map((pair) => `"${pair.c}" = "${pair.p}"`).join(", ");
    throw new SpecError(`Ambiguous area join in ${cfg.file}: ${choices} match equally well but identify different areas. Set "join" and "boundaries.id" explicitly.`);
  }
  if (!column || !cfg.id) report.notes.push(`boundaries: matched data column "${best.c}" to property "${best.p}" (${best.hits} of ${rows.length} rows).`);
  const m = indexFor(best.p);
  const used = new Map();
  const entries = [];
  const known = [...new Set(polys.map((f) => String(f.properties[best.p] ?? "")).filter(Boolean))];
  let misses = 0;
  for (const [i, row] of rows.entries()) {
    const k = joinKey(row[best.c]);
    const found = k ? m.get(k) : null;
    if (!found) {
      // Close matches for the first misses; a file that does not fit at all needs a different key, not 5,000 suggestions.
      const close = row[best.c] != null && misses++ < 25 ? closest(String(row[best.c]), known) : [];
      report.unmatched.push({ row: i + 1, reason: `"${row[best.c] ?? ""}" matched no area by "${best.p}"${close.length ? ` (close: ${close.join(", ")})` : ""}` });
      continue;
    }
    if (used.has(k)) {
      report.warnings.push(`Two rows match area "${row[best.c]}"; kept the first (row ${used.get(k)}).`);
      continue;
    }
    used.set(k, i + 1);
    // Several features with one id (a multi-part area split into pieces) shade together.
    const feature = found.length === 1 ? found[0] : { type: "Feature", properties: found[0].properties, geometry: { type: "GeometryCollection", geometries: found.map((f) => f.geometry) } };
    entries.push({ feature, parts: found, row, index: i + 1 });
  }
  return { entries, column: best.c, property: best.p };
}

function drawnFeature(f, env) {
  if (env.resolution === "110m" && f.properties.iso3) {
    return features("world-110m", "countries").features.find((x) => x.properties.iso3 === f.properties.iso3) ?? f;
  }
  return f;
}

function poolFor(geography, ctx) {
  if (geography === "countries") return features("world-50m", "countries");
  if (geography === "admin1") return admin1Features(ctx.admin1Country);
  if (geography === "us-states") return usStateFeatures();
  if (geography === "us-counties") return usCountyFeatures();
  throw new SpecError(`Unknown geography "${geography}". Use countries, admin1, us-states or us-counties.`);
}

function match(geography, key, pool, ctx) {
  if (key == null || key === "") return null;
  if (geography === "countries") {
    const c = findCountry(key);
    return c ? pool.features.find((f) => f.properties.iso3 === c.iso3) ?? null : null;
  }
  if (geography === "admin1") return findAdmin1(ctx.admin1Country, key);
  if (geography === "us-states") {
    const s = findUsState(key);
    return s ? pool.features.find((f) => f.properties.id === s[0]) ?? null : null;
  }
  if (geography === "us-counties") {
    const id = String(key).padStart(5, "0");
    return pool.features.find((f) => String(f.id) === id) ?? null;
  }
  return null;
}

function suggest(geography, key, pool) {
  if (key == null) return [];
  const names = pool.features.map((f) => f.properties.name).filter(Boolean);
  if (geography === "countries" || geography === "admin1") return closest(String(key), names);
  return [];
}

export { normalize };
