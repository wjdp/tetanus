// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { getQuery } from "h3";
import { describe, expect, it, vi } from "vitest";
import DiskDiary from "./DiskDiary.vue";

const requestedLimits: number[] = [];
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
});

registerEndpoint("/api/diary", (event) => {
  const limit = Number(getQuery(event).limit);
  requestedLimits.push(limit);
  return Array.from({ length: Math.min(entryCount, limit) }, (_, index) =>
    entry(index + 1),
  );
});

const mountDiary = async (entries: number) => {
  entryCount = entries;
  requestedLimits.length = 0;
  const diary = await mountSuspended(DiskDiary, { props: { diskId: 3 } });
  await vi.waitFor(() => expect(diary.text()).toContain("Auto event 1"));
  return diary;
};

const showOlder = '[data-testid="show-older"]';

describe("DiskDiary", () => {
  it("fetches the first 20 entries", async () => {
    await mountDiary(20);
    expect(requestedLimits).toEqual([20]);
  });

  it("fetches 50 more on Show older", async () => {
    const diary = await mountDiary(30);
    await diary.get(showOlder).trigger("click");
    await vi.waitFor(() => expect(requestedLimits).toEqual([20, 70]));
    await vi.waitFor(() => expect(diary.text()).toContain("Manual note 30"));
    expect(diary.find(showOlder).exists()).toBe(false);
  });

  it("hides Show older when fewer entries than the limit come back", async () => {
    const diary = await mountDiary(5);
    expect(diary.find(showOlder).exists()).toBe(false);
  });

  it("filters by kind", async () => {
    const diary = await mountDiary(4);
    const tab = (label: string) =>
      diary.findAll('[role="tab"]').find((button) => button.text() === label);

    await tab("Manual")?.trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(diary.text()).toContain("Manual note 2");
    expect(diary.text()).not.toContain("Auto event 1");

    await tab("Auto")?.trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(diary.text()).toContain("Auto event 1");
    expect(diary.text()).not.toContain("Manual note 2");
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
    expect(diary.find(form).exists()).toBe(false);
  });
});
