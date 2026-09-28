// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { clearNuxtData } from "#app";
import IndexPage from "./index.vue";

// registerEndpoint's handler is re-read on every request, but a second call
// for the same URL does not replace the first within one test file, so both
// scenarios share one endpoint and switch on a mutable fixture instead.
let hosts: unknown[] = [];

registerEndpoint("/api/hosts", () => hosts);
registerEndpoint("/api/settings", () => ({
  enrolToken: "ab".repeat(32),
  config: { missingAfterDays: 7 },
}));

beforeEach(() => {
  clearNuxtData();
});

describe("index page", () => {
  it("shows first-run guidance when no hosts have reported", async () => {
    hosts = [];

    const page = await mountSuspended(IndexPage);

    expect(page.text()).toContain("No hosts have reported yet.");
    expect(page.get('[data-testid="install-command"]').text()).toContain(
      "ab".repeat(32),
    );
  });

  it("hides the empty state once a host has reported", async () => {
    hosts = [
      {
        id: 1,
        name: "mars",
        displayName: null,
        toolVersions: {},
        healthchecksUrl: null,
        notes: "",
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        lastRuns: {},
      },
    ];

    const page = await mountSuspended(IndexPage);

    expect(page.text()).not.toContain("No hosts have reported yet.");
  });
});
