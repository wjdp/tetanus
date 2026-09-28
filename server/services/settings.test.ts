import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS_CONFIG } from "#shared/schemas/settings";
import { db } from "~~/server/database/client";
import { setting } from "~~/server/database/schema";
import {
  ensureSettings,
  getSettings,
  setAlertCursor,
  updateSettings,
} from "~~/server/services/settings";
import { flushDb } from "~~/test/db";

describe("settings", () => {
  beforeEach(() => {
    flushDb();
  });

  it("generates a 32-byte hex enrol token on first read", async () => {
    const { enrolToken } = await getSettings();
    expect(enrolToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the same enrol token across reads", async () => {
    const first = await getSettings();
    const second = await getSettings();
    expect(second.enrolToken).toBe(first.enrolToken);
  });

  it("keeps a single row however often it is ensured", () => {
    ensureSettings();
    ensureSettings();
    expect(db.select().from(setting).all()).toHaveLength(1);
  });

  it("refuses a second settings row", () => {
    ensureSettings();
    expect(() =>
      db.insert(setting).values({ id: 2, enrolToken: "other" }).run(),
    ).toThrow(/CHECK constraint/);
  });

  it("fills config from defaults", async () => {
    expect((await getSettings()).config).toEqual(DEFAULT_SETTINGS_CONFIG);
  });

  it("merges a config patch and keeps the token", async () => {
    const before = await getSettings();
    const after = await updateSettings({ config: { missingAfterDays: 3 } });
    expect(after).toEqual({
      enrolToken: before.enrolToken,
      config: { ...DEFAULT_SETTINGS_CONFIG, missingAfterDays: 3 },
    });
    expect(await getSettings()).toEqual(after);
  });

  it("leaves config untouched for an empty patch", async () => {
    await updateSettings({ config: { missingAfterDays: 3 } });
    expect((await updateSettings({ config: {} })).config.missingAfterDays).toBe(
      3,
    );
  });

  it("keeps the alert cursor when config is patched", async () => {
    setAlertCursor(42);
    await updateSettings({ config: { missingAfterDays: 3 } });
    expect((await getSettings()).config.alertCursor).toBe(42);
  });
});

describe("notification settings", () => {
  const pushover = { token: "app-token", user: "user-key" };
  const webhook = { url: "https://hooks.example/tetanus", secret: "s3cret" };

  beforeEach(async () => {
    flushDb();
    await updateSettings({ config: { notifications: { pushover, webhook } } });
  });

  it("returns secrets as stored", async () => {
    expect((await getSettings()).config.notifications).toEqual({
      pushover,
      webhook,
    });
  });

  it("patches one channel and leaves the other", async () => {
    await updateSettings({ config: { notifications: { pushover: null } } });
    expect((await getSettings()).config.notifications).toEqual({
      pushover: null,
      webhook,
    });
  });
});
