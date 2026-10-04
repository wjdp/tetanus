#!/usr/bin/env bash
# Boots a distro's cloud image under QEMU/KVM with two SATA disks and one NVMe disk,
# installs OpenZFS and smartmontools, reboots, builds pools and captures a collector
# dry run into <out-dir>/collect.txt.
#
# Usage: host/test/matrix/vm.sh <distro> <out-dir>
# Needs qemu-system-x86_64, qemu-img, xorriso, ssh and /dev/kvm.

set -euo pipefail

distro=$1
out=$(mkdir -p "$2" && cd "$2" && pwd)
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$here/../../.." && pwd)
work=${TETANUS_MATRIX_WORK:-${RUNNER_TEMP:-/tmp}/tetanus-matrix}/$distro
ssh_port=${TETANUS_MATRIX_SSH_PORT:-2222}

case $distro in
  ubuntu-*)
    release=${distro#ubuntu-}
    image=https://cloud-images.ubuntu.com/releases/$release/release/ubuntu-$release-server-cloudimg-amd64.img
    ;;
  debian-12) image=https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2 ;;
  debian-13 | proxmox-9) image=https://cloud.debian.org/images/cloud/trixie/latest/debian-13-generic-amd64.qcow2 ;;
  almalinux-*)
    release=${distro#almalinux-}
    image=https://repo.almalinux.org/almalinux/$release/cloud/x86_64/images/AlmaLinux-$release-GenericCloud-latest.x86_64.qcow2
    ;;
  *)
    echo "vm.sh: unknown distro '$distro'" >&2
    exit 2
    ;;
esac

log() {
  printf '[vm %s] %s\n' "$distro" "$*" >&2
}

mkdir -p "$work"
base=$work/${image##*/}
[[ -s $base ]] || curl -fsSL --retry 3 -o "$base" "$image"

rm -f "$work"/{root.qcow2,sata0.img,sata1.img,nvme0.img,seed.iso,id_ed25519,id_ed25519.pub,qemu.pid}
qemu-img create -q -f qcow2 -F qcow2 -b "$base" "$work/root.qcow2" 20G
for disk in sata0 sata1 nvme0; do
  truncate -s 2G "$work/$disk.img"
done

ssh-keygen -q -t ed25519 -N '' -f "$work/id_ed25519"
mkdir -p "$work/seed"
cat >"$work/seed/user-data" <<USERDATA
#cloud-config
users:
  - name: tester
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $(<"$work/id_ed25519.pub")
USERDATA
printf 'instance-id: %s\nlocal-hostname: matrix\n' "$distro" >"$work/seed/meta-data"
xorriso -as mkisofs -quiet -output "$work/seed.iso" -volid cidata -joliet -rock \
  "$work/seed/user-data" "$work/seed/meta-data"

qemu-system-x86_64 \
  -enable-kvm -cpu host -smp 4 -m 4096 \
  -display none -serial "file:$out/console.log" \
  -daemonize -pidfile "$work/qemu.pid" \
  -drive "if=none,id=root,file=$work/root.qcow2,format=qcow2" \
  -device virtio-blk-pci,drive=root,bootindex=0 \
  -drive "file=$work/seed.iso,if=virtio,format=raw,readonly=on" \
  -device ahci,id=ahci \
  -drive "if=none,id=sata0,file=$work/sata0.img,format=raw" \
  -device ide-hd,drive=sata0,bus=ahci.0,serial=TANK0 \
  -drive "if=none,id=sata1,file=$work/sata1.img,format=raw" \
  -device ide-hd,drive=sata1,bus=ahci.1,serial=TANK1 \
  -drive "if=none,id=nvme0,file=$work/nvme0.img,format=raw" \
  -device nvme,drive=nvme0,serial=FAST0 \
  -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$ssh_port-:22" \
  -device virtio-net-pci,netdev=net0

stop_vm() {
  if [[ -s $work/qemu.pid ]]; then
    kill "$(<"$work/qemu.pid")" 2>/dev/null || true
  fi
}
trap stop_vm EXIT

vm() {
  ssh -q -i "$work/id_ed25519" -p "$ssh_port" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=5 -o ServerAliveInterval=15 -o LogLevel=ERROR \
    tester@127.0.0.1 "$@"
}

wait_for_ssh() {
  local deadline=$((SECONDS + 600))
  until vm true 2>/dev/null; do
    if ((SECONDS > deadline)); then
      log "no ssh after 10 min; console tail:"
      tail -n 50 "$out/console.log" >&2
      exit 1
    fi
    sleep 5
  done
}

log "booting"
wait_for_ssh
vm 'cloud-init status --wait >/dev/null 2>&1 || true'

log "copying collector"
tar -C "$repo_root" -cz host bin | vm 'rm -rf matrix && mkdir matrix && tar -C matrix -xz'

log "provisioning"
vm "sudo bash matrix/host/test/matrix/provision.sh $distro" 2>&1 | tee "$out/provision.log" >&2

log "rebooting"
vm 'sudo systemctl reboot' || true
sleep 15
wait_for_ssh

log "running scenario"
vm 'sudo bash matrix/host/test/matrix/scenario.sh' 2>&1 | tee "$out/scenario.log" >&2
vm 'sudo tar -C /var/tmp/matrix-out -c .' | tar -C "$out" -x
log "captured into $out"
