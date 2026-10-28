#!/bin/sh
# speech.cpp の speech serve を、音声合成・音声認識・発話検出のモデルで起動します。
# モデルは stt/models に置きます。ないモデルは初回だけHugging Faceから取得します。
#   SPEECH            speech コマンド（既定: PATH上の speech）
#   SPEECH_MODEL_DIR  モデルの保存先（既定: stt/models）
#   TTS_MODEL         音声合成モデル（既定: qwen3-tts-0.6b）
#   ASR_MODEL         音声認識モデル（既定: qwen3-asr-0.6b）
#   VAD_MODEL         発話検出モデル（既定: silero-vad）
#   PORT              ポート（既定: 8080）
set -eu
SPEECH_MODEL_DIR="${SPEECH_MODEL_DIR:-$(cd "$(dirname "$0")" && pwd)/models}"
export SPEECH_MODEL_DIR
mkdir -p "$SPEECH_MODEL_DIR"
exec "${SPEECH:-speech}" serve \
  "${TTS_MODEL:-qwen3-tts-0.6b}" "${ASR_MODEL:-qwen3-asr-0.6b}" "${VAD_MODEL:-silero-vad}" \
  --host 127.0.0.1 --port "${PORT:-8080}" "$@"
