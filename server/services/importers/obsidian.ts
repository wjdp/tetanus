import { eq, like, or, sql } from "drizzle-orm";
import {
  type ImportRow,
  type ImportTarget,
  mapColumns,
  parseTable,
  readRow,
} from "#shared/importers/obsidianTable";
import type { Inventory } from "#shared/inventory-fields";
import type { ObsidianImportInput } from "#shared/schemas/import";
import { db } from "~~/server/database/client";
import { disk, diskKey } from "~~/server/database/schema";
import { addAutoEvent } from "~~/server/services/diary";
import {
  type DiskRow,
  findDiskByAlias,
  findDiskByKey,
} from "~~/server/services/disks";
import { normaliseModelSerial } from "~~/server/services/identity";
import { ServiceError } from "~~/server/utils/serviceError";

export interface ImportedRow {
  row: number;
  diskId: number;
  alias: string | null;
  serial: string | null;
  changes: string[];
  warnings: string[];
}

export interface SkippedRow {
  row: number;
  reason: string;
}

export interface ObsidianImportResult {
  dryRun: boolean;
  columns: Record<ImportTarget, string | null>;
  ignoredColumns: string[];
  matched: ImportedRow[];
  created: ImportedRow[];
  skipped: SkippedRow[];
}

type Match =
  | { disk: DiskRow; by: "model-serial" | "serial" | "alias" }
  | { ambiguous: number[] }
  | null;

class DryRunRollback extends Error {}

function serialCore(serial: string): string {
  return normaliseModelSerial("", serial).split("|")[1];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function endsWithSerial(value: string, serial: string): boolean {
  const upper = value.toUpperCase();
  if (upper === serial) return true;
  if (!upper.endsWith(serial)) return false;
  return /[|_\-\s]/.test(upper[upper.length - serial.length - 1]);
}

export function findDiskBySerial(serial: string): Match {
  const core = serialCore(serial);
  if (core === "") return null;
  const bySerialColumn = db
    .select({ id: disk.id })
    .from(disk)
    .where(
      or(
        sql`upper(${disk.serial}) = ${serial.trim().toUpperCase()}`,
        sql`upper(${disk.serial}) = ${core}`,
      ),
    )
    .all()
    .map((row) => row.id);
  const byKey = db
    .select({ diskId: diskKey.diskId, value: diskKey.value })
    .from(diskKey)
    .where(like(diskKey.value, sql`${`%${escapeLike(core)}`} escape '\\'`))
    .all()
    .filter((row) => endsWithSerial(row.value, core))
    .map((row) => row.diskId);
  const ids = [...new Set([...bySerialColumn, ...byKey])].sort((a, b) => a - b);
  if (ids.length === 0) return null;
  if (ids.length > 1) return { ambiguous: ids };
  const row = db.select().from(disk).where(eq(disk.id, ids[0])).get();
  return row ? { disk: row, by: "serial" } : null;
}

function findMatch(row: ImportRow): Match {
  if (row.model && row.serial) {
    const byModelSerial = findDiskByKey(
      "model-serial",
      `${row.model}|${row.serial}`,
    );
    if (byModelSerial) return { disk: byModelSerial, by: "model-serial" };
  }
  if (row.serial) {
    const bySerial = findDiskBySerial(row.serial);
    if (bySerial) return bySerial;
  }
  if (row.alias) {
    const byAlias = findDiskByAlias(row.alias);
    if (byAlias) return { disk: byAlias, by: "alias" };
  }
  return null;
}

function serialsDiffer(existing: DiskRow, row: ImportRow): boolean {
  return (
    existing.serial !== null &&
    row.serial !== undefined &&
    serialCore(existing.serial) !== serialCore(row.serial)
  );
}

function inventoryChanges(
  current: Partial<Inventory>,
  incoming: Partial<Inventory>,
): Partial<Inventory> {
  return Object.fromEntries(
    Object.entries(incoming).filter(
      ([key, value]) => current[key as keyof Inventory] !== value,
    ),
  );
}

function applyToExisting(
  existing: DiskRow,
  row: ImportRow,
  rowNumber: number,
): ImportedRow {
  const warnings = [...row.warnings];
  const changes: Partial<DiskRow> = {};
  const inventory = inventoryChanges(existing.inventory, row.inventory);
  if (Object.keys(inventory).length > 0) {
    changes.inventory = { ...existing.inventory, ...inventory };
  }
  if (existing.alias === null && row.alias) {
    const holder = findDiskByAlias(row.alias);
    if (holder) {
      warnings.push(`alias ${row.alias} is already used by disk ${holder.id}`);
    } else {
      changes.alias = row.alias;
    }
  }
  if (existing.stateOverride === null && row.stateOverride) {
    changes.stateOverride = row.stateOverride;
  }
  for (const field of ["model", "serial"] as const) {
    if (existing[field] === null && row[field]) changes[field] = row[field];
  }
  if (existing.capacityBytes === null && row.capacityBytes !== undefined) {
    changes.capacityBytes = row.capacityBytes;
  }

  const changed = [
    ...Object.keys(changes).filter((key) => key !== "inventory"),
    ...Object.keys(inventory),
  ];
  if (changed.length > 0) {
    db.update(disk).set(changes).where(eq(disk.id, existing.id)).run();
    addAutoEvent({
      subjectType: "disk",
      subjectId: existing.id,
      eventType: "imported",
      title: `updated from Obsidian: ${changed.join(", ")}`,
      data: { source: "obsidian", row: rowNumber, changes: changed },
    });
  }
  return {
    row: rowNumber,
    diskId: existing.id,
    alias: changes.alias ?? existing.alias,
    serial: changes.serial ?? existing.serial,
    changes: changed,
    warnings,
  };
}

function createInventoryOnly(row: ImportRow, rowNumber: number): ImportedRow {
  const created = db
    .insert(disk)
    .values({
      alias: row.alias ?? null,
      model: row.model ?? null,
      serial: row.serial ?? null,
      capacityBytes: row.capacityBytes ?? null,
      stateOverride: row.stateOverride ?? null,
      inventory: row.inventory,
    })
    .returning()
    .get();
  if (row.model && row.serial) {
    db.insert(diskKey)
      .values({
        diskId: created.id,
        kind: "model-serial",
        value: normaliseModelSerial(row.model, row.serial),
      })
      .onConflictDoNothing()
      .run();
  }
  addAutoEvent({
    subjectType: "disk",
    subjectId: created.id,
    eventType: "imported",
    title: "created from Obsidian",
    data: { source: "obsidian", row: rowNumber },
  });
  return {
    row: rowNumber,
    diskId: created.id,
    alias: created.alias,
    serial: created.serial,
    changes: [],
    warnings: row.warnings,
  };
}

function columnNames(headers: string[]) {
  const mapping = mapColumns(headers);
  const columns = Object.fromEntries(
    Object.entries(mapping).map(([target, index]) => [
      target,
      index === null ? null : headers[index],
    ]),
  ) as Record<ImportTarget, string | null>;
  const mapped = new Set(Object.values(mapping));
  const ignoredColumns = headers.filter((_, index) => !mapped.has(index));
  return { mapping, columns, ignoredColumns };
}

function runImport(text: string, dryRun: boolean): ObsidianImportResult {
  const { headers, rows } = parseTable(text);
  if (headers.length === 0) {
    throw new ServiceError(422, "No table found in the pasted text");
  }
  const { mapping, columns, ignoredColumns } = columnNames(headers);
  if (mapping.alias === null && mapping.serial === null) {
    throw new ServiceError(
      422,
      "The table needs an alias or a serial column to match disks",
    );
  }

  const result: ObsidianImportResult = {
    dryRun,
    columns,
    ignoredColumns,
    matched: [],
    created: [],
    skipped: [],
  };
  rows.forEach((cells, index) => {
    const rowNumber = index + 1;
    const row = readRow(cells, mapping);
    if (!row.serial && !row.alias) {
      result.skipped.push({ row: rowNumber, reason: "no serial or alias" });
      return;
    }
    const match = findMatch(row);
    if (match && "ambiguous" in match) {
      result.skipped.push({
        row: rowNumber,
        reason: `serial ${row.serial} matches disks ${match.ambiguous.join(", ")}`,
      });
      return;
    }
    if (match && match.by === "alias" && serialsDiffer(match.disk, row)) {
      result.skipped.push({
        row: rowNumber,
        reason: `alias ${row.alias} belongs to disk ${match.disk.id} with serial ${match.disk.serial}`,
      });
      return;
    }
    if (match) {
      result.matched.push(applyToExisting(match.disk, row, rowNumber));
    } else {
      result.created.push(createInventoryOnly(row, rowNumber));
    }
  });
  return result;
}

export function importObsidian({
  text,
  dryRun,
}: ObsidianImportInput): ObsidianImportResult {
  if (!dryRun) return db.transaction(() => runImport(text, false));
  let preview: ObsidianImportResult | undefined;
  try {
    db.transaction(() => {
      preview = runImport(text, true);
      throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return preview as ObsidianImportResult;
}
