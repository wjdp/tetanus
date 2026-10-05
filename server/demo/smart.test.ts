import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { collectorRun, diaryEntry } from "~~/server/database/schema";
import type { LsblkResult } from "~~/server/ingest/lsblk";
import { PARSERS } from "~~/server/ingest/registry";
import type { SmartctlScanResult } from "~~/server/ingest/smartctl-scan";
import type { SmartctlXallResult } from "~~/server/ingest/smartctl-xall";
import type { UdevResult } from "~~/server/ingest/udev";
import type { VdevIdConfResult } from "~~/server/ingest/vdev-id-conf";
import { type DiskSummary, listDisks } from "~~/server/services/disks";
import { recordIngest } from "~~/server/services/ingest";
import { getSmartHistory, latestAttributes } from "~~/server/services/smart";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";
import { byIdNames, vdevIdTarget } from "./fleet";
import { renderSmart } from "./smart";
import { smartTemplate } from "./smartTemplates";
import { addMs, DAY_MS, HOUR_MS } from "./timeline";
import {
  type DiskModel,
  type HostModel,
  type HostPayload,
  SMART_TEMPLATES,
  type SmartTemplate,
} from "./types";
import { createWorld } from "./world";

const world = createWorld();
const { timeline, stories, fleet } = world;
const { anchor } = timeline;
const INSTANTS = {
  anchor,
  "anchor - 40 d": addMs(anchor, -40 * DAY_MS),
  "anchor - 400 d": addMs(anchor, -400 * DAY_MS),
};

const hostNamed = (name: HostModel["name"]) =>
  fleet.hosts.find((host) => host.name === name) as HostModel;
const disk = (alias: string) => stories.disk(alias);

function parsed<T>(payload: HostPayload): T {
  return PARSERS[payload.source](payload.body, payload.meta).data as T;
}

function xall(alias: string, t: Date): SmartctlXallResult | undefined {
  const target = disk(alias);
  const payload = renderSmart(world, hostNamed(target.host), t).find(
    (candidate) =>
      candidate.source === "smartctl-xall" &&
      parsed<SmartctlXallResult>(candidate).identity.serial === target.serial,
  );
  return payload && parsed<SmartctlXallResult>(payload);
}

const rawOf = (result: SmartctlXallResult | undefined, id: number) =>
  result?.ata?.attributes.find((attribute) => attribute.id === id)?.raw.value;

describe("templates", () => {
  it.each(Object.entries(SMART_TEMPLATES) as [SmartTemplate, string][])(
    "bundles %s from %s",
    (name, path) => {
      expect(smartTemplate(name)).toEqual(
        JSON.parse(readFixture(path.replace(/^test\/fixtures\//, ""))),
      );
    },
  );
});

describe.each(fleet.hosts.map((host) => [host.name, host] as const))(
  "renderSmart for %s",
  (_name, host) => {
    it.each(Object.entries(INSTANTS))("parses every payload at %s", (_, t) => {
      const payloads = renderSmart(world, host, t);
      const present = stories.disksPresent(host.name, t);
      for (const payload of payloads) {
        expect(() =>
          PARSERS[payload.source](payload.body, payload.meta),
        ).not.toThrow();
      }
      const bySource = (source: HostPayload["source"]) =>
        payloads.filter((payload) => payload.source === source);

      const [lsblk] = bySource("lsblk").map((payload) =>
        parsed<LsblkResult>(payload),
      );
      expect(lsblk?.disks.map((row) => row.serial).sort()).toEqual(
        present.map((target) => target.serial).sort(),
      );
      const [scan] = bySource("smartctl-scan").map((payload) =>
        parsed<SmartctlScanResult>(payload),
      );
      expect(scan?.devices).toHaveLength(present.length);
      expect(bySource("udev")).toHaveLength(present.length);
      expect(bySource("vdev-id-conf")).toHaveLength(host.vdevIdConf ? 1 : 0);

      const xalls = bySource("smartctl-xall");
      expect(xalls).toHaveLength(present.length);
      for (const payload of xalls) {
        const result = parsed<SmartctlXallResult>(payload);
        const target = present.find(
          (candidate) => candidate.serial === result.identity.serial,
        ) as DiskModel;
        const counters = stories.smartCounters(target, t);
        expect(result.identity).toMatchObject({
          model: target.model,
          firmware: target.firmware,
          capacityBytes: target.capacityBytes,
        });
        expect(result.device.name).toBe(target.smartctlDevice);
        expect(result.smartStatus?.passed).toBe(counters.healthPassed);
        expect(result.powerOnHours).toBe(counters.powerOnHours);
        expect(result.temperature).toBe(counters.temperatureC);
        expect(result.smartctl.exitStatus.diskFailing).toBe(
          !counters.healthPassed,
        );
        if (target.protocol === "nvme") {
          expect(payload.meta.type).toBe("nvme");
          expect(result.nvme).toMatchObject({
            powerOnHours: counters.powerOnHours,
            powerCycles: counters.powerCycles,
            percentageUsed: counters.percentageUsed,
          });
        } else {
          expect(result.identity.wwn).toBe(target.wwn);
          expect(rawOf(result, 5)).toBe(counters.reallocatedSectors);
          expect(rawOf(result, 9)).toBe(counters.powerOnHours);
          expect(rawOf(result, 12)).toBe(counters.powerCycles);
          const newestTest = result.selfTests?.[0];
          expect(newestTest?.lifetimeHours).toBeLessThanOrEqual(
            counters.powerOnHours,
          );
          expect(result.sctTemperatureHistory?.values.at(-1)).toBe(
            counters.temperatureC,
          );
        }
      }
    });

    it("is deterministic", () => {
      expect(renderSmart(world, host, anchor)).toEqual(
        renderSmart(world, host, anchor),
      );
    });
  },
);

describe("identity keys line up across sources", () => {
  it("names every present disk in udev by-id links and vdev_id.conf targets", () => {
    const atlas = hostNamed("atlas");
    const payloads = renderSmart(world, atlas, anchor);
    const byId = payloads
      .filter((payload) => payload.source === "udev")
      .flatMap((payload) => parsed<UdevResult>(payload).byId);
    const [conf] = payloads
      .filter((payload) => payload.source === "vdev-id-conf")
      .map((payload) => parsed<VdevIdConfResult>(payload));
    for (const target of stories.disksPresent("atlas", anchor)) {
      expect(byId).toEqual(expect.arrayContaining(byIdNames(target)));
      expect(conf?.aliases).toContainEqual({
        alias: target.alias,
        target: vdevIdTarget(target),
      });
    }
  });
});

describe("stories at the anchor", () => {
  it("A3 has 8 pending sectors", () => {
    expect(rawOf(xall("A3", anchor), 197)).toBe(8);
  });

  it("A7 has 24 reallocated sectors and errors in its log", () => {
    const result = xall("A7", anchor);
    expect(rawOf(result, 5)).toBe(24);
    expect(result?.smartStatus?.passed).toBe(
      stories.healthPassed(disk("A7"), anchor),
    );
    expect(result?.smartctl.exitStatus.errorLogHasErrors).toBe(true);
  });

  it("Exos FARM logs agree with the rewritten SMART identity and hours", () => {
    const results = fleet.disks
      .filter((model) => model.template.startsWith("exos"))
      .flatMap((model) => xall(model.alias, anchor) ?? []);
    expect(results.length).toBeGreaterThan(2);
    for (const result of results) {
      expect(result.farm).toMatchObject({
        serial: result.identity.serial,
        wwn: result.identity.wwn,
        powerOnHours: result.powerOnHours,
        powerCycles: result.powerCycles,
      });
    }
  });

  it("P1 reads 87 % used", () => {
    expect(xall("P1", anchor)?.nvme?.percentageUsed).toBe(87);
  });

  it("V5 is not attached", () => {
    const payloads = renderSmart(world, hostNamed("styx"), anchor);
    expect(
      payloads.some((payload) => payload.body.includes(disk("V5").serial)),
    ).toBe(false);
  });

  it("V2 is gone at the anchor, present 40 days earlier and FAILED 34 days earlier", () => {
    expect(xall("V2", anchor)).toBeUndefined();
    expect(xall("V2", INSTANTS["anchor - 40 d"])?.smartStatus?.passed).toBe(
      true,
    );
    const failed = xall("V2", addMs(anchor, -34 * DAY_MS));
    expect(failed?.smartStatus?.passed).toBe(false);
    expect(failed?.smartctl.exitStatus).toMatchObject({
      diskFailing: true,
      prefailBelowThreshold: true,
      selfTestLogHasErrors: true,
    });
    expect(
      failed?.ata?.attributes.find((attribute) => attribute.id === 5)
        ?.whenFailed,
    ).toBe("now");
  });

  it("V6 is attached", () => {
    expect(xall("V6", anchor)).toBeDefined();
  });
});

async function ingestHost(host: HostModel, t: Date) {
  for (const payload of renderSmart(world, host, t)) {
    const outcome = recordIngest({
      hostName: host.name,
      source: payload.source,
      meta: payload.meta,
      body: payload.body,
      receivedAt: t,
    });
    expect(outcome.ok).toBe(true);
  }
}

describe.each(fleet.hosts.map((host) => [host.name, host] as const))(
  "ingesting %s through the real pipeline",
  (_name, host) => {
    const present = stories.disksPresent(host.name, anchor);
    let disks: DiskSummary[] = [];
    const rowOf = (target: DiskModel) =>
      disks.find((row) => row.serial === target.serial) as DiskSummary;

    beforeAll(async () => {
      flushDb();
      await ingestHost(host, addMs(anchor, -2 * HOUR_MS));
      await ingestHost(host, addMs(anchor, -HOUR_MS));
      await ingestHost(host, anchor);
      disks = await listDisks(anchor);
    });

    it("runs every handler without error", () => {
      expect(
        db
          .select()
          .from(collectorRun)
          .all()
          .filter((run) => run.error !== null),
      ).toEqual([]);
    });

    it("matches each disk seen through smartctl, lsblk and udev as one", () => {
      expect(disks).toHaveLength(present.length);
      expect(
        db
          .select()
          .from(diaryEntry)
          .where(eq(diaryEntry.eventType, "identity-conflict"))
          .all(),
      ).toEqual([]);
    });

    it.each(present.map((target) => [target.alias, target] as const))(
      "resolves %s (spare until the ZFS sources place it in a pool, unless mounted)",
      (_alias, target) => {
        const row = rowOf(target);
        expect(row).toMatchObject({
          model: target.model,
          serial: target.serial,
          protocol: target.protocol,
          media: target.rotational ? "hdd" : "ssd",
          interface: target.protocol === "nvme" ? "nvme" : "sata",
          link: target.transport,
          capacityBytes: target.capacityBytes,
          state:
            target.membership && row.usage.mounts.length === 0
              ? "spare"
              : "in-use",
        });
        if (host.vdevIdConf) expect(row.alias).toBe(target.alias);
        if (target.protocol === "ata") {
          expect(row.formFactor).toBe(target.formFactor);
          expect(row.rotationRate).toBe(target.rpm ?? 0);
        }
        const counters = stories.smartCounters(target, anchor);
        expect(row.latestPowerOnHours).toBe(counters.powerOnHours);
        expect(row.latestTemp).toBe(counters.temperatureC);
      },
    );

    if (host.name === "atlas") {
      it("keeps A3's pending sectors and A7's reallocations in the history", () => {
        const a3 = rowOf(disk("A3"));
        const a7 = rowOf(disk("A7"));
        expect(
          latestAttributes(a3.id).find(
            (attribute) => attribute.attrId === "197",
          )?.rawValue,
        ).toBe(8);
        expect(
          getSmartHistory(a7.id, "7d", anchor).attributes["5"]?.at(-1)?.value,
        ).toBe(24);
        expect(
          getSmartHistory(a7.id, "7d", anchor).temperature.length,
        ).toBeGreaterThan(3);
      });
    }

    if (host.name === "pip") {
      it("keeps P1's endurance", () => {
        expect(
          latestAttributes(rowOf(disk("P1")).id).find(
            (attribute) => attribute.attrId === "percentage_used",
          )?.rawValue ??
            latestAttributes(rowOf(disk("P1")).id).find(
              (attribute) => attribute.attrId === "percentage_used",
            )?.value,
        ).toBe(87);
      });
    }
  },
);
