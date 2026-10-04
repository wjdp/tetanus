#!/usr/bin/env bash
# Runs as root inside a matrix VM: installs the distro's OpenZFS and smartmontools the
# way a home NAS user would. A reboot follows, so new kernels and modules take effect.
#
# Usage: provision.sh <distro>

set -euxo pipefail

distro=$1
export DEBIAN_FRONTEND=noninteractive

enable_contrib() {
  sed -i -E 's/^(Components: .*\bmain\b)$/\1 contrib/' /etc/apt/sources.list.d/*.sources 2>/dev/null || true
  [[ -f /etc/apt/sources.list ]] && sed -i -E 's/^(deb .* main)$/\1 contrib/' /etc/apt/sources.list
  return 0
}

# zfsutils' postinst starts services that fail until the reboot loads the new module.
apt_install() {
  apt-get install -yq "$@" || dpkg --configure -a || true
}

case $distro in
  ubuntu-*)
    apt-get update -q
    apt_install zfsutils-linux smartmontools
    ;;
  debian-12)
    enable_contrib
    echo 'deb http://deb.debian.org/debian bookworm-backports main contrib' \
      >/etc/apt/sources.list.d/backports.list
    apt-get update -q
    apt-get full-upgrade -yq
    apt_install linux-image-amd64 linux-headers-amd64 smartmontools
    apt_install -t bookworm-backports zfs-dkms zfsutils-linux
    ;;
  debian-13)
    enable_contrib
    apt-get update -q
    apt-get full-upgrade -yq
    apt_install linux-image-amd64 linux-headers-amd64 smartmontools
    apt_install zfs-dkms zfsutils-linux
    ;;
  proxmox-9)
    curl -fsSL -o /usr/share/keyrings/proxmox-archive-keyring.gpg \
      https://enterprise.proxmox.com/debian/proxmox-archive-keyring-trixie.gpg
    cat >/etc/apt/sources.list.d/proxmox.sources <<SOURCES
Types: deb
URIs: http://download.proxmox.com/debian/pve
Suites: trixie
Components: pve-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
SOURCES
    apt-get update -q
    apt-get full-upgrade -yq
    apt_install proxmox-default-kernel zfsutils-linux smartmontools
    ;;
  almalinux-*)
    dnf -y update
    dnf -y install epel-release dnf-plugins-core
    dnf -y install "https://zfsonlinux.org/epel/zfs-release-3-0$(rpm --eval '%{dist}').noarch.rpm"
    dnf config-manager --disable zfs
    dnf config-manager --enable zfs-kmod
    dnf -y install zfs smartmontools
    echo zfs >/etc/modules-load.d/zfs.conf
    ;;
  *)
    echo "provision.sh: unknown distro '$distro'" >&2
    exit 2
    ;;
esac
