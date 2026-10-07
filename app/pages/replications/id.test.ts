// @vitest-environment nuxt
import {
  mockNuxtImport,
  mountSuspended,
  registerEndpoint,
} from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { createError, getQuery, readBody } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearNuxtData } from "#app";
import type { FaultView } from "#shared/faults";
import type {
  ReplicationLadderRow,
  ReplicationRow,
  ReplicationSyncView,
} from "#shared/replications";
import type { SubjectScenarios } from "#shared/simulator";
import {
  endpoint,
  endpointFacts,
  replicationRow,
} from "~/components/replication/testFixtures";
import { FakeEventSource } from "~~/test/fakeEventSource";
import ReplicationPage from "./[id].vue";

const HOUR_MS = 60 * 60_000;
const START = Date.parse("2026-09-01T00:00:00.000Z");

const sync = (index: number, hoursAfterStart: number): ReplicationSyncView => ({
  id: index,
  at: new Date(START + hoursAfterStart * HOUR_MS).toISOString(),
  snapshotName: `autosnap_${String(index).padStart(3, "0")}`,
  guid: String(1000 + index),
  snapshots: index === 120 ? 3 : 1,
});

// Hourly syncs with an 8 h hole before the newest, 120 in all.
const SYNC_HOURS = [...Array.from({ length: 119 }, (_, index) => index), 126];
const SYNCS = SYNC_HOURS.map((hours, index) =>
  sync(index + 1, hours),
).reverse();

const LADDER: ReplicationLadderRow[] = [
  {
    source: { name: "autosnap_120", creation: "2026-09-06T06:00:00.000Z" },
    target: { name: "autosnap_120", creation: "2026-09-06T06:00:00.000Z" },
    guid: "1120",
    creation: "2026-09-06T06:00:00.000Z",
  },
  {
    source: { name: "autosnap_119", creation: "2026-09-05T22:00:00.000Z" },
    target: null,
    guid: "1119",
    creation: "2026-09-05T22:00:00.000Z",
  },
];

let row: ReplicationRow;
const patches: unknown[] = [];

const detail = (page: number) => ({
  ...row,
  syncs: {
    items: SYNCS.slice((page - 1) * 100, page * 100),
    total: SYNCS.length,
    page,
    pageSize: 100,
  },
  ladder: LADDER,
  ends: {
    source: endpointFacts(),
    target: endpointFacts({
      encryption: "aes-256-gcm",
      keyStatus: "unavailable",
      mountpoint: "/mnt/vault/replica/tank/media",
    }),
  },
  diary: [
    {
      id: 9,
      subjectType: "replication",
      subjectId: 3,
      at: "2026-09-01T00:00:00.000Z",
      kind: "auto",
      eventType: "replication-discovered",
      title: "Replication discovered",
      body: "",
      data: null,
    },
  ],
  faults: [],
});

mockNuxtImport("useSimulator", () => () => ({
  enabled: true,
  simulations: ref([]),
  simulate: vi.fn(),
  restore: vi.fn(),
  refresh: vi.fn(),
}));

const SCENARIOS: SubjectScenarios = {
  simulations: [],
  scenarios: [
    {
      id: "replication-late",
      label: "Running late",
      group: "Replication",
      params: [
        {
          key: "hours",
          label: "Syncs moved back",
          kind: "number",
          default: 4,
          min: 1,
        },
      ],
    },
    {
      id: "replication-target-destroyed",
      label: "Target dataset destroyed",
      group: "Replication",
      params: [],
    },
  ],
};
registerEndpoint("/api/simulate/replication/3", () => SCENARIOS);

registerEndpoint("/api/replications/3", {
  method: "GET",
  handler: (event) => detail(Number(getQuery(event).page ?? 1)),
});
registerEndpoint("/api/replications/3", {
  method: "PATCH",
  handler: async (event) => {
    const body = await readBody(event);
    patches.push(body);
    if (body.archived === true) {
      row = {
        ...row,
        status: "archived",
        archivedAt: "2026-09-07T00:00:00.000Z",
        archivedNote: body.archivedNote ?? "",
      };
    }
    if ("sourceDatasetId" in body) {
      row = {
        ...row,
        direction: body.sourceDatasetId === null ? "received" : "manual",
      };
    }
    if ("manualIntervalSec" in body) {
      row = {
        ...row,
        intervalSec: body.manualIntervalSec ?? 3600,
        intervalManual: body.manualIntervalSec !== null,
      };
    }
    return detail(1);
  },
});
registerEndpoint("/api/replications/404", () => {
  throw createError({
    statusCode: 404,
    statusMessage: "Replication not found",
  });
});

const stalledFault: FaultView = {
  id: 61,
  kind: "replication-stalled",
  category: "zfs",
  severity: "error",
  state: "open",
  key: "3",
  note: "",
  data: { targetName: "vault/replica/tank/media" },
  openedAt: "2026-09-06T00:00:00.000Z",
  lastSeenAt: "2026-09-06T06:00:00.000Z",
  resolvedAt: null,
  stateChangedAt: "2026-09-06T00:00:00.000Z",
  subject: {
    type: "replication",
    id: 3,
    label: "tank/media → vault/replica/tank/media",
    hostName: "styx",
    path: "/replications/3",
  },
};
registerEndpoint("/api/faults", (event) => {
  const faults =
    getQuery(event).subject === "replication:3" ? [stalledFault] : [];
  return {
    faults,
    counts: { open: faults.length, acknowledged: 0, accepted: 0, resolved: 0 },
  };
});
registerEndpoint("/api/settings", () => ({
  enrolToken: "x",
  config: {
    replicationLateFloorHours: 3,
    replicationLateFactor: 0.5,
    replicationStalledFloorHours: 48,
    replicationStalledFactor: 2,
  },
}));

beforeEach(() => {
  FakeEventSource.install();
  clearNuxtData();
  patches.length = 0;
  row = replicationRow(3, {
    source: endpoint("atlas", "tank/media", { datasetId: 21 }),
    target: endpoint("styx", "vault/replica/tank/media", {
      hostId: 2,
      datasetId: 31,
    }),
    status: "stalled",
    syncCount: SYNCS.length,
  });
});

const mountPage = () =>
  mountSuspended(ReplicationPage, { route: "/replications/3" });

describe("replication page", () => {
  it("shows the header, cadence, source and open faults", async () => {
    const page = await mountPage();

    expect(page.get('[data-testid="endpoints"]').text()).toMatch(
      /atlas\s*tank\/media\s*styx\s*vault\/replica\/tank\/media/,
    );
    expect(page.text()).toContain("Stalled");
    expect(page.get('[data-testid="direction"]').text()).toBe("Discovered");
    expect(
      page
        .find('[data-testid="endpoints"] a[href="/zfs/atlas/tank/media"]')
        .exists(),
    ).toBe(true);
    expect(
      page.find('[data-testid="endpoints"] a[href="/hosts/atlas"]').exists(),
    ).toBe(true);

    const target = page.get('[data-testid="target-panel"]').text();
    expect(target).toContain("vault/replica/tank/media");
    expect(target).toContain("aes-256-gcm · key not loaded");
    expect(target).toContain("/mnt/vault/replica/tank/media");
    expect(target).toContain("autosnap_120");
    expect(page.get('[data-testid="source-panel"]').text()).toContain(
      "Encryptionoff",
    );

    const cadence = page.get('[data-testid="cadence-panel"]').text();
    expect(cadence).toContain("hourly");
    expect(cadence).toContain("median gap of the last 10 syncs");
    expect(cadence).toContain("120");

    expect(page.get('[data-testid="source-panel"]').text()).toContain(
      "tank/media",
    );
    await vi.waitFor(() =>
      expect(page.find('[data-testid="replication-faults"]').exists()).toBe(
        true,
      ),
    );
  });

  it("offers the replication's fault scenarios", async () => {
    const page = await mountPage();
    await page
      .get('[data-testid="simulate-fault"]')
      .trigger("keydown", { key: "Enter" });
    await vi.waitFor(() => {
      const labels = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].map((element) => element.textContent?.trim());
      expect(labels).toEqual(["Running late…", "Target dataset destroyed"]);
    });
  });

  it("logs syncs a page at a time with long gaps marked", async () => {
    const page = await mountPage();
    const rows = () => page.findAll('[data-testid="sync-log"] tbody tr');

    expect(rows()).toHaveLength(100);
    expect(rows()[0].text()).toContain("autosnap_120");
    expect(rows()[0].text()).toContain("3");
    const gap = rows()[0].get("[data-gap]");
    expect(gap.attributes("data-gap")).toBe("late");
    expect(gap.text()).toBe("8 h");
    expect(rows()[1].find("[data-gap]").exists()).toBe(false);

    const next = page
      .get('[data-testid="sync-log-pages"]')
      .findAll("button")
      .find((button) => button.text() === "2");
    await next?.trigger("click");
    await vi.waitFor(() => expect(rows()).toHaveLength(20));
    expect(rows()[0].text()).toContain("autosnap_020");
  });

  it("joins the snapshot ladder by guid", async () => {
    const page = await mountPage();
    const tab = page
      .findAll('[role="tab"]')
      .find((element) => element.text().startsWith("Snapshots"));
    await tab?.trigger("mousedown", { button: 0 });
    await flushPromises();

    const rows = page.findAll('[data-testid="snapshot-ladder"] tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].find('[data-testid="ladder-shared"]').exists()).toBe(true);
    expect(rows[1].find('[data-testid="ladder-shared"]').exists()).toBe(false);
    expect(rows[1].text()).toContain("—");
  });

  it("sets and clears an interval override", async () => {
    const page = await mountPage();
    const form = page.get('[data-testid="interval-form"]');

    await form.get("input").setValue("24");
    await form.trigger("submit");
    await flushPromises();
    expect(patches).toEqual([{ manualIntervalSec: 86_400 }]);

    await vi.waitFor(() =>
      expect(page.get('[data-testid="cadence-panel"]').text()).toContain(
        "set by hand",
      ),
    );
    await page.get('[data-testid="interval-clear"]').trigger("click");
    await flushPromises();
    expect(patches.at(-1)).toEqual({ manualIntervalSec: null });
  });

  it("sets the source by hand and hands it back to discovery", async () => {
    const page = await mountPage();
    await page.get('[data-testid="source-choose"]').trigger("click");

    const picker = page
      .get('[data-testid="source-panel"]')
      .findComponent({ name: "USelectMenu" });
    picker.vm.$emit("update:modelValue", 44);
    await flushPromises();
    await page.get('[data-testid="source-form"]').trigger("submit");
    await flushPromises();
    expect(patches).toEqual([{ sourceDatasetId: 44 }]);

    await vi.waitFor(() =>
      expect(page.get('[data-testid="direction"]').text()).toBe(
        "Source set by hand",
      ),
    );
    await page.get('[data-testid="source-rediscover"]').trigger("click");
    await flushPromises();
    expect(patches.at(-1)).toEqual({ sourceDatasetId: null });
  });

  it("archives with a note and shows the banner", async () => {
    const page = await mountSuspended(ReplicationPage, {
      route: "/replications/3",
      attachTo: document.body,
    });
    const modal = page.findComponent({ name: "ReplicationArchiveModal" });
    modal.vm.$emit("update:open", true);
    await flushPromises();

    const textarea = document.querySelector<HTMLTextAreaElement>(
      "#replication-archive-form textarea",
    );
    if (!textarea) throw new Error("note field missing");
    textarea.value = " moved to cold storage ";
    textarea.dispatchEvent(new Event("input"));
    document
      .querySelector<HTMLFormElement>("#replication-archive-form")
      ?.requestSubmit();
    await flushPromises();

    expect(patches).toEqual([
      { archived: true, archivedNote: "moved to cold storage" },
    ]);
    await vi.waitFor(() =>
      expect(
        page.get('[data-testid="replication-archived-banner"]').text(),
      ).toContain("moved to cold storage"),
    );
    page.unmount();
  });

  it("raises a 404 for an unknown replication", async () => {
    await expect(
      mountSuspended(ReplicationPage, { route: "/replications/404" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
