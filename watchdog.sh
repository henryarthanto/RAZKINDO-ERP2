#!/bin/bash
# Keep the dev server running - restart if it dies
LOG=/home/z/my-project/dev.log
while true; do
  if ! ss -tlnp 2>/dev/null | grep -q ":3000 "; then
    echo "[$(date)] Starting dev server..." >> $LOG
    cd /home/z/my-project
    rm -rf .next
    node --max-old-space-size=4096 node_modules/.bin/next dev -p 3000 --webpack >> $LOG 2>&1 &
    # Wait for it to be ready
    for i in $(seq 1 30); do
      if ss -tlnp 2>/dev/null | grep -q ":3000 "; then
        echo "[$(date)] Dev server ready" >> $LOG
        break
      fi
      sleep 1
    done
  fi
  sleep 5
done
