#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose -f compose.yaml -f compose.codex.yaml exec -T nestjs-api node scripts/smoke-video-infra.js
docker compose -f compose.yaml -f compose.codex.yaml exec -T video-worker node scripts/worker-health.js
echo 'Video infrastructure smoke passed'
