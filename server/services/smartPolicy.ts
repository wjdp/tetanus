import { eq, inArray } from "drizzle-orm";
import { SMART_POLICY_VERSION } from "#shared/smart/classification";
import type { SmartProtocol } from "#shared/smart/metadata";
import { db } from "~~/server/database/client";
import {
  disk,
  setting,
  smartAttribute,
  smartReading,
} from "~~/server/database/schema";
import {
  attributesOfReading,
  diskProtocol,
  evaluateNamedAttributes,
  latestReading,
  type MinimalSmartAttribute,
  parsedFromMinimal,
  recomputeLatestStatus,
  type SmartAttributeRow,
  type SmartReadingRow,
} from "~~/server/services/smart";

const SETTING_ROW_ID = 1;

export interface SmartPolicyOutcome {
  disks: number;
  changed: number;
}

function protocolOf(
  diskId: number,
  attributes: SmartAttributeRow[],
): SmartProtocol | undefined {
  const known = diskProtocol(diskId);
  if (known) return known;
  const allNumeric = attributes.every(({ attrId }) => /^\d+$/.test(attrId));
  return allNumeric ? "ATA" : undefined;
}

function minimalAttribute(row: SmartAttributeRow): MinimalSmartAttribute {
  return {
    id: row.attrId,
    value: row.value ?? 0,
    worst: row.worst,
    thresh: row.thresh,
    rawValue: row.rawValue,
    rawString: row.rawString,
    whenFailed: row.whenFailed,
  };
}

function reevaluateAttributes(
  reading: SmartReadingRow,
  protocol: SmartProtocol,
  stored: SmartAttributeRow[],
) {
  const evaluated = evaluateNamedAttributes(
    parsedFromMinimal({
      protocol,
      attributes: stored.map(minimalAttribute),
      temperature: reading.temp,
      powerOnHours: reading.powerOnHours,
      powerCycles: reading.powerCycles,
    }),
  );
  const byAttrId = new Map(
    evaluated.map((attribute) => [attribute.attrId, attribute]),
  );
  for (const row of stored) {
    const attribute = byAttrId.get(row.attrId);
    if (!attribute) continue;
    db.update(smartAttribute)
      .set({
        transformedValue: attribute.transformedValue,
        status: attribute.status,
        failureRate: attribute.failureRate ?? null,
        reason: attribute.reason ?? null,
      })
      .where(eq(smartAttribute.id, row.id))
      .run();
  }
}

function latestStatusOf(diskId: number) {
  return db
    .select({ latestStatus: disk.latestStatus })
    .from(disk)
    .where(eq(disk.id, diskId))
    .get()?.latestStatus;
}

export function reapplySmartPolicy(now = new Date()): SmartPolicyOutcome {
  return db.transaction(() => {
    const outcome: SmartPolicyOutcome = { disks: 0, changed: 0 };
    const disks = db
      .select({ id: disk.id, latestReadingAt: disk.latestReadingAt })
      .from(disk)
      .where(
        inArray(
          disk.id,
          db.selectDistinct({ diskId: smartReading.diskId }).from(smartReading),
        ),
      )
      .all();
    for (const { id, latestReadingAt } of disks) {
      const reading = latestReading(id);
      if (!reading) continue;
      const stored = attributesOfReading(reading.id);
      const protocol = protocolOf(id, stored);
      if (!protocol) continue;
      reevaluateAttributes(reading, protocol, stored);
      if (latestReadingAt === null) {
        outcome.disks += 1;
        continue;
      }
      const before = latestStatusOf(id);
      recomputeLatestStatus(id, now, "policy");
      outcome.disks += 1;
      if (latestStatusOf(id) !== before) outcome.changed += 1;
    }
    return outcome;
  });
}

export function applySmartPolicyIfStale(now = new Date()): boolean {
  const row = db
    .select({ config: setting.config })
    .from(setting)
    .where(eq(setting.id, SETTING_ROW_ID))
    .get();
  const config = row?.config ?? {};
  if ((config.smartPolicyVersion ?? 0) === SMART_POLICY_VERSION) return false;
  const { disks, changed } = db.transaction(() => {
    const outcome = reapplySmartPolicy(now);
    db.update(setting)
      .set({ config: { ...config, smartPolicyVersion: SMART_POLICY_VERSION } })
      .where(eq(setting.id, SETTING_ROW_ID))
      .run();
    return outcome;
  });
  console.log(
    `SMART policy v${SMART_POLICY_VERSION} applied: ${disks} disks, ${changed} status changes`,
  );
  return true;
}
