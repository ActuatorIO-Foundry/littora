#!/bin/sh
# The daemon remains PID 1. Its private stream is consumed in memory, never copied to a file.
set -eu
kind=${1:-}
case "$kind" in
  postgres)
    set -- docker-entrypoint.sh "$@" -c logging_collector=off -c log_destination=stderr \
      -c 'log_line_prefix=littora-db ' -c log_statement=none -c log_min_error_statement=panic \
      -c log_parameter_max_length_on_error=0 -c log_parameter_max_length=0 ;;
  redis-server)
    set -- docker-entrypoint.sh "$@" --logfile "" --slowlog-log-slower-than -1 --acllog-max-len 0 ;;
  nginx) set -- /docker-entrypoint.sh "$@" ;;
  caddy|npm) ;;
  *) echo '{"event":"unsupported_daemon"}' >&2; exit 1 ;;
esac
dir=$(mktemp -d)
fifo=$dir/stream
mkfifo -m 600 "$fifo"
awk -v service="$kind" '
  function event(name) { print "{\"event\":\"" name "\"}"; fflush() }
  service == "postgres" && /^littora-db ERROR:/ { event("database_error"); next }
  service == "postgres" && /^littora-db (FATAL|PANIC):/ { event("database_fatal"); next }
  service == "postgres" && /^littora-db WARNING:/ { event("database_warning"); next }
  service == "postgres" && /Error: Database is uninitialized/ { event("database_configuration_failed"); next }
  service == "postgres" && /database system is ready to accept connections/ { event("database_ready"); next }
  service == "redis-server" && /Ready to accept connections/ { event("redis_ready"); next }
  service == "redis-server" && /FATAL CONFIG FILE ERROR/ { event("redis_configuration_failed"); next }
  service == "redis-server" && / # / { event("redis_warning"); next }
  service == "caddy" && /"level":"(error|warn|fatal|panic)"/ { event("proxy_warning"); next }
  service == "caddy" && /serving initial configuration/ { event("proxy_ready"); next }
  service == "caddy" && /^Error:/ { event("proxy_configuration_failed"); next }
  service == "nginx" && /^web_status [1-5][0-9][0-9]$/ { print "{\"event\":\"web_response\",\"status\":" $2 "}"; fflush(); next }
  service == "nginx" && /\[(error|crit|alert|emerg|warn)\]/ { event("web_warning"); next }
  service == "npm" && /[Ee]rror|failed/ { event("dev_web_error"); next }
  service == "npm" && /Application bundle generation complete|Local:/ { event("dev_web_ready"); next }
' < "$fifo" &
{
  rm -f "$fifo"
  rmdir "$dir"
  exec "$@"
} > "$fifo" 2>&1
