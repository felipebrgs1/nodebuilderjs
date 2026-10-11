#!/usr/bin/env sh
# Usage: scripts/measure.sh <label> <file.tsx> [seconds]   (env vars pass through)
# Samples CPU% and memory of the app process from /proc after a 2s warm-up.
set -eu
LABEL=$1; FILE=$2; SECS=${3:-5}
BUN=$(bun -e 'console.log(process.execPath)')
LOG=$(mktemp)
NB_STATS=1 "$BUN" "$FILE" >"$LOG" 2>&1 &
PID=$!
sleep 2
ticks() { awk '{print $14 + $15}' /proc/$PID/stat; }
T0=$(ticks); sleep "$SECS"; T1=$(ticks)
HZ=$(getconf CLK_TCK)
CPU=$(awk -v a="$T0" -v b="$T1" -v hz="$HZ" -v s="$SECS" 'BEGIN { printf "%.1f", (b - a) / hz / s * 100 }')
RSS=$(awk '/^VmRSS/ {printf "%.0f", $2/1024}' /proc/$PID/status)
PSS=$(awk '/^Pss:/ {printf "%.0f", $2/1024}' /proc/$PID/smaps_rollup)
THREADS=$(awk '/^Threads/ {print $2}' /proc/$PID/status)
kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
printf '%-34s CPU %5s%%  RSS %4s MB  PSS %4s MB  threads %s\n' "$LABEL" "$CPU" "$RSS" "$PSS" "$THREADS"
grep '^fps' "$LOG" | tail -2 | sed 's/^/    /'
grep -iv '^fps' "$LOG" | head -5 | sed 's/^/    ! /'
rm -f "$LOG"
