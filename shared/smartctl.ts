export interface SmartctlXallDevice {
  name: string;
  type: string;
  protocol: string;
}

export interface SmartctlExitFlags {
  raw: number;
  commandLineError: boolean;
  deviceOpenFailed: boolean;
  commandFailed: boolean;
  diskFailing: boolean;
  prefailBelowThreshold: boolean;
  pastPrefailBelowThreshold: boolean;
  errorLogHasErrors: boolean;
  selfTestLogHasErrors: boolean;
}

export interface AtaAttributeFlags {
  value?: number;
  string?: string;
  prefailure: boolean;
  updatedOnline: boolean;
  performance: boolean;
  errorRate: boolean;
  eventCount: boolean;
  autoKeep: boolean;
}

export interface AtaAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  thresh: number;
  whenFailed: string | null;
  raw: { value?: number; string?: string };
  flags: AtaAttributeFlags;
}

export interface SelfTestEntry {
  type?: string;
  status?: string;
  passed: boolean;
  lifetimeHours?: number;
  lba?: number;
}

export interface SctTemperatureHistory {
  intervalMinutes?: number;
  values: (number | null)[];
}

export interface ScsiErrorCounters {
  correctedErrors?: number;
  uncorrectedErrors?: number;
  errorsCorrectedByEccfast?: number;
  errorsCorrectedByEccdelayed?: number;
  errorsCorrectedByRereadsRewrites?: number;
  totalErrorsCorrected?: number;
  correctionAlgorithmInvocations?: number;
  totalUncorrectedErrors?: number;
}

export interface ScsiInfo {
  grownDefects?: number;
  read?: ScsiErrorCounters;
  write?: ScsiErrorCounters;
  verify?: ScsiErrorCounters;
  startStopCycleCounter?: unknown;
}

export interface SmartctlXallIdentity {
  model?: string;
  modelFamily?: string;
  serial?: string;
  firmware?: string;
  wwn?: string;
  capacityBytes?: number;
  rotationRate?: number;
  formFactor?: string;
  transport?: string;
}

export interface SmartctlXallResult {
  device: SmartctlXallDevice;
  smartctl: { version: string; exitStatus: SmartctlExitFlags };
  identity: SmartctlXallIdentity;
  smartSupport: { available: boolean; enabled: boolean };
  smartStatus?: { passed: boolean };
  standby: boolean;
  temperature?: number;
  powerOnHours?: number;
  powerCycles?: number;
  ata?: { attributes: AtaAttribute[] };
  nvme?: Record<string, unknown>;
  scsi?: ScsiInfo;
  selfTests?: SelfTestEntry[];
  sctTemperatureHistory?: SctTemperatureHistory;
}
