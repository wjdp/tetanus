#!/usr/bin/env bash
# Runs as root inside a provisioned matrix VM: builds a mirror on the two SATA disks and
# a single-disk pool on the NVMe, gives them snapshots, a receive and a scrub, then
# captures a collector dry run and raw fixtures into /var/tmp/matrix-out.

set -euxo pipefail

matrix_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$matrix_dir/../../.." && pwd)
out=/var/tmp/matrix-out
rm -rf "$out"
mkdir -p "$out"

{
  uname -r
  sed -n 's/^PRETTY_NAME=//p' /etc/os-release
  zfs version || true
  smartctl --version | head -n 1 || true
  bash --version | head -n 1
  curl --version | head -n 1
  lsblk --version
} >"$out/versions.txt" 2>&1

modprobe zfs
udevadm settle

# disk_by_id <prefix> <serial>
disk_by_id() {
  local link
  for link in /dev/disk/by-id/"$1"*"$2"; do
    [[ -e $link ]] && printf '%s' "$link" && return 0
  done
  ls -l /dev/disk/by-id >&2
  echo "scenario.sh: no $1 disk with serial $2" >&2
  exit 1
}

sata0=$(disk_by_id ata- TANK0)
sata1=$(disk_by_id ata- TANK1)
nvme0=$(disk_by_id nvme- FAST0)

zpool create -f -o ashift=12 tank mirror "$sata0" "$sata1"
zpool create -f fast "$nvme0"
zfs create -o compression=lz4 tank/data
zfs create -V 64M tank/vol
dd if=/dev/urandom of=/tank/data/blob bs=1M count=64 status=none
zfs snapshot tank/data@one
dd if=/dev/urandom of=/tank/data/blob2 bs=1M count=16 status=none
zfs snapshot tank/data@two
zfs send tank/data@one | zfs receive fast/copy
zfs send -i @one tank/data@two | zfs receive fast/copy
zpool scrub -w tank

printf 'TETANUS_URL=http://matrix.invalid\nTETANUS_TOKEN=matrix\nTETANUS_HOST=matrix\n' \
  >/var/tmp/collect.env
TETANUS_CONFIG=/var/tmp/collect.env "$repo_root/host/tetanus-collect" --dry-run \
  >"$out/collect.txt" 2>"$out/collect.log" || echo "collector exited $?" >>"$out/collect.log"

"$repo_root/bin/capture-fixtures.sh" "$out/fixtures" >"$out/capture-fixtures.log" 2>&1 ||
  echo "capture-fixtures exited $?" >>"$out/capture-fixtures.log"

chmod -R a+rX "$out"
