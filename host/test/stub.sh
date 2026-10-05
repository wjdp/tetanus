#!/usr/bin/env bash
# Stands in for zpool, zfs, smartctl, lsblk and cat. Replays the fixture whose manifest
# argv matches this invocation exactly, logging the argv to $STUB_LOG. Unmatched `cat`
# falls through to the real one; anything else unmatched exits 127.

set -uo pipefail

name=${0##*/}
argv="$name $*"
printf '%s\n' "${TZ:+TZ=$TZ }$argv" >>"$STUB_LOG"

replay() {
  local fixture=$STUB_FIXTURES/$1 ext
  for ext in json txt; do
    [[ -e $fixture.$ext ]] && command -p cat "$fixture.$ext"
  done
  exit "$(command -p cat "$fixture.exit")"
}

replay_recorded() {
  local fixture recorded
  while IFS=$'\t' read -r fixture _ recorded; do
    [[ $fixture == \#* ]] && continue
    [[ ${recorded% | tail -n *} == "$1" ]] && replay "$fixture"
  done <"$STUB_FIXTURES/manifest.txt"
}

replay_recorded "$argv"
# Until mars is re-captured with collector 0.7.0's -l farm (docs/083-Seagate-FARM-log.md).
[[ $argv == "smartctl --xall "*" -l farm "* ]] && replay_recorded "${argv/ -l farm/}"

# Until mars is re-captured with collector 0.4.0's commands (docs/015-Replication-health.md).
case $argv in
  "zpool version") replay zfs-version ;;
  "zpool list -H -o name")
    printf 'tank\nzeta\n'
    exit 0
    ;;
  "zpool history -il "*) replay zpool-history ;;
  "zfs list -j -p -t snapshot "*) replay zfs-snapshots ;;
  cat*)
    command -p cat "$@"
    exit
    ;;
esac

echo "stub: no fixture for: $argv" >&2
exit 127
