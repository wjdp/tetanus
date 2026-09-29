#!/usr/bin/env bash
# Refresh the vendored nasdisks.com drive spec snapshot. A refresh is a commit.
# Usage: bin/update-drive-db.sh
set -euo pipefail
url=https://www.nasdisks.com/data/drives.json
out=$(cd "$(dirname "$0")/../server/services/drive-db" && pwd)/nasdisks.json
snapshot=$(date -u +%F)

raw=$(mktemp)
trap 'rm -f "$raw"' EXIT
curl -sSfL "$url" -o "$raw"

jq -S --arg snapshot "$snapshot" '{
  source: "nasdisks",
  snapshot: $snapshot,
  url: .url,
  licence: .license,
  licence_url: .license_url,
  licence_scope: .license_scope,
  attribution: .attribution,
  reliability: (.reliability | {source, terms, terms_url}),
  drives: (.drives
    | map(del(.acoustic_idle_db, .acoustic_seek_db,
              .reliability_drive_days, .reliability_failures))
    | sort_by(.model))
}' "$raw" | jq -r '
  (to_entries | map(select(.key != "drives"))
    | map("  \(.key | tojson): \(.value | tojson),") | .[]),
  "  \"drives\": [",
  (.drives | map("    \(tojson)") | join(",\n")),
  "  ]"
' | { echo "{"; cat; echo "}"; } > "$out.tmp"

jq -e '.drives | length > 0' "$out.tmp" > /dev/null
mv "$out.tmp" "$out"
echo "$(jq '.drives | length' "$out") drives, snapshot $snapshot → $out"
