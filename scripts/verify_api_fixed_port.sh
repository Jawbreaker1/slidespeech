#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${API_PORT:-4000}"
BASE_URL="http://127.0.0.1:${PORT}"
HEALTH_URL="${BASE_URL}/api/presentations/health"
LIST_URL="${BASE_URL}/api/presentations"
REQUIRE_LLM_HEALTH="${REQUIRE_LLM_HEALTH:-0}"
STARTED_TEMP_SERVER=0
SERVER_PID=""
HEALTH_JSON_FILE=""

cleanup() {
  if [[ "${STARTED_TEMP_SERVER}" -eq 1 && -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${HEALTH_JSON_FILE}" && -f "${HEALTH_JSON_FILE}" ]]; then
    rm -f "${HEALTH_JSON_FILE}"
  fi
}

trap cleanup EXIT INT TERM

cd "${ROOT_DIR}"

if ! curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
  API_PORT="${PORT}" LLM_PROVIDER="${LLM_PROVIDER:-lmstudio}" node --import tsx apps/api/src/server.ts >/tmp/slidespeech-api-verify.log 2>&1 &
  SERVER_PID="$!"
  STARTED_TEMP_SERVER=1

  for _ in {1..40}; do
    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

HEALTH_JSON_FILE="$(mktemp)"
curl -fsS "${HEALTH_URL}" | tee "${HEALTH_JSON_FILE}"
echo

if [[ "${REQUIRE_LLM_HEALTH}" == "1" || "${REQUIRE_LLM_HEALTH}" == "true" ]]; then
  node -e '
const { readFileSync } = require("node:fs");
const health = JSON.parse(readFileSync(process.argv[1], "utf8"));
if (!health.llmHealth || health.llmHealth.ok !== true) {
  const detail = health.llmHealth?.detail ?? "LLM health is missing from API health response.";
  console.error(`LLM provider is not ready: ${detail}`);
  process.exit(1);
}
' "${HEALTH_JSON_FILE}"
fi

curl -fsS "${LIST_URL}?limit=1&readyOnly=false" >/dev/null
if [[ "${REQUIRE_LLM_HEALTH}" == "1" || "${REQUIRE_LLM_HEALTH}" == "true" ]]; then
  echo "Verified SlideSpeech API and LLM provider on fixed port ${PORT}."
else
  echo "Verified SlideSpeech API on fixed port ${PORT}."
fi
