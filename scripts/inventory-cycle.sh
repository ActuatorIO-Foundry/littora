#!/bin/sh
set -eu
umask 077
cli=apps/api/scripts/amenities.cjs
while :; do
  # A restart on the same day must not trigger a second national download.
  if [ ! -f /cache/cycle.ok ] || [ "$(date -u +%F)" != "$(cat /cache/cycle.ok)" ] || [ -f /cache/cycle.failed ]; then
    status=0
    if node "$cli" sites > /cache/sites.tmp && mv /cache/sites.tmp /cache/sites.json; then
      : > /cache/manifest
      python3 scripts/territory-inventories.py --sites /cache/sites.json --cache /cache --manifest /cache/manifest || status=1
      while IFS= read -r file; do
        node "$cli" region-apply < "$file" || status=1
      done < /cache/manifest
      node "$cli" coverage || status=1
    else
      status=1
    fi
    if [ "$status" = 0 ]; then
      date -u +%F > /cache/cycle.tmp && mv /cache/cycle.tmp /cache/cycle.ok
      rm -f /cache/cycle.failed
    else
      date -u > /cache/cycle.failed
      echo 'Inventory incomplete: check region errors and coverage.' >&2
      sleep 21600
    fi
  fi
  sleep 3600
done
