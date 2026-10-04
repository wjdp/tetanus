import type { Vendor } from "./vendor";

export interface WarrantyCheckDisk {
  vendor: Vendor | null;
  serial: string | null;
  model: string | null;
  inventory: { seagateBpid?: string | null };
}

export interface WarrantyCheck {
  url: string;
  copy: Record<string, string>;
  note?: string;
}

const SEAGATE_CHECKER =
  "https://www.seagate.com/gb/en/support/warranty-and-replacements/";
const WD_CHECKER = "https://support-en.wd.com/app/warrantystatusweb";
const TOSHIBA_CHECKER =
  "https://myapps.taec.toshiba.com/myapps/admin/jsp/webrma/addRequest1NoLogin.jsp?Action=NEW";
const SOLIDIGM_CHECKER = "https://support.solidigm.com/en-US/serial-number/";
const SAMSUNG_WARRANTY =
  "https://semiconductor.samsung.com/consumer-storage/support/warranty/";

const BPID_DIGITS_ASKED = 4;

function bpidTail(bpid: string | null | undefined): string | null {
  const compact = bpid?.replace(/\s+/g, "");
  return compact ? compact.slice(-BPID_DIGITS_ASKED) : null;
}

export function needsBpid(disk: WarrantyCheckDisk): boolean {
  return disk.vendor === "seagate" && !bpidTail(disk.inventory.seagateBpid);
}

export function warrantyCheckUrl(
  disk: WarrantyCheckDisk,
): WarrantyCheck | null {
  const serial = disk.serial?.trim();
  if (!serial) return null;
  switch (disk.vendor) {
    case "seagate": {
      const bpid = bpidTail(disk.inventory.seagateBpid);
      return {
        url: SEAGATE_CHECKER,
        copy: {
          Serial: serial,
          ...(bpid ? { "BPID (last 4)": bpid } : {}),
        },
      };
    }
    case "western-digital":
    case "hgst":
      return { url: WD_CHECKER, copy: { Serial: serial } };
    case "toshiba":
      return {
        url: TOSHIBA_CHECKER,
        copy: { Serial: serial },
        note: "Toshiba wants the full serial from the label, which can carry characters the drive does not report.",
      };
    case "intel":
      return { url: SOLIDIGM_CHECKER, copy: { Serial: serial } };
    case "samsung":
      return {
        url: SAMSUNG_WARRANTY,
        copy: {
          Serial: serial,
          ...(disk.model ? { Model: disk.model } : {}),
        },
        note: "Samsung has no online checker: claims go through the retailer or a Samsung service centre.",
      };
    default:
      return null;
  }
}
