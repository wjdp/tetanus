import { and, asc, desc, eq, gt, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { type AlertChannel, TEST_RULE } from "#shared/alerts";
import { APP_NAME } from "#shared/app";
import { replicationLabel } from "#shared/replications";
import type { NotificationsConfig } from "#shared/schemas/settings";
import { db } from "~~/server/database/client";
import {
  dataset,
  diaryEntry,
  disk,
  host,
  notification,
  pool,
  replication,
} from "~~/server/database/schema";
import { activeAcceptances } from "~~/server/services/acceptance";
import {
  configuredChannels,
  type Fetch,
  type SendResult,
  sendToChannel,
} from "~~/server/services/alerts/channels";
import {
  type Alert,
  type AlertContext,
  type AlertDisk,
  type AlertHost,
  type AlertPool,
  type AlertReplication,
  deriveAlert,
  deriveAlerts,
} from "~~/server/services/alerts/rules";
import { listDisks } from "~~/server/services/disks";
import { syncFaults } from "~~/server/services/faults";
import { getSettings, setAlertCursor } from "~~/server/services/settings";
import { simulationActive } from "~~/server/services/simulator/capture";
import { isDemo } from "~~/server/utils/demo";

export type NotificationRow = typeof notification.$inferSelect;

export const DEFAULT_NOTIFICATION_LIMIT = 50;
const DEMO_SEND_ERROR = "Disabled in the demo";
const SIMULATED_SEND: SendResult = {
  ok: false,
  error: "Not sent: a fault simulation is active",
};
export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AlertsPassSummary {
  entries: number;
  alerts: number;
  sent: number;
  failed: number;
  retried: number;
}

function memoise<T>(load: (id: number) => T): (id: number) => T {
  const cache = new Map<number, T>();
  return (id) => {
    if (!cache.has(id)) cache.set(id, load(id));
    return cache.get(id) as T;
  };
}

export function alertContext(): AlertContext {
  return {
    disk: memoise((id): AlertDisk | undefined =>
      db
        .select({
          alias: disk.alias,
          model: disk.model,
          serial: disk.serial,
          hostName: host.name,
          disposal: disk.disposal,
        })
        .from(disk)
        .leftJoin(host, eq(host.id, disk.lastSeenHostId))
        .where(eq(disk.id, id))
        .get(),
    ),
    pool: memoise((id): AlertPool | undefined => {
      const row = db
        .select({
          name: pool.name,
          hostName: host.name,
          archivedAt: pool.archivedAt,
        })
        .from(pool)
        .leftJoin(host, eq(host.id, pool.hostId))
        .where(eq(pool.id, id))
        .get();
      if (!row) return undefined;
      const { archivedAt, ...described } = row;
      return { ...described, archived: archivedAt !== null };
    }),
    host: memoise((id): AlertHost | undefined =>
      db.select({ name: host.name }).from(host).where(eq(host.id, id)).get(),
    ),
    replication: memoise((id): AlertReplication | undefined => {
      const source = alias(dataset, "source");
      const row = db
        .select({
          targetName: dataset.name,
          sourceName: source.name,
          hostName: host.name,
          archivedAt: replication.archivedAt,
          poolArchivedAt: pool.archivedAt,
        })
        .from(replication)
        .innerJoin(dataset, eq(dataset.id, replication.targetDatasetId))
        .innerJoin(pool, eq(pool.id, dataset.poolId))
        .leftJoin(host, eq(host.id, pool.hostId))
        .leftJoin(source, eq(source.id, replication.sourceDatasetId))
        .where(eq(replication.id, id))
        .get();
      if (!row) return undefined;
      return {
        label: replicationLabel(row),
        hostName: row.hostName,
        archived: row.archivedAt !== null || row.poolArchivedAt !== null,
      };
    }),
    hasActiveAcceptance: (() => {
      const accepted = memoise(activeAcceptances);
      return (diskId, attrId) => accepted(diskId).has(attrId);
    })(),
  };
}

function hasBeenSent(dedupeKey: string, channel: AlertChannel) {
  return (
    db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.dedupeKey, dedupeKey),
          eq(notification.channel, channel),
          eq(notification.ok, true),
        ),
      )
      .get() !== undefined
  );
}

function recordNotification(
  alert: Alert,
  channel: AlertChannel,
  result: SendResult,
  at: Date,
) {
  db.insert(notification)
    .values({
      at,
      channel,
      rule: alert.rule,
      dedupeKey: alert.dedupeKey,
      subject: alert.subject,
      title: alert.title,
      message: alert.message,
      ok: result.ok,
      error: result.error,
      diaryEntryId: alert.diaryEntryId,
    })
    .run();
}

function retryableNotifications(now: Date) {
  return db
    .select()
    .from(notification)
    .where(
      and(
        eq(notification.ok, false),
        gt(notification.at, new Date(now.getTime() - RETRY_WINDOW_MS)),
        isNotNull(notification.diaryEntryId),
      ),
    )
    .orderBy(asc(notification.id))
    .all();
}

function rederive(row: NotificationRow, context: AlertContext) {
  if (row.diaryEntryId === null) return null;
  const entry = db
    .select()
    .from(diaryEntry)
    .where(eq(diaryEntry.id, row.diaryEntryId))
    .get();
  const alert = entry && deriveAlert(entry, context);
  return alert?.dedupeKey === row.dedupeKey ? alert : null;
}

async function retryFailed(
  now: Date,
  notifications: NotificationsConfig,
  channels: AlertChannel[],
  context: AlertContext,
  fetchImpl: Fetch,
) {
  let retried = 0;
  for (const row of retryableNotifications(now)) {
    if (!channels.includes(row.channel)) continue;
    if (hasBeenSent(row.dedupeKey, row.channel)) continue;
    const alert = rederive(row, context);
    if (!alert) continue;
    const result = await sendToChannel(
      row.channel,
      notifications,
      alert,
      fetchImpl,
    );
    db.update(notification)
      .set({ ok: result.ok, error: result.error })
      .where(eq(notification.id, row.id))
      .run();
    retried += 1;
  }
  return retried;
}

function readNewEntries(cursor: number) {
  return db
    .select()
    .from(diaryEntry)
    .where(gt(diaryEntry.id, cursor))
    .orderBy(asc(diaryEntry.id))
    .all();
}

export async function runAlertsPass(
  now = new Date(),
  fetchImpl: Fetch = fetch,
): Promise<AlertsPassSummary> {
  await syncFaults(now, await listDisks(now));
  const { config } = await getSettings();
  const entries = readNewEntries(config.alertCursor);
  const lastEntry = entries.at(-1);
  if (lastEntry) setAlertCursor(lastEntry.id);

  const summary = { entries: entries.length, alerts: 0, sent: 0, failed: 0 };
  if (isDemo()) return { ...summary, retried: 0 };
  const channels = configuredChannels(config.notifications);
  if (channels.length === 0) return { ...summary, retried: 0 };

  const context = alertContext();
  const simulating = simulationActive();
  const retried = simulating
    ? 0
    : await retryFailed(
        now,
        config.notifications,
        channels,
        context,
        fetchImpl,
      );
  const alerts = deriveAlerts(entries, context);
  summary.alerts = alerts.length;
  for (const alert of alerts) {
    for (const channel of channels) {
      if (hasBeenSent(alert.dedupeKey, channel)) continue;
      const result = simulating
        ? SIMULATED_SEND
        : await sendToChannel(channel, config.notifications, alert, fetchImpl);
      recordNotification(alert, channel, result, now);
      if (result.ok) summary.sent += 1;
      else summary.failed += 1;
    }
  }
  return { ...summary, retried };
}

export async function sendTestNotification(
  channel: AlertChannel,
  now = new Date(),
  fetchImpl: Fetch = fetch,
): Promise<SendResult> {
  if (isDemo()) return { ok: false, error: DEMO_SEND_ERROR };
  const { config } = await getSettings();
  return sendToChannel(
    channel,
    config.notifications,
    {
      rule: TEST_RULE,
      severity: TEST_RULE,
      subject: APP_NAME,
      subjectType: null,
      subjectId: null,
      host: null,
      title: `${APP_NAME} test`,
      message: `Test notification from ${APP_NAME}: alerts will arrive here.`,
      at: now,
      dedupeKey: `${TEST_RULE}:${now.getTime()}`,
    },
    fetchImpl,
  );
}

export function listNotifications(
  limit = DEFAULT_NOTIFICATION_LIMIT,
): NotificationRow[] {
  return db
    .select()
    .from(notification)
    .orderBy(desc(notification.at), desc(notification.id))
    .limit(limit)
    .all();
}
