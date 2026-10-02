import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  disk,
  faultAcceptance,
  notification,
} from "~~/server/database/schema";
import type { Fetch } from "~~/server/services/alerts/channels";
import {
  listNotifications,
  RETRY_WINDOW_MS,
  runAlertsPass,
  sendTestNotification,
} from "~~/server/services/alerts/dispatch";
import { addAutoEvent } from "~~/server/services/diary";
import { upsertHostByName } from "~~/server/services/hosts";
import { getSettings, updateSettings } from "~~/server/services/settings";
import { flushDb } from "~~/test/db";

const now = new Date("2026-09-01T10:00:00Z");
const later = new Date(now.getTime() + 5 * 60 * 1000);

let diskId: number;

function failAttribute(attrId = "197", value = 16) {
  return addAutoEvent({
    subjectType: "disk",
    subjectId: diskId,
    eventType: "attribute-status-changed",
    title: "Current Pending Sector Count failed (was passed)",
    data: {
      attrId,
      name: "Current Pending Sector Count",
      from: "passed",
      to: "failed",
      value,
    },
    at: now,
  });
}

function respondWith(...statuses: number[]) {
  const queue = [...statuses];
  return vi.fn<Fetch>(
    async () => new Response(null, { status: queue.shift() ?? 200 }),
  );
}

async function configure({ pushover = true, webhook = true } = {}) {
  await updateSettings({
    config: {
      notifications: {
        pushover: pushover ? { token: "app", user: "me" } : null,
        webhook: webhook ? { url: "https://hooks.example/t" } : null,
      },
    },
  });
}

beforeEach(() => {
  flushDb();
  const mars = upsertHostByName("mars", now);
  db.insert(collectorRun)
    .values({
      hostId: mars.id,
      source: "zpool-status",
      receivedAt: now,
      ok: true,
      bytes: 0,
    })
    .run();
  diskId = db
    .insert(disk)
    .values({
      alias: "K2",
      lastSeenAt: now,
      lastSeenHostId: mars.id,
      lastState: "spare",
    })
    .returning()
    .get().id;
});

describe("runAlertsPass", () => {
  it("advances the cursor and sends nothing without a channel", async () => {
    const entry = failAttribute();
    const fetchMock = respondWith();

    const summary = await runAlertsPass(now, fetchMock);

    expect(summary).toMatchObject({ entries: 1, alerts: 0, sent: 0 });
    expect((await getSettings()).config.alertCursor).toBe(entry.id);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(listNotifications()).toEqual([]);
  });

  it("sends each alert to every channel and records it", async () => {
    await configure();
    const entry = failAttribute();
    const fetchMock = respondWith(200, 200);

    expect(await runAlertsPass(now, fetchMock)).toEqual({
      entries: 1,
      alerts: 1,
      sent: 2,
      failed: 0,
      retried: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      listNotifications().map(({ channel, ok, rule, message }) => ({
        channel,
        ok,
        rule,
        message,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          channel: "pushover",
          ok: true,
          rule: "attribute-failed",
          message: "mars · K2: Current Pending Sector Count failed (16)",
        },
        expect.objectContaining({ channel: "webhook", ok: true }),
      ]),
    );
    expect((await getSettings()).config.alertCursor).toBe(entry.id);
  });

  it("does not reread entries behind the cursor", async () => {
    await configure();
    failAttribute();
    await runAlertsPass(now, respondWith());
    const fetchMock = respondWith();

    expect(await runAlertsPass(later, fetchMock)).toMatchObject({
      entries: 0,
      sent: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a key already sent on that channel", async () => {
    await configure({ webhook: false });
    const entry = failAttribute();
    db.insert(notification)
      .values({
        at: now,
        channel: "pushover",
        rule: "attribute-failed",
        dedupeKey: `attribute-failed:disk:${diskId}:197:${entry.id}`,
        subject: "mars · K2",
        title: "Attribute failed",
        message: "",
        ok: true,
      })
      .run();
    const fetchMock = respondWith();

    expect(await runAlertsPass(now, fetchMock)).toMatchObject({
      alerts: 1,
      sent: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not alert on an attribute failing under an active acceptance", async () => {
    await configure();
    db.insert(faultAcceptance)
      .values({ diskId, attrId: "197", acceptedValue: 16, acceptedAt: now })
      .run();
    failAttribute();
    const fetchMock = respondWith();

    expect(await runAlertsPass(now, fetchMock)).toMatchObject({
      entries: 1,
      alerts: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("materialises disk state transitions before reading the diary", async () => {
    await configure({ webhook: false });
    db.update(disk)
      .set({ lastSeenAt: new Date(now.getTime() - 3 * 60 * 60 * 1000) })
      .run();

    await runAlertsPass(now, respondWith(200));

    expect(listNotifications()).toEqual([
      expect.objectContaining({
        rule: "disk-missing",
        message: "mars · K2: missing (was spare)",
      }),
    ]);
  });

  it("records a failed send and retries it on the next pass", async () => {
    await configure({ webhook: false });
    failAttribute();

    expect(await runAlertsPass(now, respondWith(500))).toMatchObject({
      failed: 1,
    });
    const [failed] = listNotifications();
    expect(failed).toMatchObject({ ok: false, error: "HTTP 500" });

    expect(await runAlertsPass(later, respondWith(503))).toMatchObject({
      retried: 1,
    });
    expect(listNotifications()).toEqual([
      expect.objectContaining({ id: failed.id, ok: false, error: "HTTP 503" }),
    ]);

    expect(await runAlertsPass(later, respondWith(200))).toMatchObject({
      retried: 1,
    });
    expect(listNotifications()).toEqual([
      expect.objectContaining({ id: failed.id, ok: true, error: null }),
    ]);

    const fetchMock = respondWith();
    expect(await runAlertsPass(later, fetchMock)).toMatchObject({
      retried: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up retrying after a day", async () => {
    await configure({ webhook: false });
    failAttribute();
    await runAlertsPass(now, respondWith(500));
    const fetchMock = respondWith();

    const dayLater = new Date(now.getTime() + RETRY_WINDOW_MS);
    db.update(disk).set({ lastSeenAt: dayLater }).run();
    expect(await runAlertsPass(dayLater, fetchMock)).toMatchObject({
      retried: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry once the fault has been accepted", async () => {
    await configure({ webhook: false });
    failAttribute();
    await runAlertsPass(now, respondWith(500));
    db.insert(faultAcceptance)
      .values({ diskId, attrId: "197", acceptedValue: 16, acceptedAt: later })
      .run();
    const fetchMock = respondWith();

    expect(await runAlertsPass(later, fetchMock)).toMatchObject({
      retried: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendTestNotification", () => {
  it("sends a test message on the chosen channel", async () => {
    await configure();
    const fetchMock = respondWith(200);

    expect(await sendTestNotification("webhook", now, fetchMock)).toEqual({
      ok: true,
      error: null,
    });
    const [url, init] = fetchMock.mock.lastCall ?? [];
    expect(url).toBe("https://hooks.example/t");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      rule: "test",
      severity: "test",
    });
    expect(listNotifications()).toEqual([]);
  });

  it("fails a channel that is not configured", async () => {
    expect(await sendTestNotification("pushover", now, respondWith())).toEqual({
      ok: false,
      error: "pushover is not configured",
    });
  });
});

describe("in the demo", () => {
  beforeEach(() => {
    useRuntimeConfig().public.demo = true;
  });

  afterEach(() => {
    useRuntimeConfig().public.demo = false;
  });

  it("sends nothing, records no notifications, and still advances the cursor", async () => {
    await configure();
    failAttribute();
    const fetchImpl = respondWith();

    const summary = await runAlertsPass(later, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      alerts: 0,
      sent: 0,
      failed: 0,
      retried: 0,
    });
    expect(listNotifications()).toEqual([]);
    expect((await getSettings()).config.alertCursor).toBeGreaterThan(0);
  });

  it("refuses test notifications without an outbound request", async () => {
    await configure();
    const fetchImpl = respondWith();

    expect(await sendTestNotification("webhook", later, fetchImpl)).toEqual({
      ok: false,
      error: "Disabled in the demo",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
