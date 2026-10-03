// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { clearNuxtData } from "#app";
import type { ReplicationRow } from "#shared/replications";
import {
  endpoint,
  replicationRow,
} from "~/components/replication/testFixtures";
import ReplicationsPage from "./index.vue";

const HOUR_MS = 60 * 60_000;
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * HOUR_MS).toISOString();

let rows: ReplicationRow[] = [];
registerEndpoint("/api/replications", () => rows);

beforeEach(() => {
  clearNuxtData();
  rows = [
    replicationRow(1, { lastSyncAt: hoursAgo(0.5), dueAt: hoursAgo(-0.5) }),
    replicationRow(2, {
      source: endpoint("atlas", "tank/backups/laptops"),
      target: endpoint("styx", "vault/replica/tank/backups/laptops"),
      status: "stalled",
      intervalSec: 86_400,
      intervalManual: true,
      lastSyncAt: hoursAgo(100),
      dueAt: hoursAgo(76),
    }),
    replicationRow(3, {
      source: endpoint("atlas", "tank/music"),
      target: endpoint("styx", "vault/replica/tank/music"),
      status: "late",
      intervalSec: 86_400 * 1.1,
      lastSyncAt: hoursAgo(40),
      dueAt: hoursAgo(14),
    }),
    replicationRow(4, {
      source: null,
      target: endpoint("styx", "vault/old/root"),
      status: "archived",
      archivedAt: hoursAgo(10),
    }),
  ];
});

describe("replications page", () => {
  it("groups rows by source and target parent with the worst status", async () => {
    const page = await mountSuspended(ReplicationsPage);
    const groups = page.findAll('[data-testid="replication-group"]');

    expect(groups.map((group) => group.attributes("data-status"))).toEqual([
      "late",
      "stalled",
    ]);
    expect(groups[0].get("h3").text()).toMatch(
      /atlas\s*tank\/\*\s*styx\s*vault\/replica\/tank\/\*\s*2/,
    );
    const firstRows = groups[0].findAll("tbody tr");
    expect(firstRows.map((row) => row.text())).toEqual([
      expect.stringContaining("tank/media"),
      expect.stringContaining("tank/music"),
    ]);
    expect(firstRows[0].text()).toContain("hourly");
    expect(firstRows[0].text()).toContain("30 min ago");
    expect(firstRows[0].text()).toContain("in 30 min");
    expect(firstRows[1].text()).toContain("~daily");
    expect(firstRows[1].text()).toContain("overdue 14 h");
    expect(firstRows[1].find(".text-warning").exists()).toBe(true);

    const stalled = groups[1].get("tbody tr");
    expect(stalled.text()).toContain("Stalled");
    expect(stalled.find('[data-testid="cadence-manual"]').exists()).toBe(true);
    expect(stalled.get('a[href="/replications/2"]').text()).toBe(
      "vault/replica/tank/backups/laptops",
    );
  });

  it("keeps archived replications in a collapsed section", async () => {
    const page = await mountSuspended(ReplicationsPage);
    const archived = page.get('[data-testid="archived-replications"]');

    expect(archived.text()).toContain("Archived");
    expect(archived.find("table").exists()).toBe(false);

    await archived.get('[data-testid="archived-toggle"]').trigger("click");
    expect(archived.get("h3").text()).toContain("source not monitored");
    expect(archived.text()).toContain("vault/old/root");
  });

  it("explains where replications come from when there are none", async () => {
    rows = [];
    const page = await mountSuspended(ReplicationsPage);
    expect(page.get('[data-testid="replications-empty"]').text()).toContain(
      "No replications seen yet",
    );
  });
});
