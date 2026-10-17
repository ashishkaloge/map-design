# Cartography guide

Short rules that separate a map people trust from one they scroll past.

## Say one thing

- Write the title as the finding: "Rents doubled along the new metro line", not
  "Rent change by neighborhood". The subtitle carries the measure, units,
  place and date.
- One map, one variable. Two variables usually need two maps side by side.
- Annotate the two or three places the story is about. An annotation that
  explains an outlier is worth more than ten labels.

## Pick the right encoding

| Data | Encode as | Avoid |
| --- | --- | --- |
| Rate, share, per-capita, density by area | Choropleth | Raw counts by area |
| Totals at places | Bubbles (area) or spikes (height) | Choropleth of totals |
| Change with a meaningful zero | Diverging choropleth, `scale.center: 0` | Sequential ramp for +/− |
| Categories by area | Categorical choropleth, at most 6–7 categories | Rainbow palettes |
| Movement | Flows with width by volume | Straight lines for long distances |
| Sequence of places | Route, numbered | Unordered points |

## Classes and color

- Quantiles make every class hold the same number of areas; good default for
  skewed data. Say so in the legend title if readers might compare values.
- Thresholds at round numbers (10, 25, 50, 100) read faster and survive being
  compared across maps. Prefer them for published work.
- Jenks finds natural clusters; good for exploration, harder to explain.
- 4 to 6 classes. More than 7 cannot be told apart.
- Light means less, dark means more on light themes. On dark themes (`ink`,
  `blueprint`) the `amber` and `ice` ramps run dark to bright instead.
- Diverging palettes only when the midpoint means something: zero change, the
  national average, 50%.
- Never encode with red versus green alone.

## Projections

The renderer chooses an equal-area projection for thematic maps:

- World: Equal Earth.
- United States: Albers USA (Alaska and Hawaii as insets).
- Continents and countries: Lambert azimuthal equal-area, or a conic
  equal-area projection for wide mid-latitude areas such as Russia or Canada.
- Globe: orthographic, for "where on Earth" and polar routes.

Mercator inflates high latitudes; Greenland looks like Africa. Use it only for
city-scale maps, where posters already use it.

## Labels and type

- The renderer places labels where they fit and drops the rest. If an important
  name was dropped, label fewer things or annotate it explicitly.
- Prefer `labelTop` of 5 to 10 on bubble and spike maps.
- Keep the footer: source, note, credit. Maps without sources are not shared
  by people who care.

## Themes by use

| Use | Theme |
| --- | --- |
| Reports, articles, documents | `paper` |
| Presentations, dark dashboards | `ink` |
| Reference maps, education | `atlas` |
| History, voyages, storytelling | `antique` |
| Posters, bold one-number maps | `swiss` |
| Technical, infrastructure | `blueprint` |

## Borders and names

Boundaries follow Natural Earth's de facto view. Disputed areas (for example
Kashmir, Crimea, Western Sahara) are shown as Natural Earth draws them, which
does not match every government's official position. When a map will be
published in a country with legal requirements on how borders are shown, say
so in `note` and have the publisher review it.
