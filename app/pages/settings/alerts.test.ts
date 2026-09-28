// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { readBody } from "h3";
import { describe, expect, it, vi } from "vitest";
import { SECRET_MASK } from "#shared/schemas/settings";
import AlertsPage from "./alerts.vue";

const notifications = {
  pushover: { token: SECRET_MASK, user: SECRET_MASK },
  webhook: null,
};

const patched: unknown[] = [];

registerEndpoint("/api/settings", {
  method: "GET",
  handler: () => ({
    enrolToken: "ab",
    config: { missingAfterDays: 7, alertCursor: 0, notifications },
  }),
});

registerEndpoint("/api/settings", {
  method: "PATCH",
  handler: async (event) => {
    const body = await readBody(event);
    patched.push(body);
    return {
      enrolToken: "ab",
      config: {
        missingAfterDays: 7,
        alertCursor: 0,
        notifications: body.config.notifications,
      },
    };
  },
});

registerEndpoint("/api/alerts", () => [
  {
    id: 2,
    at: "2026-09-28T17:05:00.000Z",
    channel: "pushover",
    rule: "pool-degraded",
    dedupeKey: "pool-degraded:pool:1:DEGRADED:9",
    subject: "mars · tank",
    title: "Pool degraded",
    message: "mars · tank: DEGRADED",
    ok: false,
    error: "HTTP 500",
    diaryEntryId: 9,
  },
  {
    id: 1,
    at: "2026-09-28T17:00:00.000Z",
    channel: "webhook",
    rule: "disk-failed",
    dedupeKey: "disk-failed:disk:4:failed:8",
    subject: "mars · K2",
    title: "Disk failed",
    message: "mars · K2: SMART failed",
    ok: true,
    error: null,
    diaryEntryId: 8,
  },
]);

registerEndpoint("/api/alerts/test", {
  method: "POST",
  handler: async (event) => {
    const { channel } = await readBody(event);
    return channel === "pushover"
      ? { ok: true, error: null }
      : { ok: false, error: "Webhook is not configured" };
  },
});

describe("alerts settings page", () => {
  it("renders both channels with stored secrets masked", async () => {
    const page = await mountSuspended(AlertsPage);

    const pushover = page.get('[data-testid="channel-pushover"]');
    const secrets = pushover.findAll('input[type="password"]');
    expect(
      secrets.map((input) => (input.element as HTMLInputElement).value),
    ).toEqual([SECRET_MASK, SECRET_MASK]);
    expect(page.get('[data-testid="channel-webhook"]').text()).toContain(
      "Disabled.",
    );
  });

  it("lists recent notifications with rule labels and results", async () => {
    const page = await mountSuspended(AlertsPage);
    const table = page.get('[data-testid="notifications"]');

    expect(table.text()).toContain("Pool degraded");
    expect(table.text()).toContain("mars · tank: DEGRADED");
    expect(table.text()).toContain("HTTP 500");
    expect(table.text()).toContain("Disk failed");
    expect(table.text()).toContain("Webhook");
  });

  it("saves masks unchanged and sends null for a disabled channel", async () => {
    const page = await mountSuspended(AlertsPage);
    await page.get("form").trigger("submit");
    await flushPromises();

    expect(patched.at(-1)).toEqual({ config: { notifications } });
  });

  it("shows the test result inline", async () => {
    const page = await mountSuspended(AlertsPage);
    for (const channel of ["pushover", "webhook"]) {
      const button = page
        .get(`[data-testid="channel-${channel}"]`)
        .findAll("button")
        .find((candidate) => candidate.text() === "Send test");
      await button?.trigger("click");
    }
    await vi.waitFor(() => {
      const results = page.findAll('[data-testid="test-result"]');
      expect(
        results.map((result) => [result.text(), result.classes()]),
      ).toEqual([
        ["Sent", expect.arrayContaining(["text-muted"])],
        ["Webhook is not configured", expect.arrayContaining(["text-error"])],
      ]);
    });
  });
});
