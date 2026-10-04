import { describe, expect, it } from "vitest";
import { DIARY_SUBJECT_TYPES } from "#shared/diary";
import {
  DIARY_SUBJECT_ICON,
  datasetSubjectItems,
  diskSubjectItems,
  hostSubjectItems,
  poolSubjectItems,
  vdevSubjectItems,
} from "./diarySubjects";

const leaf = (id: number, name: string) => ({
  id,
  name,
  type: "disk",
  children: [],
});

const tank = {
  id: 3,
  name: "tank",
  host: { name: "mars" },
  vdevs: {
    id: 10,
    name: "tank",
    type: "root",
    children: [
      {
        id: 11,
        name: "mirror-0",
        type: "mirror",
        children: [leaf(12, "K1"), leaf(13, "K2")],
      },
    ],
  },
};

describe("diary subject items", () => {
  it("labels disks by alias, model and serial, skipping blanks", () => {
    expect(
      diskSubjectItems([
        { id: 1, alias: "K1", model: "WDC WD80", serial: "ABC" },
        { id: 2, alias: null, model: "ST4000", serial: "XYZ" },
        { id: 3, alias: null, model: null, serial: null },
      ]),
    ).toEqual([
      { label: "K1 · WDC WD80 · ABC", value: 1 },
      { label: "ST4000 · XYZ", value: 2 },
      { label: "Unidentified disk", value: 3 },
    ]);
  });

  it("labels pools by host and name", () => {
    expect(poolSubjectItems([tank])).toEqual([
      { label: "mars · tank", value: 3 },
    ]);
  });

  it("lists every vdev below the pool root", () => {
    expect(vdevSubjectItems([tank, { ...tank, id: 4, vdevs: null }])).toEqual([
      { label: "mars · tank · mirror-0", value: 11 },
      { label: "mars · tank · K1", value: 12 },
      { label: "mars · tank · K2", value: 13 },
    ]);
  });

  it("labels hosts by display name, else name", () => {
    expect(
      hostSubjectItems([
        { id: 1, name: "mars", displayName: "Mars NAS" },
        { id: 2, name: "venus", displayName: null },
      ]),
    ).toEqual([
      { label: "Mars NAS", value: 1 },
      { label: "venus", value: 2 },
    ]);
  });

  it("labels datasets by host and full dataset name", () => {
    expect(
      datasetSubjectItems([
        {
          id: 22,
          name: "tank/media/photos",
          host: { name: "mars", displayName: null },
        },
        { id: 23, name: "tank/vm", host: { name: "mars", displayName: "NAS" } },
      ]),
    ).toEqual([
      { label: "mars · tank/media/photos", value: 22 },
      { label: "NAS · tank/vm", value: 23 },
    ]);
  });
});

describe("DIARY_SUBJECT_ICON", () => {
  it.each(DIARY_SUBJECT_TYPES)("has a lucide icon for %s", (subjectType) => {
    expect(DIARY_SUBJECT_ICON[subjectType]).toMatch(/^i-lucide-/);
  });

  it("borrows the entity icons", () => {
    expect(DIARY_SUBJECT_ICON).toMatchObject({
      disk: "i-lucide-hard-drive",
      pool: "i-lucide-database",
      dataset: "i-lucide-folder-tree",
      host: "i-lucide-server",
    });
  });
});
