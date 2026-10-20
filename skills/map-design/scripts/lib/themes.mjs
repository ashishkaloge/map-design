// Design tokens. Editorial themes drive data maps; poster themes drive city posters.
// Every color a renderer uses comes from here, so a theme change restyles the whole map.

import { mix } from "./color.mjs";

const SANS = "'Libre Franklin', 'Helvetica Neue', Arial, sans-serif";
const SERIF = "'Source Serif 4', Georgia, 'Times New Roman', serif";
const GARAMOND = "'EB Garamond', Garamond, Georgia, serif";
const GEOMETRIC = "Jost, Futura, 'Century Gothic', 'Helvetica Neue', sans-serif";
const MONO = "'IBM Plex Mono', Menlo, Consolas, monospace";

export const EDITORIAL = {
  paper: {
    label: "Warm newsprint. The default for data maps.",
    dark: false,
    bg: "#F7F4EE",
    ocean: "#F7F4EE",
    land: "#E4DED2",
    noData: "#E4DED2",
    border: "#FFFFFF",
    coast: "#CFC6B6",
    context: "#ECE7DE",
    graticule: "#E8E2D7",
    sphere: "#D3CABA",
    water: "#DCE5E6",
    river: "#B9CCD0",
    text: "#1E1C19",
    muted: "#6C665C",
    faint: "#9F978A",
    accent: "#C2412D",
    halo: "#F7F4EE",
    route: "#C2412D",
    symbol: "#C2412D",
    symbolStroke: "#FFFFFF",
    fonts: { title: SERIF, body: SANS, label: SANS, mono: MONO, water: SERIF },
    titleWeight: 600,
    sequential: "teal",
    diverging: "red-blue",
    categorical: "editorial",
  },
  atlas: {
    label: "Classic reference atlas: blue water, cream land, serif labels.",
    dark: false,
    bg: "#F4F0E4",
    ocean: "#CADDE3",
    land: "#F6F1E1",
    noData: "#EAE4D1",
    border: "#A99C83",
    coast: "#8DA9B3",
    context: "#EFE9D7",
    graticule: "#B7CDD4",
    sphere: "#8DA9B3",
    water: "#CADDE3",
    river: "#8EB4C3",
    text: "#2A2722",
    muted: "#6A6253",
    faint: "#958B78",
    accent: "#A33A2C",
    halo: "#F6F1E1",
    route: "#A33A2C",
    symbol: "#A33A2C",
    symbolStroke: "#FFFFFF",
    fonts: { title: GARAMOND, body: SERIF, label: SERIF, mono: MONO, water: GARAMOND },
    titleWeight: 600,
    sequential: "orange",
    diverging: "brown-teal",
    categorical: "muted",
    graticuleOn: true,
    rivers: true,
  },
  ink: {
    label: "Dark editorial. Data glows against near-black.",
    dark: true,
    bg: "#111317",
    ocean: "#111317",
    land: "#262A31",
    noData: "#22262C",
    border: "#111317",
    coast: "#3A3F48",
    context: "#1C1F24",
    graticule: "#1B1E23",
    sphere: "#2C3038",
    water: "#16202B",
    river: "#22364A",
    text: "#EEEAE3",
    muted: "#A0A4AB",
    faint: "#6D727B",
    accent: "#F2A541",
    halo: "#111317",
    route: "#F2A541",
    symbol: "#F2A541",
    symbolStroke: "#111317",
    fonts: { title: SERIF, body: SANS, label: SANS, mono: MONO, water: SERIF },
    titleWeight: 600,
    sequential: "amber",
    diverging: "orange-blue",
    categorical: "neon",
  },
  antique: {
    label: "Parchment, sepia ink and coastal ripples. For voyages and history.",
    dark: false,
    bg: "#EEE3C8",
    ocean: "#E6D8B8",
    land: "#F3E9D0",
    noData: "#EADFC2",
    border: "#A08A63",
    coast: "#7D6440",
    context: "#EFE4C9",
    graticule: "#CDBB93",
    sphere: "#7D6440",
    water: "#DCCDA9",
    river: "#A8936B",
    text: "#3B2C17",
    muted: "#6E5A3A",
    faint: "#9C8662",
    accent: "#9B2F1F",
    halo: "#F3E9D0",
    route: "#9B2F1F",
    symbol: "#9B2F1F",
    symbolStroke: "#F3E9D0",
    fonts: { title: GARAMOND, body: GARAMOND, label: GARAMOND, mono: GARAMOND, water: GARAMOND },
    titleWeight: 600,
    sequential: "orange",
    diverging: "brown-teal",
    categorical: "muted",
    graticuleOn: true,
    ripples: true,
    rivers: true,
  },
  swiss: {
    label: "White, black and one red. Grid-strict and loud.",
    dark: false,
    bg: "#FFFFFF",
    ocean: "#FFFFFF",
    land: "#E9E9E9",
    noData: "#E9E9E9",
    border: "#FFFFFF",
    coast: "#BDBDBD",
    context: "#F2F2F2",
    graticule: "#EFEFEF",
    sphere: "#BDBDBD",
    water: "#E4ECEF",
    river: "#C9D7DC",
    text: "#000000",
    muted: "#555555",
    faint: "#8C8C8C",
    accent: "#E30613",
    halo: "#FFFFFF",
    route: "#E30613",
    symbol: "#E30613",
    symbolStroke: "#FFFFFF",
    fonts: { title: SANS, body: SANS, label: SANS, mono: MONO, water: SANS },
    titleWeight: 800,
    sequential: "red",
    diverging: "red-blue",
    categorical: "vivid",
  },
  blueprint: {
    label: "Engineering drawing: white linework on cyanotype blue.",
    dark: true,
    bg: "#1C3A63",
    ocean: "#1C3A63",
    land: "#24497A",
    noData: "#22436F",
    border: "#5F84B5",
    coast: "#C9DBF2",
    context: "#20416D",
    graticule: "#2A5185",
    sphere: "#C9DBF2",
    water: "#1C3A63",
    river: "#6E95C7",
    text: "#F0F6FF",
    muted: "#B4C8E4",
    faint: "#7D9CC6",
    accent: "#FFD166",
    halo: "#1C3A63",
    route: "#FFD166",
    symbol: "#FFD166",
    symbolStroke: "#1C3A63",
    fonts: { title: MONO, body: MONO, label: MONO, mono: MONO, water: MONO },
    titleWeight: 500,
    sequential: "ice",
    diverging: "orange-blue",
    categorical: "neon",
    graticuleOn: true,
  },
};

// Roads fade from the road colour toward the background by class, so arteries
// read first and the residential mesh becomes texture. FADE is how far each
// class moves toward the background; WIDTH is the stroke at 1200 px wide.
const FADE = { motorway: 0, trunk: 0.03, primary: 0.08, secondary: 0.18, tertiary: 0.28, residential: 0.4, service: 0.55, path: 0.6 };
const WIDTH = { motorway: 2.6, trunk: 2.3, primary: 1.8, secondary: 1.35, tertiary: 1.05, residential: 0.6, service: 0.35, path: 0.3 };
const MAJOR = new Set(["motorway", "trunk", "primary"]);
const MINOR = new Set(["residential", "service", "path"]);

function road(color, bg, scale = {}) {
  const out = {};
  for (const [cls, w] of Object.entries(WIDTH)) {
    const k = MAJOR.has(cls) ? scale.major ?? 1 : MINOR.has(cls) ? scale.minor ?? 1 : 1;
    out[cls] = { color: mix(color, bg, FADE[cls] * (scale.fade ?? 1)), width: w * k };
  }
  return out;
}

// `road` is the strongest street colour; `building` and `park` sit just off the
// background so blocks gain texture without competing with the streets.
const POSTER_DEFS = {
  noir: {
    label: "White streets on black.",
    pin: "#FF5A4E",
    bg: "#0D0D0D", water: "#232A33", park: "#16201A", building: "#19191B", text: "#F4F4F2", muted: "#9A9A96",
    road: "#F2F2F0", rail: "#5C5C5A", font: GEOMETRIC, sub: GEOMETRIC, mono: MONO,
  },
  paper: {
    label: "Charcoal on warm paper. Prints well.",
    pin: "#C2412D",
    bg: "#F3EEE4", water: "#CFDCDE", park: "#DDE3CD", building: "#E5DDCF", text: "#1F1D1A", muted: "#6D675E",
    road: "#24221F", rail: "#8B857B", font: GEOMETRIC, sub: GEOMETRIC, mono: MONO,
  },
  blueprint: {
    label: "Cyanotype linework.",
    pin: "#FFD166",
    bg: "#1B3A62", water: "#132B4A", park: "#21466F", building: "#20416B", text: "#EEF5FF", muted: "#A9C1E2",
    road: "#E4EEFA", rail: "#7FA0CC", font: MONO, sub: MONO, mono: MONO,
  },
  sumi: {
    label: "Ink on washi paper with a red seal.",
    pin: "#B7282E",
    bg: "#F2ECDF", water: "#D8D2C4", park: "#E3DDCB", building: "#E7E0D1", text: "#1A1A1A", muted: "#6B655B", accent: "#B7282E",
    road: "#1A1A1A", roadScale: { minor: 0.9 }, rail: "#77716A", font: GARAMOND, sub: GARAMOND, mono: GARAMOND,
  },
  terracotta: {
    label: "Burnt orange streets on sandstone.",
    pin: "#1D5C63",
    bg: "#EFE2D2", water: "#D5C3AC", park: "#E2D5BC", building: "#E7D8C5", text: "#6A2C14", muted: "#9A6448",
    road: "#A3401F", rail: "#C08A6C", font: GEOMETRIC, sub: GEOMETRIC, mono: MONO,
  },
  azulejo: {
    label: "Cobalt on white, after Portuguese tiles.",
    pin: "#E39B2D",
    bg: "#F8F7F3", water: "#D6E1F2", park: "#E4EAF1", building: "#EDEFF3", text: "#1C4A9C", muted: "#5A78B3",
    road: "#1C4A9C", rail: "#7E97C7", font: SERIF, sub: SERIF, mono: MONO,
  },
  neon: {
    label: "Synthwave night: magenta arteries, violet streets.",
    pin: "#FFE14D",
    bg: "#110A1E", water: "#1A1036", park: "#1A1032", building: "#170E29", text: "#FFFFFF", muted: "#C7A8FF",
    road: "#8B6CFF",
    roadOverrides: {
      motorway: "#FF3DA6", trunk: "#FF3DA6", primary: "#FF5DB8", secondary: "#29E7FF",
    },
    rail: "#3F2C73", font: GEOMETRIC, sub: GEOMETRIC, mono: MONO,
  },
  forest: {
    label: "Cream streets on deep green.",
    pin: "#F2A541",
    bg: "#1F3A2E", water: "#2B4A40", park: "#28493A", building: "#234032", text: "#ECE6D3", muted: "#B4C2A8",
    road: "#F0EAD8", rail: "#6D8574", font: SERIF, sub: SERIF, mono: MONO,
  },
  mono: {
    label: "Pure black on white. Maximum contrast.",
    pin: "#E30613",
    bg: "#FFFFFF", water: "#E4E4E4", park: "#EDEDED", building: "#F0F0F0", text: "#000000", muted: "#555555",
    road: "#000000", rail: "#888888", font: GEOMETRIC, sub: GEOMETRIC, mono: MONO,
  },
};

export const POSTER = Object.fromEntries(
  Object.entries(POSTER_DEFS).map(([name, { road: color, roadScale, roadOverrides, ...t }]) => {
    const roads = road(color, t.bg, roadScale);
    for (const [cls, c] of Object.entries(roadOverrides ?? {})) roads[cls] = { ...roads[cls], color: c };
    return [name, { ...t, roads, casing: t.bg }];
  }),
);

export function editorialTheme(name = "paper") {
  const t = EDITORIAL[name];
  if (!t) throw new Error(`Unknown theme "${name}". Editorial themes: ${Object.keys(EDITORIAL).join(", ")}.`);
  return { name, ...t };
}

export function posterTheme(name = "noir") {
  const t = POSTER[name];
  if (!t) throw new Error(`Unknown poster theme "${name}". Poster themes: ${Object.keys(POSTER).join(", ")}.`);
  return { name, ...t };
}
