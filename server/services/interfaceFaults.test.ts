import { beforeEach, describe, expect, it } from "vitest";
import { listDisks } from "~~/server/services/disks";
import { recordIngest } from "~~/server/services/ingest";
import { detectInterfaceErrors } from "~~/server/services/interfaceFaults";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const SDA = readFixture("mars/smartctl/xall-sda-auto.json");

const daysAfter = (days: number) => new Date(t0.getTime() + days * DAY_MS);

function withAttributes(raws: Record<number, number | null>) {
  const json = JSON.parse(SDA);
  json.ata_smart_attributes.table = json.ata_smart_attributes.table.flatMap(
    (row: { id: number; raw: unknown }) => {
      if (!(row.id in raws)) return [row];
      const raw = raws[row.id];
      return raw === null
        ? []
        : [{ ...row, raw: { value: raw, string: String(raw) } }];
    },
  );
  return JSON.stringify(json);
}

function ingestCrc(raw: number | null, days: number) {
  const outcome = recordIngest({
    hostName: "host-a",
    source: "smartctl-xall",
    meta: { device: "/dev/sda", type: "sat", exitStatus: 0 },
    body: withAttributes({ 199: raw }),
    receivedAt: daysAfter(days),
  });
  expect(outcome.ok).toBe(true);
}

async function detectAt(days: number) {
  const now = daysAfter(days);
  return detectInterfaceErrors({ disks: await listDisks(now), now });
}

beforeEach(() => {
  flushDb();
});

describe("detectInterfaceErrors", () => {
  it("does not raise for two rises", async () => {
    ingestCrc(0, 0);
    ingestCrc(4, 1);
    ingestCrc(9, 2);
    expect(await detectAt(2)).toEqual([]);
  });

  it("raises once the count has risen across three readings", async () => {
    ingestCrc(0, 0);
    ingestCrc(4, 1);
    ingestCrc(4, 2);
    ingestCrc(9, 3);
    ingestCrc(12, 4);
    const [disk] = await listDisks(daysAfter(4));
    expect(await detectAt(4)).toEqual([
      {
        kind: "interface-errors",
        key: String(disk?.id),
        subjectId: disk?.id,
        severity: "warning",
        data: { count: 12, rise: 12, readings: 3 },
      },
    ]);
  });

  it("re-baselines after a counter reset", async () => {
    ingestCrc(0, 0);
    ingestCrc(5, 1);
    ingestCrc(10, 2);
    ingestCrc(2, 3);
    ingestCrc(3, 4);
    expect(await detectAt(4)).toEqual([]);
    ingestCrc(6, 5);
    expect(await detectAt(5)).toEqual([]);
    ingestCrc(8, 6);
    expect(await detectAt(6)).toMatchObject([
      { data: { count: 8, rise: 6, readings: 3 } },
    ]);
  });

  it("clears once the window passes without enough rises", async () => {
    ingestCrc(0, 0);
    ingestCrc(1, 1);
    ingestCrc(2, 2);
    ingestCrc(3, 3);
    expect(await detectAt(3)).toHaveLength(1);
    ingestCrc(3, 8);
    expect(await detectAt(9)).toEqual([]);
  });

  it("clears for a disk that stops reporting", async () => {
    ingestCrc(0, 0);
    ingestCrc(1, 1);
    ingestCrc(2, 2);
    ingestCrc(3, 3);
    expect(await detectAt(11)).toEqual([]);
  });

  it("skips disks out of service", async () => {
    ingestCrc(0, 0);
    ingestCrc(1, 1);
    ingestCrc(2, 2);
    ingestCrc(3, 3);
    const now = daysAfter(3);
    const disks = (await listDisks(now)).map((row) => ({
      ...row,
      state: "retired" as const,
    }));
    expect(detectInterfaceErrors({ disks, now })).toEqual([]);
  });

  it("ignores disks that do not report attribute 199", async () => {
    for (const days of [0, 1, 2, 3]) ingestCrc(null, days);
    expect(await detectAt(3)).toEqual([]);
  });
});
