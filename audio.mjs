// Discord sends and receives 48kHz stereo s16le. speech.cpp takes a WAVE file
// of any rate for recognition and answers synthesis with mono s16le PCM.
export const DISCORD_RATE = 48000;
export const DISCORD_FRAME_BYTES = 4;

export function seconds(discordPcm) {
  return discordPcm.length / (DISCORD_RATE * DISCORD_FRAME_BYTES);
}

// 48kHz stereo -> 48kHz mono. The rate is left to speech.cpp, which resamples.
export function toMono(discordPcm) {
  const frames = Math.floor(discordPcm.length / DISCORD_FRAME_BYTES);
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++)
    out.writeInt16LE(
      (discordPcm.readInt16LE(i * 4) + discordPcm.readInt16LE(i * 4 + 2)) >> 1,
      i * 2,
    );
  return out;
}

export function wavFile(pcm, rate, channels = 1) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Mono s16le at `rate` -> 48kHz stereo s16le, linearly interpolated.
export function toDiscordPcm(pcm, rate) {
  const frames = Math.floor(pcm.length / 2);
  if (!frames) return Buffer.alloc(0);
  const count = Math.round((frames * DISCORD_RATE) / rate);
  const out = Buffer.alloc(count * DISCORD_FRAME_BYTES);
  for (let i = 0; i < count; i++) {
    const position = Math.min((i * rate) / DISCORD_RATE, frames - 1),
      lo = Math.floor(position),
      hi = Math.min(lo + 1, frames - 1),
      fraction = position - lo;
    const value = Math.round(
      pcm.readInt16LE(lo * 2) * (1 - fraction) +
        pcm.readInt16LE(hi * 2) * fraction,
    );
    out.writeInt16LE(value, i * 4);
    out.writeInt16LE(value, i * 4 + 2);
  }
  return out;
}
