import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { APP_NAME } from "#shared/app";
import type { IngestSource } from "#shared/ingest";
import { db, sqlite } from "~~/server/database/client";
import { latestAppliedMigration } from "~~/server/database/migrate";
import {
  collectorRun,
  diaryEntry,
  disk,
  diskKey,
  faultAcceptance,
  host,
  NO_DEVICE,
  payload,
  pool,
  selfTest,
  smartAttribute,
  smartReading,
  temperatureReading,
  vdev,
} from "~~/server/database/schema";
import { getDisk } from "~~/server/services/disks";
import { getSettings } from "~~/server/services/settings";
import { notFound } from "~~/server/utils/serviceError";

export const DIAGNOSTICS_WINDOW_DAYS = 30;

// Replay order: the order the collector posts in.
export const DIAGNOSTICS_SOURCES = [
  "versions",
  "lsblk",
  "udev",
  "smartctl-scan",
  "smartctl-xall",
  "zpool-status",
  "vdev-id-conf",
] as const satisfies readonly IngestSource[];

export interface RawManifestEntry {
  file: string;
  source: IngestSource;
  device: string | null;
  type: string | null;
  exitStatus: number | null;
  receivedAt: string;
}

export type DiagnosticsBundle = Record<string, string>;

const DAY_MS = 24 * 60 * 60 * 1000;

export function diagnosticsName(diskId: number, now: Date) {
  return `${APP_NAME}-disk-${diskId}-${now.toISOString().slice(0, 10)}`;
}

function toJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9._,-]+/g, "-");
}

function rawFileName(
  source: IngestSource,
  device: string | null,
  type: string | null,
) {
  switch (source) {
    case "smartctl-xall": {
      const name = safeName((device ?? "unknown").replace(/^\/dev\//, ""));
      return `smartctl/xall-${name}${type ? `-${safeName(type)}` : ""}.json`;
    }
    case "udev":
      return `udev/${safeName(device ?? "unknown")}.txt`;
    case "versions":
    case "vdev-id-conf":
      return `${source}.txt`;
    default:
      return `${source}.json`;
  }
}

function parseIfJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function runFor(row: typeof payload.$inferSelect) {
  const device = row.device === NO_DEVICE ? null : row.device;
  return db
    .select()
    .from(collectorRun)
    .where(
      and(
        eq(collectorRun.hostId, row.hostId),
        eq(collectorRun.source, row.source),
        device === null
          ? isNull(collectorRun.device)
          : eq(collectorRun.device, device),
        eq(collectorRun.receivedAt, row.receivedAt),
      ),
    )
    .orderBy(desc(collectorRun.id))
    .get();
}

function replayRank(source: string) {
  return (DIAGNOSTICS_SOURCES as readonly string[]).indexOf(source);
}

function rawFiles(hostId: number, hostName: string): DiagnosticsBundle {
  const rows = db
    .select()
    .from(payload)
    .where(
      and(
        eq(payload.hostId, hostId),
        inArray(payload.source, [...DIAGNOSTICS_SOURCES]),
      ),
    )
    .orderBy(asc(payload.device))
    .all()
    .sort((a, b) => replayRank(a.source) - replayRank(b.source));

  const directory = `raw/${safeName(hostName)}`;
  const files: DiagnosticsBundle = {};
  const manifest: RawManifestEntry[] = rows.map((row) => {
    const source = row.source as IngestSource;
    const run = runFor(row);
    const device = row.device === NO_DEVICE ? null : row.device;
    const type = run?.deviceType ?? null;
    const exitStatus = run?.exitStatus ?? null;
    const file = rawFileName(source, device, type);
    files[`${directory}/${file}`] = row.body;
    if (exitStatus !== null) {
      files[`${directory}/${file.replace(/\.[^./]+$/, ".exit")}`] =
        `${exitStatus}\n`;
    }
    return {
      file,
      source,
      device,
      type,
      exitStatus,
      receivedAt: row.receivedAt.toISOString(),
    };
  });
  files[`${directory}/manifest.json`] = toJson({ host: hostName, manifest });
  return files;
}

function membership(diskId: number) {
  return db
    .select({ vdev, poolName: pool.name, poolState: pool.state })
    .from(vdev)
    .innerJoin(pool, eq(pool.id, vdev.poolId))
    .where(eq(vdev.diskId, diskId))
    .all()
    .map(({ vdev, poolName, poolState }) => ({ ...vdev, poolName, poolState }));
}

function readme({
  diskId,
  now,
  hostName,
}: {
  diskId: number;
  now: Date;
  hostName: string | null;
}) {
  const raw = hostName
    ? `- \`raw/${safeName(hostName)}/\`: the latest collector output from ${hostName} for every disk on the host, byte for byte. \`manifest.json\` lists each file with its source, device, type, exit status and receipt time.`
    : "- No `raw/`: this disk has never been seen by a collector (inventory-only or imported).";
  return `# ${APP_NAME} diagnostics for disk ${diskId}

Generated ${now.toISOString()}.

- \`meta.json\`: app version, schema migration, settings that affect state.
- \`db/\`: what ${APP_NAME} has stored about the disk. Readings cover the last ${DIAGNOSTICS_WINDOW_DAYS} days.
${raw}

Contains serials, hostnames and mount paths. Check before posting publicly.

## Replay

Unzip into \`test/fixtures/bugs/<name>/\` and, in a unit test:

\`\`\`ts
import { replayBundle } from "~~/test/diagnostics";

replayBundle(join(import.meta.dirname, "../../test/fixtures/bugs/<name>"));
\`\`\`

This ingests \`raw/<host>/\` in collector order into the test database; then
assert on the disk.
`;
}

export async function buildDiskDiagnostics(
  id: number,
  { now = new Date(), appVersion = "unknown" } = {},
): Promise<DiagnosticsBundle> {
  const row = db.select().from(disk).where(eq(disk.id, id)).get();
  if (!row) throw notFound(`Disk ${id} not found`);

  const since = new Date(now.getTime() - DIAGNOSTICS_WINDOW_DAYS * DAY_MS);
  const lastHost = row.lastSeenHostId
    ? db.select().from(host).where(eq(host.id, row.lastSeenHostId)).get()
    : undefined;
  const { config } = await getSettings();

  const files: DiagnosticsBundle = {
    "README.md": readme({ diskId: id, now, hostName: lastHost?.name ?? null }),
    "meta.json": toJson({
      app: APP_NAME,
      appVersion,
      migration: latestAppliedMigration(sqlite),
      generatedAt: now.toISOString(),
      diskId: id,
      windowDays: DIAGNOSTICS_WINDOW_DAYS,
      settings: {
        missingAfterDays: config.missingAfterDays,
        smartPolicyVersion: config.smartPolicyVersion,
      },
    }),
    "db/disk.json": toJson({ ...row, latestRaw: parseIfJson(row.latestRaw) }),
    "db/keys.json": toJson(
      db.select().from(diskKey).where(eq(diskKey.diskId, id)).all(),
    ),
    "db/summary.json": toJson({
      ...(await getDisk(id, now)),
      latestRaw: undefined,
    }),
    "db/diary.json": toJson(
      db
        .select()
        .from(diaryEntry)
        .where(
          and(eq(diaryEntry.subjectType, "disk"), eq(diaryEntry.subjectId, id)),
        )
        .orderBy(asc(diaryEntry.at), asc(diaryEntry.id))
        .all(),
    ),
    "db/smart-readings.json": toJson(
      db
        .select()
        .from(smartReading)
        .where(
          and(eq(smartReading.diskId, id), gte(smartReading.takenAt, since)),
        )
        .orderBy(asc(smartReading.takenAt))
        .all(),
    ),
    "db/smart-attributes.json": toJson(
      db
        .select()
        .from(smartAttribute)
        .where(
          and(
            eq(smartAttribute.diskId, id),
            gte(smartAttribute.takenAt, since),
          ),
        )
        .orderBy(asc(smartAttribute.takenAt), asc(smartAttribute.attrId))
        .all(),
    ),
    "db/temperatures.json": toJson(
      db
        .select()
        .from(temperatureReading)
        .where(
          and(
            eq(temperatureReading.diskId, id),
            gte(temperatureReading.at, since),
          ),
        )
        .orderBy(asc(temperatureReading.at))
        .all(),
    ),
    "db/self-tests.json": toJson(
      db
        .select()
        .from(selfTest)
        .where(eq(selfTest.diskId, id))
        .orderBy(asc(selfTest.lifetimeHours))
        .all(),
    ),
    "db/acceptances.json": toJson(
      db
        .select()
        .from(faultAcceptance)
        .where(eq(faultAcceptance.diskId, id))
        .orderBy(asc(faultAcceptance.acceptedAt))
        .all(),
    ),
    "db/membership.json": toJson(membership(id)),
  };
  if (!lastHost) return files;

  const { healthchecksUrl: _secret, ...hostRow } = lastHost;
  files["db/host.json"] = toJson(hostRow);
  files["db/collector-runs.json"] = toJson(
    db
      .select()
      .from(collectorRun)
      .where(
        and(
          eq(collectorRun.hostId, lastHost.id),
          inArray(collectorRun.source, [...DIAGNOSTICS_SOURCES]),
          gte(collectorRun.receivedAt, since),
        ),
      )
      .orderBy(asc(collectorRun.receivedAt), asc(collectorRun.id))
      .all(),
  );
  return { ...files, ...rawFiles(lastHost.id, lastHost.name) };
}
