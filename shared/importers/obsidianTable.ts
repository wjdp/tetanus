import type { StateOverride } from "../disk";
import {
  INVENTORY_FIELDS,
  type Inventory,
  type InventoryKey,
} from "../inventory-fields";
import { diskAliasSchema } from "../schemas/disks";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

export const IMPORT_TARGETS = [
  "alias",
  "model",
  "serial",
  "capacity",
  "pool",
  "status",
  ...INVENTORY_FIELDS.map((field) => field.key),
] as const satisfies readonly string[];

export type ImportTarget =
  | "alias"
  | "model"
  | "serial"
  | "capacity"
  | "pool"
  | "status"
  | InventoryKey;

export type ColumnMapping = Record<ImportTarget, number | null>;

export const COLUMN_SYNONYMS: Record<ImportTarget, string[]> = {
  alias: ["alias", "name", "id", "disk", "label"],
  model: ["model", "model number"],
  serial: ["serial", "serial number", "serial no", "sn", "s/n"],
  capacity: ["capacity", "size"],
  pool: ["pool", "zpool"],
  status: ["status", "state"],
  purchaseDate: ["purchased", "purchase date", "bought", "date purchased"],
  purchasePrice: ["price", "cost", "purchase price", "paid"],
  supplier: ["supplier", "vendor", "shop", "seller", "retailer"],
  purchaseCondition: ["condition", "purchase condition"],
  warrantyExpiry: ["warranty", "warranty expiry", "warranty until"],
  pin33Taped: ["3.3v", "3.3 v pin", "3.3v pin", "pin", "3.3 v", "taped"],
};

const MARKDOWN_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}

function isMarkdownTable(lines: string[]): boolean {
  return lines.length >= 2 && MARKDOWN_SEPARATOR.test(lines[1]);
}

function splitMarkdownRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && line[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  const trimmed = line.trim();
  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) cells.pop();
  return cells.map((cell) => cell.trim());
}

function parseMarkdown(lines: string[]): ParsedTable {
  const [headerLine, , ...rowLines] = lines;
  return {
    headers: splitMarkdownRow(headerLine),
    rows: rowLines.map(splitMarkdownRow),
  };
}

function detectDelimiter(text: string): "," | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = firstLine.split("\t").length - 1;
  const commas = firstLine.split(",").length - 1;
  return tabs > 0 && tabs >= commas ? "\t" : ",";
}

function parseDelimited(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (char === delimiter) {
      endField();
    } else if (char === "\r" && text[index + 1] === "\n") {
      endRecord();
      index += 1;
    } else if (char === "\n" || char === "\r") {
      endRecord();
    } else {
      field += char;
    }
    index += 1;
  }
  if (field !== "" || record.length > 0) endRecord();
  return records
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ""));
}

export function parseTable(text: string): ParsedTable {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return { headers: [], rows: [] };
  if (isMarkdownTable(lines)) return parseMarkdown(lines);
  const [headers = [], ...rows] = parseDelimited(text.trim());
  return { headers, rows };
}

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9./]/g, "");
}

const TARGET_BY_HEADER_KEY: Map<string, ImportTarget> = (() => {
  const byKey = new Map<string, ImportTarget>();
  const add = (name: string, target: ImportTarget) => {
    const key = headerKey(name);
    if (!byKey.has(key)) byKey.set(key, target);
  };
  for (const [target, synonyms] of Object.entries(COLUMN_SYNONYMS)) {
    for (const synonym of synonyms) add(synonym, target as ImportTarget);
  }
  for (const field of INVENTORY_FIELDS) {
    add(field.key, field.key);
    add(field.label, field.key);
  }
  return byKey;
})();

export function mapColumns(headers: string[]): ColumnMapping {
  const mapping = Object.fromEntries(
    IMPORT_TARGETS.map((target) => [target, null]),
  ) as ColumnMapping;
  headers.forEach((header, index) => {
    const target = TARGET_BY_HEADER_KEY.get(headerKey(header));
    if (target && mapping[target] === null) mapping[target] = index;
  });
  return mapping;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

export function coerceDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const british = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (british) {
    return isoDate(Number(british[3]), Number(british[2]), Number(british[1]));
  }
  const written = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(trimmed);
  if (written) {
    const month = MONTHS.indexOf(written[2].slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    return isoDate(Number(written[3]), month, Number(written[1]));
  }
  return null;
}

export function coerceMoney(value: string): number | null {
  const cleaned = value.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const TRUE_VALUES = new Set(["yes", "y", "true", "✓", "✔", "✅", "taped"]);
const FALSE_VALUES = new Set(["no", "n", "false", "x", "✗", "✘", "❌"]);

export function coerceBoolean(value: string): boolean | null {
  const normalised = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  return null;
}

const CAPACITY_MULTIPLIER: Record<string, number> = {
  t: 1e12,
  tb: 1e12,
  g: 1e9,
  gb: 1e9,
  m: 1e6,
  mb: 1e6,
};

export function coerceCapacity(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec(value.trim());
  const multiplier = match && CAPACITY_MULTIPLIER[match[2].toLowerCase()];
  if (!match || !multiplier) return null;
  return Math.round(Number(match[1]) * multiplier);
}

const STATUS_OVERRIDES: Record<string, StateOverride | null> = {
  online: null,
  spare: "spare",
  removed: "removed",
};

export function coerceStatus(value: string): StateOverride | null | undefined {
  return STATUS_OVERRIDES[value.trim().toLowerCase()];
}

function stripWikiLink(value: string): string {
  return value.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_, target: string, label?: string) => label ?? target,
  );
}

export interface ImportRow {
  alias?: string;
  model?: string;
  serial?: string;
  capacityBytes?: number;
  pool?: string;
  stateOverride?: StateOverride | null;
  inventory: Partial<Inventory>;
  warnings: string[];
}

type InventoryValue = Inventory[InventoryKey];

function coerceInventoryValue(
  field: (typeof INVENTORY_FIELDS)[number],
  value: string,
): InventoryValue | null {
  switch (field.type) {
    case "date":
      return coerceDate(value);
    case "money":
      return coerceMoney(value);
    case "boolean":
      return coerceBoolean(value);
    case "text":
      return value.slice(0, 500);
    case "enum":
      return (
        field.values.find((option) => option === value.toLowerCase()) ?? null
      );
  }
}

export function readRow(cells: string[], mapping: ColumnMapping): ImportRow {
  const row: ImportRow = { inventory: {}, warnings: [] };
  const cell = (target: ImportTarget) => {
    const index = mapping[target];
    if (index === null) return undefined;
    const value = stripWikiLink(cells[index] ?? "").trim();
    return value === "" || value === "—" || value === "-" ? undefined : value;
  };

  const alias = cell("alias");
  if (alias !== undefined) {
    const parsed = diskAliasSchema.safeParse(alias);
    if (parsed.success && parsed.data) row.alias = parsed.data;
    else row.warnings.push(`alias "${alias}" is not a valid alias`);
  }
  row.model = cell("model");
  row.serial = cell("serial");
  row.pool = cell("pool");

  const capacity = cell("capacity");
  if (capacity !== undefined) {
    const bytes = coerceCapacity(capacity);
    if (bytes === null) row.warnings.push(`capacity "${capacity}" not read`);
    else row.capacityBytes = bytes;
  }

  const status = cell("status");
  if (status !== undefined) {
    const override = coerceStatus(status);
    if (override === undefined) row.warnings.push(`status "${status}" ignored`);
    else row.stateOverride = override;
  }

  for (const field of INVENTORY_FIELDS) {
    const value = cell(field.key);
    if (value === undefined) continue;
    const coerced = coerceInventoryValue(field, value);
    if (coerced === null) {
      row.warnings.push(`${field.label} "${value}" not read`);
    } else {
      (row.inventory as Record<string, InventoryValue>)[field.key] = coerced;
    }
  }

  for (const key of ["model", "serial", "pool"] as const) {
    if (row[key] === undefined) delete row[key];
  }
  return row;
}
