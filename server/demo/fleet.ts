import { forkRng, guidFor } from "./prng";
import { addMs, DAY_MS, HOUR_MS, isoDay, type Timeline } from "./timeline";
import type {
  DatasetModel,
  DiskLayout,
  DiskModel,
  FormFactor,
  HostModel,
  HostName,
  PoolMembership,
  PoolModel,
  SmartTemplate,
  SnapshotPolicy,
  VdevModel,
  Vendor,
} from "./types";

export interface Fleet {
  hosts: HostModel[];
  pools: PoolModel[];
  disks: DiskModel[];
  datasets: Record<HostName, DatasetModel[]>;
}

const TB = 1e12;
const GB = 1e9;

const date = (iso: string) => new Date(iso);

/** Disk product lines: what the renderer needs that is the same for every unit. */
interface Product {
  vendor: Vendor;
  model: string;
  modelFamily: string | null;
  capacityBytes: number;
  protocol: DiskModel["protocol"];
  rpm: number | null;
  formFactor: FormFactor;
  firmware: string;
  template: SmartTemplate;
  serial: (alias: string) => string;
  wwn: (alias: string) => string;
  enduranceTbw: number | null;
  temperatureOffsetC: number;
}

const serialRng = (alias: string) => forkRng(`serial:${alias}`);
const wwnRng = (alias: string) => forkRng(`wwn:${alias}`);

export const SERIAL_FORMATS = {
  seagate: /^ZL2[A-Z0-9]{5}$/,
  wdRed: /^WD-WX[A-Z0-9]{9}$/,
  wdHgst: /^9JH[A-Z0-9]{5}$/,
  samsung: /^S5[A-Z0-9]{2}NX0N\d{6}[A-Z]$/,
  intel: /^BTYF\d{6}[A-Z0-9]{2}480BGN$/,
  crucial: /^\d{4}E[0-9A-F]{7}$/,
  wdNvme: /^\d{5}[A-Z]\d{6}$/,
} as const;

export const WWN_PREFIXES = {
  seagate: "5000c500",
  wdRed: "50014ee2",
  wdHgst: "5000cca2",
  samsung: "5002538e",
  intel: "55cd2e41",
  crucialEui: "eui.00a075",
  wdNvmeEui: "eui.e8238fa6",
} as const;

const naa = (prefix: string) => (alias: string) =>
  `${prefix}${wwnRng(alias).hex(16 - prefix.length)}`;

const eui = (prefix: string) => (alias: string) =>
  `${prefix}${wwnRng(alias).hex(20 - prefix.length)}`;

const seagateSerial = (alias: string) => `ZL2${serialRng(alias).alnum(5)}`;
const wdHgstSerial = (alias: string) => `9JH${serialRng(alias).alnum(5)}`;

const PRODUCTS = {
  exosX16: {
    vendor: "seagate",
    model: "ST16000NM001G-2KK103",
    modelFamily: "Seagate Exos X16",
    capacityBytes: 16_000_900_661_248,
    protocol: "ata",
    rpm: 7200,
    formFactor: "3.5 inches",
    firmware: "SN04",
    template: "exosX16",
    serial: seagateSerial,
    wwn: naa(WWN_PREFIXES.seagate),
    enduranceTbw: null,
    temperatureOffsetC: 13,
  },
  exosX18: {
    vendor: "seagate",
    model: "ST18000NM000J-2TV103",
    modelFamily: "Seagate Exos X18",
    capacityBytes: 18_000_207_937_536,
    protocol: "ata",
    rpm: 7200,
    formFactor: "3.5 inches",
    firmware: "SN02",
    template: "exosX18",
    serial: seagateSerial,
    wwn: naa(WWN_PREFIXES.seagate),
    enduranceTbw: null,
    temperatureOffsetC: 14,
  },
  hc550: {
    vendor: "wd",
    model: "WDC WUH721818ALE6L4",
    modelFamily: "Western Digital Ultrastar DC HC550",
    capacityBytes: 18_000_207_937_536,
    protocol: "ata",
    rpm: 7200,
    formFactor: "3.5 inches",
    firmware: "PCGNW232",
    template: "wd7200",
    serial: wdHgstSerial,
    wwn: naa(WWN_PREFIXES.wdHgst),
    enduranceTbw: null,
    temperatureOffsetC: 11,
  },
  wd120emaz: {
    vendor: "wd",
    model: "WDC WD120EMAZ-11BLFA0",
    modelFamily: "Western Digital Ultrastar (He10/12)",
    capacityBytes: 12_000_138_625_024,
    protocol: "ata",
    rpm: 5400,
    formFactor: "3.5 inches",
    firmware: "81.00A81",
    template: "wd120emaz",
    serial: wdHgstSerial,
    wwn: naa(WWN_PREFIXES.wdHgst),
    enduranceTbw: null,
    temperatureOffsetC: 9,
  },
  redPlus8: {
    vendor: "wd",
    model: "WDC WD80EFZZ-68BTXN0",
    modelFamily: "Western Digital Red Plus",
    capacityBytes: 8_001_563_222_016,
    protocol: "ata",
    rpm: 5640,
    formFactor: "3.5 inches",
    firmware: "81.00A81",
    template: "wdRed",
    serial: (alias) => `WD-WX${serialRng(alias).alnum(9)}`,
    wwn: naa(WWN_PREFIXES.wdRed),
    enduranceTbw: null,
    temperatureOffsetC: 9,
  },
  redPlus8Px: {
    vendor: "wd",
    model: "WDC WD80EFPX-68C4ZN0",
    modelFamily: "Western Digital Red Plus",
    capacityBytes: 8_001_563_222_016,
    protocol: "ata",
    rpm: 5640,
    formFactor: "3.5 inches",
    firmware: "81.00A81",
    template: "wdRed",
    serial: (alias) => `WD-WX${serialRng(alias).alnum(9)}`,
    wwn: naa(WWN_PREFIXES.wdRed),
    enduranceTbw: null,
    temperatureOffsetC: 9,
  },
  evo870_2tb: {
    vendor: "samsung",
    model: "Samsung SSD 870 EVO 2TB",
    modelFamily: "Samsung based SSDs",
    capacityBytes: 2_000_398_934_016,
    protocol: "ata",
    rpm: null,
    formFactor: "2.5 inches",
    firmware: "SVT02B6Q",
    template: "samsung870Evo",
    serial: samsungSerial,
    wwn: naa(WWN_PREFIXES.samsung),
    enduranceTbw: 1200,
    temperatureOffsetC: 5,
  },
  evo870_4tb: {
    vendor: "samsung",
    model: "Samsung SSD 870 EVO 4TB",
    modelFamily: "Samsung based SSDs",
    capacityBytes: 4_000_787_030_016,
    protocol: "ata",
    rpm: null,
    formFactor: "2.5 inches",
    firmware: "SVT02B6Q",
    template: "samsung870Evo",
    serial: samsungSerial,
    wwn: naa(WWN_PREFIXES.samsung),
    enduranceTbw: 2400,
    temperatureOffsetC: 7,
  },
  evo860_500gb: {
    vendor: "samsung",
    model: "Samsung SSD 860 EVO 500GB",
    modelFamily: "Samsung based SSDs",
    capacityBytes: 500_107_862_016,
    protocol: "ata",
    rpm: null,
    formFactor: "2.5 inches",
    firmware: "RVT04B6Q",
    template: "samsung860Evo",
    serial: samsungSerial,
    wwn: naa(WWN_PREFIXES.samsung),
    enduranceTbw: 300,
    temperatureOffsetC: 5,
  },
  intelS4610: {
    vendor: "intel",
    model: "INTEL SSDSC2KG480G8",
    modelFamily: "Intel S4510/S4610/S4500/S4600 Series SSDs",
    capacityBytes: 480_103_981_056,
    protocol: "ata",
    rpm: null,
    formFactor: "2.5 inches",
    firmware: "XCV10132",
    template: "intelS4610",
    serial: (alias) => {
      const rng = serialRng(alias);
      return `BTYF${rng.digits(6)}${rng.alnum(2)}480BGN`;
    },
    wwn: naa(WWN_PREFIXES.intel),
    enduranceTbw: 3400,
    temperatureOffsetC: 4,
  },
  p3Plus1tb: {
    vendor: "crucial",
    model: "CT1000P3PSSD8",
    modelFamily: null,
    capacityBytes: 1_000_204_886_016,
    protocol: "nvme",
    rpm: null,
    formFactor: "M.2",
    firmware: "P9CR40A",
    template: "nvme",
    serial: (alias) => {
      const rng = serialRng(alias);
      return `${rng.digits(4)}E${rng.hex(7).toUpperCase()}`;
    },
    wwn: eui(WWN_PREFIXES.crucialEui),
    enduranceTbw: 220,
    temperatureOffsetC: 19,
  },
  sn700_1tb: {
    vendor: "wd",
    model: "WDS100T1R0C-68BDK0",
    modelFamily: null,
    capacityBytes: 1_000_204_886_016,
    protocol: "nvme",
    rpm: null,
    formFactor: "M.2",
    firmware: "111150WD",
    template: "nvme",
    serial: (alias) => {
      const rng = serialRng(alias);
      return `${rng.digits(5)}${rng.alnum(1).replace(/\d/, "K")}${rng.digits(6)}`;
    },
    wwn: eui(WWN_PREFIXES.wdNvmeEui),
    enduranceTbw: 2000,
    temperatureOffsetC: 15,
  },
} as const satisfies Record<string, Product>;

function samsungSerial(alias: string) {
  const rng = serialRng(alias);
  return `S5${rng.alnum(2)}NX0N${rng.digits(6)}${rng.alnum(1).replace(/\d/, "R")}`;
}

type ProductName = keyof typeof PRODUCTS;

function sdMajMin(kernelName: string): string {
  const index = kernelName.charCodeAt(2) - "a".charCodeAt(0);
  return index < 16 ? `8:${index * 16}` : `65:${(index - 16) * 16}`;
}

interface Slot {
  kernelName: string;
  transport: DiskModel["transport"];
  /** NVMe only: controller index and whole-disk minor. */
  nvme?: { controller: number; minor: number };
}

const hba = (kernelName: string): Slot => ({ kernelName, transport: "sas" });
const ahci = (kernelName: string): Slot => ({ kernelName, transport: "sata" });
const nvme = (controller: number, minor: number): Slot => ({
  kernelName: `nvme${controller}n1`,
  transport: "nvme",
  nvme: { controller, minor },
});

interface DiskSpec {
  alias: string;
  host: HostName;
  product: ProductName;
  slot: Slot;
  layout?: DiskLayout;
  membership: PoolMembership | null;
  memberFrom?: Date;
  memberUntil?: Date | null;
  installedAt: Date;
  removedAt?: Date | null;
  inventoryOnly?: boolean;
  inventory: DiskModel["inventory"];
  powerOnHoursAtInstall?: number;
  powerCyclesAtInstall?: number;
  temperatureOffsetC?: number;
  bytesWrittenPerDay: number;
}

function buildDisk(spec: DiskSpec): DiskModel {
  const product: Product = PRODUCTS[spec.product];
  const { slot } = spec;
  return {
    alias: spec.alias,
    host: spec.host,
    kernelName: slot.kernelName,
    majMin: slot.nvme ? `259:${slot.nvme.minor}` : sdMajMin(slot.kernelName),
    smartctlDevice: slot.nvme
      ? `/dev/nvme${slot.nvme.controller}`
      : `/dev/${slot.kernelName}`,
    scanType: slot.nvme ? "nvme" : slot.transport === "sas" ? "scsi" : "sat",
    transport: slot.transport,
    vendor: product.vendor,
    model: product.model,
    modelFamily: product.modelFamily,
    capacityBytes: product.capacityBytes,
    protocol: product.protocol,
    rotational: product.rpm !== null,
    rpm: product.rpm,
    formFactor: product.formFactor,
    serial: product.serial(spec.alias),
    wwn: product.wwn(spec.alias),
    firmware: product.firmware,
    template: product.template,
    layout: spec.layout ?? { kind: "zfs-whole-disk" },
    membership: spec.membership,
    ...(spec.memberFrom && { memberFrom: spec.memberFrom }),
    ...(spec.memberUntil !== undefined && { memberUntil: spec.memberUntil }),
    installedAt: spec.installedAt,
    removedAt: spec.removedAt ?? null,
    inventoryOnly: spec.inventoryOnly ?? false,
    inventory: spec.inventory,
    powerOnHoursAtInstall: spec.powerOnHoursAtInstall ?? 0,
    powerCyclesAtInstall: spec.powerCyclesAtInstall ?? 3,
    temperatureOffsetC: spec.temperatureOffsetC ?? product.temperatureOffsetC,
    bytesWrittenPerDay: spec.bytesWrittenPerDay,
    enduranceTbw: product.enduranceTbw,
  };
}

const member = (
  pool: string,
  vdevClass: PoolMembership["vdev"]["class"],
  index: number | null,
  position: number,
): PoolMembership => ({ pool, vdev: { class: vdevClass, index }, position });

const inventory = (
  purchaseDate: string,
  purchasePrice: number,
  supplier: string,
  purchaseCondition: "new" | "used" | "refurbished" | "shucked",
  warrantyExpiry: string | null,
  extra: DiskModel["inventory"] = {},
): DiskModel["inventory"] => ({
  purchaseDate,
  purchasePrice,
  supplier,
  purchaseCondition,
  warrantyExpiry,
  ...extra,
});

const ATLAS_BUILT = date("2019-11-16T13:30:00Z");
const TANK_VDEV1_ADDED = date("2021-04-10T11:05:00Z");
const SCRATCH_CREATED = date("2021-10-23T16:20:00Z");
const SPECIAL_ADDED = date("2022-08-20T10:45:00Z");
export const W1_REPLACED_AT = date("2024-03-09T10:15:00Z");
export const W2_REPLACED_AT = date("2024-03-16T10:40:00Z");
export const TANK_RESILVER_DURATION_MS = 26 * HOUR_MS;
const STYX_BUILT = date("2020-06-06T15:00:00Z");
const VAULT_SPARE_ADDED = date("2021-01-16T12:30:00Z");
const PIP_BUILT = date("2022-06-18T19:00:00Z");
const PIP_MEDIA_DISK_ADDED = date("2023-01-21T14:00:00Z");
const BENCH_BUILT = date("2025-02-08T11:00:00Z");
const BURNIN_CREATED = date("2025-02-08T11:40:00Z");

/** P1 reaches 87.5 % of rated endurance at the anchor, so `percentage_used` reads 87. */
export const P1_PERCENTAGE_USED_AT_ANCHOR = 87.5;

function atlasDisks(timeline: Timeline): DiskSpec[] {
  const exosX16 = (alias: string, kernel: string, position: number) =>
    ({
      alias,
      host: "atlas",
      product: "exosX16",
      slot: hba(kernel),
      membership: member("tank", "normal", 0, position),
      installedAt: ATLAS_BUILT,
      inventory: inventory("2019-11-08", 389.99, "Scan", "new", "2024-11-08"),
      powerOnHoursAtInstall: 2,
      bytesWrittenPerDay: 55 * GB,
    }) satisfies DiskSpec;
  const exosX18 = (alias: string, kernel: string, position: number) =>
    ({
      alias,
      host: "atlas",
      product: "exosX18",
      slot: hba(kernel),
      membership: member("tank", "normal", 1, position),
      installedAt: TANK_VDEV1_ADDED,
      inventory: inventory("2021-03-24", 429.0, "Scan", "new", "2026-03-24"),
      powerOnHoursAtInstall: 1,
      bytesWrittenPerDay: 60 * GB,
    }) satisfies DiskSpec;
  return [
    exosX16("A1", "sda", 0),
    exosX16("A2", "sdb", 1),
    exosX16("A3", "sdc", 2),
    exosX16("A4", "sdd", 3),
    {
      alias: "A5",
      host: "atlas",
      product: "hc550",
      slot: hba("sde"),
      membership: member("tank", "normal", 0, 4),
      installedAt: W1_REPLACED_AT,
      inventory: inventory(
        "2024-03-02",
        219.0,
        "Bargain Hardware",
        "refurbished",
        "2027-03-02",
      ),
      powerOnHoursAtInstall: 9_412,
      powerCyclesAtInstall: 41,
      bytesWrittenPerDay: 55 * GB,
    },
    {
      alias: "A6",
      host: "atlas",
      product: "hc550",
      slot: hba("sdf"),
      membership: member("tank", "normal", 0, 5),
      installedAt: W2_REPLACED_AT,
      inventory: inventory(
        "2024-03-02",
        219.0,
        "Bargain Hardware",
        "refurbished",
        "2027-03-02",
      ),
      powerOnHoursAtInstall: 11_870,
      powerCyclesAtInstall: 37,
      bytesWrittenPerDay: 55 * GB,
    },
    exosX18("A7", "sdg", 0),
    exosX18("A8", "sdh", 1),
    exosX18("A9", "sdi", 2),
    exosX18("A10", "sdj", 3),
    {
      alias: "A11",
      host: "atlas",
      product: "hc550",
      slot: hba("sdk"),
      membership: member("tank", "normal", 1, 4),
      installedAt: TANK_VDEV1_ADDED,
      inventory: inventory("2021-03-30", 399.0, "Amazon", "new", "2026-03-30"),
      powerOnHoursAtInstall: 1,
      bytesWrittenPerDay: 60 * GB,
    },
    {
      alias: "A12",
      host: "atlas",
      product: "hc550",
      slot: hba("sdl"),
      membership: member("tank", "normal", 1, 5),
      installedAt: TANK_VDEV1_ADDED,
      inventory: inventory("2021-03-30", 399.0, "Amazon", "new", "2026-03-30"),
      powerOnHoursAtInstall: 1,
      bytesWrittenPerDay: 60 * GB,
    },
    ...(["A13", "A14"] as const).map(
      (alias, position): DiskSpec => ({
        alias,
        host: "atlas",
        product: "evo870_2tb",
        slot: hba(position === 0 ? "sdm" : "sdn"),
        membership: member("tank", "special", 2, position),
        installedAt: SPECIAL_ADDED,
        inventory: inventory(
          "2022-08-12",
          169.99,
          "Amazon",
          "new",
          "2027-08-12",
        ),
        bytesWrittenPerDay: 38 * GB,
      }),
    ),
    ...(["A15", "A16"] as const).map(
      (alias, position): DiskSpec => ({
        alias,
        host: "atlas",
        product: "intelS4610",
        slot: ahci(position === 0 ? "sdo" : "sdp"),
        layout: { kind: "zfs-boot" },
        membership: member("rpool", "normal", 0, position),
        installedAt: ATLAS_BUILT,
        inventory: inventory("2019-10-30", 62.0, "eBay", "used", null, {
          purpose: "system",
        }),
        powerOnHoursAtInstall: position === 0 ? 21_344 : 23_109,
        powerCyclesAtInstall: position === 0 ? 58 : 61,
        bytesWrittenPerDay: 14 * GB,
      }),
    ),
    {
      alias: "A17",
      host: "atlas",
      product: "sn700_1tb",
      slot: nvme(0, 0),
      membership: member("scratch", "normal", 0, 0),
      installedAt: SCRATCH_CREATED,
      inventory: inventory(
        "2021-10-18",
        109.99,
        "Amazon",
        "new",
        isoDay(timeline.a17WarrantyExpiry),
      ),
      bytesWrittenPerDay: 160 * GB,
    },
  ];
}

function formerAtlasDisks(): DiskSpec[] {
  const shucked = (
    alias: string,
    kernel: string,
    position: number,
    replacedAt: Date,
  ): DiskSpec => {
    const memberUntil = addMs(replacedAt, TANK_RESILVER_DURATION_MS);
    return {
      alias,
      host: "atlas",
      product: "wd120emaz",
      slot: hba(kernel),
      membership: member("tank", "normal", 0, position),
      memberUntil,
      installedAt: ATLAS_BUILT,
      removedAt: addMs(memberUntil, 3 * HOUR_MS),
      inventoryOnly: true,
      inventory: inventory("2019-10-26", 179.99, "Amazon", "shucked", null, {
        pin33Taped: true,
      }),
      powerOnHoursAtInstall: 1,
      bytesWrittenPerDay: 45 * GB,
    };
  };
  return [
    shucked("W1", "sdq", 4, W1_REPLACED_AT),
    shucked("W2", "sdr", 5, W2_REPLACED_AT),
  ];
}

/** Third refurbished HC550 of the March 2024 batch: failed on the bench dock, sent back; A6 came as its replacement. */
function rmaedAtlasDisk(): DiskSpec {
  const installedAt = date("2024-03-05T19:20:00Z");
  return {
    alias: "A18",
    host: "atlas",
    product: "hc550",
    slot: hba("sds"),
    membership: null,
    installedAt,
    removedAt: addMs(installedAt, 2 * DAY_MS),
    inventoryOnly: true,
    inventory: inventory(
      "2024-03-02",
      219.0,
      "Bargain Hardware",
      "refurbished",
      "2027-03-02",
    ),
    powerOnHoursAtInstall: 10_204,
    powerCyclesAtInstall: 44,
    bytesWrittenPerDay: 1 * GB,
  };
}

function styxDisks(timeline: Timeline): DiskSpec[] {
  const redPlus = (
    alias: string,
    kernel: string,
    position: number,
  ): DiskSpec => ({
    alias,
    host: "styx",
    product: "redPlus8",
    slot: ahci(kernel),
    membership: member("vault", "normal", 0, position),
    installedAt: STYX_BUILT,
    inventory: inventory("2020-05-28", 179.99, "Scan", "new", "2023-05-28"),
    bytesWrittenPerDay: 22 * GB,
  });
  return [
    redPlus("V1", "sda", 0),
    {
      ...redPlus("V2", "sdb", 1),
      memberUntil: timeline.vaultResilverEnd,
      removedAt: timeline.v2PulledAt,
      inventoryOnly: true,
    },
    redPlus("V3", "sdc", 2),
    redPlus("V4", "sdd", 3),
    {
      alias: "V5",
      host: "styx",
      product: "redPlus8",
      slot: ahci("sde"),
      membership: member("vault", "spare", null, 0),
      memberUntil: null,
      installedAt: VAULT_SPARE_ADDED,
      removedAt: timeline.v5PulledAt,
      inventory: inventory("2021-01-10", 119.0, "eBay", "used", null),
      powerOnHoursAtInstall: 3_117,
      powerCyclesAtInstall: 19,
      bytesWrittenPerDay: 0.2 * GB,
    },
    {
      alias: "V6",
      host: "styx",
      product: "redPlus8Px",
      slot: ahci("sdg"),
      membership: member("vault", "normal", 0, 1),
      memberFrom: timeline.v2ReplaceAt,
      installedAt: timeline.v6InsertedAt,
      inventory: inventory(
        isoDay(addMs(timeline.v6InsertedAt, -3 * DAY_MS)),
        189.99,
        "Scan",
        "new",
        isoDay(addMs(timeline.v6InsertedAt, 3 * 365 * DAY_MS)),
      ),
      bytesWrittenPerDay: 22 * GB,
    },
    {
      alias: "V7",
      host: "styx",
      product: "evo860_500gb",
      slot: ahci("sdf"),
      layout: { kind: "zfs-boot" },
      membership: member("rpool", "normal", 0, 0),
      installedAt: STYX_BUILT,
      inventory: inventory("2020-05-30", 64.99, "Amazon", "new", "2025-05-30", {
        purpose: "system",
      }),
      bytesWrittenPerDay: 9 * GB,
    },
  ];
}

function pipDisks(timeline: Timeline): DiskSpec[] {
  const rpoolDays = (timeline.anchor.getTime() - PIP_BUILT.getTime()) / DAY_MS;
  const p1Endurance = PRODUCTS.p3Plus1tb.enduranceTbw * TB;
  const rpoolBytesPerDay =
    (p1Endurance * P1_PERCENTAGE_USED_AT_ANCHOR) / 100 / rpoolDays;
  return [
    {
      alias: "P1",
      host: "pip",
      product: "p3Plus1tb",
      slot: nvme(0, 0),
      layout: { kind: "zfs-boot" },
      membership: member("rpool", "normal", 0, 0),
      installedAt: PIP_BUILT,
      inventory: inventory("2022-06-10", 64.99, "Amazon", "new", "2027-06-10", {
        purpose: "system",
      }),
      bytesWrittenPerDay: rpoolBytesPerDay,
    },
    {
      alias: "P2",
      host: "pip",
      product: "sn700_1tb",
      slot: nvme(1, 3),
      layout: { kind: "zfs-boot" },
      membership: member("rpool", "normal", 0, 1),
      installedAt: PIP_BUILT,
      inventory: inventory("2022-06-10", 94.99, "Scan", "new", "2027-06-10", {
        purpose: "system",
      }),
      bytesWrittenPerDay: rpoolBytesPerDay,
    },
    {
      alias: "P3",
      host: "pip",
      product: "evo870_4tb",
      slot: ahci("sda"),
      layout: {
        kind: "luks-ext4",
        luksName: "media_crypt",
        mountpoint: "/srv/media",
      },
      membership: null,
      installedAt: PIP_MEDIA_DISK_ADDED,
      inventory: inventory("2023-01-14", 239.0, "Amazon", "new", "2028-01-14", {
        purpose: "other",
      }),
      bytesWrittenPerDay: 12 * GB,
    },
  ];
}

function benchDisks(): DiskSpec[] {
  const usedExos = (alias: string, kernel: string, position: number) =>
    ({
      alias,
      host: "bench",
      product: "exosX16",
      slot: ahci(kernel),
      membership: member("burnin", "normal", 0, position),
      installedAt: BENCH_BUILT,
      inventory: inventory("2025-01-30", 164.0, "eBay", "used", null),
      powerOnHoursAtInstall: position === 0 ? 31_206 : 29_874,
      powerCyclesAtInstall: position === 0 ? 22 : 25,
      bytesWrittenPerDay: 5 * GB,
    }) satisfies DiskSpec;
  return [usedExos("B1", "sda", 0), usedExos("B2", "sdb", 1)];
}

/** No reboots in the 50 days before the anchor, so `zpool events` and error counters still carry the stories. */
function hostBoots(
  name: HostName,
  installedAt: Date,
  timeline: Timeline,
): Date[] {
  const quietFrom = timeline.anchor.getTime() - 50 * DAY_MS;
  const quietUntil = timeline.anchor.getTime() + DAY_MS;
  const rng = forkRng(`boots:${name}`);
  const until = date("2032-01-01T00:00:00Z").getTime();
  const boots: Date[] = [installedAt];
  let at = installedAt.getTime();
  for (;;) {
    at += rng.int(24, 78) * DAY_MS + rng.int(0, 23) * HOUR_MS;
    if (at > until) return boots;
    if (at >= quietFrom && at <= quietUntil) continue;
    boots.push(new Date(at - (at % (15 * 60_000))));
  }
}

const UBUNTU_ZFS = "zfs-2.4.1-1ubuntu5.1";

function hosts(timeline: Timeline): HostModel[] {
  const host = (
    model: Omit<HostModel, "boots"> & { installedAt: Date },
  ): HostModel => ({
    ...model,
    boots: hostBoots(model.name, model.installedAt, timeline),
  });
  return [
    host({
      name: "atlas",
      role: "main NAS",
      os: "Ubuntu 26.04.1 LTS",
      kernel: "7.0.0-34-generic",
      zfsVersion: UBUNTU_ZFS,
      smartctlVersion:
        "smartctl 7.5 2025-04-30 r5714 [x86_64-linux-7.0.0-34-generic] (local build)",
      vdevIdConf: true,
      ambientC: 23,
      installedAt: ATLAS_BUILT,
    }),
    host({
      name: "styx",
      role: "backup box",
      os: "Debian GNU/Linux 13 (trixie)",
      kernel: "6.12.43+deb13-amd64",
      zfsVersion: "zfs-2.3.2-2",
      smartctlVersion:
        "smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.12.43+deb13-amd64] (local build)",
      vdevIdConf: true,
      ambientC: 18,
      installedAt: STYX_BUILT,
    }),
    host({
      name: "pip",
      role: "mini PC",
      os: "Ubuntu 26.04.1 LTS",
      kernel: "7.0.0-31-generic",
      zfsVersion: UBUNTU_ZFS,
      smartctlVersion:
        "smartctl 7.5 2025-04-30 r5714 [x86_64-linux-7.0.0-31-generic] (local build)",
      vdevIdConf: false,
      ambientC: 25,
      installedAt: PIP_BUILT,
    }),
    host({
      name: "bench",
      role: "test bench",
      os: "Debian GNU/Linux 13 (trixie)",
      kernel: "6.12.43+deb13-amd64",
      zfsVersion: "zfs-2.3.2-2",
      smartctlVersion:
        "smartctl 7.4 2023-08-01 r5530 [x86_64-linux-6.12.43+deb13-amd64] (local build)",
      vdevIdConf: false,
      ambientC: 21,
      installedAt: BENCH_BUILT,
      intermittent: true,
      lastRunAt: timeline.benchLastRunAt,
      collectorVersion: "0.3.0",
    }),
  ];
}

const vdev = (
  vdevClass: VdevModel["class"],
  type: VdevModel["type"],
  index: number | null,
  width: number,
  addedAt: Date,
): VdevModel => ({ class: vdevClass, type, index, width, addedAt });

const DEFAULT_POOL_PROPERTIES = {
  autotrim: "off",
  autoexpand: "off",
  autoreplace: "off",
  failmode: "wait",
};

function pools(): PoolModel[] {
  const pool = (model: Omit<PoolModel, "guid">): PoolModel => ({
    ...model,
    guid: guidFor(`pool:${model.host}/${model.name}`),
  });
  return [
    pool({
      name: "tank",
      host: "atlas",
      createdAt: date("2019-11-16T14:02:00Z"),
      ashift: 12,
      vdevs: [
        vdev("normal", "raidz2", 0, 6, date("2019-11-16T14:02:00Z")),
        vdev("normal", "raidz2", 1, 6, TANK_VDEV1_ADDED),
        vdev("special", "mirror", 2, 2, SPECIAL_ADDED),
      ],
      allocatedFraction: { atCreation: 0.02, atAnchor: 0.62 },
      scrubDurationMs: 20.5 * HOUR_MS,
      scrubSchedule: "monthly-second-sunday",
      properties: { ...DEFAULT_POOL_PROPERTIES, autoexpand: "on" },
    }),
    pool({
      name: "rpool",
      host: "atlas",
      createdAt: date("2019-11-16T13:40:00Z"),
      ashift: 12,
      vdevs: [vdev("normal", "mirror", 0, 2, date("2019-11-16T13:40:00Z"))],
      allocatedFraction: { atCreation: 0.01, atAnchor: 0.09 },
      scrubDurationMs: 4 * 60_000,
      scrubSchedule: "monthly-second-sunday",
      properties: { ...DEFAULT_POOL_PROPERTIES, autotrim: "on" },
    }),
    pool({
      name: "scratch",
      host: "atlas",
      createdAt: SCRATCH_CREATED,
      ashift: 12,
      vdevs: [vdev("normal", "disk", 0, 1, SCRATCH_CREATED)],
      allocatedFraction: { atCreation: 0, atAnchor: 0.47 },
      scrubDurationMs: 11 * 60_000,
      scrubSchedule: "none",
      properties: { ...DEFAULT_POOL_PROPERTIES, autotrim: "on" },
    }),
    pool({
      name: "vault",
      host: "styx",
      createdAt: date("2020-06-06T15:30:00Z"),
      ashift: 12,
      vdevs: [
        vdev("normal", "raidz1", 0, 4, date("2020-06-06T15:30:00Z")),
        vdev("spare", "disk", null, 1, VAULT_SPARE_ADDED),
      ],
      allocatedFraction: { atCreation: 0, atAnchor: 0.52 },
      scrubDurationMs: 9 * HOUR_MS + 40 * 60_000,
      scrubSchedule: "weekly-sunday",
      properties: DEFAULT_POOL_PROPERTIES,
    }),
    pool({
      name: "rpool",
      host: "styx",
      createdAt: date("2020-06-06T15:05:00Z"),
      ashift: 12,
      vdevs: [vdev("normal", "disk", 0, 1, date("2020-06-06T15:05:00Z"))],
      allocatedFraction: { atCreation: 0.01, atAnchor: 0.06 },
      scrubDurationMs: 3 * 60_000,
      scrubSchedule: "monthly-second-sunday",
      properties: { ...DEFAULT_POOL_PROPERTIES, autotrim: "on" },
    }),
    pool({
      name: "rpool",
      host: "pip",
      createdAt: date("2022-06-18T19:10:00Z"),
      ashift: 12,
      vdevs: [vdev("normal", "mirror", 0, 2, date("2022-06-18T19:10:00Z"))],
      allocatedFraction: { atCreation: 0.01, atAnchor: 0.71 },
      scrubDurationMs: 14 * 60_000,
      scrubSchedule: "monthly-second-sunday",
      properties: { ...DEFAULT_POOL_PROPERTIES, autotrim: "on" },
    }),
    pool({
      name: "burnin",
      host: "bench",
      createdAt: BURNIN_CREATED,
      ashift: 12,
      vdevs: [vdev("normal", "mirror", 0, 2, BURNIN_CREATED)],
      allocatedFraction: { atCreation: 0, atAnchor: 0.08 },
      scrubDurationMs: 6 * HOUR_MS,
      scrubSchedule: "monthly-second-sunday",
      properties: DEFAULT_POOL_PROPERTIES,
    }),
  ];
}

const SANOID = {
  production: { style: "sanoid", hourly: 48, daily: 30, monthly: 6 },
  media: { style: "sanoid", hourly: 0, daily: 14, monthly: 6 },
  backup: { style: "sanoid", hourly: 0, daily: 30, monthly: 12 },
  vm: { style: "sanoid", hourly: 24, daily: 7, monthly: 0 },
  system: { style: "sanoid", hourly: 0, daily: 14, monthly: 3 },
  systemHome: { style: "sanoid", hourly: 24, daily: 14, monthly: 3 },
  replica: { style: "sanoid", hourly: 0, daily: 120, monthly: 24 },
} as const satisfies Record<string, SnapshotPolicy>;

const AUTO_SNAP = {
  root: { style: "zfs-auto-snap", hourly: 24, daily: 14, monthly: 0 },
  home: { style: "zfs-auto-snap", hourly: 24, daily: 31, monthly: 0 },
} as const satisfies Record<string, SnapshotPolicy>;

/** syncoid on styx pulls every replicated dataset daily at this UTC time. */
export const REPLICATION_DAILY_AT_UTC = "02:30";

interface DatasetSpec {
  name: string;
  createdAt: Date;
  referenced: [atCreation: number, atAnchor: number];
  churnPerDay?: number;
  compressRatio?: number;
  recordsize?: number;
  compression?: string;
  mountpoint?: string | null;
  quota?: number;
  snapshots?: SnapshotPolicy;
  volsize?: number;
  replicaOf?: string;
}

const KiB = 1024;

function dataset(spec: DatasetSpec): DatasetModel {
  const isVolume = spec.volsize !== undefined;
  return {
    name: spec.name,
    type: isVolume ? "volume" : "filesystem",
    createdAt: spec.createdAt,
    referencedBytes: {
      atCreation: spec.referenced[0],
      atAnchor: spec.referenced[1],
    },
    churnBytesPerDay: spec.churnPerDay ?? 0,
    compressRatio: spec.compressRatio ?? 1.0,
    recordsize: isVolume ? null : (spec.recordsize ?? 128 * KiB),
    volsize: spec.volsize ?? null,
    compression: spec.compression ?? "lz4",
    encryption: "off",
    mountpoint: isVolume
      ? null
      : spec.mountpoint === undefined
        ? `/${spec.name}`
        : spec.mountpoint,
    quota: spec.quota ?? 0,
    snapshots: spec.snapshots ?? null,
    ...(spec.replicaOf && { replicaOf: spec.replicaOf }),
  };
}

const MiB = 1024 * KiB;
const TANK_CREATED = date("2019-11-16T14:02:00Z");

const REPLICATED_TANK_DATASETS = [
  "tank/photos",
  "tank/home/ada",
  "tank/home/ben",
  "tank/media/music",
  "tank/backups/laptops",
] as const;

function atlasDatasets(): DatasetModel[] {
  const tank = (spec: Omit<DatasetSpec, "createdAt"> & { createdAt?: Date }) =>
    dataset({ createdAt: TANK_CREATED, ...spec });
  return [
    tank({ name: "tank", referenced: [200 * KiB, 200 * KiB] }),
    tank({ name: "tank/media", referenced: [200 * KiB, 200 * KiB] }),
    tank({
      name: "tank/media/films",
      referenced: [4 * TB, 41 * TB],
      churnPerDay: 25 * GB,
      recordsize: 1 * MiB,
      snapshots: SANOID.media,
    }),
    tank({
      name: "tank/media/tv",
      referenced: [2 * TB, 27 * TB],
      churnPerDay: 30 * GB,
      recordsize: 1 * MiB,
      snapshots: SANOID.media,
    }),
    tank({
      name: "tank/media/music",
      referenced: [0.6 * TB, 1.4 * TB],
      churnPerDay: 0.8 * GB,
      recordsize: 1 * MiB,
      snapshots: SANOID.media,
    }),
    tank({
      name: "tank/photos",
      referenced: [0.9 * TB, 3.1 * TB],
      churnPerDay: 4 * GB,
      recordsize: 1 * MiB,
      snapshots: SANOID.production,
    }),
    tank({ name: "tank/home", referenced: [200 * KiB, 200 * KiB] }),
    tank({
      name: "tank/home/ada",
      referenced: [0.2 * TB, 1.2 * TB],
      churnPerDay: 3 * GB,
      compressRatio: 1.21,
      snapshots: SANOID.production,
    }),
    tank({
      name: "tank/home/ben",
      referenced: [0.1 * TB, 0.6 * TB],
      churnPerDay: 1.5 * GB,
      compressRatio: 1.34,
      snapshots: SANOID.production,
    }),
    tank({ name: "tank/backups", referenced: [200 * KiB, 200 * KiB] }),
    tank({
      name: "tank/backups/styx",
      createdAt: STYX_BUILT,
      referenced: [2 * GB, 48 * GB],
      churnPerDay: 0.4 * GB,
      compressRatio: 1.9,
      compression: "zstd",
      snapshots: SANOID.backup,
    }),
    tank({
      name: "tank/backups/pip",
      createdAt: PIP_BUILT,
      referenced: [5 * GB, 310 * GB],
      churnPerDay: 2 * GB,
      compressRatio: 1.6,
      compression: "zstd",
      snapshots: SANOID.backup,
    }),
    tank({
      name: "tank/backups/laptops",
      referenced: [0.3 * TB, 2.4 * TB],
      churnPerDay: 6 * GB,
      compressRatio: 1.45,
      compression: "zstd",
      snapshots: SANOID.backup,
    }),
    tank({
      name: "tank/vm",
      createdAt: date("2021-05-02T09:00:00Z"),
      referenced: [200 * KiB, 200 * KiB],
    }),
    tank({
      name: "tank/vm/haos",
      createdAt: date("2021-05-02T09:10:00Z"),
      referenced: [6 * GB, 31 * GB],
      churnPerDay: 1.2 * GB,
      volsize: 64 * 1024 * MiB,
      compressRatio: 1.52,
      snapshots: SANOID.vm,
    }),
    tank({
      name: "tank/vm/win11",
      createdAt: date("2023-02-11T20:00:00Z"),
      referenced: [22 * GB, 71 * GB],
      churnPerDay: 2.5 * GB,
      volsize: 128 * 1024 * MiB,
      compressRatio: 1.18,
      snapshots: SANOID.vm,
    }),
    tank({
      name: "tank/vm/k3s-01",
      createdAt: date("2024-09-07T13:00:00Z"),
      referenced: [8 * GB, 38 * GB],
      churnPerDay: 3 * GB,
      volsize: 100 * 1024 * MiB,
      compressRatio: 1.71,
      snapshots: SANOID.vm,
    }),
    dataset({
      name: "rpool",
      createdAt: ATLAS_BUILT,
      referenced: [96 * KiB, 96 * KiB],
      mountpoint: "/",
    }),
    dataset({
      name: "rpool/ROOT",
      createdAt: ATLAS_BUILT,
      referenced: [96 * KiB, 96 * KiB],
      mountpoint: "none",
    }),
    dataset({
      name: "rpool/ROOT/ubuntu",
      createdAt: ATLAS_BUILT,
      referenced: [4 * GB, 22 * GB],
      churnPerDay: 0.6 * GB,
      compressRatio: 1.94,
      mountpoint: "/",
      snapshots: SANOID.system,
    }),
    dataset({
      name: "rpool/home",
      createdAt: ATLAS_BUILT,
      referenced: [0.1 * GB, 4 * GB],
      churnPerDay: 0.1 * GB,
      compressRatio: 1.4,
      mountpoint: "/home",
      snapshots: SANOID.systemHome,
    }),
    dataset({
      name: "scratch",
      createdAt: SCRATCH_CREATED,
      referenced: [96 * KiB, 96 * KiB],
      compression: "off",
    }),
    dataset({
      name: "scratch/downloads",
      createdAt: SCRATCH_CREATED,
      referenced: [20 * GB, 380 * GB],
      churnPerDay: 120 * GB,
      compression: "off",
    }),
    dataset({
      name: "scratch/transcode",
      createdAt: SCRATCH_CREATED,
      referenced: [5 * GB, 60 * GB],
      churnPerDay: 40 * GB,
      compression: "off",
    }),
  ];
}

function styxDatasets(): DatasetModel[] {
  const vaultCreated = date("2020-06-06T15:30:00Z");
  const container = (name: string, mountpoint?: string | null) =>
    dataset({
      name,
      createdAt: vaultCreated,
      referenced: [200 * KiB, 200 * KiB],
      compression: "zstd",
      ...(mountpoint !== undefined && { mountpoint }),
    });
  const sources = new Map(
    atlasDatasets().map((source) => [source.name, source]),
  );
  const replicas = REPLICATED_TANK_DATASETS.map((sourceName) => {
    const source = sources.get(sourceName);
    if (!source) throw new Error(`Unknown replicated dataset ${sourceName}`);
    const firstReplication = new Date(
      Math.max(source.createdAt.getTime(), vaultCreated.getTime() + DAY_MS),
    );
    return dataset({
      name: `vault/replica/${sourceName}`,
      createdAt: firstReplication,
      referenced: [
        source.referencedBytes.atCreation,
        source.referencedBytes.atAnchor,
      ],
      churnPerDay: source.churnBytesPerDay,
      compressRatio: source.compressRatio,
      compression: source.compression,
      recordsize: source.recordsize ?? undefined,
      mountpoint: "none",
      snapshots: SANOID.replica,
      replicaOf: sourceName,
    });
  });
  const replicaParents = [
    ...new Set(
      REPLICATED_TANK_DATASETS.flatMap((name) => {
        const parts = name.split("/");
        return parts
          .slice(1, -1)
          .map((_, index) => parts.slice(0, index + 2).join("/"));
      }),
    ),
  ];
  return [
    container("vault"),
    container("vault/replica", "none"),
    container("vault/replica/tank", "none"),
    ...replicaParents.map((name) => container(`vault/replica/${name}`, "none")),
    ...replicas,
    dataset({
      name: "rpool",
      createdAt: STYX_BUILT,
      referenced: [96 * KiB, 96 * KiB],
      mountpoint: "/",
    }),
    dataset({
      name: "rpool/ROOT",
      createdAt: STYX_BUILT,
      referenced: [96 * KiB, 96 * KiB],
      mountpoint: "none",
    }),
    dataset({
      name: "rpool/ROOT/debian",
      createdAt: STYX_BUILT,
      referenced: [2 * GB, 9 * GB],
      churnPerDay: 0.3 * GB,
      compressRatio: 2.1,
      mountpoint: "/",
      snapshots: AUTO_SNAP.root,
    }),
    dataset({
      name: "rpool/home",
      createdAt: STYX_BUILT,
      referenced: [0.05 * GB, 1.2 * GB],
      churnPerDay: 0.02 * GB,
      compressRatio: 1.3,
      mountpoint: "/home",
      snapshots: AUTO_SNAP.home,
    }),
  ];
}

function pipDatasets(): DatasetModel[] {
  const created = date("2022-06-18T19:10:00Z");
  return [
    dataset({
      name: "rpool",
      createdAt: created,
      referenced: [96 * KiB, 96 * KiB],
      mountpoint: "/",
    }),
    dataset({
      name: "rpool/ROOT",
      createdAt: created,
      referenced: [96 * KiB, 96 * KiB],
      mountpoint: "none",
    }),
    dataset({
      name: "rpool/ROOT/ubuntu",
      createdAt: created,
      referenced: [5 * GB, 28 * GB],
      churnPerDay: 0.8 * GB,
      compressRatio: 1.88,
      mountpoint: "/",
      snapshots: AUTO_SNAP.root,
    }),
    dataset({
      name: "rpool/home",
      createdAt: created,
      referenced: [0.2 * GB, 12 * GB],
      churnPerDay: 0.3 * GB,
      compressRatio: 1.25,
      mountpoint: "/home",
      snapshots: AUTO_SNAP.home,
    }),
    dataset({
      name: "rpool/frigate",
      createdAt: date("2022-07-02T10:00:00Z"),
      referenced: [40 * GB, 610 * GB],
      churnPerDay: 110 * GB,
      recordsize: 1 * MiB,
      compression: "off",
      mountpoint: "/srv/frigate",
    }),
  ];
}

function benchDatasets(): DatasetModel[] {
  return [
    dataset({
      name: "burnin",
      createdAt: BURNIN_CREATED,
      referenced: [96 * KiB, 1.1 * TB],
      churnPerDay: 5 * GB,
    }),
  ];
}

export function createFleet(timeline: Timeline): Fleet {
  const disks = [
    ...atlasDisks(timeline),
    ...formerAtlasDisks(),
    ...styxDisks(timeline),
    ...pipDisks(timeline),
    ...benchDisks(),
    rmaedAtlasDisk(),
  ].map(buildDisk);
  return {
    hosts: hosts(timeline),
    pools: pools(),
    disks,
    datasets: {
      atlas: atlasDatasets(),
      styx: styxDatasets(),
      pip: pipDatasets(),
      bench: benchDatasets(),
    },
  };
}

const byIdModel = (disk: DiskModel) => disk.model.replace(/\s+/g, "_");

/** `/dev/disk/by-id` names for the whole disk, as udev creates them; partitions append `-part<n>`. */
export function byIdNames(disk: DiskModel): string[] {
  const model = byIdModel(disk);
  switch (disk.transport) {
    case "nvme":
      return [`nvme-${model}_${disk.serial}`, `nvme-${disk.wwn}`];
    case "sas":
      return [
        `scsi-3${disk.wwn}`,
        `scsi-SATA_${model}_${disk.serial}`,
        `wwn-0x${disk.wwn}`,
      ];
    case "sata":
      return [`ata-${model}_${disk.serial}`, `wwn-0x${disk.wwn}`];
  }
}

/** Target of the disk's `alias` line in vdev_id.conf. */
export function vdevIdTarget(disk: DiskModel): string {
  return disk.transport === "nvme" ? `nvme-${disk.wwn}` : `wwn-0x${disk.wwn}`;
}

export function snapshotGuid(sourceDataset: string, snapshotName: string) {
  return guidFor(`snapshot:${sourceDataset}@${snapshotName}`);
}

export function vdevGuid(pool: PoolModel, key: string) {
  return guidFor(`vdev:${pool.host}/${pool.name}/${key}`);
}
