import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { disk } from "~~/server/database/schema";
import { recordIngest } from "~~/server/services/ingest";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";
import { getDiskStatistics } from "./statistics";

const t0 = new Date("2026-09-01T10:00:00Z");

function ingest(fixture: string, device: string, type = "sat") {
  const body = readFixture(`mars/smartctl/${fixture}`);
  expect(
    recordIngest({
      hostName: "mars",
      source: "smartctl-xall",
      meta: { device, type, exitStatus: 0 },
      body,
      receivedAt: t0,
    }).ok,
  ).toBe(true);
  const serial = JSON.parse(body).serial_number as string;
  return (
    db
      .select({ id: disk.id })
      .from(disk)
      .where(eq(disk.serial, serial))
      .get() as {
      id: number;
    }
  ).id;
}

beforeEach(() => {
  flushDb();
});

describe("getDiskStatistics", () => {
  it("returns device statistics and FARM for a Seagate", () => {
    const id = ingest("xall-sdf-auto.json", "/dev/sdf");
    const statistics = getDiskStatistics(id);
    expect(statistics.device?.powerOnHours).toBe(statistics.smartPowerOnHours);
    expect(statistics.farm?.logVersion).toBe("4.19");
    expect(statistics.nvme).toBeNull();
    expect(statistics.logicalBlockSize).toBe(512);
  });

  it("builds NVMe figures from the latest attributes", () => {
    const id = ingest("xall-nvme0.json", "/dev/nvme0", "nvme");
    const statistics = getDiskStatistics(id);
    expect(statistics.device).toBeNull();
    expect(statistics.nvme).toMatchObject({
      dataUnitsWritten: expect.any(Number),
      hostReads: expect.any(Number),
      unsafeShutdowns: expect.any(Number),
      warningTemperatureMinutes: expect.any(Number),
    });
  });

  it("keeps device statistics off the disk list", async () => {
    const { listDisks } = await import("~~/server/services/disks");
    ingest("xall-sda-auto.json", "/dev/sda");
    expect((await listDisks())[0]).not.toHaveProperty("latestDeviceStatistics");
  });

  it("is not found for an unknown disk", () => {
    expect(() => getDiskStatistics(99999)).toThrow(/not found/);
  });
});
