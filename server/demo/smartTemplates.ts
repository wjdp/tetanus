import nvme from "~~/test/fixtures/mars/smartctl/xall-nvme0.json";
import wd120emaz from "~~/test/fixtures/mars/smartctl/xall-sda-auto.json";
import wdRed from "~~/test/fixtures/mars/smartctl/xall-sdd-auto.json";
import wd7200 from "~~/test/fixtures/mars/smartctl/xall-sde-auto.json";
import exosX18 from "~~/test/fixtures/mars/smartctl/xall-sdh-auto.json";
import exosX16 from "~~/test/fixtures/mars/smartctl/xall-sdl-auto.json";
import intelS4610 from "~~/test/fixtures/mars/smartctl/xall-sdn-auto.json";
import samsung860Evo from "~~/test/fixtures/mars/smartctl/xall-sdo-auto.json";
import samsung870Evo from "~~/test/fixtures/mars/smartctl/xall-sdr-auto.json";
import sas from "~~/test/fixtures/synthetic-smartctl/xall-sas.json";
import type { SmartTemplate } from "./types";

export interface AtaAttributeJson {
  id: number;
  name: string;
  value: number;
  worst: number;
  thresh: number;
  when_failed: string;
  flags: { prefailure: boolean; [key: string]: unknown };
  raw: { value: number; string: string };
}

export interface DeviceStatisticJson {
  name: string;
  value?: number;
  [key: string]: unknown;
}

export interface NvmeNamespaceJson {
  size: { blocks: number; bytes: number };
  capacity: { blocks: number; bytes: number };
  utilization: { blocks: number; bytes: number };
  formatted_lba_size: number;
  eui64?: { oui: number; ext_id: number };
  [key: string]: unknown;
}

/** The parts of smartctl `--xall --json` output the renderer rewrites; everything else passes through. */
export interface SmartctlJson {
  [key: string]: unknown;
  smartctl: {
    version: number[];
    svn_revision: string;
    platform_info: string;
    build_info: string;
    argv: string[];
    exit_status: number;
    [key: string]: unknown;
  };
  local_time?: { time_t: number; asctime: string };
  device: { name: string; info_name: string; type: string; protocol: string };
  model_family?: string;
  model_name: string;
  serial_number: string;
  wwn?: { naa: number; oui: number; id: number };
  firmware_version?: string;
  revision?: string;
  user_capacity: { blocks: number; bytes: number };
  logical_block_size?: number;
  physical_block_size?: number;
  rotation_rate?: number;
  form_factor?: { name: string; [key: string]: unknown };
  smart_status: { passed: boolean; nvme?: { value: number } };
  ata_smart_data?: {
    self_test: {
      status: Record<string, unknown>;
      polling_minutes: { short: number; extended: number };
    };
    [key: string]: unknown;
  };
  ata_smart_attributes?: { revision: number; table: AtaAttributeJson[] };
  power_on_time: { hours: number; minutes?: number };
  power_cycle_count?: number;
  temperature: Record<string, number>;
  ata_smart_error_log?: Record<string, unknown>;
  seagate_farm_log?: {
    page_1_drive_information?: Record<string, unknown>;
    [key: string]: unknown;
  };
  ata_smart_self_test_log?: Record<string, unknown>;
  ata_sct_status?: {
    temperature: Record<string, number>;
    smart_status: { passed: boolean };
    [key: string]: unknown;
  };
  ata_sct_temperature_history?: {
    logging_interval_minutes: number;
    table: (number | null)[];
    [key: string]: unknown;
  };
  ata_device_statistics?: { pages: { table?: DeviceStatisticJson[] }[] };
  ata_pending_defects_log?: { size: number; count: number };
  nvme_smart_health_information_log?: Record<string, number>;
  nvme_self_test_log?: Record<string, unknown>;
  nvme_namespaces?: NvmeNamespaceJson[];
  nvme_total_capacity?: number;
  nvme_ieee_oui_identifier?: number;
  nvme_pci_vendor?: { id: number; subsystem_id: number };
  scsi_grown_defect_list?: number;
}

/**
 * Static imports rather than file reads so the templates are bundled into the
 * Cloudflare Worker, which has no filesystem.
 */
const TEMPLATES = {
  exosX18,
  exosX16,
  wd7200,
  wdRed,
  wd120emaz,
  samsung870Evo,
  samsung860Evo,
  intelS4610,
  nvme,
  sas,
} as unknown as Record<SmartTemplate, SmartctlJson>;

export function smartTemplate(name: SmartTemplate): SmartctlJson {
  return structuredClone(TEMPLATES[name]);
}

export interface BlockSizes {
  logical: number;
  physical: number;
}

export function templateBlockSizes(name: SmartTemplate): BlockSizes {
  const template = TEMPLATES[name];
  const logical = template.logical_block_size ?? 512;
  return { logical, physical: template.physical_block_size ?? logical };
}
