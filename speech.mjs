import { wavFile, DISCORD_RATE } from "./audio.mjs";

const clean = (text) =>
  String(text)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 300);

async function failure(response, label) {
  let message = "";
  try {
    message = clean((await response.json()).error?.message ?? "");
  } catch {
    /* Keep the HTTP status if the body is not speech.cpp's JSON error. */
  }
  return new Error(
    `${label} HTTP ${response.status}${message ? `: ${message}` : ""}`,
  );
}

// A client of `speech serve`: GET /v1/models, POST /v1/audio/speech and
// POST /v1/audio/transcriptions.
export class SpeechClient {
  constructor(baseUrl, { fetchImpl = fetch, timeoutMs = 120000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
  signal() {
    return AbortSignal.timeout(this.timeoutMs);
  }
  // { synthesis, recognition, detection }: each the model entry or undefined.
  async models() {
    const response = await this.fetch(`${this.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw await failure(response, "モデル一覧");
    const { data } = await response.json();
    const find = (task) =>
      Array.isArray(data)
        ? data.find((m) => m?.speech?.task === task)
        : undefined;
    this.loaded = {
      synthesis: find("synthesis"),
      recognition: find("recognition"),
      detection: find("detection"),
    };
    return this.loaded;
  }
  // The model refuses an option it does not take, so send only those it lists.
  takes(task, name) {
    return !!this.loaded?.[task]?.speech?.options?.some((o) => o.name === name);
  }
  voices() {
    return (this.loaded?.synthesis?.speech?.voices ?? []).map((v) => v.name);
  }
  // Returns mono s16le PCM and its rate.
  async synthesize(text, voice) {
    const model = this.loaded?.synthesis;
    if (!model) throw new Error("speech serveに音声合成モデルがありません");
    const response = await this.fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        input: text,
        voice,
        response_format: "pcm",
      }),
      signal: this.signal(),
    });
    if (!response.ok) throw await failure(response, "音声合成");
    const rate = Number(response.headers.get("X-Sample-Rate"));
    if (!Number.isInteger(rate) || rate < 8000 || rate > 96000)
      throw new Error("音声合成のサンプルレートが不正です");
    return { pcm: Buffer.from(await response.arrayBuffer()), rate };
  }
  // `mono` is 48kHz mono s16le. Returns the recognized text.
  async transcribe(mono, { language, prompt, regions = false } = {}) {
    const model = this.loaded?.recognition;
    if (!model) throw new Error("speech serveに音声認識モデルがありません");
    const form = new FormData();
    form.append(
      "file",
      new Blob([wavFile(mono, DISCORD_RATE)], { type: "audio/wav" }),
      "utterance.wav",
    );
    form.append("model", model.id);
    form.append("response_format", "json");
    if (language && this.takes("recognition", "language"))
      form.append("language", language);
    if (prompt && this.takes("recognition", "prompt"))
      form.append("prompt", prompt);
    if (regions && this.loaded.detection)
      form.append("chunking_strategy", "auto");
    const response = await this.fetch(
      `${this.baseUrl}/v1/audio/transcriptions`,
      { method: "POST", body: form, signal: this.signal() },
    );
    if (!response.ok) throw await failure(response, "音声認識");
    const { text } = await response.json();
    return typeof text === "string" ? text.trim() : "";
  }
}
