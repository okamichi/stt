import { appendFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { getCiphers } from "node:crypto";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { SpeechClient } from "./speech.mjs";
import { listen, serial } from "./listen.mjs";
import { EchoGuard } from "./echo.mjs";
import { seconds, toMono, toDiscordPcm } from "./audio.mjs";

const HELP = `使い方: node stt.mjs [オプション]

Discordのボイスチャンネルに入り、参加者ごとに発言を文字起こしします。
入力した文章をspeech.cppで音声にして、同じチャンネルで読み上げます。

トークンは環境変数 DISCORD_BOT_TOKEN から読みます。配布版はconfig.jsonでも設定できます。

  --speech URL         speech serveのURL（既定: http://127.0.0.1:8080）
  --channel ID         入るボイスチャンネルのID。省略すると一覧を表示して終了
  --voice NAME         読み上げの声（既定: 音声合成モデルの最初の声）
  --language CODE      認識の言語（既定: ja）。モデルが受け付けない場合は送らない
  --prompt TEXT        認識のヒント（固有名詞など）。モデルが受け付けない場合は送らない
  --vad                発話の中をspeech serveの発話検出モデルで区切って認識する
  --silence MS         発言の終わりとみなす無音（既定: 800）
  --min-seconds N      これより短い発言は捨てる（既定: 0.4）
  --max-seconds N      これより長い発言は区切って認識する（既定: 30）
  --echo-threshold N   読み上げ中・直後の発言が、読み上げた文章とこの割合以上
                       一致したら回り込みとして捨てる（0〜1、既定: 0.5、0で無効）
  --log FILE           文字起こしをJSON Linesで追記する
  --http PORT          127.0.0.1:PORT で読み上げを受け付ける（POST /say）
  --verbose            発言の長さと認識にかかった時間も表示する
  --check              依存パッケージとspeech serveだけ確認して終了
  -h, --help           この説明`;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let o;
try {
  ({ values: o } = parseArgs({
    options: {
      speech: { type: "string", default: "http://127.0.0.1:8080" },
      channel: { type: "string" },
      voice: { type: "string" },
      language: { type: "string", default: "ja" },
      prompt: { type: "string" },
      vad: { type: "boolean", default: false },
      silence: { type: "string", default: "800" },
      "min-seconds": { type: "string", default: "0.4" },
      "max-seconds": { type: "string", default: "30" },
      "echo-threshold": { type: "string", default: "0.5" },
      log: { type: "string" },
      http: { type: "string" },
      verbose: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      "self-test": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  }));
} catch (error) {
  fail(`${error.message}\n\n${HELP}`);
}
if (o.help) {
  console.log(HELP);
  process.exit(0);
}
const number = (name, min, max) => {
  const value = Number(o[name]);
  if (!Number.isFinite(value) || value < min || value > max)
    fail(`--${name} は${min}〜${max}で指定してください`);
  return value;
};
const silenceMs = number("silence", 100, 10000),
  minSeconds = number("min-seconds", 0, 10),
  maxSeconds = number("max-seconds", 5, 120),
  echoThreshold = number("echo-threshold", 0, 1),
  httpPort = o.http === undefined ? undefined : number("http", 1, 65535);
if (o.channel !== undefined && !/^\d{17,20}$/.test(o.channel))
  fail("--channel にはボイスチャンネルのIDを指定してください");

// Do not print raw library errors: authentication errors can contain secrets.
let stage = "依存パッケージの読み込み（npm ci を実行してください）";
let d, v, OpusScript;
try {
  d = await import("discord.js");
  v = await import("@discordjs/voice");
  await import("@snazzah/davey");
  ({ default: OpusScript } = await import("opusscript"));
  const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO),
    decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  try {
    const pcm = decoder.decode(encoder.encode(Buffer.alloc(960 * 4), 960));
    if (pcm.length !== 960 * 4) throw new Error();
  } finally {
    encoder.delete();
    decoder.delete();
  }
  if (!getCiphers().includes("aes-256-gcm")) throw new Error();
} catch {
  fail(`失敗: ${stage}`);
}
console.log("DAVEロード / Opusエンコード・デコード / AES-256-GCM: OK");

if (o["self-test"]) process.exit(0);

const speech = new SpeechClient(o.speech);
let loaded;
try {
  loaded = await speech.models();
} catch (error) {
  fail(`speech serve（${o.speech}）に接続できません: ${error.message}`);
}
console.log(
  `音声合成: ${loaded.synthesis?.id ?? "なし（読み上げは使えません）"}`,
);
console.log(`音声認識: ${loaded.recognition?.id ?? "なし"}`);
console.log(`発話検出: ${loaded.detection?.id ?? "なし"}`);
if (!loaded.recognition)
  fail("speech serveを音声認識モデルと一緒に起動してください（serve.sh）");
if (o.language && !speech.takes("recognition", "language"))
  console.log(
    "このモデルは言語の指定を受け付けないため、--language は送りません",
  );
if (o.prompt && !speech.takes("recognition", "prompt"))
  console.log("このモデルはヒントを受け付けないため、--prompt は送りません");
if (o.vad && !loaded.detection)
  fail("--vad にはspeech serveの発話検出モデル（silero-vad）が必要です");
const voices = speech.voices();
if (o.voice && !voices.includes(o.voice))
  fail(`声「${o.voice}」がありません。候補: ${voices.join(", ")}`);
let voice = o.voice ?? voices[0];
if (loaded.synthesis) console.log(`読み上げの声: ${voice}`);
if (o.check) process.exit(0);

stage = "トークンの確認（DISCORD_BOT_TOKEN）";
const token = process.env.DISCORD_BOT_TOKEN;
delete process.env.DISCORD_BOT_TOKEN;
if (
  typeof token !== "string" ||
  !token ||
  /\s/.test(token) ||
  token.length > 200
)
  fail(`失敗: ${stage}`);
const channelId = o.channel;

let client, connection, stopListening, lines, server;
let closing = false;
const transcribing = serial(),
  speaking = serial(),
  echo = new EchoGuard({ threshold: echoThreshold });
const shutdown = async (code = 0) => {
  if (closing) return;
  closing = true;
  stopListening?.();
  lines?.close();
  server?.close();
  // Streams flush their last utterance when they close, on a later tick.
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.race([transcribing.idle(), delay(15000)]);
  if (connection && connection.state.status !== "destroyed")
    connection.destroy();
  client?.destroy();
  process.exit(code);
};
process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

try {
  client = new d.Client({
    intents: [d.GatewayIntentBits.Guilds, d.GatewayIntentBits.GuildVoiceStates],
  });
  client.on("error", () => console.error("Discord Gatewayエラー"));
  stage = "ログイン";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("timeout")), 30000);
    const ready = () => done();
    const done = (error) => {
      clearTimeout(timer);
      client.off(d.Events.ClientReady, ready);
      error ? reject(error) : resolve();
    };
    client.once(d.Events.ClientReady, ready);
    client.login(token).catch(done);
  });
  console.log(`Bot: ${client.user.tag}`);

  const needed = [
    d.PermissionFlagsBits.ViewChannel,
    d.PermissionFlagsBits.Connect,
    d.PermissionFlagsBits.Speak,
  ];
  if (!channelId) {
    stage = "チャンネル一覧の取得";
    for (const guild of client.guilds.cache.values()) {
      await guild.channels.fetch();
      const me = await guild.members.fetchMe();
      for (const ch of guild.channels.cache.values())
        if (ch.type === d.ChannelType.GuildVoice)
          console.log(
            `${guild.name} / ${ch.name}: ${ch.id}${ch.permissionsFor(me)?.has(needed) ? "" : "（権限がありません）"}`,
          );
    }
    console.log("--channel にIDを指定して実行してください。");
    await shutdown(0);
  }

  stage = "チャンネルの確認";
  const channel = await client.channels.fetch(channelId);
  if (channel?.type !== d.ChannelType.GuildVoice) throw new Error();
  const guild = channel.guild;
  if (!channel.permissionsFor(await guild.members.fetchMe())?.has(needed))
    throw new Error();

  stage = "ボイス接続";
  connection = v.joinVoiceChannel({
    guildId: guild.id,
    channelId: channel.id,
    adapterCreator: guild.voiceAdapterCreator,
    // A deafened member is sent no audio, so the bot must not deafen itself.
    selfDeaf: false,
    selfMute: false,
  });
  connection.on("error", () => console.error("ボイス接続エラー"));
  connection.on(v.VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        v.entersState(connection, v.VoiceConnectionStatus.Signalling, 5000),
        v.entersState(connection, v.VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      console.error("ボイスチャンネルから切断されました");
      shutdown(1);
    }
  });
  await v.entersState(connection, v.VoiceConnectionStatus.Ready, 30000);
  console.log(`入室: ${guild.name} / ${channel.name}`);

  const names = new Map();
  const speakerName = (userId) => {
    if (!names.has(userId))
      names.set(
        userId,
        guild.members.fetch(userId).then(
          (member) => member.displayName,
          () => userId,
        ),
      );
    return names.get(userId);
  };
  const clock = (date) => date.toLocaleTimeString("ja-JP", { hour12: false });
  stopListening = listen(connection.receiver, {
    decoder: () => new OpusScript(48000, 2, OpusScript.Application.AUDIO),
    endBehavior: v.EndBehaviorType.AfterSilence,
    silenceMs,
    maxSeconds,
    // The bot itself, and other bots such as a reading bot in the same
    // channel, are not players.
    ignore: (userId) =>
      userId === client.user.id || !!guild.members.cache.get(userId)?.user.bot,
    onError: () => {
      if (o.verbose) console.error("受信できないパケットがありました");
    },
    onUtterance: ({ userId, startedAt, pcm }) => {
      const length = seconds(pcm),
        endedAt = new Date();
      if (length < minSeconds) return;
      transcribing(async () => {
        const began = performance.now();
        const text = await speech.transcribe(toMono(pcm), {
          language: o.language,
          prompt: o.prompt,
          regions: o.vad,
        });
        const took = (performance.now() - began) / 1000;
        if (!text) return;
        const name = await speakerName(userId);
        if (echo.echoes(text, startedAt, endedAt)) {
          if (o.verbose)
            console.log(
              `（読み上げの回り込みとして除外）[${clock(startedAt)}] ${name}: ${text}`,
            );
          return;
        }
        console.log(
          `[${clock(startedAt)}] ${name}: ${text}${o.verbose ? `（発言 ${length.toFixed(1)}秒 / 認識 ${took.toFixed(2)}秒）` : ""}`,
        );
        if (o.log)
          await appendFile(
            o.log,
            `${JSON.stringify({ time: startedAt.toISOString(), userId, name, seconds: Number(length.toFixed(2)), text })}\n`,
          );
      }).catch((error) => console.error(`文字起こし失敗: ${error.message}`));
      if (transcribing.size() > 5)
        console.error(`文字起こし待ち: ${transcribing.size()}件`);
    },
  });

  const player = v.createAudioPlayer();
  player.on("error", () => console.error("音声再生エラー"));
  if (!connection.subscribe(player)) throw new Error();
  const play = (pcm) =>
    new Promise((resolve, reject) => {
      const idle = () => done(),
        error = (e) => done(e);
      const done = (e) => {
        player.off(v.AudioPlayerStatus.Idle, idle);
        player.off("error", error);
        e ? reject(e) : resolve();
      };
      player.once("error", error);
      player.play(
        v.createAudioResource(Readable.from([pcm]), {
          inputType: v.StreamType.Raw,
        }),
      );
      player.once(v.AudioPlayerStatus.Idle, idle);
    });
  // Returns an error message, or queues the text and returns undefined.
  const say = (text, chosen = voice) => {
    if (!loaded.synthesis) return "音声合成モデルがありません";
    text = String(text ?? "").trim();
    if (!text || text.length > 500) return "文章は1〜500文字にしてください";
    if (!voices.includes(chosen)) return `声「${chosen}」がありません`;
    speaking(async () => {
      const { pcm, rate } = await speech.synthesize(text, chosen);
      const reading = echo.playing(text);
      try {
        await play(toDiscordPcm(pcm, rate));
      } finally {
        reading.end();
      }
    }).catch((error) => console.error(`読み上げ失敗: ${error.message}`));
  };

  lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const [command, ...rest] = line.trim().split(/\s+/);
    if (command === "/quit") return shutdown(0);
    if (command === "/voices") return console.log(voices.join(", "));
    if (command === "/voice") {
      if (!voices.includes(rest[0]))
        return console.log(`候補: ${voices.join(", ")}`);
      voice = rest[0];
      return console.log(`読み上げの声: ${voice}`);
    }
    if (line.trim()) {
      const problem = say(line);
      if (problem) console.error(problem);
    }
  });
  if (process.stdin.isTTY)
    console.log(
      "入力した行を読み上げます。/voice 名前 で声を変更、/voices で一覧、/quit で終了。",
    );

  if (httpPort) {
    server = createServer((req, res) => {
      const reply = (status, body) => {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(body));
      };
      // Only local programs may ask; a web page in a browser may not.
      if (req.headers.origin)
        return reply(403, { error: "ブラウザからの要求は受け付けません" });
      if (req.method !== "POST" || req.url !== "/say")
        return reply(404, { error: "POST /say だけを受け付けます" });
      if (!/^application\/json\b/i.test(req.headers["content-type"] ?? ""))
        return reply(415, {
          error: "Content-Type: application/json で送ってください",
        });
      const chunks = [];
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 16384) req.destroy();
        else chunks.push(chunk);
      });
      req.on("end", () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return reply(400, { error: "JSONが不正です" });
        }
        const problem = say(body?.text, body?.voice ?? voice);
        if (problem) return reply(400, { error: problem });
        reply(202, { queued: speaking.size() });
      });
    });
    server.on("error", () => {
      console.error(`127.0.0.1:${httpPort} で待ち受けできません`);
      shutdown(1);
    });
    server.listen(httpPort, "127.0.0.1", () =>
      console.log(`読み上げ受付: POST http://127.0.0.1:${httpPort}/say`),
    );
  }
  console.log("文字起こしを始めます。Ctrl+Cで退出します。");
} catch {
  console.error(
    `失敗: ${stage}。トークン・チャンネルID・権限・ネットワークを確認してください。`,
  );
  await shutdown(1);
}
