export interface DiskSlot {
  enclosureId: string;
  slot: number;
}

/** A disk's slot, with the `ID_PATH` it had there, so a move is told from a re-keying. */
export interface LastSlot extends DiskSlot {
  idPath: string | null;
}

export interface EnclosureSlotState {
  element: string;
  slot: number;
  status: string | null;
  locate: boolean | null;
  fault: boolean | null;
  device: string | null;
  devnum: string | null;
}

export interface Bay {
  locationKey: string;
  label: string | null;
  defaultLabel: string;
}

export interface BayDisk {
  id: number;
  label: string;
  present: boolean;
}

export interface BaySlot extends Bay {
  slot: number;
  element: string;
  status: string | null;
  fault: boolean | null;
  disk: BayDisk | null;
}

export interface BayEnclosure {
  enclosureId: string;
  name: string;
  vendor: string | null;
  model: string | null;
  slots: BaySlot[];
}

export interface PathBay extends Bay {
  disk: BayDisk;
}

export interface HostBays {
  enclosures: BayEnclosure[];
  paths: PathBay[];
  orphans: Bay[];
}

const ENCLOSURE_KEY = /^enc:([^:]+):(\d+)$/;
const PATH_PREFIX = "path:";

export const enclosureKey = ({ enclosureId, slot }: DiskSlot) =>
  `enc:${enclosureId}:${slot}`;

export const pathKey = (idPath: string) => `${PATH_PREFIX}${idPath}`;

export const pathOfKey = (key: string) =>
  key.startsWith(PATH_PREFIX) ? key.slice(PATH_PREFIX.length) : null;

export function locationKeyOf(
  slot: DiskSlot | null,
  idPath: string | null,
): string | null {
  if (slot) return enclosureKey(slot);
  return idPath ? pathKey(idPath) : null;
}

export function parseEnclosureKey(key: string): DiskSlot | null {
  const match = ENCLOSURE_KEY.exec(key);
  return match ? { enclosureId: match[1], slot: Number(match[2]) } : null;
}

const SATA_PORT = /-ata-(\d+)(?:\.\d+)?$/;
const SAS_PHY = /-sas-(?:exp0x[0-9a-f]+-)?phy(\d+)-lun-\d+$/;
const NVME = /^pci-[0-9a-f]{4}:([0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f])-nvme-\d+$/;
const USB = /-usb-/;

export function defaultPathLabel(idPath: string): string {
  const sata = SATA_PORT.exec(idPath);
  if (sata) return `SATA port ${sata[1]}`;
  const sas = SAS_PHY.exec(idPath);
  if (sas) return `SAS phy ${sas[1]}`;
  const nvme = NVME.exec(idPath);
  if (nvme) return `NVMe ${nvme[1]}`;
  if (USB.test(idPath)) return `USB ${idPath}`;
  return idPath;
}

export function defaultSlotLabel(model: string | null, slot: number): string {
  return `${model ?? "Enclosure"} slot ${slot}`;
}

/** The default for any key; `models` maps enclosure id to its model. */
export function defaultBayLabel(
  locationKey: string,
  models: ReadonlyMap<string, string | null> = new Map(),
): string {
  const slot = parseEnclosureKey(locationKey);
  if (slot) {
    return defaultSlotLabel(models.get(slot.enclosureId) ?? null, slot.slot);
  }
  const idPath = pathOfKey(locationKey);
  return idPath === null ? locationKey : defaultPathLabel(idPath);
}
