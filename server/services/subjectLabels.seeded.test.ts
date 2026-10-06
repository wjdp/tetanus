import { beforeAll, describe, expect, it } from "vitest";
import { listDiary } from "~~/server/services/diary";
import { labelSubjects } from "~~/server/services/subjectLabels";
import { loadSeededDatabase } from "~~/test/seeded";

describe("labelSubjects", () => {
  beforeAll(loadSeededDatabase);

  it("names every diary subject without falling back to its id", () => {
    const entries = listDiary({ limit: 10_000 });
    expect(
      new Set(entries.map((entry) => entry.subjectType)).size,
    ).toBeGreaterThan(3);
    for (const entry of entries) {
      if (entry.subjectId === null) {
        expect(entry.subjectLabel).toBeNull();
        continue;
      }
      const fallback = new RegExp(`^(removed )?${entry.subjectType}( \\d+)?$`);
      expect(entry.subjectLabel).not.toMatch(fallback);
    }
  });

  it("marks subjects that no longer exist as removed", () => {
    expect(
      labelSubjects([{ subjectType: "host", subjectId: 999_999 }]),
    ).toEqual([
      {
        subjectType: "host",
        subjectId: 999_999,
        subjectLabel: "removed host",
        subjectPath: null,
      },
    ]);
  });
});
