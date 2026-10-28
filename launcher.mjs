import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { once } from "node:events";
const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const suffix = process.platform === "win32" ? ".exe" : "";
let helper,
  bot,
  stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (bot && bot.exitCode === null && bot.signalCode === null) {
    bot.kill("SIGTERM");
    await Promise.race([
      once(bot, "exit"),
      new Promise((r) => setTimeout(r, 17000)),
    ]);
    if (bot.exitCode === null && bot.signalCode === null) bot.kill("SIGKILL");
  }
  if (helper?.pid && helper.exitCode === null && helper.signalCode === null) {
    helper.stdin.end("Q");
    await once(helper, "exit");
  }
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
try {
  let config = {};
  try {
    config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT")
      throw Error("config.jsonを読み込めません。JSON形式を確認してください。");
  }
  const simple = args.some((a) => ["--help", "-h", "--self-test"].includes(a));
  const external = args.some(
    (a) => a === "--speech" || a.startsWith("--speech="),
  );
  const env = { ...process.env };
  if (!simple && !args.includes("--check") && !env.DISCORD_BOT_TOKEN) {
    if (!config.token)
      throw Error(
        "config.example.jsonをconfig.jsonにコピーしてBotトークンとチャンネルを設定してください。",
      );
    env.DISCORD_BOT_TOKEN = config.token;
  }
  if (
    config.channel &&
    !args.some((a) => a === "--channel" || a.startsWith("--channel="))
  )
    args.push("--channel", String(config.channel));
  if (!simple && !external) {
    const data = join(root, "data");
    await mkdir(data, { recursive: true });
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    await new Promise((r) => server.close(r));
    const runtime = join(root, "runtime/speech");
    helper = spawn(
      join(runtime, `stt-supervisor${suffix}`),
      [
        join(data, "speech.lock"),
        "--listen-port",
        String(port),
        join(runtime, `speech${suffix}`),
        "serve",
        config.ttsModel || "qwen3-tts-0.6b",
        config.asrModel || "qwen3-asr-0.6b",
        config.vadModel || "silero-vad",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        env: {
          ...process.env,
          SPEECH_MODEL_DIR:
            process.env.SPEECH_MODEL_DIR || join(root, "models"),
        },
        stdio: ["pipe", "pipe", "inherit"],
      },
    );
    helper.stdin.on("error", () => {});
    const events = createInterface({ input: helper.stdout });
    console.log(
      "音声サーバーを起動しています。初回はモデルをダウンロードします。",
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("音声サーバーの起動がタイムアウトしました。")),
        30 * 60 * 1000,
      );
      const fail = () => {
        clearTimeout(timer);
        reject(Error("音声サーバーを起動できませんでした。"));
      };
      helper.once("error", fail);
      helper.once("exit", fail);
      events.on("line", (line) => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.event === "locked") helper.stdin.write("S");
        if (["lock-error", "spawn-error", "exited"].includes(event.event))
          fail();
        if (event.event === "listening") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const url = `http://127.0.0.1:${port}`;
    const response = await fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error("音声サーバーのモデルを確認できませんでした。");
    args.push("--speech", url);
    helper.on("exit", () => {
      if (!stopping) {
        console.error("音声サーバーが終了しました。");
        void stop(1);
      }
    });
  }
  if (!stopping) {
    bot = spawn(process.execPath, [join(root, "stt.mjs"), ...args], {
      env,
      stdio: "inherit",
    });
    bot.on("error", () => {
      console.error("Botを起動できませんでした。");
      void stop(1);
    });
    bot.on("exit", (code) => void stop(code ?? 1));
  }
} catch (error) {
  console.error(error.message);
  await stop(1);
}
