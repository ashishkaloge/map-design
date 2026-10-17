// Areas shaded by a value: countries, first-level regions, US states or US counties.
import { findCountry, findAdmin1, findUsState, admin1Features, usCountyFeatures, usStateFeatures, features, closest, normalize, hasAdmin1, meshOf } from "../data.mjs";
import { colorScale } from "../scales.mjs";
import { classedLegend, continuousLegend, categoricalLegend } from "../layout.mjs";
import { pickColumn } from "../spec.mjs";
import { SpecError } from "../errors.mjs";
import { esc, n, formatNumber } from "../svg.mjs";
import { areaLabels, contrastText, tooltip, numeric } from "./common.mjs";
import { G } from "../geo.mjs";

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
  const { spec, theme, rows } = ctx;
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

  const categorical = spec.scale?.type === "categorical";
  const entries = [...joined.values()];
  const values = categorical ? entries.map((e) => e.row[valueField]) : numeric(entries, valueField, ctx, "choropleth");
  entries.forEach((e, i) => (e.value = values[i]));
  const scale = colorScale(values, spec.scale ?? {}, theme);
  const format = spec.format ?? {};
  const legendTitle = spec.legend?.title ?? spec.legendTitle ?? null;
  const hasNoData = geography === "countries" ? true : pool.features.length > joined.size;
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
