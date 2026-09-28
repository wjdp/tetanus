import { beforeEach, describe, expect, it } from "vitest";
import {
  addAutoEvent,
  addManualEntry,
  latestAutoEvent,
  listDiary,
} from "~~/server/services/diary";
import { flushDb } from "~~/test/db";

const earlier = new Date("2026-09-01T10:00:00Z");
const later = new Date("2026-09-02T10:00:00Z");

describe("diary", () => {
  beforeEach(() => {
    flushDb();
  });

  it("records auto events with their type and data", () => {
    const entry = addAutoEvent({
      subjectType: "disk",
      subjectId: 3,
      eventType: "moved-host",
      title: "moved from mars to venus",
      data: { fromHostId: 1 },
      at: earlier,
    });
    expect(entry).toMatchObject({
      kind: "auto",
      eventType: "moved-host",
      body: "",
      data: { fromHostId: 1 },
      at: earlier,
    });
  });

  it("records manual entries without an event type", () => {
    const entry = addManualEntry({
      subjectType: "system",
      title: "Bought a new HBA",
      body: "LSI 9300",
    });
    expect(entry).toMatchObject({
      kind: "manual",
      eventType: null,
      subjectId: null,
      title: "Bought a new HBA",
      body: "LSI 9300",
    });
  });

  it("lists newest first, filtered by subject, up to the limit", () => {
    addManualEntry({
      subjectType: "disk",
      subjectId: 1,
      title: "a",
      at: earlier,
    });
    addManualEntry({
      subjectType: "disk",
      subjectId: 1,
      title: "b",
      at: later,
    });
    addManualEntry({
      subjectType: "disk",
      subjectId: 2,
      title: "c",
      at: later,
    });
    addManualEntry({
      subjectType: "pool",
      subjectId: 1,
      title: "d",
      at: later,
    });

    expect(
      listDiary({ subjectType: "disk", subjectId: 1 }).map((row) => row.title),
    ).toEqual(["b", "a"]);
    expect(listDiary({ subjectType: "disk" }).map((row) => row.title)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(listDiary({ limit: 1 })).toHaveLength(1);
  });

  it("finds the latest auto event of a type for a subject", () => {
    for (const [alias, at] of [
      ["K1", earlier],
      ["K2", later],
    ] as const) {
      addAutoEvent({
        subjectType: "disk",
        subjectId: 1,
        eventType: "alias-drift",
        title: alias,
        data: { alias },
        at,
      });
    }
    expect(latestAutoEvent("disk", 1, "alias-drift")?.data).toEqual({
      alias: "K2",
    });
    expect(latestAutoEvent("disk", 2, "alias-drift")).toBeUndefined();
  });
});
