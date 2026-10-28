import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  existsSync,
  chmodSync,
  mkdtempSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { supplementLicenses } from "./licenses.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = `${process.platform}-${process.arch}`;
if (!["darwin-arm64", "win32-x64"].includes(target))
  throw Error("Unsupported build target");
const required = readFileSync(
  join(root, "packaging/node-version"),
  "utf8",
).trim();
if (process.versions.node !== required)
  throw Error(`Build with Node.js ${required}`);
const info = JSON.parse(readFileSync(join(root, "package.json")));
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== `v${info.version}`
)
  throw Error("Release tag must match package version");
const pins = JSON.parse(readFileSync(join(root, "packaging/speech-lock.json")));
const speechDir = join(root, ".packaging/speech-runtime");
const built = JSON.parse(readFileSync(join(speechDir, "build.json")));
if (
  built.target !== target ||
  ["speech", "ggml"].some(
    (k) =>
      built[k].commit !== pins[k].commit || built[k].sha256 !== pins[k].sha256,
  )
)
  throw Error("Build pinned speech.cpp first");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const work = mkdtempSync(join(root, ".packaging/package-"));
const name = `stt-${info.version}-${target}`;
const stage = join(work, name);
mkdirSync(stage);
// Explicit allowlist: never copy local models, configuration or transcripts.
for (const f of [
  "stt.mjs",
  "launcher.mjs",
  "audio.mjs",
  "echo.mjs",
  "listen.mjs",
  "speech.mjs",
  "package.json",
  "package-lock.json",
  "config.example.json",
  "LICENSE",
  "README.md",
])
  cpSync(join(root, f), join(stage, f));
const npm =
  process.env.npm_execpath ||
  join(
    dirname(process.execPath),
    process.platform === "win32"
      ? "node_modules/npm/bin/npm-cli.js"
      : "../lib/node_modules/npm/bin/npm-cli.js",
  );
execFileSync(
  process.execPath,
  [npm, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: stage, stdio: "inherit" },
);
mkdirSync(join(stage, "runtime"), { recursive: true });
cpSync(speechDir, join(stage, "runtime/speech"), { recursive: true });
const windows = process.platform === "win32";
cpSync(process.execPath, join(stage, "runtime", windows ? "node.exe" : "node"));
chmodSync(join(stage, "runtime", windows ? "node.exe" : "node"), 0o755);
if (windows)
  writeFileSync(
    join(stage, "stt.cmd"),
    '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0launcher.mjs" %*\r\n',
  );
else {
  writeFileSync(
    join(stage, "stt.command"),
    '#!/bin/sh\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$HERE/runtime/node" "$HERE/launcher.mjs" "$@"\n',
  );
  chmodSync(join(stage, "stt.command"), 0o755);
}
const licenses = join(stage, "licenses");
mkdirSync(licenses);
const license = [
  join(dirname(process.execPath), "../LICENSE"),
  join(dirname(process.execPath), "LICENSE"),
].find(existsSync);
if (!license) throw Error("Official Node.js LICENSE missing");
cpSync(license, join(licenses, "Node.js-LICENSE"));
supplementLicenses(join(stage, "node_modules"), licenses);
writeFileSync(
  join(stage, "build-info.json"),
  JSON.stringify(
    {
      version: info.version,
      target,
      node: process.versions.node,
      speech: built,
    },
    null,
    2,
  ),
);
const archive = join(dist, `${name}.zip`);
if (windows)
  execFileSync("tar.exe", ["-a", "-cf", archive, "-C", work, name], {
    stdio: "inherit",
  });
else
  execFileSync("zip", ["-qr", archive, name], { cwd: work, stdio: "inherit" });
writeFileSync(
  `${archive}.sha256`,
  `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${name}.zip\n`,
);
writeFileSync(
  join(root, ".packaging/latest.json"),
  JSON.stringify({ archive, name }),
);
console.log(archive);
