import { DISCORD_RATE, DISCORD_FRAME_BYTES } from "./audio.mjs";

// Discord sends each member's voice on its own stream, so the speaker of an
// utterance is the user id of the stream it came from: no voice diarization.
//
// `receiver` is a VoiceConnection's receiver. `decoder()` makes an Opus
// decoder ({ decode(packet), delete() }) giving 48kHz stereo s16le.
// `onUtterance({ userId, startedAt, pcm })` gets each utterance as it ends,
// or a piece of it every `maxSeconds` while someone keeps talking.
export function listen(
  receiver,
  {
    decoder,
    endBehavior,
    silenceMs = 800,
    maxSeconds = 30,
    ignore = () => false,
    onUtterance,
    onError = () => {},
  },
) {
  const active = new Set();
  const maxBytes = Math.round(maxSeconds * DISCORD_RATE) * DISCORD_FRAME_BYTES;
  let stopped = false;
  const start = (userId) => {
    if (stopped || active.has(userId) || ignore(userId)) return;
    active.add(userId);
    const stream = receiver.subscribe(userId, {
      end: { behavior: endBehavior, duration: silenceMs },
    });
    const opus = decoder();
    let chunks = [],
      bytes = 0,
      startedAt = new Date(),
      finished = false;
    const flush = () => {
      if (bytes)
        onUtterance({ userId, startedAt, pcm: Buffer.concat(chunks, bytes) });
      chunks = [];
      bytes = 0;
      startedAt = new Date();
    };
    stream.on("data", (packet) => {
      let pcm;
      try {
        pcm = opus.decode(packet);
      } catch {
        return; // A damaged packet costs 20ms, not the utterance.
      }
      chunks.push(pcm);
      bytes += pcm.length;
      if (bytes >= maxBytes) flush();
    });
    const finish = () => {
      if (finished) return;
      finished = true;
      opus.delete();
      flush();
    };
    stream.once("end", finish);
    stream.on("error", (error) => onError(error));
    stream.once("close", () => {
      finish();
      active.delete(userId);
      // The receiver keeps an ending stream until it closes; resubscribe if
      // the member started again in between.
      if (receiver.speaking.users.has(userId)) start(userId);
    });
  };
  receiver.speaking.on("start", start);
  return () => {
    stopped = true;
    receiver.speaking.off("start", start);
    for (const stream of receiver.subscriptions.values()) stream.destroy();
  };
}

// Runs tasks one at a time in the order given.
export function serial() {
  let tail = Promise.resolve(),
    pending = 0;
  const run = (task) => {
    pending++;
    const result = tail.then(task).finally(() => pending--);
    tail = result.catch(() => {});
    return result;
  };
  run.idle = () => tail;
  run.size = () => pending;
  return run;
}
