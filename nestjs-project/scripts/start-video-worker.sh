#!/bin/sh
set -eu
exec ./node_modules/.bin/ts-node -r tsconfig-paths/register src/video-worker.ts
