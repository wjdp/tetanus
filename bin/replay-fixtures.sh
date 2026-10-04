#!/usr/bin/env bash
# Replay the mars fixtures into a running tetanus server, in collector order.
# Usage: bin/replay-fixtures.sh [url] [host]   (token is read from /api/settings)
set -euo pipefail
url=${1:-http://localhost:3000}
host=${2:-mars}
fixtures=$(cd "$(dirname "$0")/../test/fixtures" && pwd)
token=$(curl -sf "$url/api/settings" | jq -r '.enrolToken // empty')
echo ${url:?} ${host:?} ${token:?}

post() {
  local source=$1 query=$2 file=$3
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url/api/ingest/$source$query" \
    -H "Authorization: Bearer $token" -H "Tetanus-Host: $host" \
    -H "Content-Type: text/plain" --data-binary @"$file")
  printf '%s %s%s\n' "$code" "$source" "$query"
}

m=$fixtures/mars
post versions "" <(printf 'zfs=%s\nsmartctl=%s\n' \
  "$(head -1 "$m/zfs-version.txt" | sed 's/^zfs-//')" \
  "$(head -1 "$m/smartctl-version.txt" | awk '{print $2}')")
post lsblk "" "$m/lsblk.json"
for u in "$m"/udev/*.txt; do post udev "?device=$(basename "$u" .txt)" "$u"; done
[[ -e $m/enclosure.txt ]] && post enclosure "" "$m/enclosure.txt"
post vdev-id-conf "" "$m/vdev-id-conf.txt"
post smartctl-scan "" "$m/smartctl-scan.json"
for x in "$m"/smartctl/xall-*-auto.json "$m"/smartctl/xall-nvme0.json; do
  dev=$(basename "$x" .json | sed 's/^xall-//; s/-auto$//')
  post smartctl-xall "?device=/dev/$dev&exitStatus=$(cat "${x%.json}.exit")" "$x"
done
post zpool-status "" "$m/zpool-status-stored-paths.json"
post zpool-list "" "$m/zpool-list.json"
post zfs-list "" "$m/zfs-list.json"
post zfs-snapshots "" "$m/zfs-snapshots.json"
post zpool-events "" "$m/zpool-events.txt"
# Captures from collector 0.4.0 on are per pool, each file a pool's tail without its header.
per_pool_history() {
  local file
  for file in "$1"/*.txt; do
    printf "History for '%s':\n" "$(basename "$file" .txt)"
    cat "$file"
  done
}
if [[ -d $m/zpool-history ]]; then
  post zpool-history "" <(per_pool_history "$m/zpool-history")
  post zfs-receives "" <(per_pool_history "$m/zfs-receives")
else
  post zpool-history "" "$m/zpool-history.txt"
fi
post zpool-events "" "$fixtures/events/q2-failure-2025-05.txt"
