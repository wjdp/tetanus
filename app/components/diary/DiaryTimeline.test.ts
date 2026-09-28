// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import DiaryTimeline from "./DiaryTimeline.vue";

const entry = (overrides: Record<string, unknown>) => ({
  id: 1,
  subjectType: "disk",
  subjectId: 4,
  at: "2026-09-28T10:15:00.000Z",
  kind: "auto",
  eventType: "state-changed",
  title: "spare (was in-use)",
  body: "",
  ...overrides,
});

describe("DiaryTimeline", () => {
  it("groups entries by day and links subjects", async () => {
    const timeline = await mountSuspended(DiaryTimeline, {
      props: {
        entries: [
          entry({ id: 3 }),
          entry({
            id: 2,
            at: "2026-09-28T08:00:00.000Z",
            subjectType: "pool",
            subjectId: 7,
            kind: "manual",
            eventType: null,
            title: "Scrubbed by hand",
            body: "First paragraph.\n\nSecond paragraph.",
          }),
          entry({ id: 1, at: "2026-09-27T23:00:00.000Z", subjectType: "host" }),
        ],
        subjectLabel: (type: string, id: number) =>
          type === "disk" ? "disk K2" : `${type} ${id}`,
      },
    });

    const headings = timeline.findAll("h3").map((heading) => heading.text());
    expect(headings).toEqual(["2026-09-28", "2026-09-27"]);
    expect(timeline.find('a[href="/disks/4"]').text()).toBe("disk K2");
    expect(timeline.find('a[href="/zfs/7"]').exists()).toBe(true);
    expect(timeline.find('a[href="/settings/hosts"]').exists()).toBe(true);

    const manual = timeline.findAll('[data-testid="diary-entry"]')[1];
    expect(manual.text()).toContain("manual");
    expect(manual.findAll("p").map((p) => p.text())).toEqual([
      "Scrubbed by hand",
      "First paragraph.",
      "Second paragraph.",
    ]);
  });

  it("shows the empty message", async () => {
    const timeline = await mountSuspended(DiaryTimeline, {
      props: { entries: [], empty: "Nothing here." },
    });
    expect(timeline.text()).toBe("Nothing here.");
  });
});
