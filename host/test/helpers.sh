# shellcheck shell=bash disable=SC2034
# Shared setup and assertions for host tests; works under bats and the plain runner.
# Variables set here are read by collect.test.sh.

host_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
repo_root=$(cd "$host_dir/.." && pwd)
fixtures=$repo_root/test/fixtures/mars
collector=$host_dir/tetanus-collect
zedlet=$host_dir/zed/all-tetanus.sh
installer=$host_dir/install.sh
readonly test_url=https://tetanus.test
readonly test_token=test-token-123
readonly test_host=mars

setup_env() {
  test_dir=$(mktemp -d)
  local fakebin=$test_dir/bin command
  mkdir -p "$fakebin"
  for command in zpool zfs smartctl lsblk cat; do
    ln -s "$host_dir/test/stub.sh" "$fakebin/$command"
  done
  ln -s "$host_dir/test/curl-stub.sh" "$fakebin/curl"
  PATH=$fakebin:$PATH

  unset TETANUS_URL TETANUS_TOKEN TETANUS_HOST
  export STUB_FIXTURES=$fixtures
  export STUB_LOG=$test_dir/argv.log
  export STUB_REQUESTS=$test_dir/requests
  export TETANUS_CONFIG=$test_dir/collect.env
  : >"$STUB_LOG"
  printf 'TETANUS_URL=%s/\nTETANUS_TOKEN="%s"\nTETANUS_HOST=%s\n' \
    "$test_url" "$test_token" "$test_host" >"$TETANUS_CONFIG"
}

teardown_env() {
  rm -rf "$test_dir"
}

# run_collect <args...>: sets status, output (stdout) and errors (stderr).
run_collect() {
  status=0
  output=$("$collector" "$@" 2>"$test_dir/stderr") || status=$?
  errors=$(<"$test_dir/stderr")
}

fail() {
  printf '%s\n' "$@" >&2
  return 1
}

assert_eq() {
  [[ $1 == "$2" ]] || fail "expected: $2" "actual:   $1"
}

assert_contains() {
  [[ $1 == *"$2"* ]] || fail "expected to find: $2" "in:" "$1"
}

assert_not_contains() {
  [[ $1 != *"$2"* ]] || fail "expected not to find: $2" "in:" "$1"
}

manifest_argv() {
  awk -F'\t' -v name="$1" '$1 == name { print $3 }' "$fixtures/manifest.txt"
}

# Prints "METHOD url" lines for dry-run output.
dry_run_posts() {
  grep '^### POST ' <<<"$output" | sed 's/^### POST //'
}
