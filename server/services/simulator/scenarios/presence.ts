import { and, asc, eq, ne } from "drizzle-orm";
import type { DiskKey } from "#shared/disk";
import { isHistoryState } from "#shared/disk";
import { DEFAULT_SETTINGS_CONFIG } from "#shared/schemas/settings";
import { db } from "~~/server/database/client";
import { disk, diskKey } from "~~/server/database/schema";
import { parse as parseUdev } from "~~/server/ingest/udev";
import { PRESENT_WINDOW_MS } from "~~/server/services/disks";
import { diskSightingTimes } from "~~/server/services/hosts";
import { extractKeys } from "~~/server/services/identity";
import { ensureSettings } from "~~/server/services/settings";
import { type StoredPayload, storedPayloads } from "../payloads";
import { parseSmartctl } from "../smartctl";
import { smartctlPayloadOf } from "../subjects";
import { defineScenario, type SubjectOf } from "../types";

const HOUR_MS = 60 * 60 * 1000;
const DEVICE_OPEN_FAILED = 2;
const COMMAND_FAILED = 4;

export function missingAfterHours() {
  const config = { ...DEFAULT_SETTINGS_CONFIG, ...ensureSettings().config };
  return config.missingAfterDays * 24;
}

/** Disk state is judged as of the host's last sighting, not now. */
function sightingReference(hostId: number, now: Date) {
  const sightedAt = diskSightingTimes().get(hostId);
  return sightedAt && sightedAt < now ? sightedAt : now;
}

/** Moves the disk's last sighting `hours` before its host's, so it reads as missing. */
export function backdateSighting(
  diskId: number,
  hostId: number,
  hours: number,
  now: Date,
) {
  const reference = sightingReference(hostId, now);
  db.update(disk)
    .set({ lastSeenAt: new Date(reference.getTime() - hours * HOUR_MS) })
    .where(eq(disk.id, diskId))
    .run();
}

export const missing = defineScenario({
  id: "disk-missing",
  label: "Missing",
  group: "Presence",
  subjectType: "disk",
  description: "The disk stops appearing in collector output.",
  applies: (subject) => subject.disk.stateOverride === null,
  params: () => [
    {
      key: "hours",
      label: "Last seen",
      kind: "number",
      default: Math.min(48, missingAfterHours()),
      min: Math.ceil(PRESENT_WINDOW_MS / HOUR_MS) + 1,
      max: missingAfterHours(),
      unit: "hours ago",
    },
  ],
  plan: (subject, params) => ({
    replays: [],
    afterReplay: (now) =>
      backdateSighting(
        subject.disk.id,
        subject.host.id,
        Number(params.hours),
        now,
      ),
  }),
});

const keyId = (key: DiskKey) => `${key.kind}\0${key.value}`;

function keysOf(diskId: number): DiskKey[] {
  return db
    .select({ kind: diskKey.kind, value: diskKey.value })
    .from(diskKey)
    .where(eq(diskKey.diskId, diskId))
    .orderBy(asc(diskKey.kind), asc(diskKey.value))
    .all();
}

function udevKeys(stored: StoredPayload): DiskKey[] {
  try {
    const { data } = parseUdev(stored.body, stored.meta);
    return extractKeys({ source: "udev", udev: data });
  } catch {
    return [];
  }
}

function udevPayloadOf(hostId: number, diskId: number) {
  const own = new Set(keysOf(diskId).map(keyId));
  return storedPayloads(hostId, "udev").find((stored) =>
    udevKeys(stored).some((key) => own.has(keyId(key))),
  );
}

const udevLineFor = (key: DiskKey) =>
  key.kind === "wwn" ? `E:ID_WWN=0x${key.value}` : `S:disk/by-id/${key.value}`;

/** A key of the disk that a udev payload can carry, so another device can claim it. */
function claimableKey(diskId: number) {
  const keys = keysOf(diskId);
  return (
    keys.find((key) => key.kind === "by-id") ??
    keys.find((key) => key.kind === "wwn")
  );
}

function conflictPartners(subject: SubjectOf<"disk">) {
  return db
    .select()
    .from(disk)
    .where(
      and(
        eq(disk.lastSeenHostId, subject.host.id),
        ne(disk.id, subject.disk.id),
      ),
    )
    .orderBy(asc(disk.id))
    .all()
    .filter(
      (row) =>
        !isHistoryState(row.stateOverride) &&
        udevPayloadOf(subject.host.id, row.id) !== undefined,
    );
}

const partnerLabel = (row: typeof disk.$inferSelect) =>
  [row.alias, row.model, row.serial].filter(Boolean).join(" · ") ||
  `Disk ${row.id}`;

/** The other device's udev output, claiming one of this disk's keys; its by-vdev alias is dropped so the claim moves no alias. */
function claimIdentity(stored: StoredPayload, claimed: DiskKey): StoredPayload {
  const lines = stored.body
    .split("\n")
    .filter((line) => !line.startsWith("S:disk/by-vdev/"));
  const kept =
    claimed.kind === "wwn"
      ? lines.filter((line) => !line.startsWith("E:ID_WWN="))
      : lines;
  return { ...stored, body: [udevLineFor(claimed), ...kept].join("\n") };
}

export const identityConflict = defineScenario({
  id: "identity-conflict",
  label: "Identity conflict",
  group: "Presence",
  subjectType: "disk",
  description:
    "Another device reports one of this disk's identifiers, so a sighting matches two disks. The fault opens on the older of the two.",
  applies: (subject) =>
    claimableKey(subject.disk.id) !== undefined &&
    conflictPartners(subject).length > 0,
  params: (subject) => {
    const partners = conflictPartners(subject);
    const next =
      partners.find((row) => row.id > subject.disk.id) ?? partners[0];
    return [
      {
        key: "diskId",
        label: "With disk",
        kind: "select",
        default: String(next?.id ?? ""),
        options: partners.map((row) => ({
          value: String(row.id),
          label: partnerLabel(row),
        })),
      },
    ];
  },
  plan: (subject, params) => {
    const claimed = claimableKey(subject.disk.id);
    const stored = udevPayloadOf(subject.host.id, Number(params.diskId));
    if (!claimed || !stored) throw new Error("No udev output to edit");
    return { replays: [claimIdentity(stored, claimed)] };
  },
});

function requireSmartctl(subject: SubjectOf<"disk">) {
  const stored = smartctlPayloadOf(subject);
  if (!stored) throw new Error("No smartctl output stored for this disk");
  return stored;
}

const SMART_DATA_KEYS = [
  "smart_status",
  "ata_smart_attributes",
  "ata_smart_data",
  "ata_smart_self_test_log",
  "ata_smart_error_log",
  "nvme_smart_health_information_log",
  "temperature",
  "power_on_time",
  "power_cycle_count",
];

function smartctlHeader(json: Record<string, unknown>, exitStatus: number) {
  const header = json.smartctl as Record<string, unknown>;
  return { ...header, exit_status: exitStatus };
}

function openFailedBody(stored: StoredPayload) {
  const json = parseSmartctl(stored.body);
  return {
    json_format_version: json.json_format_version,
    smartctl: {
      ...smartctlHeader(json, DEVICE_OPEN_FAILED),
      messages: [
        {
          string: `Smartctl open device: ${stored.device} failed: No such device`,
          severity: "error",
        },
      ],
    },
  };
}

function commandFailedBody(stored: StoredPayload) {
  const json = parseSmartctl(stored.body);
  const kept = Object.fromEntries(
    Object.entries(json).filter(
      ([key]) => !SMART_DATA_KEYS.includes(key) && !key.startsWith("scsi_"),
    ),
  );
  return {
    ...kept,
    smartctl: {
      ...smartctlHeader(json, COMMAND_FAILED),
      messages: [
        {
          string: "Read SMART Data failed: Input/output error",
          severity: "error",
        },
      ],
    },
  };
}

export const smartctlUnreadable = defineScenario({
  id: "smartctl-unreadable",
  label: "smartctl unreadable",
  group: "Presence",
  subjectType: "disk",
  description: "smartctl cannot open the device or read its SMART data.",
  applies: (subject) => smartctlPayloadOf(subject) !== undefined,
  params: () => [
    {
      key: "exitStatus",
      label: "Exit status",
      kind: "select",
      default: String(DEVICE_OPEN_FAILED),
      options: [
        { value: String(DEVICE_OPEN_FAILED), label: "2: device open failed" },
        { value: String(COMMAND_FAILED), label: "4: SMART command failed" },
      ],
    },
  ],
  plan: (subject, params) => {
    const stored = requireSmartctl(subject);
    const exitStatus = Number(params.exitStatus);
    const body =
      exitStatus === DEVICE_OPEN_FAILED
        ? openFailedBody(stored)
        : commandFailedBody(stored);
    return {
      replays: [
        {
          ...stored,
          meta: { ...stored.meta, exitStatus },
          body: JSON.stringify(body, null, 2),
        },
      ],
    };
  },
});

export const PRESENCE_SCENARIOS = [
  missing,
  identityConflict,
  smartctlUnreadable,
];
