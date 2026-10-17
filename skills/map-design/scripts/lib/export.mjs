// PNG export through a locally installed Chrome, Chromium, Edge or Brave in
// headless mode. No browser is downloaded; without one, export is skipped.
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

export function findBrowser() {
  if (process.env.MAP_DESIGN_BROWSER && existsSync(process.env.MAP_DESIGN_BROWSER)) return process.env.MAP_DESIGN_BROWSER;
  for (const c of CANDIDATES[process.platform] ?? []) {
    if (c.includes("/") || c.includes("\\")) {
      if (existsSync(c)) return c;
    } else {
      const r = spawnSync("which", [c], { encoding: "utf8" });
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    }
  }
  return null;
}

/** Rasterize an SVG string to `out` at `scale`× its pixel size. Returns { ok, reason }. */
export function exportPng(svg, width, height, out, { scale = 2 } = {}) {
  const browser = findBrowser();
  if (!browser) return { ok: false, reason: "No Chrome, Chromium, Edge or Brave found. Set MAP_DESIGN_BROWSER to a browser binary, or open the HTML and use its PNG button." };
  const dir = mkdtempSync(join(tmpdir(), "map-design-"));
  try {
    const page = join(dir, "page.html");
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`);
    const args = [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--mute-audio", `--user-data-dir=${join(dir, "profile")}`,
      `--force-device-scale-factor=${scale}`, `--window-size=${width},${height}`,
      "--virtual-time-budget=4000", `--screenshot=${out}`, pathToFileURL(page).href,
    ];
    const r = spawnSync(browser, args, { encoding: "utf8", timeout: 120000 });
    if (r.status !== 0 || !existsSync(out)) return { ok: false, reason: `Browser export failed: ${(r.stderr || r.error?.message || "").trim().split("\n").slice(-2).join(" ")}` };
    return { ok: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
