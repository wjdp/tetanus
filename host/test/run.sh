#!/usr/bin/env bash
# Runs the host tests in collect.test.sh with bats when it is installed, otherwise with a
# small TAP-printing bash runner. Pass --plain to force the bash runner.

set -uo pipefail

test_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
test_file=$test_dir/collect.test.sh

test_names() {
  bash -c 'source "$1" && declare -F' _ "$test_file" | awk '$3 ~ /^test_/ { print $3 }'
}

run_with_bats() {
  local name
  suite=$(mktemp "${TMPDIR:-/tmp}/tetanus-host-tests.XXXXXX")
  trap 'rm -f "$suite"' EXIT
  {
    printf 'setup() { source %q; setup_env; }\n' "$test_file"
    printf 'teardown() { teardown_env; }\n'
    for name in $(test_names); do
      printf '@test %q { %s; }\n' "${name#test_}" "$name"
    done
  } >"$suite"
  bats "$suite"
}

run_plain() {
  local names name number=0 failures=0 log
  names=$(test_names)
  log=$(mktemp)
  echo "1..$(wc -w <<<"$names")"
  for name in $names; do
    number=$((number + 1))
    # A separate process, so `set -e` still applies inside the test under `if`.
    # shellcheck disable=SC2016
    if bash -c 'set -e; source "$1"; setup_env; trap teardown_env EXIT; "$2"' \
      _ "$test_file" "$name" >"$log" 2>&1; then
      echo "ok $number ${name#test_}"
    else
      failures=$((failures + 1))
      echo "not ok $number ${name#test_}"
      sed 's/^/# /' "$log"
    fi
  done
  rm -f "$log"
  ((failures == 0))
}

if [[ ${1:-} != --plain ]] && command -v bats >/dev/null; then
  run_with_bats
else
  run_plain
fi
