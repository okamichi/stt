import { test } from "node:test";
import assert from "node:assert/strict";
import { SpeechClient } from "./speech.mjs";

const MODELS = {
  data: [
    {
      id: "qwen3-tts-0.6b",
      speech: {
        task: "synthesis",
        voices: [{ name: "ryan" }, { name: "ono_anna" }],
        options: [{ name: "voice" }],
      },
    },
    {
      id: "qwen3-asr-0.6b",
      speech: {
        task: "recognition",
        options: [{ name: "language" }, { name: "prompt" }],
      },
    },
    { id: "silero-vad", speech: { task: "detection", options: [] } },
  ],
};

function server(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    return handlers[path]?.(init) ?? new Response("", { status: 404 });
  };
  return { calls, fetchImpl };
}

test("models finds each task and the voices", async () => {
  const { fetchImpl } = server({ "/v1/models": () => Response.json(MODELS) });
  const speech = new SpeechClient("http://speech.invalid/", { fetchImpl });
  const loaded = await speech.models();
  assert.equal(loaded.synthesis.id, "qwen3-tts-0.6b");
  assert.equal(loaded.recognition.id, "qwen3-asr-0.6b");
  assert.equal(loaded.detection.id, "silero-vad");
  assert.deepEqual(speech.voices(), ["ryan", "ono_anna"]);
  assert.ok(speech.takes("recognition", "language"));
  assert.ok(!speech.takes("synthesis", "language"));
});

test("transcribe posts a WAVE file with the options the model takes", async () => {
  const { calls, fetchImpl } = server({
    "/v1/models": () => Response.json(MODELS),
    "/v1/audio/transcriptions": () => Response.json({ text: " こんにちは " }),
  });
  const speech = new SpeechClient("http://speech.invalid", { fetchImpl });
  await speech.models();
  const text = await speech.transcribe(Buffer.alloc(9600), {
    language: "ja",
    prompt: "ドラゴンランス",
    regions: true,
  });
  assert.equal(text, "こんにちは");
  const form = calls.at(-1).init.body;
  assert.equal(calls.at(-1).init.method, "POST");
  assert.equal(form.get("model"), "qwen3-asr-0.6b");
  assert.equal(form.get("response_format"), "json");
  assert.equal(form.get("language"), "ja");
  assert.equal(form.get("prompt"), "ドラゴンランス");
  assert.equal(form.get("chunking_strategy"), "auto");
  const wav = Buffer.from(await form.get("file").arrayBuffer());
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.length, 44 + 9600);
});

test("transcribe leaves out options the model does not take", async () => {
  const models = structuredClone(MODELS);
  models.data[1].speech.options = [];
  models.data.pop();
  const { calls, fetchImpl } = server({
    "/v1/models": () => Response.json(models),
    "/v1/audio/transcriptions": () => Response.json({ text: "" }),
  });
  const speech = new SpeechClient("http://speech.invalid", { fetchImpl });
  await speech.models();
  assert.equal(
    await speech.transcribe(Buffer.alloc(2), {
      language: "ja",
      prompt: "x",
      regions: true,
    }),
    "",
  );
  const form = calls.at(-1).init.body;
  assert.equal(form.get("language"), null);
  assert.equal(form.get("prompt"), null);
  assert.equal(form.get("chunking_strategy"), null);
});

test("synthesize returns the PCM and its rate", async () => {
  const { calls, fetchImpl } = server({
    "/v1/models": () => Response.json(MODELS),
    "/v1/audio/speech": () =>
      new Response(Buffer.alloc(480), {
        headers: { "X-Sample-Rate": "24000" },
      }),
  });
  const speech = new SpeechClient("http://speech.invalid", { fetchImpl });
  await speech.models();
  const { pcm, rate } = await speech.synthesize("こんにちは", "ono_anna");
  assert.equal(rate, 24000);
  assert.equal(pcm.length, 480);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
    model: "qwen3-tts-0.6b",
    input: "こんにちは",
    voice: "ono_anna",
    response_format: "pcm",
  });
});

test("server errors carry speech.cpp's message", async () => {
  const { fetchImpl } = server({
    "/v1/models": () => Response.json(MODELS),
    "/v1/audio/speech": () =>
      Response.json(
        { error: { message: "no voice named x\n" } },
        { status: 400 },
      ),
  });
  const speech = new SpeechClient("http://speech.invalid", { fetchImpl });
  await speech.models();
  await assert.rejects(speech.synthesize("a", "x"), {
    message: "音声合成 HTTP 400: no voice named x ",
  });
});

test("a server without the model refuses before any request", async () => {
  const { calls, fetchImpl } = server({
    "/v1/models": () => Response.json({ data: [] }),
  });
  const speech = new SpeechClient("http://speech.invalid", { fetchImpl });
  await speech.models();
  await assert.rejects(
    speech.synthesize("a", "x"),
    /音声合成モデルがありません/,
  );
  await assert.rejects(
    speech.transcribe(Buffer.alloc(2)),
    /音声認識モデルがありません/,
  );
  assert.equal(calls.length, 1);
});
