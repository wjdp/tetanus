import { byIdNames, vdevIdTarget } from "./fleet";
import { forkRng } from "./prng";
import { templateBlockSizes } from "./smartTemplates";
import type { DemoEnclosure, DiskModel, HostModel } from "./types";
import type { DemoWorld } from "./world";

const MiB = 1024 * 1024;
const SCSI_INQUIRY_MODEL_LENGTH = 16;
const DEVICE_MAPPER_MAJOR = 252;
const HBA_PCI = "pci-0000:01:00.0";
const AHCI_PCI = "pci-0000:00:17.0";
const UBUNTU_SNAPS = [
  { mountpoint: "/snap/core24/1055", size: 68_993_024 },
  { mountpoint: "/snap/snapd/24792", size: 52_236_288 },
];

interface LsblkNode {
  name: string;
  type: string;
  size: number;
  model: string | null;
  serial: string | null;
  wwn: string | null;
  tran: string | null;
  rota: boolean;
  "maj:min": string;
  path: string;
  pttype: string | null;
  partuuid: string | null;
  fstype: string | null;
  zoned: string;
  "log-sec": number;
  "phy-sec": number;
  mountpoints: (string | null)[];
  children?: LsblkNode[];
}

interface PartitionSpec {
  number: number;
  size: number;
  fsType: string | null;
  mountpoint: string | null;
  crypt?: { name: string; mountpoint: string };
}

function uuidFor(key: string): string {
  const hex = forkRng(`uuid:${key}`).hex(32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

const byNaturalAlias = (a: DiskModel, b: DiskModel) =>
  a.alias.localeCompare(b.alias, "en", { numeric: true });

function kernelIndex(disk: DiskModel): number {
  return disk.transport === "nvme"
    ? Number(/^nvme(\d+)/.exec(disk.kernelName)?.[1] ?? 0)
    : disk.kernelName.charCodeAt(2) - "a".charCodeAt(0);
}

function majMinOrder(majMin: string): number {
  const [major = 0, minor = 0] = majMin.split(":").map(Number);
  return major * 1_000_000 + minor;
}

/** What lsblk and udev show for MODEL: the 16-character SCSI INQUIRY product for ATA disks. */
function inquiryModel(disk: DiskModel): string {
  return disk.protocol === "nvme"
    ? disk.model
    : disk.model.slice(0, SCSI_INQUIRY_MODEL_LENGTH).trimEnd();
}

function partitionsOf(disk: DiskModel): PartitionSpec[] {
  const { layout } = disk;
  switch (layout.kind) {
    case "zfs-whole-disk":
      return [
        {
          number: 1,
          size: disk.capacityBytes - 10 * MiB,
          fsType: "zfs_member",
          mountpoint: null,
        },
        { number: 9, size: 8 * MiB, fsType: null, mountpoint: null },
      ];
    case "zfs-boot":
      return [
        {
          number: 1,
          size: 512 * MiB,
          fsType: "vfat",
          mountpoint: disk.membership?.position === 0 ? "/boot/efi" : null,
        },
        {
          number: 2,
          size: disk.capacityBytes - 514 * MiB,
          fsType: "zfs_member",
          mountpoint: null,
        },
      ];
    case "luks-ext4":
      return [
        {
          number: 1,
          size: disk.capacityBytes - 2 * MiB,
          fsType: "crypto_LUKS",
          mountpoint: null,
          crypt: { name: layout.luksName, mountpoint: layout.mountpoint },
        },
      ];
  }
}

function partitionName(disk: DiskModel, number: number) {
  return disk.transport === "nvme"
    ? `${disk.kernelName}p${number}`
    : `${disk.kernelName}${number}`;
}

function partitionMajMin(disk: DiskModel, number: number, position: number) {
  const [major, minor = 0] = disk.majMin.split(":").map(Number);
  return disk.transport === "nvme"
    ? `${major}:${minor + position + 1}`
    : `${major}:${minor + number}`;
}

function lsblkWwn(disk: DiskModel) {
  return disk.transport === "nvme" ? disk.wwn : `0x${disk.wwn}`;
}

function diskNode(disk: DiskModel, cryptMinor: () => number): LsblkNode {
  const sectors = templateBlockSizes(disk.template);
  const common = {
    zoned: "none",
    "log-sec": sectors.logical,
    "phy-sec": sectors.physical,
  };
  const children = partitionsOf(disk).map(
    (partition, position): LsblkNode => ({
      name: partitionName(disk, partition.number),
      type: "part",
      size: partition.size,
      model: null,
      serial: null,
      wwn: lsblkWwn(disk),
      tran: disk.transport === "nvme" ? "nvme" : null,
      rota: disk.rotational,
      "maj:min": partitionMajMin(disk, partition.number, position),
      path: `/dev/${partitionName(disk, partition.number)}`,
      pttype: "gpt",
      partuuid: uuidFor(`partuuid:${disk.alias}:${partition.number}`),
      fstype: partition.fsType,
      ...common,
      mountpoints: [partition.mountpoint],
      ...(partition.crypt && {
        children: [
          {
            name: partition.crypt.name,
            type: "crypt",
            size: partition.size - 16 * MiB,
            model: null,
            serial: null,
            wwn: null,
            tran: null,
            rota: disk.rotational,
            "maj:min": `${DEVICE_MAPPER_MAJOR}:${cryptMinor()}`,
            path: `/dev/mapper/${partition.crypt.name}`,
            pttype: null,
            partuuid: null,
            fstype: "ext4",
            ...common,
            mountpoints: [partition.crypt.mountpoint],
          },
        ],
      }),
    }),
  );
  return {
    name: disk.kernelName,
    type: "disk",
    size: disk.capacityBytes,
    model: inquiryModel(disk),
    serial: disk.serial,
    wwn: lsblkWwn(disk),
    tran: disk.transport,
    rota: disk.rotational,
    "maj:min": disk.majMin,
    path: `/dev/${disk.kernelName}`,
    pttype: "gpt",
    partuuid: null,
    fstype: null,
    ...common,
    mountpoints: [null],
    children,
  };
}

function loopNodes(host: HostModel): LsblkNode[] {
  if (!host.os.startsWith("Ubuntu")) return [];
  return UBUNTU_SNAPS.map((snap, index) => ({
    name: `loop${index}`,
    type: "loop",
    size: snap.size,
    model: null,
    serial: null,
    wwn: null,
    tran: null,
    rota: false,
    "maj:min": `7:${index}`,
    path: `/dev/loop${index}`,
    pttype: null,
    partuuid: null,
    fstype: "squashfs",
    zoned: "none",
    "log-sec": 512,
    "phy-sec": 512,
    mountpoints: [snap.mountpoint],
  }));
}

/** `lsblk -J -b -o NAME,…,PHY-SEC,MOUNTPOINTS` for the disks attached at the time. */
export function renderLsblk(host: HostModel, disks: DiskModel[]): string {
  let nextCryptMinor = 0;
  const cryptMinor = () => nextCryptMinor++;
  const blockdevices = [
    ...loopNodes(host),
    ...[...disks]
      .sort((a, b) => majMinOrder(a.majMin) - majMinOrder(b.majMin))
      .map((disk) => diskNode(disk, cryptMinor)),
  ];
  return `${JSON.stringify({ blockdevices }, null, 3)}\n`;
}

/** Disks with an alias line in vdev_id.conf: edited when a disk is retired, left alone when one goes missing. */
export function vdevAliasedDisks(
  world: DemoWorld,
  host: HostModel,
  t: Date,
): DiskModel[] {
  if (!host.vdevIdConf) return [];
  return world.fleet.disks
    .filter(
      (disk) =>
        disk.host === host.name &&
        disk.installedAt <= t &&
        (!disk.inventoryOnly || world.stories.isPresent(disk, t)),
    )
    .sort(byNaturalAlias);
}

export function renderVdevIdConf(disks: DiskModel[]): string {
  return disks
    .map((disk) => `alias\t${disk.alias}\t${vdevIdTarget(disk)}\n`)
    .join("");
}

const udevEncode = (value: string) => value.replace(/ /g, "\\x20");
const udevSafe = (value: string) => value.trim().replace(/\s+/g, "_");

function byPath(
  disk: DiskModel,
  enclosure: DemoEnclosure | undefined,
): string[] {
  const index = kernelIndex(disk);
  switch (disk.transport) {
    case "nvme":
      return [`pci-0000:0${index + 2}:00.0-nvme-1`];
    case "sas":
      return enclosure
        ? [`${HBA_PCI}-sas-exp0x${enclosure.id}-phy${index}-lun-0`]
        : [`${HBA_PCI}-sas-phy${index}-lun-0`];
    case "sata":
      return [`${AHCI_PCI}-ata-${index + 1}.0`, `${AHCI_PCI}-ata-${index + 1}`];
  }
}

function scsiLines(disk: DiskModel): string[] {
  const inquiry = inquiryModel(disk);
  const encodedModel = udevEncode(
    inquiry.padEnd(SCSI_INQUIRY_MODEL_LENGTH, " "),
  );
  const revision = disk.firmware.slice(-4);
  const ataName = `${udevSafe(disk.model)}_${disk.serial}`;
  return [
    "E:SCSI_TPGS=0",
    "E:SCSI_TYPE=disk",
    "E:SCSI_VENDOR=ATA",
    "E:SCSI_VENDOR_ENC=ATA\\x20\\x20\\x20\\x20\\x20",
    `E:SCSI_MODEL=${udevSafe(inquiry)}`,
    `E:SCSI_MODEL_ENC=${encodedModel}`,
    `E:SCSI_REVISION=${revision}`,
    "E:ID_SCSI=1",
    "E:ID_SCSI_INQUIRY=1",
    `E:SCSI_IDENT_SERIAL=${disk.serial}`,
    `E:SCSI_IDENT_LUN_VENDOR=${disk.serial}`,
    `E:SCSI_IDENT_LUN_T10=ATA_${ataName}`,
    `E:SCSI_IDENT_LUN_ATA=${ataName}`,
    `E:SCSI_IDENT_LUN_NAA_REG=${disk.wwn}`,
    "E:ID_VENDOR=ATA",
    "E:ID_VENDOR_ENC=ATA\\x20\\x20\\x20\\x20\\x20",
    `E:ID_MODEL=${udevSafe(inquiry)}`,
    `E:ID_MODEL_ENC=${encodedModel}`,
    `E:ID_REVISION=${revision}`,
    "E:ID_TYPE=disk",
    `E:ID_WWN_WITH_EXTENSION=0x${disk.wwn}`,
    `E:ID_WWN=0x${disk.wwn}`,
    ...(disk.transport === "sas"
      ? [
          "E:ID_BUS=scsi",
          `E:ID_SERIAL=3${disk.wwn}`,
          `E:ID_SERIAL_SHORT=${disk.wwn}`,
        ]
      : [
          "E:ID_BUS=ata",
          "E:ID_ATA=1",
          `E:ID_SERIAL=${ataName}`,
          `E:ID_SERIAL_SHORT=${disk.serial}`,
        ]),
    `E:ID_SCSI_SERIAL=${disk.serial}`,
    "E:DM_MULTIPATH_DEVICE_PATH=0",
  ];
}

function nvmeLines(disk: DiskModel): string[] {
  return [
    "E:DM_MULTIPATH_DEVICE_PATH=0",
    `E:ID_SERIAL_SHORT=${disk.serial}`,
    `E:ID_WWN=${disk.wwn}`,
    `E:ID_MODEL=${disk.model}`,
    `E:ID_REVISION=${disk.firmware}`,
    "E:ID_NSID=1",
    `E:ID_SERIAL=${udevSafe(disk.model)}_${disk.serial}_1`,
  ];
}

/** `/run/udev/data/b<maj>:<min>` for a whole disk, laid out like the mars captures. */
export function renderUdev(
  disk: DiskModel,
  diskseq: number,
  vdevAlias: string | null,
  enclosure?: DemoEnclosure,
): string {
  const paths = byPath(disk, enclosure);
  const [idPath = ""] = paths;
  const symlinks = [
    ...byIdNames(disk).map((name) => `S:disk/by-id/${name}`),
    ...(vdevAlias ? [`S:disk/by-vdev/${vdevAlias}`] : []),
    `S:disk/by-diskseq/${diskseq}`,
    ...paths.map((path) => `S:disk/by-path/${path}`),
  ];
  const initialisedUsec =
    9_000_000 + forkRng(`udev:${disk.alias}`).int(0, 99_999);
  const lines = [
    ...symlinks,
    `I:${initialisedUsec}`,
    ...(disk.transport === "nvme" ? nvmeLines(disk) : scsiLines(disk)),
    `E:ID_PATH=${idPath}`,
    `E:ID_PATH_TAG=${idPath.replace(/[:.]/g, "_")}`,
    ...(disk.transport === "sata"
      ? [`E:ID_PATH_ATA_COMPAT=${paths[1] ?? idPath}`]
      : []),
    `E:ID_PART_TABLE_UUID=${uuidFor(`part-table:${disk.alias}`)}`,
    "E:ID_PART_TABLE_TYPE=gpt",
    ...(vdevAlias
      ? [`E:ID_VDEV=${vdevAlias}`, `E:ID_VDEV_PATH=disk/by-vdev/${vdevAlias}`]
      : []),
    ...(disk.transport === "nvme" ? [] : ["E:NVME_HOST_IFACE=none"]),
    "G:systemd",
    "Q:systemd",
    "V:1",
  ];
  return `${lines.join("\n")}\n`;
}

const ENCLOSURE_NAME = "8:0:0:0";

/** What `tetanus-collect` posts for `enclosure`: `<path>\t<value>` per SES file. */
export function renderEnclosure(host: HostModel, present: DiskModel[]): string {
  const { enclosure } = host;
  if (!enclosure) return "";
  const bySlot = new Map(
    present
      .filter((disk) => disk.transport === "sas")
      .map((disk) => [kernelIndex(disk), disk]),
  );
  const lines = [
    `${ENCLOSURE_NAME}/id\t0x${enclosure.id}`,
    `${ENCLOSURE_NAME}/components\t${enclosure.slots}`,
    `${ENCLOSURE_NAME}/device/vendor\t${enclosure.vendor}`,
    `${ENCLOSURE_NAME}/device/model\t${enclosure.model}`,
  ];
  for (let slot = 0; slot < enclosure.slots; slot++) {
    const element = `${ENCLOSURE_NAME}/ArrayDevice${slot.toString(16).toUpperCase().padStart(2, "0")}`;
    const disk = bySlot.get(slot);
    lines.push(
      `${element}/slot\t${slot}`,
      `${element}/status\t${disk ? "OK" : "not installed"}`,
      `${element}/locate\t0`,
      `${element}/fault\t0`,
      ...(disk
        ? [`${element}/device/block/${disk.kernelName}/dev\t${disk.majMin}`]
        : []),
    );
  }
  return `${lines.join("\n")}\n`;
}
