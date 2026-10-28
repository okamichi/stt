import { readFileSync, mkdtempSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { extractArchive } from "./archive.mjs";
import assert from "node:assert/strict";
const { archive, name } = JSON.parse(
  readFileSync(new URL("../.packaging/latest.json", import.meta.url)),
);
const work = mkdtempSync(join(tmpdir(), "stt package 日本語 "));
const windows = process.platform === "win32";
extractArchive(archive, work);
const root = join(work, name);
const node = join(root, "runtime", windows ? "node.exe" : "node");
const env = {
  ...process.env,
  PATH: windows ? join(process.env.SystemRoot, "System32") : "/usr/bin:/bin",
};
delete env.DISCORD_BOT_TOKEN;
const run = (args) =>
  execFileSync(node, [join(root, "launcher.mjs"), ...args], {
    env,
    cwd: work,
    encoding: "utf8",
    timeout: 30000,
  });
assert.match(run(["--help"]), /使い方/);
assert.match(run(["--self-test"]), /DAVEロード.*OK/);
assert.match(
  execFileSync(
    join(root, "runtime/speech", windows ? "speech.exe" : "speech"),
    ["--help"],
    { env, encoding: "utf8" },
  ),
  /speech/i,
);
for (const f of ["models", "data", "config.json", ".env", "test.jsonl"])
  assert.equal(existsSync(join(root, f)), false, f);
function audit(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) audit(join(dir, e.name));
    else assert.ok(!/\.jsonl$|^\.env|^config\.json$/.test(e.name), e.name);
  }
}
audit(root);
console.log("Extracted package: help, DAVE, Opus, AES and speech passed.");
