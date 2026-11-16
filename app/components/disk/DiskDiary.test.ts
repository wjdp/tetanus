// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { getQuery } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  scrollIntoView,
  stubIntersectionObserver,
} from "~~/test/intersectionObserver";
import DiskDiary from "./DiskDiary.vue";

const requests: Record<string, unknown>[] = [];
let entryCount = 20;

const entry = (id: number) => ({
  id,
  subjectType: "disk",
  subjectId: 3,
  at: new Date(Date.UTC(2026, 8, 1, 12, 0, id)).toISOString(),
  kind: id % 2 === 0 ? "manual" : "auto",
  eventType: id % 2 === 0 ? null : "state-changed",
  title: id % 2 === 0 ? `Manual note ${id}` : `Auto event ${id}`,
  body: "",
  subjectLabel: null,
  subjectPath: null,
});

registerEndpoint("/api/diary", (event) => {
  const query = getQuery(event);
  requests.push(query);
  const limit = Number(query.limit);
  const before = query.beforeId ? Number(query.beforeId) : Infinity;
  const matching = Array.from({ length: entryCount }, (_, index) =>
    entry(entryCount - index),
  ).filter((row) => !query.kind || row.kind === query.kind);
  const older = matching.filter((row) => row.id < before);
  return {
    items: older.slice(0, limit),
    hasMore: older.length > limit,
    total: matching.length,
  };
});

const mountDiary = async (entries: number) => {
  entryCount = entries;
  const diary = await mountSuspended(DiskDiary, { props: { diskId: 3 } });
  await vi.waitFor(() => expect(diary.text()).toContain(`${entries}`));
  return diary;
};

const end = '[data-testid="infinite-list-end"]';

beforeEach(() => {
  requests.length = 0;
  stubIntersectionObserver();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DiskDiary", () => {
  it("fetches the newest page for the disk", async () => {
    await mountDiary(20);
    expect(requests).toEqual([
      { limit: "50", subjectType: "disk", subjectId: "3" },
    ]);
  });

  it("fetches older entries when the end of the list comes into view", async () => {
    const diary = await mountDiary(60);
    expect(diary.text()).not.toContain("Manual note 10");

    scrollIntoView(diary.get(end).element);

    await vi.waitFor(() => expect(diary.text()).toContain("Manual note 10"));
    expect(requests.at(-1)).toMatchObject({ limit: "50", beforeId: "11" });
    expect(diary.find(end).exists()).toBe(false);
  });

  it("shows no end marker when everything fits on one page", async () => {
    const diary = await mountDiary(5);
    expect(diary.find(end).exists()).toBe(false);
  });

  it("filters by kind on the server", async () => {
    const diary = await mountDiary(4);
    const tab = (label: string) =>
      diary.findAll('[role="tab"]').find((button) => button.text() === label);

    await tab("Manual")?.trigger("mousedown", { button: 0 });
    await vi.waitFor(() => expect(diary.text()).not.toContain("Auto event 1"));
    expect(diary.text()).toContain("Manual note 2");
    expect(requests.at(-1)).toMatchObject({ kind: "manual" });

    await tab("Auto")?.trigger("mousedown", { button: 0 });
    await vi.waitFor(() => expect(diary.text()).not.toContain("Manual note 2"));
    expect(diary.text()).toContain("Auto event 1");
  });

  it("toggles the entry form with Add entry and Cancel", async () => {
    const diary = await mountDiary(1);
    const form = '[data-testid="diary-entry-form"]';
    expect(diary.find(form).exists()).toBe(false);

    await diary.get('[data-testid="add-entry"]').trigger("click");
    expect(diary.find(form).exists()).toBe(true);
    expect(diary.find('[data-testid="subject-picker"]').exists()).toBe(false);

    const cancel = diary
      .findAll("button")
      .find((button) => button.text() === "Cancel");
    await cancel?.trigger("click");
    await flushPromises();
    expect(diary.find(form).exists()).toBe(false);
  });
});
