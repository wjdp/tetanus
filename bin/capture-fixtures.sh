#!/usr/bin/env bash
# Capture read-only fixtures from a ZFS host, then scrub identifiers.
#
# Usage: sudo bin/capture-fixtures.sh [out-dir]   (default: test/fixtures/mars)
#
# Raw output goes to a private staging dir <out-dir>.raw.XXXXXX, which is scrubbed into
# <out-dir> by bin/scrub-fixtures.py and deleted on success. Each command yields
# <name>.<json|txt>, <name>.exit, and <name>.stderr when stderr was non-empty.
#
# Deviation from docs/004 Phase 0: smartctl --xall is captured for every disk from
# `smartctl --scan`, not one per model family. It is a superset, and `-n standby` means
# sleeping disks are skipped (exit 2) rather than spun up. Where the scan reports plain
# `-d scsi` (usual for SATA behind a SAS HBA, since --scan does not open devices), an
# auto-detected run without `-d` is also captured as xall-<dev>-auto.json so the SAT
# payload is not lost.
#
# Non-zero exits are data (smartctl exit status is a bitmask), so there is no `set -e`.

set -uo pipefail

unset ZPOOL_VDEV_NAME_PATH ZPOOL_VDEV_NAME_GUID ZPOOL_VDEV_NAME_FOLLOW_LINKS
export LC_ALL=C

if [[ $EUID -ne 0 ]]; then
  echo "capture-fixtures: must run as root (sudo $0 [out-dir])" >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
out_dir=${1:-$repo_root/test/fixtures/mars}
out_dir=${out_dir%/}

if [[ -e $out_dir && -n $(ls -A "$out_dir" 2>/dev/null) ]]; then
  echo "capture-fixtures: $out_dir is not empty; remove it first" >&2
  exit 1
fi

mkdir -p "$(dirname "$out_dir")"
raw=$(mktemp -d "$out_dir.raw.XXXXXX") || exit 1
manifest=$raw/manifest.txt
printf '# captured %s\n# name\texit\targv\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$manifest"

record() {
  local name=$1 status=$2 argv=$3
  echo "$status" >"$raw/$name.exit"
  [[ -s $raw/$name.stderr ]] || rm -f "$raw/$name.stderr"
  printf '%s\t%s\t%s\n' "$name" "$status" "$argv" >>"$manifest"
}

quote_argv() {
  local word quoted=()
  for word in "$@"; do
    if [[ $word =~ ^[A-Za-z0-9_./:,=@%+-]+$ ]]; then
      quoted+=("$word")
    else
      quoted+=("$(printf '%q' "$word")")
    fi
  done
  echo "${quoted[*]}"
}

capture() {
  local name=$1 ext=$2
  shift 2
  mkdir -p "$(dirname "$raw/$name")"
  "$@" >"$raw/$name.$ext" 2>"$raw/$name.stderr"
  local status=$?
  record "$name" "$status" "$(quote_argv "$@")"
}

capture_tail() {
  local name=$1 lines=$2
  shift 2
  "$@" 2>"$raw/$name.stderr" | tail -n "$lines" >"$raw/$name.txt"
  local status=${PIPESTATUS[0]}
  record "$name" "$status" "$(quote_argv "$@") | tail -n $lines"
}

capture zfs-version txt zfs version
capture smartctl-version txt smartctl --version
capture lsb-release txt lsb_release -a
capture uname txt uname -a

capture zpool-status json zpool status -j --json-flat-vdevs --json-int -PLpvs
capture zpool-status-nested json zpool status -j --json-int -PLpvs
capture zpool-status-stored-paths json zpool status -j --json-flat-vdevs --json-int -Ppvs
capture zpool-status-guids json zpool status -j --json-flat-vdevs --json-int -gpvs
capture zpool-status-text txt zpool status -PLpvs
capture zpool-list json zpool list -j --json-int -pv
capture zpool-iostat txt zpool iostat -vpl 1 2
capture zfs-list json zfs list -j --json-int -p -t filesystem,volume \
  -o name,type,used,referenced,available,logicalused,logicalreferenced,compressratio,refcompressratio,written,usedbysnapshots,usedbydataset,usedbychildren,quota,refquota,reservation,mountpoint,creation,recordsize,compression,encryption
capture zfs-snapshots json zfs list -j --json-int -p -t snapshot \
  -o name,guid,used,referenced,written,creation -s creation
capture_tail zpool-history 500 zpool history -il
capture zpool-events txt zpool events -vH

capture vdev-id-conf txt cat /etc/zfs/vdev_id.conf
capture by-vdev txt ls -l /dev/disk/by-vdev
capture by-id txt ls -l /dev/disk/by-id
capture lsblk json lsblk -J -b -o NAME,TYPE,SIZE,MODEL,SERIAL,WWN,TRAN,ROTA,MAJ:MIN,PATH,PTTYPE,PARTUUID,FSTYPE

list_disk_and_part_devnums() {
  python3 -c '
import json, sys
def walk(devices):
    for device in devices:
        if device.get("type") in ("disk", "part") and device.get("maj:min"):
            print(device["maj:min"])
        walk(device.get("children") or [])
try:
    walk(json.load(sys.stdin).get("blockdevices") or [])
except ValueError:
    pass
' <"$raw/lsblk.json"
}

while IFS=: read -r major minor; do
  capture "udev/b$major-$minor" txt cat "/run/udev/data/b$major:$minor"
done < <(list_disk_and_part_devnums)

capture smartctl-scan json smartctl --scan --json

list_scanned_devices() {
  python3 -c '
import json, sys
try:
    devices = json.load(sys.stdin).get("devices") or []
except ValueError:
    devices = []
for device in devices:
    print(device["name"], device.get("type", "auto"), sep="\t")
' <"$raw/smartctl-scan.json"
}

while IFS=$'\t' read -r device type; do
  base=${device##*/}
  [[ $type == *,* ]] && base+="-${type//,/-}"
  capture "smartctl/xall-$base" json smartctl --xall --json -n standby -d "$type" "$device"
  if [[ $type == scsi ]]; then
    capture "smartctl/xall-$base-auto" json smartctl --xall --json -n standby "$device"
  fi
done < <(list_scanned_devices)

if ! python3 "$repo_root/bin/scrub-fixtures.py" "$raw" "$out_dir"; then
  echo "capture-fixtures: scrub failed; unscrubbed output kept in $raw (do not commit it)" >&2
  exit 1
fi

rm -rf "$raw"
if [[ -n ${SUDO_UID:-} ]]; then
  chown -R "$SUDO_UID:${SUDO_GID:-$SUDO_UID}" "$out_dir"
fi

cat >&2 <<MSG
capture-fixtures: wrote $out_dir
Review before committing. Not scrubbed: hostname, pool/dataset names, PARTUUIDs,
filesystem UUIDs of non-ZFS partitions, and anything zpool-history records
(users, remote hosts or IPs from send/receive).
MSG
