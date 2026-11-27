#!/usr/bin/env bash
set -e

node /app/apps/server/dist/index.js &
SERVER_PID=$!

cd /app/apps/web
PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/apps/web/server.js &
WEB_PID=$!

trap 'kill $SERVER_PID $WEB_PID 2>/dev/null || true' EXIT
wait -n $SERVER_PID $WEB_PID
