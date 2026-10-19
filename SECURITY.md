# Security policy

## Supported version

The latest 0.1.x release and the latest commit on `main` receive fixes.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ashishkaloge/map-design/security/advisories/new).
Do not put exploit details in a public issue.

Useful reports include:

- a spec or data file that makes the renderer read or write files outside the
  paths it was given;
- text from a spec or data file that escapes into the SVG or HTML as markup or
  script;
- the CLI contacting any host other than the configured Overpass endpoint.

## What the tool does

- Reads the spec and the data files it names, and the bundled data.
- Writes `<name>.html`, `<name>.svg` and `<name>.png` where you point it.
- For posters only, sends one query to the public Overpass API (or the endpoint
  you set) and caches the response under `~/.cache/map-design`.
- For PNG export, starts your locally installed Chrome, Edge, Brave or
  Chromium in headless mode with a temporary profile.
- The generated HTML makes no network requests.
