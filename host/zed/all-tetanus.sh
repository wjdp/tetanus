#!/usr/bin/env bash
# ZED zedlet: forward every ZFS event, as its ZEVENT_* variables, to tetanus as source
# zed-event. ZED runs all-*.sh for every event class, so this never blocks, never fails
# and says nothing: the POST runs in the background and its errors are discarded.

readonly version=0.4.0

config=${TETANUS_CONFIG:-/etc/tetanus/collect.env}
[[ -r $config ]] || exit 0

while IFS= read -r line || [[ -n $line ]]; do
  line=${line%$'\r'}
  [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?(TETANUS_(URL|TOKEN|HOST))=(.*)$ ]] || continue
  key=${BASH_REMATCH[2]}
  value=${BASH_REMATCH[4]}
  if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then
    value=${BASH_REMATCH[1]}
  fi
  [[ -n ${!key:-} ]] || printf -v "$key" '%s' "$value"
done <"$config"

[[ -n ${TETANUS_URL:-} && -n ${TETANUS_TOKEN:-} ]] || exit 0
host=${TETANUS_HOST:-$(hostname -s 2>/dev/null)}
event=$(env | grep '^ZEVENT_')
[[ -n $host && -n $event ]] || exit 0

printf '%s\n' "$event" |
  curl -q --silent --max-time 10 \
    --user-agent "tetanus-zed/$version" \
    --header @<(printf 'Authorization: Bearer %s\nTetanus-Host: %s\n' "$TETANUS_TOKEN" "$host") \
    --header 'Content-Type: text/plain' \
    --data-binary @- \
    --output /dev/null \
    "${TETANUS_URL%/}/api/ingest/zed-event" >/dev/null 2>&1 &

exit 0
