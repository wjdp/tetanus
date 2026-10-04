import type { IngestSource, Parser } from "#shared/ingest";
import { parse as enclosure } from "./enclosure";
import { parse as lsblk } from "./lsblk";
import { parse as smartctlScan } from "./smartctl-scan";
import { parse as smartctlXall } from "./smartctl-xall";
import { parse as udev } from "./udev";
import { parse as vdevIdConf } from "./vdev-id-conf";
import { parse as versions } from "./versions";
import { parse as zedEvent } from "./zed-event";
import { parse as zfsList } from "./zfs-list";
import { parse as zfsReceives } from "./zfs-receives";
import { parse as zfsSnapshots } from "./zfs-snapshots";
import { parse as zpoolEvents } from "./zpool-events";
import { parse as zpoolHistory } from "./zpool-history";
import { parse as zpoolList } from "./zpool-list";
import { parse as zpoolStatus } from "./zpool-status";

export const PARSERS: Record<IngestSource, Parser<unknown>> = {
  versions,
  "smartctl-scan": smartctlScan,
  "smartctl-xall": smartctlXall,
  lsblk,
  udev,
  enclosure,
  "vdev-id-conf": vdevIdConf,
  "zpool-status": zpoolStatus,
  "zpool-list": zpoolList,
  "zfs-list": zfsList,
  "zfs-snapshots": zfsSnapshots,
  "zpool-history": zpoolHistory,
  "zfs-receives": zfsReceives,
  "zpool-events": zpoolEvents,
  "zed-event": zedEvent,
};
