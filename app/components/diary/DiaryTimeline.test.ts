// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import type { DiaryEntryKind, DiarySubjectType } from "#shared/diary";
import DiaryTimeline from "./DiaryTimeline.vue";

interface Entry {
  id: number;
  subjectType: DiarySubjectType;
  subjectId: number | null;
  at: string;
  kind: DiaryEntryKind;
  eventType: string | null;
  data?: unknown;
  title: string;
  body: string;
}

const entry = (overrides: Partial<Entry>): Entry => ({
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
          entry({
            id: 4,
            at: "2026-09-27T22:00:00.000Z",
            subjectType: "dataset",
            subjectId: 22,
          }),
        ],
        subjectLabel: (type: string, id: number) =>
          type === "disk" ? "disk K2" : `${type} ${id}`,
      },
    });

    const headings = timeline.findAll("h3").map((heading) => heading.text());
    expect(headings).toEqual(["2026-09-28", "2026-09-27"]);
    expect(timeline.find('a[href="/disks/4"]').text()).toBe("disk K2");
    expect(timeline.find('a[href="/disks/4"]').html()).toContain("hard-drive");
    expect(timeline.find('a[href="/zfs/7"]').exists()).toBe(true);
    expect(timeline.find('a[href="/hosts/4"]').exists()).toBe(true);
    expect(timeline.find('a[href="/datasets/22"]').text()).toBe("dataset 22");

    const manual = timeline.findAll('[data-testid="diary-entry"]')[1];
    expect(manual.text()).toContain("manual");
    expect(manual.findAll("p").map((p) => p.text())).toEqual([
      "Scrubbed by hand",
      "First paragraph.",
      "Second paragraph.",
    ]);
  });

  it("offers edit and delete only on manual entries", async () => {
    const timeline = await mountSuspended(DiaryTimeline, {
      props: {
        entries: [
          entry({ id: 2, kind: "manual", eventType: null, title: "Reseated" }),
          entry({ id: 1, at: "2026-09-28T09:00:00.000Z" }),
        ],
      },
    });

    const [manual, auto] = timeline.findAll('[data-testid="diary-entry"]');
    expect(manual.find('button[aria-label="Edit entry"]').exists()).toBe(true);
    expect(manual.find('button[aria-label="Delete entry"]').exists()).toBe(
      true,
    );
    expect(auto.find('[data-testid="diary-entry-actions"]').exists()).toBe(
      false,
    );
  });

  it("shows the event icon in the gutter", async () => {
    const timeline = await mountSuspended(DiaryTimeline, {
      props: {
        entries: [
          entry({ id: 3, data: { from: "in-use", to: "dead" } }),
          entry({
            id: 2,
            at: "2026-09-28T09:00:00.000Z",
            eventType: "smart-status-changed",
            data: { from: "passed", to: "failed" },
          }),
          entry({
            id: 1,
            at: "2026-09-28T08:00:00.000Z",
            kind: "manual",
            eventType: null,
          }),
        ],
      },
    });

    const [state, smart, manual] = timeline.findAll(
      '[data-testid="diary-entry-icon"]',
    );
    expect(state.find("[data-icon]").attributes("data-icon")).toBe(
      "i-lucide-skull",
    );
    expect(smart.find("[data-colour]").attributes()).toMatchObject({
      "data-colour": "error",
      "data-shape": "filled",
      "aria-label": "SMART failed",
    });
    expect(manual.find("[data-icon]").attributes("data-icon")).toBe(
      "i-lucide-pencil",
    );
  });

  it("hides the subject when asked", async () => {
    const timeline = await mountSuspended(DiaryTimeline, {
      props: { entries: [entry({})], showSubject: false },
    });
    expect(timeline.find('a[href="/disks/4"]').exists()).toBe(false);
  });

  it("shows the empty message", async () => {
    const timeline = await mountSuspended(DiaryTimeline, {
      props: { entries: [], empty: "Nothing here." },
    });
    expect(timeline.text()).toBe("Nothing here.");
  });
});
