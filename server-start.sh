#!/bin/bash
while true; do
  NODE_ENV=production node dist/index.js
  echo "[RESTART] Server exited with code $?, restarting in 1 second..."
  sleep 1
done
