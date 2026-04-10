#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${API_PORT:-4000}"
BASE_URL="http://127.0.0.1:${PORT}"
HEALTH_URL="${BASE_URL}/api/presentations/health"
EXAMPLE_URL="${BASE_URL}/api/presentations/example"
STARTED_TEMP_SERVER=0
SERVER_PID=""

cleanup() {
  if [[ "${STARTED_TEMP_SERVER}" -eq 1 && -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "${ROOT_DIR}"

if ! curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
  API_PORT="${PORT}" LLM_PROVIDER="${LLM_PROVIDER:-mock}" node --import tsx apps/api/src/server.ts >/tmp/slidespeech-api-verify.log 2>&1 &
  SERVER_PID="$!"
  STARTED_TEMP_SERVER=1

  for _ in {1..40}; do
    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

curl -fsS "${HEALTH_URL}"
echo
curl -fsS "${EXAMPLE_URL}" >/dev/null
echo "Verified SlideSpeech API on fixed port ${PORT}."
