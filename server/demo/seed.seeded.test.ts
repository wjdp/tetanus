import { count } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { FAULT_STATES, type FaultKind } from "#shared/faults";
import { isHostOffline } from "#shared/hostFreshness";
import { db } from "~~/server/database/client";
import { dataset, smartReading } from "~~/server/database/schema";
import { listNotifications } from "~~/server/services/alerts/dispatch";
import { listDiary } from "~~/server/services/diary";
import { type DiskSummary, listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { listHosts } from "~~/server/services/hosts";
import { latestAttributes } from "~~/server/services/smart";
import { listPools } from "~~/server/services/zfs/queries";
import { loadSeededDatabase, SEEDED_AT, seededReport } from "~~/test/seeded";
import { type SeedReport, tick } from "./seed";
import { DEMO_EPOCH, HOUR_MS } from "./timeline";
import { createWorld } from "./world";

// A full replay takes over a minute; the short one keeps every story instant.
const NOW = SEEDED_AT;
const { stories, timeline } = createWorld(DEMO_EPOCH);

let report: SeedReport;
let disks: DiskSummary[];

const diskByAlias = (alias: string) => {
  const found = disks.find((candidate) => candidate.alias === alias);
  if (!found) throw new Error(`No seeded disk ${alias}`);
  return found;
};
const attribute = (alias: string, attrId: string) =>
  latestAttributes(diskByAlias(alias).id).find(
    (candidate) => candidate.attrId === attrId,
  );
const poolNamed = (hostName: string, name: string) =>
  listPools().find(
    (candidate) => candidate.host.name === hostName && candidate.name === name,
  );
const allFaults = () => listFaults({ state: [...FAULT_STATES] });
const faultOf = (kind: FaultKind, label: string, attrId?: string) => {
  const found = allFaults().faults.filter(
    (candidate) =>
      candidate.kind === kind &&
      candidate.subject.label === label &&
      (attrId === undefined || candidate.data.attrId === attrId),
  );
  if (found.length !== 1) {
    throw new Error(`${found.length} ${kind} faults on ${label}`);
  }
  return found[0];
};
const readingCount = () =>
  db.select({ n: count() }).from(smartReading).get()?.n ?? 0;

beforeAll(async () => {
  await loadSeededDatabase();
  report = await seededReport();
  disks = await listDisks(NOW);
});

describe("seed", () => {
  it("ingests every payload without a parse or handler failure", () => {
    expect(report.failures).toEqual([]);
    expect(report.at).toEqual(new Date("2026-09-29T06:00:00Z"));
  });

  it("builds the fleet: four hosts, seven pools, present and inventory-only disks", () => {
    expect(listHosts().map((row) => [row.name, row.displayName])).toEqual([
      ["atlas", "Atlas"],
      ["styx", "Styx (offsite)"],
      ["pip", "Pip"],
      ["bench", "Test bench"],
    ]);
    expect(listPools()).toHaveLength(7);
    expect(disks).toHaveLength(31);
    const present = disks.filter((row) => row.state === "in-use");
    expect(present).toHaveLength(
      stories.disksPresent("atlas", NOW).length +
        stories.disksPresent("styx", NOW).length +
        stories.disksPresent("pip", NOW).length +
        stories.disksPresent("bench", NOW).length,
    );
    expect(
      disks
        .filter((row) => row.stateOverride !== null)
        .map((row) => [row.alias, row.stateOverride]),
    ).toEqual([
      ["V2", "dead"],
      ["W1", "sold"],
      ["W2", "retired"],
    ]);
  });

  it("names pip's disks by hand, since pip has no vdev_id.conf", () => {
    expect(
      disks.filter((row) => row.hostName === "pip").map((row) => row.alias),
    ).toEqual(["P1", "P2", "P3"]);
  });

  it("upserts datasets and snapshots once", () => {
    expect(db.select({ n: count() }).from(dataset).get()?.n).toBe(45);
    const snapshots = listPools().reduce(
      (total, row) => total + row.snapshotCount,
      0,
    );
    expect(snapshots).toBeGreaterThan(1000);
    expect(snapshots).toBeLessThan(2000);
  });

  it("A3: pending sectors accepted at 8", () => {
    expect(diskByAlias("A3").latestStatus).toBe("passed");
    expect(attribute("A3", "197")).toMatchObject({
      rawValue: 8,
      displayStatus: "accepted",
    });
  });

  it("A7: reallocated sectors failed, worsening, with diary events", () => {
    expect(diskByAlias("A7").latestStatus).toBe("failed");
    expect(attribute("A7", "5")).toMatchObject({
      displayStatus: "failed",
      trend: "worsening",
    });
    const events = listDiary({
      subjectType: "disk",
      subjectId: diskByAlias("A7").id,
    }).map((entry) => entry.eventType);
    expect(events).toContain("attribute-status-changed");
    expect(events).toContain("smart-status-changed");
    expect(events).toContain("fault-acknowledged");
    expect(events).toContain("acknowledgement-superseded");
  });

  it("A12: new pending sectors acknowledged, so a warning rather than failed", () => {
    expect(diskByAlias("A12").latestStatus).toBe("warning");
    expect(attribute("A12", "197")).toMatchObject({
      rawValue: 2,
      status: "failed",
      displayStatus: "acknowledged",
    });
  });

  it("V2 is dead and V6 took its slot in vault", () => {
    expect(diskByAlias("V2")).toMatchObject({ state: "dead" });
    expect(diskByAlias("V6")).toMatchObject({
      state: "in-use",
      membership: { poolName: "vault" },
    });
  });

  it("V5, the pulled hot spare, is missing", () => {
    expect(diskByAlias("V5").state).toBe("missing");
  });

  it("P1 is at 87 % of its rated endurance", () => {
    expect(attribute("P1", "percentage_used")?.transformedValue).toBe(87);
  });

  it("tank is mid-scrub and vault's last scrub found nothing", () => {
    expect(poolNamed("atlas", "tank")?.scan).toMatchObject({
      function: "SCRUB",
      state: "SCANNING",
    });
    expect(poolNamed("styx", "vault")?.scan).toMatchObject({
      function: "SCRUB",
      state: "FINISHED",
      errors: 0,
    });
  });

  it("archives atlas's tfault test pool, hidden by default and raising nothing", () => {
    const [seedPool] = stories.seeds.archivedPools;
    expect(poolNamed("atlas", "tfault")).toBeUndefined();
    const archived = listPools("only");
    expect(archived).toMatchObject([
      {
        name: "tfault",
        host: { name: "atlas" },
        archivedAt: seedPool?.archivedAt,
        archiveNote: seedPool?.note,
        vdevs: {
          children: [
            { type: "mirror", children: [{ type: "file" }, { type: "file" }] },
          ],
        },
      },
    ]);
    expect(
      allFaults().faults.filter(
        (candidate) => candidate.subject.label === "tfault",
      ),
    ).toEqual([]);
  });

  it("inserts the story alerts exactly as the rules would have", () => {
    const notifications = listNotifications();
    expect(notifications.map((row) => row.rule).sort()).toEqual([
      "attribute-failed",
      "disk-failed",
      "disk-missing",
      "pool-degraded",
      "pool-recovered",
    ]);
    for (const row of notifications) {
      const story = stories.seeds.notifications.find(
        (candidate) => candidate.rule === row.rule,
      );
      expect(row).toMatchObject({ channel: "pushover", ok: true });
      expect(row.message).toBe(`${row.subject}: ${story?.detail}`);
      expect(row.dedupeKey.endsWith(`:${row.diaryEntryId}`)).toBe(true);
    }
  });

  it("holds the switched-off bench's disks in use, with no missing entry", () => {
    const bench = listHosts().find((row) => row.name === "bench");
    expect(bench?.intermittent).toBe(true);
    expect(bench?.healthchecksUrl).toBeNull();
    expect(bench && isHostOffline(bench, report.at.getTime())).toBe(true);
    const benchDisks = disks.filter((row) => row.hostName === "bench");
    expect(benchDisks.map((row) => [row.alias, row.state])).toEqual([
      ["B1", "in-use"],
      ["B2", "in-use"],
    ]);
    for (const row of benchDisks) {
      const wentMissing = listDiary({ subjectType: "disk", subjectId: row.id })
        .filter((entry) => entry.eventType === "state-changed")
        .filter((entry) => entry.title.startsWith("missing"));
      expect(wentMissing).toEqual([]);
    }
  });

  describe("faults", () => {
    it("counts six live, one accepted and eleven resolved", () => {
      const { counts } = allFaults();
      expect(counts).toEqual({
        open: 3,
        acknowledged: 3,
        accepted: 1,
        resolved: 11,
      });
      const zfsKinds = allFaults()
        .faults.filter((row) => row.category === "zfs")
        .map((row) => [row.kind, row.subject.label, row.state]);
      expect(zfsKinds).toEqual(
        expect.arrayContaining([
          ["leaf-errors", "tank", "acknowledged"],
          ["scrub-overdue", "scratch", "open"],
          ["leaf-errors", "vault", "resolved"],
          ["scrub-overdue", "vault", "resolved"],
        ]),
      );
      expect(
        allFaults().faults.filter((row) => row.kind === "collector-silent"),
      ).toEqual([]);
    });

    it("A7's acknowledgement was superseded, so its fault is open again", () => {
      expect(faultOf("smart-attribute", "A7", "5")).toMatchObject({
        state: "open",
        severity: "error",
      });
    });

    it("A12 is acknowledged and A3 accepted", () => {
      expect(faultOf("smart-attribute", "A12", "197")).toMatchObject({
        state: "acknowledged",
        note: "Long self-test queued; watching it.",
      });
      expect(faultOf("smart-attribute", "A3", "197")).toMatchObject({
        state: "accepted",
      });
    });

    it("V5 went missing, then was acknowledged with a note", () => {
      const [acknowledgement] = stories.seeds.faultActions;
      const missing = faultOf("disk-missing", "V5");
      expect(missing).toMatchObject({
        state: "acknowledged",
        note: "Pulled for RMA",
        resolvedAt: null,
        stateChangedAt: acknowledgement?.at.toISOString(),
      });
      expect(Date.parse(missing.openedAt)).toBeGreaterThan(
        timeline.v5PulledAt.getTime(),
      );
      const events = listDiary({
        subjectType: "disk",
        subjectId: diskByAlias("V5").id,
      }).map((entry) => entry.eventType);
      expect(events).toContain("fault-opened");
      expect(events).toContain("fault-state-changed");
    });

    it("V2 failed SMART health, then left service dead", () => {
      const failed = faultOf("smart-health-failed", "V2");
      expect(failed).toMatchObject({
        state: "resolved",
        openedAt: timeline.v2SmartFailedAt.toISOString(),
      });
      expect(Date.parse(failed.resolvedAt ?? "")).toBeGreaterThanOrEqual(
        timeline.v2DeclaredDeadAt.getTime(),
      );
    });

    it("vault was degraded until the resilver finished, listing V2", () => {
      const degraded = faultOf("pool-degraded", "vault");
      expect(degraded).toMatchObject({
        state: "resolved",
        openedAt: timeline.v2FaultedAt.toISOString(),
        resolvedAt: timeline.vaultResilverEnd.toISOString(),
      });
      expect(degraded.data.leaves).toEqual([
        expect.objectContaining({
          state: "FAULTED",
          diskId: diskByAlias("V2").id,
        }),
      ]);
    });

    it("A7's checksum errors in tank are acknowledged at their level", () => {
      const leafErrors = allFaults().faults.find(
        (row) =>
          row.kind === "leaf-errors" &&
          row.subject.label === "tank" &&
          row.state !== "resolved",
      );
      expect(leafErrors).toMatchObject({
        state: "acknowledged",
        note: expect.stringContaining("A7"),
        data: { diskId: diskByAlias("A7").id },
      });
      expect(leafErrors?.data.acknowledgedCounts).toEqual(
        leafErrors?.data.total,
      );
    });

    it("scratch has never been scrubbed, so its scrub is overdue", () => {
      expect(faultOf("scrub-overdue", "scratch")).toMatchObject({
        state: "open",
        severity: "warning",
        data: { lastScrubAt: null, intervalDays: 35 },
      });
    });

    it("bench runs an outdated collector", () => {
      expect(
        listHosts().find((row) => row.name === "bench")?.collectorStatus,
      ).toBe("outdated");
      expect(faultOf("collector-outdated", "bench")).toMatchObject({
        state: "open",
        severity: "warning",
        data: { version: "0.3.0" },
      });
    });
  });

  it("tick adds one reading per present disk an hour later, once", async () => {
    const before = readingCount();
    const later = new Date(NOW.getTime() + HOUR_MS);
    const first = await tick(later);
    expect(first.failures).toEqual([]);
    expect(first.skipped).toEqual([]);
    expect(readingCount() - before).toBe(
      disks.filter((row) => row.state === "in-use" && row.hostName !== "bench")
        .length,
    );
    const again = await tick(new Date(later.getTime() + 10 * 60_000));
    expect(again.skipped).toEqual(["atlas", "styx", "pip"]);
    expect(readingCount() - before).toBe(first.ingests.count["smartctl-xall"]);
  });
});
