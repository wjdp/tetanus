import { and, eq, inArray } from "drizzle-orm";
import { type Bay, defaultBayLabel } from "#shared/bays";
import type { BayPatch } from "#shared/schemas/bays";
import { db } from "~~/server/database/client";
import { bay, enclosure, host } from "~~/server/database/schema";
import { notFound } from "~~/server/utils/serviceError";

type Located = {
  lastSeenHostId: number | null;
  lastLocationKey: string | null;
};

function modelsByHost(hostIds: number[]) {
  const byHost = new Map<number, Map<string, string | null>>();
  if (hostIds.length === 0) return byHost;
  const rows = db
    .select({
      hostId: enclosure.hostId,
      enclosureId: enclosure.enclosureId,
      model: enclosure.model,
    })
    .from(enclosure)
    .where(inArray(enclosure.hostId, hostIds))
    .all();
  for (const row of rows) {
    const models = byHost.get(row.hostId) ?? new Map();
    models.set(row.enclosureId, row.model);
    byHost.set(row.hostId, models);
  }
  return byHost;
}

export function labelsOf(hostId: number): Map<string, string> {
  return new Map(
    db
      .select({ locationKey: bay.locationKey, label: bay.label })
      .from(bay)
      .where(eq(bay.hostId, hostId))
      .all()
      .map((row) => [row.locationKey, row.label]),
  );
}

export function enclosureModelsOf(hostId: number) {
  return modelsByHost([hostId]).get(hostId) ?? new Map<string, string | null>();
}

export function baysOf<T extends Located & { id: number }>(
  rows: T[],
): Map<number, Bay> {
  const located = rows.filter(
    (row) => row.lastSeenHostId !== null && row.lastLocationKey !== null,
  );
  const hostIds = [
    ...new Set(located.map((row) => row.lastSeenHostId as number)),
  ];
  const models = modelsByHost(hostIds);
  const labels = new Map<string, string>();
  if (hostIds.length > 0) {
    for (const row of db
      .select()
      .from(bay)
      .where(inArray(bay.hostId, hostIds))
      .all()) {
      labels.set(`${row.hostId}\t${row.locationKey}`, row.label);
    }
  }
  return new Map(
    located.map((row) => {
      const hostId = row.lastSeenHostId as number;
      const locationKey = row.lastLocationKey as string;
      return [
        row.id,
        {
          locationKey,
          label: labels.get(`${hostId}\t${locationKey}`) ?? null,
          defaultLabel: defaultBayLabel(locationKey, models.get(hostId)),
        },
      ];
    }),
  );
}

export function bayName(hostId: number, locationKey: string): string {
  return (
    labelsOf(hostId).get(locationKey) ??
    defaultBayLabel(locationKey, enclosureModelsOf(hostId))
  );
}

export function patchBays(hostId: number, patch: BayPatch) {
  if (!db.select({ id: host.id }).from(host).where(eq(host.id, hostId)).get()) {
    throw notFound(`Host ${hostId} not found`);
  }
  db.transaction(() => {
    for (const [locationKey, label] of Object.entries(patch)) {
      if (label === null) {
        db.delete(bay)
          .where(and(eq(bay.hostId, hostId), eq(bay.locationKey, locationKey)))
          .run();
        continue;
      }
      db.insert(bay)
        .values({ hostId, locationKey, label })
        .onConflictDoUpdate({
          target: [bay.hostId, bay.locationKey],
          set: { label },
        })
        .run();
    }
  });
}
