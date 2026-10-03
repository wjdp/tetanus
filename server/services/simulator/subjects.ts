import { eq } from "drizzle-orm";
import { isHistoryState } from "#shared/disk";
import type { SimulationSubjectType } from "#shared/simulator";
import { db } from "~~/server/database/client";
import { disk, host, pool } from "~~/server/database/schema";
import { notFound } from "~~/server/utils/serviceError";
import { storedPayloads } from "./payloads";
import { serialOf } from "./smartctl";
import type { HostRow, Subject, SubjectOf } from "./types";

function hostRow(id: number | null): HostRow | undefined {
  if (id === null) return undefined;
  return db.select().from(host).where(eq(host.id, id)).get();
}

/** The subject with the host that collects it; undefined for a disk out of service or with no host. */
export function loadSubject(
  type: SimulationSubjectType,
  id: number,
): Subject | undefined {
  if (type === "host") {
    const row = hostRow(id);
    if (!row) throw notFound(`No host ${id}`);
    return { type, host: row };
  }
  if (type === "pool") {
    const row = db.select().from(pool).where(eq(pool.id, id)).get();
    if (!row) throw notFound(`No pool ${id}`);
    const owner = hostRow(row.hostId);
    return owner && { type, pool: row, host: owner };
  }
  const row = db.select().from(disk).where(eq(disk.id, id)).get();
  if (!row) throw notFound(`No disk ${id}`);
  if (isHistoryState(row.stateOverride)) {
    return undefined;
  }
  const owner = hostRow(row.lastSeenHostId);
  return owner && { type, disk: row, host: owner };
}

export function smartctlPayloadOf(subject: SubjectOf<"disk">) {
  const { serial } = subject.disk;
  if (!serial) return undefined;
  return storedPayloads(subject.host.id, "smartctl-xall").find(
    (stored) => serialOf(stored.body) === serial,
  );
}
