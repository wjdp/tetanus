import { and, eq, isNull } from "drizzle-orm";
import type { FaultKind } from "#shared/faults";
import { db } from "~~/server/database/client";
import { fault } from "~~/server/database/schema";

export type LiveFault = typeof fault.$inferSelect;

export function liveFaultsByKey(kind: FaultKind): Map<string, LiveFault> {
  return new Map(
    db
      .select()
      .from(fault)
      .where(and(eq(fault.kind, kind), isNull(fault.resolvedAt)))
      .all()
      .map((row) => [row.key, row]),
  );
}
