import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
function fixture(t, config) {
  const dir = mkdtempSync(join(tmpdir(), "stt launcher 日本語 "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(
    new URL("./launcher.mjs", import.meta.url),
    join(dir, "launcher.mjs"),
  );
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  writeFileSync(
    join(dir, "stt.mjs"),
    `console.log(JSON.stringify({token:process.env.DISCORD_BOT_TOKEN,args:process.argv.slice(2)}));`,
  );
  return (args = [], env = {}) =>
    spawnSync(
      process.execPath,
      [join(dir, "launcher.mjs"), "--speech", "http://127.0.0.1:1", ...args],
      {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, DISCORD_BOT_TOKEN: "", ...env },
      },
    );
}
test("standalone config supplies credentials and channel without starting speech", (t) => {
  const run = fixture(t, { token: "test-token", channel: "123" });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.token, "test-token");
  assert.deepEqual(actual.args, [
    "--speech",
    "http://127.0.0.1:1",
    "--channel",
    "123",
  ]);
});
test("environment and explicit channel override config", (t) => {
  const run = fixture(t, { token: "config-token", channel: "123" });
  const result = run(["--channel", "456"], { DISCORD_BOT_TOKEN: "env-token" });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.token, "env-token");
  assert.deepEqual(actual.args, [
    "--speech",
    "http://127.0.0.1:1",
    "--channel",
    "456",
  ]);
});
test("missing credentials fails without starting speech or bot", (t) => {
  const result = fixture(t, {})();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /config.example.json/);
  assert.equal(result.stdout, "");
});
test("help runs without credentials", (t) => {
  const result = fixture(t, {})(["--help"]);
  assert.equal(result.status, 0, result.stderr);
});
test("Bridge settings option is rejected", () => {
  const result = spawnSync(
    process.execPath,
    ["stt.mjs", "--bridge-data", "unused"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option/);
});
