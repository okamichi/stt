# Discord STT / TTS

Discordのボイスチャンネルで、参加者ごとの発言を文字起こしし、入力した文章を読み上げるツールです。音声認識と音声合成はローカルのspeech.cppで行います。

## ビルド済みパッケージ

[GitHub Actions](https://github.com/okamichi/stt/actions/workflows/package.yml) の成功した実行からArtifactsをダウンロードします。タグのビルドではGitHub Releasesのドラフトも作成します。

- macOS Apple Silicon: `stt-バージョン-darwin-arm64.zip`
- Windows x64: `stt-バージョン-win32-x64.zip`（CPU版はAVX2対応CPUが必要）

Node.js、Discord依存パッケージ、speech.cppを同梱します。利用者による開発ツールのインストールは不要です。配布フォルダ全体を保管してください。

1. ZIPを書き込み可能なフォルダに展開します。
2. `config.example.json` を `config.json` にコピーし、`token` にBotトークン、`channel` にボイスチャンネルIDを文字列で設定します。
3. macOSでは `stt.command`、Windowsでは `stt.cmd` をターミナルから実行します。
4. 初回はモデルをダウンロードします。既定のモデルは約1.9GBで、展開先の `models/` に保存します。読み込みが終わるとBotが接続します。
5. 文章を入力してEnterを押すと読み上げます。`/voices` で声の一覧、`/voice 名前` で変更、`/quit` またはCtrl+Cで終了します。

ターミナル操作のアプリです。macOS版は公証なし、Windows版は署名なしです。Botトークンを含む `config.json` は公開しないでください。Discord接続と初回モデル取得にはネット接続が必要です。同じBotを別のアプリから同時接続しないでください。文字起こしを始める前に参加者の同意を得てください。

`channel` が空欄ならチャンネル一覧を表示して終了します。環境変数 `DISCORD_BOT_TOKEN` は設定ファイルより優先します。`--channel` 引数も設定ファイルより優先します。

モデルは `config.json` の `ttsModel`、`asrModel`、`vadModel` で変更できます。保存先は環境変数 `SPEECH_MODEL_DIR` で変更できます。モデルごとに利用条件が異なります。モデル重みは配布物に含みません。

`--speech http://127.0.0.1:8080` で外部サーバーを使う場合は、同梱サーバーを起動しません。Windowsの標準起動はCPU版です。同梱の `runtime/speech/speech-vulkan.exe` は手動起動用です。

## 動作

- Discordの音声送り主から話者を識別します。声による話者推定ではありません。
- 無音が既定800ms続くと発言の終わりとみなし、WAVをspeech.cppに送ります。
- 他のBotの音声は文字起こししません。
- 読み上げ中と終了後2秒の発言は、読み上げた文章との一致率が既定50%以上なら回り込みとして除外します。
- 文字起こしと読み上げは、それぞれ順番に処理します。
- `--http 8790` でローカルの `POST /say` から読み上げを依頼できます。JSONは `{"text":"こんにちは","voice":"声の名前"}` です。voiceは省略可能です。

## 開発用起動

Node.js 22.13以上とspeech.cppが必要です。`npm ci` の後、別ターミナルで `./serve.sh` を起動し、`./run.sh --channel ID` でBotを起動します。`run.sh` はトークンを非表示で入力できます。`npm test` で単体テスト、`node stt.mjs --self-test` でDiscord音声依存のロードを検査します。

## パッケージのビルド

対象OS上で `packaging/node-version` のNode.js、CMakeとC++コンパイラを用意します。WindowsはVisual StudioのC++環境、ClangCL、Vulkan SDKが必要です。CIの構成は `.github/workflows/package.yml` にあります。

```sh
npm ci
npm run package:speech
npm test
npm run package:build
npm run package:smoke
```

speech.cppとggmlはコミットとSHA-256を固定しています。CIはZIPとSHA-256ファイルを保存します。スモークテストでは展開したパッケージのDAVE・Opus・暗号処理とspeechコマンドの起動を確認します。Discord実接続と実モデルによる音声品質は別途確認が必要です。

## オプション

| オプション | 説明 |
| --- | --- |
| `--speech URL` | speech serveのURL（既定: `http://127.0.0.1:8080`） |
| `--channel ID` | 入るボイスチャンネルのID。省略すると一覧を表示して終了します |
| `--voice NAME` | 読み上げの声（既定: 音声合成モデルの最初の声） |
| `--language CODE` | 認識の言語（既定: `ja`）。モデルが受け付けない場合は送りません |
| `--prompt TEXT` | 認識のヒント（キャラクター名や呪文名など）。モデルが受け付けない場合は送りません |
| `--vad` | 1つの発言の中を発話検出モデルで区切って認識します |
| `--silence MS` | 発言の終わりとみなす無音の長さ（既定: 800） |
| `--min-seconds N` | これより短い発言は捨てます（既定: 0.4） |
| `--max-seconds N` | これより長く話し続けると、区切って認識します（既定: 30） |
| `--echo-threshold N` | 読み上げの回り込みとみなす一致の割合（0〜1、既定: 0.5）。0で無効です |
| `--log FILE` | 文字起こしをJSON Linesで追記します |
| `--http PORT` | 読み上げをHTTPで受け付けます |
| `--verbose` | 発言の長さと認識にかかった時間、回り込みとして捨てた発言も表示します |
| `--check` | 依存パッケージとspeech serveだけ確認して終了します |

`--log` の1行は次の形です。

```json
{"time":"2026-10-27T12:03:12.345Z","userId":"123456789012345678","name":"たろう","seconds":1.84,"text":"ファイアボールを唱えます"}
```

## Botの権限

チャンネルの表示・接続・発言の権限が必要です。特権intentは使いません。
表示名は、発言した参加者ごとに1回だけDiscordに問い合わせます。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `stt.mjs` | 起動・Discord接続・文字起こし・読み上げ |
| `listen.mjs` | 参加者ごとの音声の受信と、発言の区切り |
| `speech.mjs` | speech serveのAPI呼び出し |
| `audio.mjs` | PCMとWAVの変換 |
| `echo.mjs` | 読み上げの回り込みの判定 |
| `serve.sh` | speech serveの起動 |
| `models/` | speech serveのモデルの保存先（Git対象外） |
| `run.sh` | `stt.mjs` の起動（トークンの入力つき） |
| `*.test.mjs` | `npm test` で動く単体テスト |
