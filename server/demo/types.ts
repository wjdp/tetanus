import type { AlertRule } from "#shared/alerts";
import type { DiskProtocol, StateOverride } from "#shared/disk";
import type { FaultAction, FaultKind } from "#shared/faults";
import type { IngestMeta, IngestSource } from "#shared/ingest";
import type { Inventory } from "#shared/inventory-fields";
import type { AcceptanceKind } from "#shared/smart/status";

export interface HostPayload {
  source: IngestSource;
  meta: IngestMeta;
  body: string;
}

export interface HostPayloads {
  host: string;
  payloads: HostPayload[];
}

/**
 * How `host/tetanus-collect` 0.3.0 posts each source, so renderers build the same `meta`.
 * `zed-event` is push-only (ZED hook) and the demo does not produce it.
 */
export const SOURCE_META = {
  versions: "none",
  "zpool-status": "none",
  "zpool-list": "none",
  "zfs-list": "none",
  "zfs-snapshots": "none",
  "zpool-history": "none",
  "zpool-events": "none",
  "vdev-id-conf": "none; only on hosts with vdevIdConf, otherwise not posted",
  lsblk:
    "none; columns NAME,TYPE,SIZE,MODEL,SERIAL,WWN,TRAN,ROTA,MAJ:MIN,PATH,PTTYPE,PARTUUID,FSTYPE,ZONED,LOG-SEC,PHY-SEC,MOUNTPOINTS",
  udev: "one post per whole disk: device=b<maj>:<min> (e.g. b8:0, b259:0)",
  "smartctl-scan": "none",
  "smartctl-xall":
    "one post per scanned device: device=<scan name> (/dev/sda, /dev/nvme0), type only when the scan type is not ata/scsi/sat (so type=nvme for NVMe), exitStatus=<smartctl exit bitmask>",
  "zed-event": "not produced by the demo",
} as const satisfies Record<IngestSource, string>;

export type HostName = "atlas" | "styx" | "pip" | "bench";

export interface HostModel {
  name: HostName;
  role: string;
  /** `os=` line of the versions source (lsb_release -ds). */
  os: string;
  /** `kernel=` line (uname -r). */
  kernel: string;
  /** `zfs=` and `zpool=` lines (first line of `zfs version` / `zpool version`). */
  zfsVersion: string;
  /** `smartctl=` line (first line of `smartctl --version`). */
  smartctlVersion: string;
  /** Posts `vdev-id-conf` and names ZFS leaves `/dev/disk/by-vdev/<alias>-part<n>`; otherwise leaves use by-id paths. */
  vdevIdConf: boolean;
  ambientC: number;
  installedAt: Date;
  /** Host reboots (kernel updates, power cuts): power cycles and the `zpool events` ring buffer restart at each. */
  boots: Date[];
  /** Marked intermittent at seed: expected to be off for long periods. */
  intermittent?: boolean;
  /** Switched off after this run: the host posts nothing later. */
  lastRunAt?: Date;
  /** `tetanus-collect` version in the producer header; the current one when unset. */
  collectorVersion?: string;
}

export type Vendor = "seagate" | "wd" | "samsung" | "intel" | "crucial";

export type FormFactor = "3.5 inches" | "2.5 inches" | "M.2";

/**
 * Fixture a disk's smartctl `--xall` JSON is based on. The renderer substitutes model,
 * serial, WWN, firmware, capacity and every time-dependent value.
 */
export const SMART_TEMPLATES = {
  /** Seagate Exos X18 ST18000NM000J-2TV103, SATA 7200, exact model. */
  exosX18: "test/fixtures/mars/smartctl/xall-sdh-auto.json",
  /** Seagate Exos X16 ST16000NM001G-2KK103, SATA 7200, exact model. */
  exosX16: "test/fixtures/mars/smartctl/xall-sdl-auto.json",
  /** WDC WD120EDBZ, the only WD 7200 rpm SATA fixture: stands in for Ultrastar DC HC550. */
  wd7200: "test/fixtures/mars/smartctl/xall-sde-auto.json",
  /** WDC WD120EMFZ Red (CMR) 5400: stands in for WD Red Plus WD80EFZZ. */
  wdRed: "test/fixtures/mars/smartctl/xall-sdd-auto.json",
  /** WDC WD120EMAZ white label, exact model. */
  wd120emaz: "test/fixtures/mars/smartctl/xall-sda-auto.json",
  /** Samsung SSD 870 EVO 2TB, exact model; also used for the 4 TB. */
  samsung870Evo: "test/fixtures/mars/smartctl/xall-sdr-auto.json",
  /** Samsung SSD 860 EVO 500GB, exact model. */
  samsung860Evo: "test/fixtures/mars/smartctl/xall-sdo-auto.json",
  /** Intel DC S4610 SSDSC2KG480G8R (Dell), exit status 4 in the fixture; the renderer sets its own. */
  intelS4610: "test/fixtures/mars/smartctl/xall-sdn-auto.json",
  /** WD SN750 WDS250G3X0C, the only NVMe fixture (no -auto variant exists for NVMe). */
  nvme: "test/fixtures/mars/smartctl/xall-nvme0.json",
  /** Synthetic SAS sample; no demo disk uses it yet. */
  sas: "test/fixtures/synthetic-smartctl/xall-sas.json",
} as const;

export type SmartTemplate = keyof typeof SMART_TEMPLATES;

/**
 * How the disk is partitioned, which drives lsblk children and udev/by-id partition links.
 * - `zfs-whole-disk`: part1 zfs_member, part9 8 MiB reserved (what `zpool create` on a whole disk does).
 * - `zfs-boot`: part1 vfat EFI (512 MiB, mounted /boot/efi), part2 zfs_member.
 * - `luks-ext4`: part1 crypto_LUKS → dm-crypt child named `luksName`, ext4, mounted at `mountpoint`.
 */
export type DiskLayout =
  | { kind: "zfs-whole-disk" }
  | { kind: "zfs-boot" }
  | { kind: "luks-ext4"; luksName: string; mountpoint: string };

export type VdevClass = "normal" | "special" | "spare";

export type VdevType = "raidz1" | "raidz2" | "mirror" | "disk";

export interface VdevModel {
  class: VdevClass;
  /** Group type; `disk` for a single-disk top-level vdev or a spare. */
  type: VdevType;
  /** ZFS top-level index as in `raidz2-0`, `mirror-2`; spares have none. */
  index: number | null;
  width: number;
  addedAt: Date;
}

export interface PoolModel {
  name: string;
  host: HostName;
  guid: string;
  createdAt: Date;
  ashift: number;
  vdevs: VdevModel[];
  /** Fraction of usable space allocated at `createdAt` and at the timeline anchor; linear in between. */
  allocatedFraction: { atCreation: number; atAnchor: number };
  /** Scrub duration; the scan rate is allocated bytes over this. */
  scrubDurationMs: number;
  /** Cron: Ubuntu/Debian zfsutils `monthly-second-sunday` at 00:24, or a weekly systemd timer on Sundays at 00:24 (UTC). */
  scrubSchedule: "monthly-second-sunday" | "weekly-sunday";
  properties: Record<string, string>;
}

export interface PoolMembership {
  pool: string;
  vdev: { class: VdevClass; index: number | null };
  /** 0-based position among the vdev's children. */
  position: number;
}

export interface DiskModel {
  alias: string;
  host: HostName;
  /** Kernel block device name, `sda` or `nvme0n1`. */
  kernelName: string;
  /** Whole-disk `MAJ:MIN`, as lsblk and the udev `device=b<maj>:<min>` query use. */
  majMin: string;
  /** Name in `smartctl --scan` and the smartctl-xall `device` meta: `/dev/sda`, `/dev/nvme0`. */
  smartctlDevice: string;
  /** Type in `smartctl --scan`; only `nvme` is forwarded as the `type` meta. */
  scanType: "scsi" | "sat" | "nvme";
  /** lsblk TRAN. */
  transport: "sas" | "sata" | "nvme";
  vendor: Vendor;
  /** smartctl `model_name` exactly (resolves in the drive db via `bareModel`). */
  model: string;
  modelFamily: string | null;
  capacityBytes: number;
  protocol: Exclude<DiskProtocol, "unknown">;
  rotational: boolean;
  rpm: number | null;
  formFactor: FormFactor;
  serial: string;
  /** 16 hex digits, no `0x`, for SATA/SAS; `eui.<16 hex>` for NVMe. */
  wwn: string;
  firmware: string;
  template: SmartTemplate;
  layout: DiskLayout;
  /** Pool slot, or null for a non-ZFS disk. Occupied from `installedAt` (or `memberFrom`) to `removedAt` (or `memberUntil`). */
  membership: PoolMembership | null;
  /** When the disk joined its vdev, if later than `installedAt`. */
  memberFrom?: Date;
  /** When the disk left its vdev (detached after a replace), if not `removedAt`; null stays listed (UNAVAIL) after being pulled. */
  memberUntil?: Date | null;
  /** Physically attached from here. */
  installedAt: Date;
  /** Physically detached here; absent from lsblk, udev, smartctl from this instant. */
  removedAt: Date | null;
  /** No longer attached anywhere at the anchor; carries a `sold`/`retired`/`dead` override. */
  inventoryOnly: boolean;
  inventory: Partial<Inventory>;
  /** Power-on hours already on the clock at `installedAt` (used, refurbished or factory burn-in). */
  powerOnHoursAtInstall: number;
  powerCyclesAtInstall: number;
  /** Degrees above host ambient under normal load. */
  temperatureOffsetC: number;
  /** Host bytes written per day (drives LBAs written, NVMe data units, SSD wear). */
  bytesWrittenPerDay: number;
  /** Rated endurance, for SSD wear (`percentage_used`, Wear_Leveling_Count). */
  enduranceTbw: number | null;
}

export type SnapshotStyle = "sanoid" | "zfs-auto-snap";

/**
 * Retention counts. sanoid names `autosnap_YYYY-MM-DD_HH:MM:SS_<kind>` (hourly on the
 * hour, daily at 00:00, monthly at 00:00 on the 1st, UTC). zfs-auto-snapshot names
 * `zfs-auto-snap_<kind>-YYYY-MM-DD-HHMM` (hourly at :17, daily at 06:25, UTC).
 */
export interface SnapshotPolicy {
  style: SnapshotStyle;
  hourly: number;
  daily: number;
  monthly: number;
}

export interface DatasetModel {
  name: string;
  type: "filesystem" | "volume";
  createdAt: Date;
  /** Referenced bytes at `createdAt` and at the anchor; linear in between. */
  referencedBytes: { atCreation: number; atAnchor: number };
  /** Bytes changed per day, which drives snapshot `used`/`written`. */
  churnBytesPerDay: number;
  compressRatio: number;
  recordsize: number | null;
  volsize: number | null;
  compression: string;
  encryption: string;
  mountpoint: string | null;
  quota: number;
  snapshots: SnapshotPolicy | null;
  /**
   * Replication target: receives the source dataset's snapshots (same names and GUIDs,
   * see `snapshotGuid`) daily at `REPLICATION_DAILY_AT_UTC`, then prunes to its own
   * retention, so it keeps older dailies and monthlies than the source.
   */
  replicaOf?: string;
}

export interface PoolHistoryEvent {
  at: Date;
  pool: string;
  /** Command line as `zpool history` shows it, e.g. `zpool scrub tank`. */
  command: string;
}

export type ZpoolEventClass =
  | "ereport.fs.zfs.checksum"
  | "ereport.fs.zfs.io"
  | "resource.fs.zfs.statechange"
  | "resource.fs.zfs.removed"
  | "sysevent.fs.zfs.scrub_start"
  | "sysevent.fs.zfs.scrub_finish"
  | "sysevent.fs.zfs.resilver_start"
  | "sysevent.fs.zfs.resilver_finish"
  | "sysevent.fs.zfs.vdev_attach"
  | "sysevent.fs.zfs.config_sync";

export interface ZpoolEvent {
  at: Date;
  class: ZpoolEventClass;
  pool: string;
  /** Leaf the event is about, if any. */
  vdevAlias?: string;
  /** `vdev_state` for statechange events. */
  vdevState?: "ONLINE" | "DEGRADED" | "FAULTED" | "UNAVAIL" | "REMOVED";
}

export type LeafState = "ONLINE" | "FAULTED" | "UNAVAIL" | "REMOVED";

export interface LeafAt {
  disk: DiskModel;
  vdev: VdevModel;
  position: number;
  state: LeafState;
  /** Wrapped in a `replacing-<position>` vdev with the outgoing disk. */
  replacing: boolean;
  resilvering: boolean;
  /** Spare in use (`INUSE`) or available (`AVAIL`); only for spares. */
  spareStatus?: "AVAIL" | "UNAVAIL";
  errors: { read: number; write: number; checksum: number };
}

export interface ScanState {
  function: "SCRUB" | "RESILVER";
  state: "SCANNING" | "FINISHED";
  startTime: Date;
  endTime: Date | null;
  toExamine: number;
  examined: number;
  /** Bytes repaired. */
  processed: number;
  errors: number;
  bytesPerSecond: number;
}

export type PoolState = "ONLINE" | "DEGRADED";

export interface SmartCounters {
  powerOnHours: number;
  powerCycles: number;
  temperatureC: number;
  reallocatedSectors: number;
  pendingSectors: number;
  offlineUncorrectable: number;
  /** smartctl `smart_status.passed`. */
  healthPassed: boolean;
  bytesWritten: number;
  bytesRead: number;
  /** NVMe `percentage_used` / SSD wear in percent of rated endurance. */
  percentageUsed: number | null;
  mediaErrors: number;
  unsafeShutdowns: number;
}

/** Subjects the seed resolves to ids after the replay. */
export type SeedSubject =
  | { type: "disk"; alias: string }
  | { type: "pool"; host: HostName; pool: string }
  | { type: "host"; host: HostName }
  | { type: "system" };

/** For `addManualEntry({ subjectType, subjectId, title, body, at })`. */
export interface ManualDiarySeed {
  subject: SeedSubject;
  title: string;
  body: string;
  at: Date;
}

/** For `acceptFault({ diskId, attrId, kind, note, now: at })`; attrId is the ATA attribute id as a string. */
export interface AcceptanceSeed {
  alias: string;
  attrId: string;
  kind: AcceptanceKind;
  note: string;
  at: Date;
}

/** For `performFaultAction(id, action, { note, now: at })` on the subject's live fault of this kind. */
export interface FaultActionSeed {
  subject: Exclude<SeedSubject, { type: "system" }>;
  kind: FaultKind;
  action: FaultAction;
  note: string;
  at: Date;
}

/** For `updateDisk(id, { stateOverride, notes }, at)`. Inventory goes through `DiskModel.inventory`. */
export interface OverrideSeed {
  alias: string;
  stateOverride: StateOverride;
  at: Date;
  notes?: string;
}

/**
 * A `Notification` row inserted directly. The seed finds the auto diary entry the real
 * rule would have matched (by subject, eventType and nearest `at`) and builds the row
 * exactly as `deriveAlert` does: title `ALERT_RULES[rule].label`, subject
 * `<host> · <alias or pool>`, message `<subject>: <detail>`, dedupeKey
 * `<rule>:<subjectType>:<subjectId>:<value>:<diaryEntryId>`, channel `pushover`, ok true.
 */
export interface NotificationSeed {
  rule: AlertRule;
  subject: Extract<SeedSubject, { type: "disk" } | { type: "pool" }>;
  /** Diary `eventType` the rule matches: attribute-status-changed, smart-status-changed, state-changed, pool-state-changed. */
  eventType: string;
  value: string;
  detail: string;
  at: Date;
}
