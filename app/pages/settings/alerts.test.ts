// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { readBody } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AlertsPage from "./alerts.vue";

const notifications = {
  pushover: { token: "app-token", user: "user-key" },
  webhook: null,
};

const patched: unknown[] = [];
const tested: string[] = [];

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
        notifications: { ...notifications, ...body.config.notifications },
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
    tested.push(channel);
    return channel === "pushover"
      ? { ok: true, error: null }
      : { ok: false, error: "Webhook is not configured" };
  },
});

const card = (page: VueWrapper, channel: string) =>
  page.get(`[data-testid="channel-${channel}"]`);

const button = (page: VueWrapper, channel: string, label: string) =>
  card(page, channel)
    .findAll("button")
    .find((candidate) => candidate.text() === label);

describe("alerts settings page", () => {
  it("shows stored secrets in plain text", async () => {
    const page = await mountSuspended(AlertsPage);

    const values = card(page, "pushover")
      .findAll("input")
      .map((input) => (input.element as HTMLInputElement).value);
    expect(values).toEqual(["app-token", "user-key"]);
    expect(card(page, "pushover").find('input[type="password"]').exists()).toBe(
      false,
    );
  });

  it("offers no actions for a disabled, unchanged channel", async () => {
    const page = await mountSuspended(AlertsPage);
    const webhook = card(page, "webhook");

    expect(webhook.text()).toContain("Disabled.");
    expect(webhook.findAll('button:not([role="switch"])')).toHaveLength(0);
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

  it("saves only the edited channel", async () => {
    const page = await mountSuspended(AlertsPage);
    expect(
      button(page, "pushover", "Save")?.attributes("disabled"),
    ).toBeDefined();

    await card(page, "pushover").findAll("input")[1]?.setValue("new-user");
    await card(page, "pushover").trigger("submit");
    await flushPromises();

    expect(patched.at(-1)).toEqual({
      config: {
        notifications: { pushover: { token: "app-token", user: "new-user" } },
      },
    });
    expect(
      button(page, "pushover", "Save")?.attributes("disabled"),
    ).toBeDefined();
  });

  it("saves before sending a test when there are unsaved changes", async () => {
    const page = await mountSuspended(AlertsPage);
    const patchesBefore = patched.length;

    await card(page, "pushover").findAll("input")[0]?.setValue("typed-token");
    await button(page, "pushover", "Save and send test")?.trigger("click");

    await vi.waitFor(() => {
      expect(
        card(page, "pushover").get('[data-testid="test-result"]').text(),
      ).toBe("Test sent");
    });
    expect(patched.length).toBe(patchesBefore + 1);
    expect(tested.at(-1)).toBe("pushover");
  });

  it("shows a failed test inline", async () => {
    const page = await mountSuspended(AlertsPage);
    await card(page, "webhook").get('button[role="switch"]').trigger("click");
    await card(page, "webhook")
      .findAll("input")[0]
      ?.setValue("https://hooks.example/t");
    await button(page, "webhook", "Save and send test")?.trigger("click");

    await vi.waitFor(() => {
      const result = card(page, "webhook").get('[data-testid="test-result"]');
      expect(result.text()).toBe("Webhook is not configured");
      expect(result.classes()).toContain("text-error");
    });
  });
});

describe("alerts page in the demo", () => {
  beforeEach(() => {
    useRuntimeConfig().public.demo = true;
  });

  afterEach(() => {
    useRuntimeConfig().public.demo = false;
  });

  it("shows a disabled note instead of the channel forms", async () => {
    const page = await mountSuspended(AlertsPage);
    expect(page.find('[data-testid="demo-disabled-note"]').exists()).toBe(true);
    expect(page.find("form").exists()).toBe(false);
    expect(page.text()).not.toContain("Create a Pushover application");
  });
});
