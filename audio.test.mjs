import { test } from "node:test";
import assert from "node:assert/strict";
import { seconds, toMono, wavFile, toDiscordPcm } from "./audio.mjs";

const stereo = (...pairs) => {
  const b = Buffer.alloc(pairs.length * 4);
  pairs.forEach(([l, r], i) => {
    b.writeInt16LE(l, i * 4);
    b.writeInt16LE(r, i * 4 + 2);
  });
  return b;
};

test("seconds counts 48kHz stereo frames", () => {
  assert.equal(seconds(Buffer.alloc(48000 * 4)), 1);
  assert.equal(seconds(Buffer.alloc(960 * 4)), 0.02);
});

test("toMono averages the two channels", () => {
  const mono = toMono(stereo([100, 300], [-32768, -32768], [32767, -32768]));
  assert.deepEqual(
    [0, 1, 2].map((i) => mono.readInt16LE(i * 2)),
    [200, -32768, -1],
  );
});

test("wavFile writes a 16-bit PCM header", () => {
  const wav = wavFile(Buffer.alloc(8), 48000);
  assert.equal(wav.length, 52);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), 44);
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt32LE(28), 96000);
  assert.equal(wav.readUInt16LE(32), 2);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), 8);
});

test("toDiscordPcm resamples mono to 48kHz stereo", () => {
  const mono = Buffer.alloc(24000 * 2);
  for (let i = 0; i < 24000; i++)
    mono.writeInt16LE(i % 2 ? 1000 : -1000, i * 2);
  const out = toDiscordPcm(mono, 24000);
  assert.equal(out.length, 48000 * 4);
  assert.equal(out.readInt16LE(0), -1000);
  assert.equal(out.readInt16LE(2), -1000);
  // Halfway between -1000 and 1000.
  assert.equal(out.readInt16LE(4), 0);
  assert.equal(out.readInt16LE(8), 1000);
  assert.equal(out.readInt16LE(10), 1000);
  assert.equal(toDiscordPcm(Buffer.alloc(0), 24000).length, 0);
});
