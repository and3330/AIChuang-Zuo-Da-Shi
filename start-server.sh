#!/bin/bash
export NODE_ENV=production

fuser -k 5000/tcp 2>/dev/null || true
sleep 1

cd /home/runner/workspace

start_server() {
  setsid node dist/index.js </dev/null >/dev/null 2>&1 &
  echo $!
}

SERVER_PID=$(start_server)
echo "Server started (PID: $SERVER_PID)"

while true; do
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "Server exited, restarting..."
    sleep 2
    SERVER_PID=$(start_server)
    echo "Restarted (PID: $SERVER_PID)"
  fi
  sleep 3
done
