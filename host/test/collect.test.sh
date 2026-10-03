# shellcheck shell=bash
# Host collector tests: plain bash functions named test_*, run by run.sh.
# shellcheck source=host/test/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

test_missing_config_exits_1() {
  TETANUS_CONFIG=$test_dir/absent.env run_collect --dry-run
  assert_eq "$status" 1
  assert_contains "$errors" "TETANUS_URL TETANUS_TOKEN not set"
}

test_config_without_token_exits_1() {
  printf 'TETANUS_URL=%s\n' "$test_url" >"$TETANUS_CONFIG"
  run_collect --dry-run
  assert_eq "$status" 1
  assert_contains "$errors" "TETANUS_TOKEN not set"
}

test_unknown_source_is_a_usage_error() {
  run_collect --only nope
  assert_eq "$status" 2
}

test_dry_run_versions_prints_payload() {
  run_collect --dry-run --only versions
  assert_eq "$status" 0
  assert_eq "$(dry_run_posts)" "$test_url/api/ingest/versions"
  assert_contains "$output" "zfs=zfs-2.4.1-1ubuntu5.1"
  assert_contains "$output" "zpool=zfs-2.4.1-1ubuntu5.1"
  assert_contains "$output" "smartctl=smartctl 7.5 2025-04-30 r5714"
  assert_contains "$output" "kernel=$(uname -r)"
  assert_contains "$output" "os="
  [[ -z $(cat "$STUB_REQUESTS"/*.url 2>/dev/null) ]] || fail "dry run must not call curl"
}

test_zpool_status_posts_manifest_argv_with_headers() {
  run_collect --only zpool-status
  assert_eq "$status" 0
  assert_eq "$(grep '^zpool ' "$STUB_LOG")" "$(manifest_argv zpool-status-stored-paths)"
  assert_eq "$(<"$STUB_REQUESTS/0000.url")" "$test_url/api/ingest/zpool-status"
  local headers
  headers=$(<"$STUB_REQUESTS/0000.headers")
  assert_contains "$headers" "Authorization: Bearer $test_token"
  assert_contains "$headers" "Tetanus-Host: $test_host"
  assert_contains "$headers" "Content-Type: text/plain"
  assert_contains "$headers" "User-Agent: tetanus-collect/"
  cmp -s "$STUB_REQUESTS/0000.body" "$fixtures/zpool-status-stored-paths.json" ||
    fail "posted body differs from the fixture"
  assert_contains "$errors" "zpool-status: HTTP 200"
}

test_token_never_on_the_command_line() {
  run_collect --only zpool-status
  assert_not_contains "$(<"$STUB_LOG")" "$test_token"
}

test_zpool_history_is_per_pool_in_utc_with_headers() {
  run_collect --dry-run --only zpool-history
  assert_eq "$status" 0
  assert_eq "$(grep 'zpool ' "$STUB_LOG")" \
    $'zpool list -H -o name\nTZ=UTC zpool history -il tank\nTZ=UTC zpool history -il zeta'
  assert_contains "$output" "History for 'tank':"
  assert_contains "$output" "History for 'zeta':"
  local tank_lines
  tank_lines=$(sed -n "/^History for 'tank':$/,/^History for 'zeta':$/p" <<<"$output" | wc -l)
  ((tank_lines <= 502)) || fail "tank history not tailed: $tank_lines lines"
}

test_zpool_history_skipped_without_pools() {
  rm "$test_dir/bin/zpool"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$test_dir/bin/zpool"
  chmod +x "$test_dir/bin/zpool"
  run_collect --dry-run --only zpool-history
  assert_eq "$status" 0
  assert_contains "$errors" "zpool-history: skipped, no pools"
  assert_eq "$(dry_run_posts)" ""
}

test_receive_lines_keeps_receives_only() {
  # shellcheck source=host/tetanus-collect
  source "$collector"
  local history
  history=$(cat <<'HISTORY'
History for 'vpool':
2026-10-02.22:00:19 zfs receive -s -F vpool/zeta/q [user 0 (root) on vault:linux]
2026-10-02.22:00:19 (362ms) ioctl receive
    input:
        snapname: 'vpool/zeta/q@syncoid_vault_2026-10-02:23:00:19-GMT01:00'
2026-10-02.22:00:19 [txg:85264673] finish receiving vpool/zeta/q/%recv (52213) snap=syncoid_vault_2026-10-02:23:00:19-GMT01:00 [on vault]
2026-10-02.22:00:20 zfs destroy vpool/zeta/q@syncoid_vault_2026-10-02:22:00:19-GMT01:00 [user 0 (root) on vault:linux]
HISTORY
  )
  assert_eq "$(receive_lines <<<"$history")" \
    "$(sed -n '2p;6p' <<<"$history")"
}

test_full_run_matches_every_manifest_argv() {
  run_collect --dry-run
  assert_eq "$status" 0
  assert_contains "$errors" " 0 failed"
  local posts disks
  posts=$(dry_run_posts)
  disks=$(grep -c '"type": "disk"' "$fixtures/lsblk.json")
  assert_eq "$(grep -c '/udev?' <<<"$posts")" "$disks"
  assert_eq "$(grep -c '/smartctl-xall?' <<<"$posts")" 20
  assert_eq "$(sed 's/?.*//; s|.*/||' <<<"$posts" | uniq | paste -sd ' ')" \
    "versions zpool-status zpool-list zfs-list zfs-snapshots zpool-history zfs-receives zpool-events vdev-id-conf lsblk udev smartctl-scan smartctl-xall"
}

test_groups_select_their_sources() {
  local group expected
  for group in zfs smart snapshots; do
    case $group in
      zfs) expected="versions zpool-status zpool-list zfs-list zpool-history zfs-receives zpool-events vdev-id-conf" ;;
      smart) expected="lsblk udev smartctl-scan smartctl-xall" ;;
      snapshots) expected="zfs-snapshots" ;;
    esac
    run_collect --dry-run --only "$group"
    assert_eq "$status" 0
    assert_eq "$(dry_run_posts | sed 's/?.*//; s|.*/||' | uniq | paste -sd ' ')" "$expected"
  done
}

test_zpool_iostat_is_not_collected() {
  run_collect --dry-run
  assert_not_contains "$(<"$STUB_LOG")" "iostat"
  run_collect --only zpool-iostat
  assert_eq "$status" 2
}

test_udev_once_per_disk_not_per_partition() {
  run_collect --dry-run --only udev
  local posts
  posts=$(dry_run_posts)
  assert_contains "$posts" "$test_url/api/ingest/udev?device=b8:0"
  assert_contains "$posts" "$test_url/api/ingest/udev?device=b259:0"
  assert_not_contains "$posts" "device=b8:1"$'\n'
  assert_not_contains "$posts" "device=b7:"
  assert_contains "$(<"$STUB_LOG")" "cat /run/udev/data/b8:16"
}

test_smartctl_xall_queries_and_exit_status() {
  run_collect --dry-run --only smartctl-xall
  assert_eq "$status" 0
  local posts
  posts=$(dry_run_posts)
  assert_eq "$(head -n 1 <<<"$posts")" "$test_url/api/ingest/smartctl-xall?device=/dev/sda&exitStatus=0"
  assert_contains "$posts" "smartctl-xall?device=/dev/sdj&exitStatus=64"
  assert_contains "$posts" "smartctl-xall?device=/dev/sdn&exitStatus=4"
  assert_eq "$(tail -n 1 <<<"$posts")" "$test_url/api/ingest/smartctl-xall?device=/dev/nvme0&type=nvme&exitStatus=0"
  assert_not_contains "$posts" "smartctl-scan"
}

test_smartctl_d_only_for_types_that_need_it() {
  run_collect --dry-run --only smartctl-xall
  local log
  log=$(<"$STUB_LOG")
  assert_contains "$log" "smartctl --xall --json -n standby /dev/sda"$'\n'
  assert_not_contains "$log" "-d scsi"
  assert_contains "$log" "smartctl --xall --json -n standby -d nvme /dev/nvme0"
  # shellcheck source=host/tetanus-collect
  source "$collector"
  local type
  for type in ata scsi sat ""; do
    ! needs_device_type "$type" || fail "-d passed for '$type'"
  done
  for type in nvme sat,12 megaraid,0 usbjmicron; do
    needs_device_type "$type" || fail "-d omitted for '$type'"
  done
}

test_scan_parsing_matches_fixture() {
  # shellcheck source=host/tetanus-collect
  source "$collector"
  local devices
  devices=$(scanned_devices "$fixtures/smartctl-scan.json")
  assert_eq "$(wc -l <<<"$devices")" 20
  assert_eq "$(head -n 1 <<<"$devices")" $'/dev/sda\tscsi'
  assert_eq "$(tail -n 1 <<<"$devices")" $'/dev/nvme0\tnvme'
}

test_scan_parsing_handles_compact_json_and_raid_types() {
  # shellcheck source=host/tetanus-collect
  source "$collector"
  printf '%s' '{"smartctl":{"argv":["smartctl","--scan","--json=c"]},"devices":[{"name":"/dev/bus/0","info_name":"/dev/bus/0 [megaraid_disk_00]","type":"megaraid,0","protocol":"SCSI"},{"name":"/dev/bus/0","info_name":"/dev/bus/0 [megaraid_disk_01]","type":"megaraid,1","protocol":"SCSI"}]}' \
    >"$test_dir/scan.json"
  assert_eq "$(scanned_devices "$test_dir/scan.json")" $'/dev/bus/0\tmegaraid,0\n/dev/bus/0\tmegaraid,1'
}

test_http_errors_are_logged_not_fatal() {
  STUB_HTTP_STATUS=500 run_collect --only zpool-list
  assert_eq "$status" 0
  assert_contains "$errors" "zpool-list: HTTP 500"
  assert_contains "$errors" "0 sent, 1 failed"
}

test_failed_command_with_no_output_is_skipped() {
  rm "$test_dir/bin/zfs"
  printf '#!/usr/bin/env bash\nexit 1\n' >"$test_dir/bin/zfs"
  chmod +x "$test_dir/bin/zfs"
  run_collect --only zfs-list
  assert_eq "$status" 0
  assert_contains "$errors" "zfs-list: skipped, command exited 1 with no output"
  [[ ! -e $STUB_REQUESTS/0000.url ]] || fail "empty failed output must not be posted"
}

test_zedlet_posts_zevent_variables() {
  ZEVENT_EID=42 ZEVENT_CLASS=sysevent.fs.zfs.config_sync ZEVENT_POOL=tank \
    "$zedlet"
  assert_eq "$?" 0
  local waited=0
  until [[ -e $STUB_REQUESTS/0000.url ]] || ((waited++ > 50)); do
    sleep 0.1
  done
  assert_eq "$(<"$STUB_REQUESTS/0000.url")" "$test_url/api/ingest/zed-event"
  local body
  body=$(<"$STUB_REQUESTS/0000.body")
  assert_contains "$body" "ZEVENT_EID=42"
  assert_contains "$body" "ZEVENT_CLASS=sysevent.fs.zfs.config_sync"
  assert_not_contains "$body" "TETANUS_"
  assert_contains "$(<"$STUB_REQUESTS/0000.headers")" "Tetanus-Host: $test_host"
}

test_zedlet_is_silent_without_config() {
  local out
  out=$(TETANUS_CONFIG=$test_dir/absent.env ZEVENT_EID=1 "$zedlet" 2>&1)
  assert_eq "$?" 0
  assert_eq "$out" ""
  [[ ! -e $STUB_REQUESTS ]] || fail "zedlet posted without config"
}

test_scripts_are_executable() {
  [[ -x $collector && -x $zedlet && -x $installer ]] || fail "host scripts must be executable"
}

test_installer_refuses_non_root() {
  if ((EUID == 0)); then
    return 0
  fi
  local out code=0
  out=$("$installer" --url "$test_url" --token "$test_token" 2>&1) || code=$?
  assert_eq "$code" 1
  assert_contains "$out" "must run as root"
}
