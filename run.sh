#!/bin/sh
# stt.mjs を起動します。引数はそのまま stt.mjs に渡します（./run.sh --help）。
# DISCORD_BOT_TOKEN がなければ、トークンを画面に出さずに尋ねます。
set -eu
cd "$(dirname "$0")"
[ -d node_modules ] || npm ci
case " $* " in
  *" --check "* | *" --help "* | *" -h "*) ;;
  *)
    if [ -z "${DISCORD_BOT_TOKEN:-}" ]; then
      if [ ! -t 0 ]; then
        echo "DISCORD_BOT_TOKEN を設定してください" >&2
        exit 1
      fi
      printf 'Bot token: '
      stty -echo
      trap 'stty echo' EXIT INT TERM
      read -r DISCORD_BOT_TOKEN
      stty echo
      trap - EXIT INT TERM
      echo
      export DISCORD_BOT_TOKEN
    fi
    ;;
esac
exec node stt.mjs "$@"
