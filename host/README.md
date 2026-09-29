# tetanus host collector

A bash script, three systemd timers and a ZED hook that run read-only ZFS, SMART and
udev commands on a NAS host and POST their raw output to the tetanus server, which does
all the parsing. Needs bash, curl, OpenZFS 2.3+ and smartmontools 7.4+ (Ubuntu 26.04 or
similar). No jq, Python or Node.

## Install

With the enrol token from the tetanus settings page, which shows this command:

```sh
curl -fsSL https://tetanus.example/host/install.sh \
  | sudo bash -s -- --url https://tetanus.example --token <enrol token>
```

The server serves the installer and the files it installs at `/host/<file>`. Piped from
curl, the installer downloads them from `--url` (or `TETANUS_URL` in an existing config);
set `TETANUS_SOURCE_URL` to download from elsewhere.

Or from a clone:

```sh
git clone https://github.com/wjdp/tetanus.git
sudo tetanus/host/install.sh --url https://tetanus.example --token <enrol token>
```

`--host <name>` overrides the host name reported to the server (default `hostname -s`).
The installer is idempotent; re-running it updates the script and units and leaves an
existing config alone. To upgrade a host, the hosts settings page flags outdated
collectors and shows `curl -fsSL https://tetanus.example/host/install.sh | sudo bash`. It installs:

| file | purpose |
| --- | --- |
| `/usr/local/bin/tetanus-collect` | the collector |
| `/etc/systemd/system/tetanus-collect@.service` | one oneshot run of a group |
| `/etc/systemd/system/tetanus-collect-{zfs,smart,snapshots}.timer` | the schedule |
| `/usr/local/libexec/tetanus/all-tetanus.sh`, symlinked from `/etc/zfs/zed.d/` | ZED hook |
| `/etc/tetanus/collect.env` (mode 600) | `TETANUS_URL`, `TETANUS_TOKEN`, optional `TETANUS_HOST` |

It then enables the timers, restarts ZED and runs a `--dry-run` as a smoke check.

## What runs when

| timer | when | sources |
| --- | --- | --- |
| `tetanus-collect-zfs` | every 10 min | `versions`, `zpool-status`, `zpool-list`, `zfs-list`, `zpool-history`, `zpool-events`, `vdev-id-conf` |
| `tetanus-collect-smart` | hourly | `lsblk`, `udev` (per disk), `smartctl-scan`, `smartctl-xall` (per scanned device) |
| `tetanus-collect-snapshots` | every 6 h | `zfs-snapshots` |
| ZED hook | every ZFS event | `zed-event` |

Each source is one command whose stdout is POSTed to `/api/ingest/<source>`:

- `zpool status -j --json-flat-vdevs --json-int -Ppvs`, `zpool list -j --json-int -pv`,
  `zfs list -j --json-int -p …`, `zpool history -il | tail -n 500`, `zpool events -vH`
- `cat /etc/zfs/vdev_id.conf`, `lsblk -J -b -o …`, `cat /run/udev/data/b<maj>:<min>`
- `smartctl --scan --json`, then `smartctl --xall --json -n standby [-d <type>] <device>`
  per device; `-n standby` leaves sleeping disks asleep, and the exit status (a
  bitmask) is sent with the output
- version strings from `zfs version`, `zpool version`, `uname -r`, `smartctl --version`
  and `lsb_release -ds`

`lsblk` requests `MOUNTPOINTS`, which needs util-linux 2.37+ (Debian 12, Ubuntu 22.04);
older hosts fall back to `MOUNTPOINT`. It also requests `ZONED,LOG-SEC,PHY-SEC` (util-linux
2.29+): sector sizes for disks whose SMART output lacks them, and the zoned model for
host-managed SMR. The server treats missing columns as unknown.

It never writes to the host: the service runs with a read-only file system
(`ProtectSystem=strict`) and a private `/tmp`. It runs as root because `zpool` needs
`/dev/zfs` and `smartctl` needs raw disk access. The token is sent in a header, never on
a command line. A failing command or a server error is logged and the run carries on.

## Check it

```sh
systemctl list-timers 'tetanus-collect-*'
systemctl status tetanus-collect@zfs.service
journalctl -u 'tetanus-collect@*'
```

The journal has one line per source with the HTTP status, then a `done: N sent, M
failed` line.

## Run it by hand

```sh
sudo systemctl start tetanus-collect@smart.service   # one group, as the timer would
sudo tetanus-collect                                 # every source
sudo tetanus-collect --only zpool-status             # one source or group
sudo tetanus-collect --dry-run --only versions       # print payloads, send nothing
```

`TETANUS_CONFIG=<path>` reads a different config file.

## Uninstall

```sh
sudo tetanus/host/install.sh --uninstall
# or
curl -fsSL https://tetanus.example/host/install.sh \
  | sudo bash -s -- --uninstall
```

This removes the script, units, ZED hook and `/etc/tetanus/collect.env`.

## Tests

`bash host/test/run.sh` (or `pnpm test:host`) runs the shell tests with bats when it is
installed, otherwise with a plain bash runner. Host commands are replaced by stubs that
replay `test/fixtures/mars` by exact argv from its `manifest.txt`.
