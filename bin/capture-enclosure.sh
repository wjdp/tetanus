#!/usr/bin/env bash
# Print what the collector's enclosure source would post, from this host's sysfs.
# Usage: bin/capture-enclosure.sh > enclosure.txt   (unscrubbed: the enclosure id is real)
set -uo pipefail
# shellcheck source=host/tetanus-collect
source "$(dirname "${BASH_SOURCE[0]}")/../host/tetanus-collect"
enclosure_files "$enclosure_root"
