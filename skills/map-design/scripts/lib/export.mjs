// PNG export through a locally installed Chrome, Chromium, Edge or Brave in
// headless mode, or a Chromium that Playwright already installed. No browser is
// downloaded; without one, export is skipped.
import { existsSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
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

// Executables inside Playwright's browser folders, newest layout first. The
// headless shell comes before full Chromium: it starts reliably in containers.
const PLAYWRIGHT = {
  linux: {
    shell: ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/headless_shell"],
    chromium: ["chrome-linux64/chrome", "chrome-linux/chrome"],
  },
  darwin: {
    shell: ["chrome-headless-shell-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell", "chrome-mac/headless_shell"],
    chromium: [
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ],
  },
  win32: {
    shell: ["chrome-headless-shell-win64\\chrome-headless-shell.exe", "chrome-win\\headless_shell.exe"],
    chromium: ["chrome-win64\\chrome.exe", "chrome-win\\chrome.exe"],
  },
};

function playwrightRoots() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH];
  if (process.platform === "linux") roots.push(join(homedir(), ".cache", "ms-playwright"));
  if (process.platform === "darwin") roots.push(join(homedir(), "Library", "Caches", "ms-playwright"));
  if (process.platform === "win32" && process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, "ms-playwright"));
  return roots.filter((r) => r && r !== "0" && existsSync(r));
}

export function playwrightBrowser() {
  const layout = PLAYWRIGHT[process.platform];
  if (!layout) return null;
  for (const root of playwrightRoots()) {
    let dirs;
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    const revision = (d) => Number(d.match(/-(\d+)$/)?.[1] ?? 0);
    for (const [prefix, files] of [["chromium_headless_shell-", layout.shell], ["chromium-", layout.chromium]]) {
      const found = dirs.filter((d) => d.startsWith(prefix)).sort((a, b) => revision(b) - revision(a));
      for (const d of found) {
        for (const f of files) {
          const exe = join(root, d, f);
          if (existsSync(exe)) return exe;
        }
      }
    }
  }
  return null;
}

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
  return playwrightBrowser();
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
      // Chrome refuses to start as root (containers, CI) unless its sandbox is off.
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
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
