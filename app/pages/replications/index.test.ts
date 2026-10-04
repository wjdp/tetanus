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
  it("lists every group in one table, worst first, with a summary", async () => {
    const page = await mountSuspended(ReplicationsPage);

    expect(page.findAll("table")).toHaveLength(1);
    expect(page.get('[data-testid="replications-summary"]').text()).toBe(
      "3 replications · 1 stalled · 1 late",
    );
    const groups = page.findAll('[data-testid="replication-group"]');
    expect(groups.map((group) => group.attributes("data-status"))).toEqual([
      "stalled",
    ]);
    expect(groups[0].get("th").text()).toMatch(
      /atlas\s*styx\s*3\s*1 stalled · 1 late/,
    );

    const rowsShown = groups[0].findAll('[data-testid="replication-row"]');
    expect(rowsShown.map((row) => row.text())).toEqual([
      expect.stringContaining("tank/backups/laptops"),
      expect.stringContaining("tank/music"),
      expect.stringContaining("tank/media"),
    ]);
    const [stalled, late, ok] = rowsShown;
    expect(stalled.text()).toContain("Stalled");
    expect(stalled.find('[data-testid="cadence-manual"]').exists()).toBe(true);
    expect(stalled.get('a[href="/replications/2"]').text()).toBe(
      "vault/replica/tank/backups/laptops",
    );
    expect(late.text()).toContain("~daily");
    expect(late.get('[data-testid="replication-row-status"]').text()).toBe(
      "Late · 14 h overdue",
    );
    expect(late.find(".text-warning").exists()).toBe(true);
    expect(ok.text()).toContain("hourly");
    expect(ok.text()).toContain("30 min ago");
    expect(ok.get('[data-testid="replication-row-status"]').text()).toBe(
      "Due in 30 min",
    );
    expect(ok.text()).not.toContain("OK");
  });

  it("lists each replication as a stacked item for phones", async () => {
    const page = await mountSuspended(ReplicationsPage);
    const list = page.get('[data-testid="replication-list"]');
    expect(list.classes()).toContain("md:hidden");

    const [stalled] = list.findAll('[data-testid="replication-list-item"]');
    expect(stalled.attributes("href")).toBe("/replications/2");
    expect(stalled.text()).toContain("tank/backups/laptops");
    expect(stalled.text()).toContain("→ vault/replica/tank/backups/laptops");
    expect(stalled.text()).toContain("Stalled · 3 d overdue");
    expect(stalled.get('[data-testid="replication-list-meta"]').text()).toMatch(
      /^daily\s*· 4 d ago$/,
    );
  });

  it("merges status and next due into one column", async () => {
    rows = [
      replicationRow(1),
      replicationRow(5, { lastSyncAt: hoursAgo(0.2) }),
    ];
    const page = await mountSuspended(ReplicationsPage);

    expect(page.findAll("thead th").map((th) => th.text())).toEqual([
      "Health",
      "Source",
      "Target",
      "Cadence",
      "Last sync",
      "Status",
    ]);
    expect(page.get('[data-testid="replications-summary"]').text()).toBe(
      "2 replications · all on schedule",
    );
  });

  it("keeps archived replications in a collapsed section", async () => {
    const page = await mountSuspended(ReplicationsPage);
    const archived = page.get('[data-testid="archived-replications"]');

    expect(archived.text()).toContain("Archived");
    expect(archived.find("table").exists()).toBe(false);

    await archived.get('[data-testid="archived-toggle"]').trigger("click");
    expect(archived.get("tbody th").text()).toContain("source not monitored");
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
