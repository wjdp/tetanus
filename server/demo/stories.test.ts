import { describe, expect, it } from "vitest";
import { addMs, DAY_MS, DEMO_EPOCH, HOUR_MS, resetAnchor } from "./timeline";
import { createWorld } from "./world";

const { timeline, stories } = createWorld();
const MINUTE = 60_000;
const justBefore = (date: Date) => addMs(date, -MINUTE);
const justAfter = (date: Date) => addMs(date, MINUTE);
const aliasesPresent = (host: "atlas" | "styx" | "pip", t: Date) =>
  stories.disksPresent(host, t).map((disk) => disk.alias);

describe("resetAnchor", () => {
  it("floors to the most recent 04:15 UTC", () => {
    expect(resetAnchor(new Date("2026-09-29T04:15:00Z"))).toEqual(DEMO_EPOCH);
    expect(resetAnchor(new Date("2026-09-29T23:59:00Z"))).toEqual(DEMO_EPOCH);
    expect(resetAnchor(new Date("2026-09-30T04:14:00Z"))).toEqual(DEMO_EPOCH);
  });

  it("shifts every story by the anchor", () => {
    const later = createWorld(addMs(DEMO_EPOCH, 10 * DAY_MS)).timeline;
    expect(later.v5PulledAt.getTime() - timeline.v5PulledAt.getTime()).toBe(
      10 * DAY_MS,
    );
  });
});

describe("presence", () => {
  it("drops V2 when pulled and adds V6 when inserted", () => {
    expect(aliasesPresent("styx", justBefore(timeline.v2PulledAt))).toContain(
      "V2",
    );
    expect(
      aliasesPresent("styx", justAfter(timeline.v2PulledAt)),
    ).not.toContain("V2");
    expect(
      aliasesPresent("styx", justBefore(timeline.v6InsertedAt)),
    ).not.toContain("V6");
    expect(aliasesPresent("styx", justAfter(timeline.v6InsertedAt))).toContain(
      "V6",
    );
  });

  it("drops V5 a week before the anchor", () => {
    expect(
      timeline.anchor.getTime() - timeline.v5PulledAt.getTime(),
    ).toBeGreaterThan(6 * DAY_MS);
    expect(aliasesPresent("styx", justBefore(timeline.v5PulledAt))).toContain(
      "V5",
    );
    expect(
      aliasesPresent("styx", justAfter(timeline.v5PulledAt)),
    ).not.toContain("V5");
  });

  it("has the configured disks attached at the anchor", () => {
    expect(aliasesPresent("atlas", DEMO_EPOCH)).toHaveLength(17);
    expect(aliasesPresent("styx", DEMO_EPOCH).sort()).toEqual([
      "V1",
      "V3",
      "V4",
      "V6",
      "V7",
    ]);
    expect(aliasesPresent("pip", DEMO_EPOCH)).toEqual(["P1", "P2", "P3"]);
  });

  it("shows the shucked disks only before their replacement", () => {
    expect(aliasesPresent("atlas", new Date("2023-01-01T00:00:00Z"))).toContain(
      "W1",
    );
    expect(aliasesPresent("atlas", DEMO_EPOCH)).not.toContain("W1");
  });
});

describe("vault replacement", () => {
  const vault = stories.pool("styx", "vault");
  const leaf = (alias: string, t: Date) =>
    stories
      .leavesAt(vault, t)
      .find((candidate) => candidate.disk.alias === alias);

  it("faults V2 and degrades vault", () => {
    expect(leaf("V2", justBefore(timeline.v2FaultedAt))?.state).toBe("ONLINE");
    expect(stories.poolState(vault, justBefore(timeline.v2FaultedAt))).toBe(
      "ONLINE",
    );
    expect(leaf("V2", justAfter(timeline.v2FaultedAt))?.state).toBe("FAULTED");
    expect(stories.poolState(vault, justAfter(timeline.v2FaultedAt))).toBe(
      "DEGRADED",
    );
  });

  it("resilvers V6 in place of V2 and recovers", () => {
    const during = justAfter(timeline.v2ReplaceAt);
    expect(leaf("V2", during)).toMatchObject({
      replacing: true,
      resilvering: false,
    });
    expect(leaf("V6", during)).toMatchObject({
      replacing: true,
      resilvering: true,
    });
    expect(stories.scanState(vault, during)).toMatchObject({
      function: "RESILVER",
      state: "SCANNING",
    });
    const done = justAfter(timeline.vaultResilverEnd);
    expect(leaf("V2", done)).toBeUndefined();
    expect(leaf("V6", done)).toMatchObject({
      state: "ONLINE",
      replacing: false,
    });
    expect(stories.poolState(vault, done)).toBe("ONLINE");
  });

  it("keeps the pulled spare listed as UNAVAIL without degrading vault", () => {
    expect(leaf("V5", justBefore(timeline.v5PulledAt))?.spareStatus).toBe(
      "AVAIL",
    );
    expect(leaf("V5", DEMO_EPOCH)).toMatchObject({
      state: "UNAVAIL",
      spareStatus: "UNAVAIL",
    });
    expect(stories.poolState(vault, DEMO_EPOCH)).toBe("ONLINE");
  });

  it("fails V2's SMART health before ZFS faults it", () => {
    const v2 = stories.disk("V2");
    expect(stories.healthPassed(v2, justBefore(timeline.v2SmartFailedAt))).toBe(
      true,
    );
    expect(stories.healthPassed(v2, justAfter(timeline.v2SmartFailedAt))).toBe(
      false,
    );
    expect(timeline.v2SmartFailedAt < timeline.v2FaultedAt).toBe(true);
  });
});

describe("SMART stories", () => {
  it("climbs A7 reallocations from 0 to 24 over the last 30 days", () => {
    const a7 = stories.disk("A7");
    expect(
      stories.reallocatedSectors(a7, justBefore(timeline.a7ClimbFrom)),
    ).toBe(0);
    expect(stories.reallocatedSectors(a7, DEMO_EPOCH)).toBe(24);
    let previous = 0;
    for (let day = -40; day <= 30; day++) {
      const value = stories.reallocatedSectors(
        a7,
        addMs(DEMO_EPOCH, day * DAY_MS),
      );
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBeGreaterThan(24);
  });

  it("holds A3 at 8 pending sectors from six months ago", () => {
    const a3 = stories.disk("A3");
    expect(stories.pendingSectors(a3, justBefore(timeline.a3PendingFrom))).toBe(
      0,
    );
    expect(stories.pendingSectors(a3, justAfter(timeline.a3PendingFrom))).toBe(
      8,
    );
    expect(stories.pendingSectors(a3, DEMO_EPOCH)).toBe(8);
    expect(timeline.a3AcceptedAt > timeline.a3PendingFrom).toBe(true);
  });

  it("has P1 at 87 % used and rising, P2 far lower", () => {
    const p1 = stories.disk("P1");
    expect(stories.percentageUsed(p1, DEMO_EPOCH)).toBe(87);
    expect(
      stories.percentageUsed(p1, addMs(DEMO_EPOCH, 30 * DAY_MS)),
    ).toBeGreaterThan(87);
    expect(stories.percentageUsed(stories.disk("P2"), DEMO_EPOCH)).toBeLessThan(
      20,
    );
  });

  it("counts power-on hours from install and stops when pulled", () => {
    const v5 = stories.disk("V5");
    const atPull = stories.powerOnHours(v5, timeline.v5PulledAt);
    expect(stories.powerOnHours(v5, DEMO_EPOCH)).toBe(atPull);
    const a1 = stories.disk("A1");
    expect(
      stories.powerOnHours(a1, addMs(DEMO_EPOCH, HOUR_MS)) -
        stories.powerOnHours(a1, DEMO_EPOCH),
    ).toBe(1);
    expect(stories.powerCycles(a1, DEMO_EPOCH)).toBeGreaterThan(10);
  });

  it("keeps temperatures plausible and stable within an hour", () => {
    for (const disk of stories.disksPresent("atlas", DEMO_EPOCH)) {
      const temperature = stories.temperature(disk, DEMO_EPOCH);
      expect(temperature).toBeGreaterThan(20);
      expect(temperature).toBeLessThan(60);
      expect(stories.temperature(disk, addMs(DEMO_EPOCH, 10 * MINUTE))).toBe(
        temperature,
      );
    }
  });
});

describe("scrubs", () => {
  it("has tank about 40 % through a scrub at the reset", () => {
    const tank = stories.pool("atlas", "tank");
    const scan = stories.scanState(tank, DEMO_EPOCH);
    expect(scan).toMatchObject({
      function: "SCRUB",
      state: "SCANNING",
      errors: 0,
    });
    const fraction = (scan?.examined ?? 0) / (scan?.toExamine ?? 1);
    expect(fraction).toBeCloseTo(0.4, 2);
    expect(
      stories.scanState(tank, justAfter(timeline.tankScrubEnd))?.state,
    ).toBe("FINISHED");
  });

  it("has vault's scrub finished last Sunday with no errors", () => {
    const vault = stories.pool("styx", "vault");
    const scan = stories.scanState(vault, DEMO_EPOCH);
    expect(scan).toMatchObject({
      function: "SCRUB",
      state: "FINISHED",
      errors: 0,
    });
    expect(scan?.startTime.getUTCDay()).toBe(0);
    expect(scan?.startTime).toEqual(timeline.vaultScrubStart);
  });
});

describe("ZFS instants", () => {
  it("are sorted and include every story instant", () => {
    const instants = stories.zfsInstants.map((at) => at.getTime());
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
    for (const at of [
      timeline.v2FaultedAt,
      timeline.v2ReplaceAt,
      timeline.vaultResilverEnd,
      timeline.v5PulledAt,
      timeline.tankScrubStart,
      timeline.v6InsertedAt,
    ]) {
      expect(instants).toContain(at.getTime());
    }
  });

  it("records A7's checksum ereports in zpool events", () => {
    const events = stories.zpoolEvents("atlas", DEMO_EPOCH);
    expect(
      events.some(
        (event) =>
          event.class === "ereport.fs.zfs.checksum" && event.vdevAlias === "A7",
      ),
    ).toBe(true);
  });

  it("keeps vault's fault, resilver and spare removal in zpool events", () => {
    const classes = stories
      .zpoolEvents("styx", DEMO_EPOCH)
      .map((event) => `${event.class}:${event.vdevAlias ?? ""}`);
    expect(classes).toEqual(
      expect.arrayContaining([
        "resource.fs.zfs.statechange:V2",
        "sysevent.fs.zfs.vdev_attach:V6",
        "sysevent.fs.zfs.resilver_finish:",
        "resource.fs.zfs.removed:V5",
        "sysevent.fs.zfs.scrub_finish:",
      ]),
    );
  });

  it("includes the vault replace in zpool history", () => {
    expect(
      stories.poolHistory("styx", DEMO_EPOCH).map((event) => event.command),
    ).toContain("zpool replace vault V2 V6");
  });
});

describe("seeds", () => {
  it("backdates everything to before the anchor", () => {
    const {
      manualDiary,
      acceptances,
      faultActions,
      overrides,
      notifications,
      archivedPools,
    } = stories.seeds;
    for (const seed of [
      ...manualDiary,
      ...acceptances,
      ...faultActions,
      ...overrides,
      ...notifications,
    ]) {
      expect(seed.at < DEMO_EPOCH, JSON.stringify(seed)).toBe(true);
    }
    for (const seed of archivedPools) {
      expect(seed.lastSeenAt < seed.archivedAt).toBe(true);
      expect(seed.archivedAt < DEMO_EPOCH, JSON.stringify(seed)).toBe(true);
    }
  });
});
