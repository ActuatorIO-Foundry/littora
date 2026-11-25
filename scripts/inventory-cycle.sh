#!/bin/sh
set -eu
umask 077
cli=apps/api/scripts/amenities.cjs
cache=${INVENTORY_CACHE_DIR:-/cache}
while :; do
  if [ -f "$cache/cycle.failed" ] && [ -s "$cache/cycle.retry" ]; then
    read -r when previous < "$cache/cycle.retry" || previous=
    case "$previous" in 900|1800|3600|7200|14400|21600) ;; *) previous=0 ;; esac
    case "$when" in ''|*[!0-9]*) when=0 ;; esac
    now=$(date -u +%s)
    if [ "$when" -gt "$now" ] && [ "$previous" -gt 0 ]; then
      wait_for=$((when - now))
      # Clamp the wait if the clock moved backwards.
      if [ "$wait_for" -gt "$previous" ]; then wait_for=$previous; fi
      sleep "$wait_for"
    fi
  else
    previous=0
  fi
  if [ ! -f "$cache/cycle.ok" ] || [ "$(date -u +%F)" != "$(cat "$cache/cycle.ok")" ] || [ -f "$cache/cycle.failed" ]; then
    status=0
    if node "$cli" sites > "$cache/sites.tmp" && mv "$cache/sites.tmp" "$cache/sites.json"; then
      : > "$cache/manifest"
      python3 scripts/territory-inventories.py --sites "$cache/sites.json" --cache "$cache" --manifest "$cache/manifest" || status=$?
      while IFS= read -r file; do
        node "$cli" region-apply < "$file" || status=1
      done < "$cache/manifest"
      node "$cli" coverage || status=1
    else
      status=1
    fi
    if [ "$status" = 0 ]; then
      date -u +%F > "$cache/cycle.tmp" && mv "$cache/cycle.tmp" "$cache/cycle.ok"
      rm -f "$cache/cycle.failed" "$cache/cycle.retry"
    else
      delay=21600
      if [ "$status" = 75 ]; then
        delay=$((previous * 2))
        if [ "$delay" -lt 900 ]; then delay=900; fi
        if [ "$delay" -gt 21600 ]; then delay=21600; fi
      fi
      date -u > "$cache/cycle.failed"
      printf '%s %s\n' "$(( $(date -u +%s) + delay ))" "$delay" > "$cache/cycle.tmp"
      mv "$cache/cycle.tmp" "$cache/cycle.retry"
      printf '{"event":"inventory_cycle_incomplete","retrySeconds":%s}\n' "$delay" >&2
      continue
    fi
  fi
  sleep 3600
done
