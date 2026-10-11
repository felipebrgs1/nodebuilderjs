#!/usr/bin/env bash
# Usage: scripts/compare.sh <label> <warmup-s> <sample-s> -- <command...>
# Measures the whole process tree (Electron runs several processes):
# CPU% (100% = one core), summed PSS (shared pages split fairly) and summed RSS.
set -euo pipefail
LABEL=$1; WARM=$2; SECS=$3; shift 4
LOG=$(mktemp)
NB_STATS=1 "$@" >"$LOG" 2>&1 &
ROOT=$!
tree() { echo "$1"; for c in $(pgrep -P "$1" || true); do tree "$c"; done; }
ticks() { for p in $(tree "$ROOT"); do [ -r /proc/$p/stat ] && awk -v p="$p" '{print p, $14 + $15}' /proc/$p/stat; done 2>/dev/null || true; }
sleep "$WARM"
declare -A T0
while read -r p t; do T0[$p]=$t; done < <(ticks)
sleep "$SECS"
SUM=0
while read -r p t; do SUM=$((SUM + t - ${T0[$p]:-0})); done < <(ticks)
PIDS=$(tree "$ROOT")
PSS=0; RSS=0; N=0
for p in $PIDS; do
  [ -r /proc/$p/smaps_rollup ] || continue
  PSS=$((PSS + $(awk '/^Pss:/ {print $2}' /proc/$p/smaps_rollup)))
  RSS=$((RSS + $(awk '/^Rss:/ {print $2}' /proc/$p/smaps_rollup)))
  N=$((N + 1))
done
kill $(tac <<<"$PIDS") 2>/dev/null || true
wait "$ROOT" 2>/dev/null || true
CPU=$(awk -v t="$SUM" -v hz="$(getconf CLK_TCK)" -v s="$SECS" 'BEGIN { printf "%.1f", t / hz / s * 100 }')
FPS=$( (grep -o '^fps *[0-9]*' "$LOG" || true) | awk '{s += $2; n++} END {if (n) printf "%.0f", s / n; else print "-"}')
printf '%-42s fps %4s | CPU %6s%% | PSS %4d MB | RSS(soma) %4d MB | %d processos\n' "$LABEL" "$FPS" "$CPU" $((PSS / 1024)) $((RSS / 1024)) "$N"
rm -f "$LOG"
