#!/usr/bin/env bash
# Install or remove the tetanus host collector. Idempotent. See host/README.md.
#
#   sudo host/install.sh --url https://tetanus.example --token <enrol token> [--host <name>]
#   sudo host/install.sh --uninstall
#
# Run from a checkout it installs the files next to it; piped from curl it downloads them
# from TETANUS_SOURCE_URL (default: the tetanus server, from --url or the existing config).

set -euo pipefail

readonly bin_path=/usr/local/bin/tetanus-collect
readonly unit_dir=/etc/systemd/system
readonly timers=(tetanus-collect-zfs.timer tetanus-collect-smart.timer tetanus-collect-snapshots.timer)
readonly units=(tetanus-collect@.service "${timers[@]}")
readonly zedlet_path=/usr/local/libexec/tetanus/all-tetanus.sh
readonly zedlet_link=/etc/zfs/zed.d/all-tetanus.sh
readonly config_dir=/etc/tetanus
readonly config_path=$config_dir/collect.env
readonly zed_unit=zfs-zed.service

url=
token=
sources=
host=
uninstall=0

say() {
  printf 'tetanus install: %s\n' "$*"
}

die() {
  printf 'tetanus install: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<USAGE
Usage: install.sh --url <server url> --token <enrol token> [--host <name>]
       install.sh --uninstall
USAGE
}

parse_args() {
  while (($#)); do
    case $1 in
      --url) url=${2:?--url needs a value}; shift 2 ;;
      --token) token=${2:?--token needs a value}; shift 2 ;;
      --host) host=${2:?--host needs a value}; shift 2 ;;
      --uninstall) uninstall=1; shift ;;
      -h | --help) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done
}

configured_url() {
  local line value=
  [[ -r $config_path ]] || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?TETANUS_URL=(.*)$ ]] || continue
    value=${BASH_REMATCH[2]}
    if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then
      value=${BASH_REMATCH[1]}
    fi
  done <"$config_path"
  printf '%s' "$value"
}

# Sets sources to a directory holding the host/ files: the checkout this script is in,
# or a temporary download from the tetanus server.
fetch_sources() {
  local here
  here=$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd) || true
  if [[ -n $here && -f $here/tetanus-collect && -f $here/zed/all-tetanus.sh ]]; then
    sources=$here
    return 0
  fi

  local file source_url=${TETANUS_SOURCE_URL:-${url:-$(configured_url)}}
  [[ -n $source_url ]] || die "no server to download from; pass --url"
  source_url=${source_url%/}
  sources=$(mktemp -d)
  trap 'rm -rf "$sources"' EXIT
  mkdir -p "$sources/zed"
  for file in tetanus-collect "${units[@]}" zed/all-tetanus.sh; do
    curl -fsSL --retry 2 -o "$sources/$file" "$source_url/host/$file" ||
      die "could not download $source_url/host/$file"
  done
}

write_config() {
  if [[ -e $config_path ]]; then
    if [[ -n $url || -n $token || -n $host ]]; then
      say "$config_path exists; left unchanged (edit it to change the URL or token)"
    fi
    return 0
  fi
  [[ -n $url && -n $token ]] || die "$config_path does not exist; pass --url and --token"

  install -d -m 0755 "$config_dir"
  (
    umask 077
    {
      printf 'TETANUS_URL=%s\n' "$url"
      printf 'TETANUS_TOKEN=%s\n' "$token"
      [[ -z $host ]] || printf 'TETANUS_HOST=%s\n' "$host"
    } >"$config_path"
  )
  chmod 0600 "$config_path"
  say "wrote $config_path"
}

restart_zed() {
  systemctl try-restart "$zed_unit" || say "could not restart $zed_unit; restart ZED yourself"
}

install_collector() {
  local unit
  command -v curl >/dev/null || die "curl is required"
  command -v zpool >/dev/null || say "warning: zpool not found; ZFS sources will be skipped"
  command -v smartctl >/dev/null || say "warning: smartctl not found; SMART sources will be skipped"

  write_config
  fetch_sources

  install -m 0755 "$sources/tetanus-collect" "$bin_path"
  for unit in "${units[@]}"; do
    install -m 0644 "$sources/$unit" "$unit_dir/$unit"
  done
  install -D -m 0755 "$sources/zed/all-tetanus.sh" "$zedlet_path"
  if [[ -d ${zedlet_link%/*} ]]; then
    ln -sfn "$zedlet_path" "$zedlet_link"
  else
    say "warning: ${zedlet_link%/*} not found; ZED hook not enabled"
  fi
  say "installed $bin_path, ${units[*]} and $zedlet_link"

  systemctl daemon-reload
  systemctl enable --now "${timers[@]}"
  restart_zed

  say "smoke check: tetanus-collect --dry-run"
  if "$bin_path" --dry-run >/dev/null; then
    say "smoke check passed"
  else
    say "warning: smoke check failed; see the output above"
  fi

  cat <<NEXT

Next steps:
  sudo systemctl start tetanus-collect@smart.service  # collect a group now (zfs, smart, snapshots)
  journalctl -u 'tetanus-collect@*'                  # one line per source with the HTTP status
  systemctl list-timers 'tetanus-collect-*'          # when each group runs next
Config: $config_path
NEXT
}

uninstall_collector() {
  systemctl disable --now "${timers[@]}" 2>/dev/null || true
  systemctl stop 'tetanus-collect@*.service' 2>/dev/null || true
  local unit
  for unit in "${units[@]}"; do
    rm -f "$unit_dir/$unit"
  done
  systemctl daemon-reload

  if [[ -L $zedlet_link && $(readlink "$zedlet_link") == "$zedlet_path" ]]; then
    rm -f "$zedlet_link"
  fi
  rm -f "$zedlet_path" "$bin_path"
  rmdir "${zedlet_path%/*}" 2>/dev/null || true
  restart_zed

  rm -f "$config_path"
  rmdir "$config_dir" 2>/dev/null || true
  say "removed the collector, its units, the ZED hook and $config_path"
}

main() {
  parse_args "$@"
  [[ $EUID -eq 0 ]] || die "must run as root (sudo)"
  if ((uninstall)); then
    uninstall_collector
  else
    install_collector
  fi
}

main "$@"
