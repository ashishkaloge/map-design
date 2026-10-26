import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { playwrightBrowser } from "../skills/map-design/scripts/lib/export.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "map-design-browser-"));

test("PNG export finds a Chromium that Playwright installed, headless shell first", () => {
  const layout = {
    linux: ["chrome-linux64/chrome", "chrome-headless-shell-linux64/chrome-headless-shell"],
    darwin: ["chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-mac/headless_shell"],
    win32: ["chrome-win64/chrome.exe", "chrome-headless-shell-win64/chrome-headless-shell.exe"],
  }[process.platform];
  if (!layout) return;
  const root = dir();
  const make = (rel) => {
    const file = join(root, rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "");
    chmodSync(file, 0o755);
    return file;
  };
  make(`chromium-1300/${layout[0]}`);
  make(`chromium_headless_shell-1100/${layout[1]}`);
  const shell = make(`chromium_headless_shell-1200/${layout[1]}`);
  const saved = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = root;
  try {
    assert.equal(playwrightBrowser(), shell);
  } finally {
    if (saved == null) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = saved;
  }
});
