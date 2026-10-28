import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createArchive, extractArchive } from "./packaging/archive.mjs";

test("ZIP round trip preserves Unicode paths, spaces, quotes and dotfiles", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "stt 日本語 space ' & "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "配布 package");
  mkdirSync(join(source, "サブフォルダ"), { recursive: true });
  writeFileSync(join(source, "サブフォルダ", "日本語.txt"), "こんにちは\n");
  writeFileSync(join(source, ".hidden"), "included\n");
  const zip = join(dir, "配布 archive.zip");
  createArchive(source, zip);
  // Rebuilding an existing archive must replace it, not fail or retain old files.
  rmSync(join(source, ".hidden"));
  createArchive(source, zip);
  const output = join(dir, "展開 output");
  mkdirSync(output);
  extractArchive(zip, output);
  assert.equal(
    readFileSync(
      join(output, "配布 package", "サブフォルダ", "日本語.txt"),
      "utf8",
    ),
    "こんにちは\n",
  );
  assert.throws(() => readFileSync(join(output, "配布 package", ".hidden")), {
    code: "ENOENT",
  });
  writeFileSync(join(source, ".hidden"), "included\n");
  createArchive(source, zip);
  const output2 = join(dir, "再展開");
  mkdirSync(output2);
  extractArchive(zip, output2);
  assert.equal(
    readFileSync(join(output2, "配布 package", ".hidden"), "utf8"),
    "included\n",
  );
});
