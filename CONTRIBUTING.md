# Contributing

Requires Node.js 20 or newer. The skill itself has no dependencies; the build
tools use a few dev dependencies.

```bash
git clone https://github.com/ashishkaloge/map-design.git
cd map-design
npm install      # only needed for the build tools
npm test
```

Good contributions:

- A map that renders wrong: the spec, the output PNG and what you expected.
- A new theme, with a preview of one editorial map and one poster.
- Better label placement, projections or palettes, with before and after images.
- A name or code that should match but does not (add it to the aliases in
  `scripts/lib/data.mjs` with a test).
- A gallery example built on real, cited, openly licensed data.

Keep pull requests focused and add a test for behavior changes. The skill must
stay runnable with plain `node`: no runtime dependencies, no network access
except the documented Overpass download for posters.

Rebuilding bundled data needs the raw downloads listed in
[docs/data-sources.md](docs/data-sources.md).

Links in contributions must support the change: official documentation,
source, data or a useful example. Disclose affiliation when submitting your own
project. Promotional additions are not accepted.
