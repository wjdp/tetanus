#!/usr/bin/env bash
# Stands in for curl: records each request's URL, headers and body under $STUB_REQUESTS
# and answers with HTTP $STUB_HTTP_STATUS (default 200).

set -uo pipefail

mkdir -p "$STUB_REQUESTS"
request=$STUB_REQUESTS/$(printf '%04d' "$(find "$STUB_REQUESTS" -name '*.url' | wc -l)")
printf 'curl %s\n' "$*" >>"$STUB_LOG"

: >"$request.headers"
url=
while (($#)); do
  case $1 in
    -H | --header)
      if [[ $2 == @* ]]; then
        command -p cat "${2#@}" >>"$request.headers"
      else
        printf '%s\n' "$2" >>"$request.headers"
      fi
      shift 2
      ;;
    -A | --user-agent)
      printf 'User-Agent: %s\n' "$2" >>"$request.headers"
      shift 2
      ;;
    --data-binary)
      [[ $2 == @- ]] && command -p cat >"$request.body"
      shift 2
      ;;
    -o | --output | -w | --write-out | --max-time | --retry)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url=$1
      shift
      ;;
  esac
done

printf '%s\n' "$url" >"$request.url"
printf '%s' "${STUB_HTTP_STATUS:-200}"
