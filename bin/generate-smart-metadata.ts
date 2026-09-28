import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface ObservedThreshold {
  low: number;
  high: number;
  annualFailureRate: number;
}

interface AtaEntry {
  displayName: string;
  ideal: string;
  critical: boolean;
  description: string;
  displayType: string;
  transformValueUnit?: string;
  observedThresholds?: ObservedThreshold[];
}

interface KeyedEntry {
  displayName: string;
  ideal: string;
  critical: boolean;
  description: string;
}

const THRESHOLDS_DIR = "webapp/backend/pkg/thresholds";
const OUTPUT = resolve(import.meta.dirname, "../shared/smart/metadata.json");

const GO_CONSTANTS: Record<string, string> = {
  AtaSmartAttributeDisplayTypeRaw: "raw",
  AtaSmartAttributeDisplayTypeNormalized: "normalized",
  AtaSmartAttributeDisplayTypeTransformed: "transformed",
  ObservedThresholdIdealLow: "low",
  ObservedThresholdIdealHigh: "high",
};

const ENTRY_START = /^\t(\d+|"[a-z0-9_]+"): \{$/;
const ENTRY_END = /^\t\},$/;
const FIELD = /^\t\t([A-Za-z]+):\s+(.*?),?$/;
const THRESHOLD_FIELD = /^\t\t\t\t(Low|High|AnnualFailureRate):\s+([0-9.]+),$/;

function goValue(literal: string): string | boolean {
  if (literal === "true") return true;
  if (literal === "false") return false;
  if (literal.startsWith('"')) return JSON.parse(literal) as string;
  const constant = GO_CONSTANTS[literal];
  if (constant === undefined) {
    throw new Error(`Unknown Go literal: ${literal}`);
  }
  return constant;
}

function splitEntries(source: string): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  let key: string | undefined;
  let lines: string[] = [];
  for (const line of source.split("\n")) {
    const start = ENTRY_START.exec(line);
    if (start?.[1] && key === undefined) {
      key = start[1].replace(/"/g, "");
      lines = [];
    } else if (key !== undefined && ENTRY_END.test(line)) {
      entries.set(key, lines);
      key = undefined;
    } else if (key !== undefined) {
      lines.push(line);
    }
  }
  return entries;
}

function fields(lines: string[]): Map<string, string | boolean> {
  const out = new Map<string, string | boolean>();
  for (const line of lines) {
    const match = FIELD.exec(line);
    if (!match?.[1] || match[2] === undefined) continue;
    const [, name, literal] = match;
    if (["ID", "Transform", "ObservedThresholds"].includes(name)) {
      out.set(name, literal);
      continue;
    }
    out.set(name, goValue(literal));
  }
  return out;
}

function observedThresholds(lines: string[]): ObservedThreshold[] {
  const thresholds: ObservedThreshold[] = [];
  let current: Partial<ObservedThreshold> = {};
  for (const line of lines) {
    const match = THRESHOLD_FIELD.exec(line);
    if (!match?.[1] || match[2] === undefined) continue;
    const value = Number(match[2]);
    if (match[1] === "Low") current = { low: value };
    else if (match[1] === "High") current.high = value;
    else {
      current.annualFailureRate = value;
      if (current.low === undefined || current.high === undefined) {
        throw new Error("Observed threshold missing Low or High");
      }
      thresholds.push(current as ObservedThreshold);
      current = {};
    }
  }
  return thresholds;
}

function keyedEntry(key: string, lines: string[]): KeyedEntry {
  const f = fields(lines);
  const required = (name: string) => {
    if (!f.has(name)) throw new Error(`${key}: missing ${name}`);
    return f.get(name);
  };
  return {
    displayName: required("DisplayName") as string,
    ideal: required("Ideal") as string,
    critical: required("Critical") as boolean,
    description: required("Description") as string,
  };
}

function ataEntry(key: string, lines: string[]): AtaEntry {
  const f = fields(lines);
  const entry: AtaEntry = {
    ...keyedEntry(key, lines),
    displayType: (f.get("DisplayType") as string | undefined) ?? "raw",
  };
  const unit = f.get("TransformValueUnit");
  if (typeof unit === "string") entry.transformValueUnit = unit;
  if (f.has("ObservedThresholds")) {
    entry.observedThresholds = observedThresholds(lines);
  }
  return entry;
}

function parseFile<T>(
  scrutiny: string,
  file: string,
  build: (key: string, lines: string[]) => T,
): Record<string, T> {
  const source = readFileSync(join(scrutiny, THRESHOLDS_DIR, file), "utf8");
  const out: Record<string, T> = {};
  for (const [key, lines] of splitEntries(source)) out[key] = build(key, lines);
  return out;
}

function assertSane(
  ata: Record<string, AtaEntry>,
  nvme: Record<string, KeyedEntry>,
  scsi: Record<string, KeyedEntry>,
): void {
  const failures: string[] = [];
  if (Object.keys(ata).length <= 60) {
    failures.push(`ATA has ${Object.keys(ata).length} entries, expected > 60`);
  }
  for (const id of ["5", "187", "188", "194", "197", "198"]) {
    if (!ata[id]) failures.push(`ATA missing ${id}`);
  }
  if (!nvme.media_errors) failures.push("NVMe missing media_errors");
  if (!scsi.scsi_grown_defect_list) {
    failures.push("SCSI missing scsi_grown_defect_list");
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

const { values } = parseArgs({
  options: { scrutiny: { type: "string", default: "../scrutiny" } },
});
const scrutiny = resolve(values.scrutiny);
const sha = execFileSync("git", ["-C", scrutiny, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

const ata = parseFile(scrutiny, "ata_attribute_metadata.go", ataEntry);
const nvme = parseFile(scrutiny, "nvme_attribute_metadata.go", keyedEntry);
const scsi = parseFile(scrutiny, "scsi_attribute_metadata.go", keyedEntry);
assertSane(ata, nvme, scsi);

const metadata = {
  _source: `github.com/AnalogJ/scrutiny@${sha}`,
  ata,
  nvme,
  scsi,
};
writeFileSync(OUTPUT, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(
  `Wrote ${OUTPUT}: ${Object.keys(ata).length} ATA, ${Object.keys(nvme).length} NVMe, ${Object.keys(scsi).length} SCSI`,
);
