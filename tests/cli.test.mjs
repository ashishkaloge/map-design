import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../skills/map-design/scripts/map.mjs");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

test("render writes html and svg next to the spec", () => {
  const dir = mkdtempSync(join(tmpdir(), "map-design-test-"));
  writeFileSync(join(dir, "m.json"), JSON.stringify({ kind: "bubbles", value: "v", title: "T", data: [{ place: "Cairo", v: 1 }] }));
  const r = run("render", join(dir, "m.json"), "--no-png");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, "m.svg")));
  const html = readFileSync(join(dir, "m.html"), "utf8");
  assert.match(html, /Download PNG/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, "the page makes no external requests");
});

test("check exits 2 when rows do not match", () => {
  const dir = mkdtempSync(join(tmpdir(), "map-design-test-"));
  writeFileSync(join(dir, "c.json"), JSON.stringify({ kind: "choropleth", value: "v", data: [{ country: "Narnia", v: 1 }, { country: "Chile", v: 2 }] }));
  const r = run("check", join(dir, "c.json"));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /NOT MATCHED/);
});

test("spec errors print one line, no stack", () => {
  const dir = mkdtempSync(join(tmpdir(), "map-design-test-"));
  writeFileSync(join(dir, "bad.json"), "{ not json");
  const r = run("render", join(dir, "bad.json"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^map-design: .*not valid JSON/);
});

test("find and themes", () => {
  assert.match(run("find", "Lagos").stdout, /place\s+Lagos/);
  assert.match(run("find", "NRT").stdout, /airport\s+NRT/);
  assert.match(run("themes").stdout, /azulejo/);
  assert.match(run("--help").stdout, /Commands/);
});
