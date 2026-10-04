import { sqlite } from "~~/server/database/client";

export interface DatabaseSize {
  bytes: number;
  reclaimableBytes: number;
}

function pragmaNumber(name: string): number {
  return sqlite.pragma(name, { simple: true }) as number;
}

export function databaseSize(): DatabaseSize {
  const pageSize = pragmaNumber("page_size");
  return {
    bytes: pragmaNumber("page_count") * pageSize,
    reclaimableBytes: pragmaNumber("freelist_count") * pageSize,
  };
}

export function optimiseDatabase(): {
  before: DatabaseSize;
  after: DatabaseSize;
} {
  const before = databaseSize();
  sqlite.exec("VACUUM");
  sqlite.pragma("optimize=0x10002");
  return { before, after: databaseSize() };
}
