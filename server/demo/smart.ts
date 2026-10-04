import { renderXall, smartctlBuild } from "./smartctlJson";
import {
  renderEnclosure,
  renderLsblk,
  renderUdev,
  renderVdevIdConf,
  vdevAliasedDisks,
} from "./smartDevices";
import type { DiskModel, HostModel, HostPayload } from "./types";
import type { DemoWorld } from "./world";

const FIRST_DISKSEQ = 9;

function renderVersions(host: HostModel): string {
  return [
    `zfs=${host.zfsVersion}`,
    `zpool=${host.zfsVersion}`,
    `kernel=${host.kernel}`,
    `smartctl=${host.smartctlVersion}`,
    `os=${host.os}`,
    "",
  ].join("\n");
}

function scanOrder(disk: DiskModel): number {
  const [major = 0, minor = 0] = disk.majMin.split(":").map(Number);
  return (disk.scanType === "nvme" ? 1e9 : 0) + major * 1_000_000 + minor;
}

function scanEntry(disk: DiskModel) {
  switch (disk.scanType) {
    case "nvme":
      return {
        name: disk.smartctlDevice,
        info_name: disk.smartctlDevice,
        type: "nvme",
        protocol: "NVMe",
      };
    case "scsi":
      return {
        name: disk.smartctlDevice,
        info_name: disk.smartctlDevice,
        type: "scsi",
        protocol: "SCSI",
      };
    case "sat":
      return {
        name: disk.smartctlDevice,
        info_name: `${disk.smartctlDevice} [SAT]`,
        type: "sat",
        protocol: "ATA",
      };
  }
}

function renderScan(host: HostModel, disks: DiskModel[]): string {
  const build = smartctlBuild(host);
  return `${JSON.stringify(
    {
      json_format_version: [1, 0],
      smartctl: {
        version: build.version,
        pre_release: false,
        svn_revision: build.svn_revision,
        platform_info: build.platform_info,
        build_info: build.build_info,
        argv: ["smartctl", "--scan", "--json"],
        exit_status: 0,
      },
      devices: disks.map(scanEntry),
    },
    null,
    2,
  )}\n`;
}

/**
 * The SMART and block-device sources (`versions`, `vdev-id-conf`, `lsblk`, `udev`,
 * `enclosure`, `smartctl-scan`, `smartctl-xall`) for `host` at `t`, in the collector's order and
 * with the `meta` it sends (see `SOURCE_META`). `xallFor` limits which disks get a
 * `smartctl-xall` post, for replay instants that only need identity and presence.
 */
export function renderSmart(
  world: DemoWorld,
  host: HostModel,
  t: Date,
  { xallFor = () => true }: { xallFor?: (disk: DiskModel) => boolean } = {},
): HostPayload[] {
  const { stories, fleet } = world;
  const hostDisks = fleet.disks.filter((disk) => disk.host === host.name);
  const present = stories
    .disksPresent(host.name, t)
    .sort((a, b) => scanOrder(a) - scanOrder(b));
  const aliased = vdevAliasedDisks(world, host, t);
  const aliasOf = (disk: DiskModel) =>
    aliased.includes(disk) ? disk.alias : null;

  return [
    { source: "versions", meta: {}, body: renderVersions(host) },
    ...(host.vdevIdConf
      ? [
          {
            source: "vdev-id-conf",
            meta: {},
            body: renderVdevIdConf(aliased),
          } as const,
        ]
      : []),
    { source: "lsblk", meta: {}, body: renderLsblk(host, present) },
    ...present.map(
      (disk): HostPayload => ({
        source: "udev",
        meta: { device: `b${disk.majMin}` },
        body: renderUdev(
          disk,
          FIRST_DISKSEQ + hostDisks.indexOf(disk),
          aliasOf(disk),
          host.enclosure,
        ),
      }),
    ),
    ...(host.collectorVersion === undefined
      ? [
          {
            source: "enclosure",
            meta: {},
            body: renderEnclosure(host, present),
          } as const,
        ]
      : []),
    { source: "smartctl-scan", meta: {}, body: renderScan(host, present) },
    ...present.filter(xallFor).map((disk): HostPayload => {
      const { body, exitStatus } = renderXall(stories, host, disk, t);
      return {
        source: "smartctl-xall",
        meta: {
          device: disk.smartctlDevice,
          ...(disk.scanType === "nvme" && { type: "nvme" }),
          exitStatus,
        },
        body,
      };
    }),
  ];
}
