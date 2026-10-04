// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { readBody } from "h3";
import { describe, expect, it, vi } from "vitest";
import DiaryEntryForm from "./DiaryEntryForm.vue";

const posted: unknown[] = [];

registerEndpoint("/api/diary", {
  method: "POST",
  handler: async (event) => {
    posted.push(await readBody(event));
    return { id: 1 };
  },
});

let diskListFetches = 0;

registerEndpoint("/api/disks", () => {
  diskListFetches += 1;
  return [
    { id: 3, alias: "K1", model: "WDC WD80", serial: "AAA" },
    { id: 4, alias: "K2", model: "WDC WD80", serial: "BBB" },
  ];
});

registerEndpoint("/api/hosts", () => [
  { id: 7, name: "mars", displayName: null },
]);

describe("DiaryEntryForm", () => {
  it("selects the pre-filled subject in the picker", async () => {
    const form = await mountSuspended(DiaryEntryForm, {
      props: { subjectType: "disk", subjectId: 4 },
    });
    await vi.waitFor(() =>
      expect(form.get('[data-testid="subject-picker"]').text()).toContain(
        "K2 · WDC WD80 · BBB",
      ),
    );
  });

  it("posts a pre-filled entry and emits saved", async () => {
    const onSaved = vi.fn();
    const form = await mountSuspended(DiaryEntryForm, {
      props: { subjectType: "disk", subjectId: 4, onSaved },
    });
    await form.get('input[name="title"]').setValue("Replaced SATA cable");
    await form.get("textarea").setValue("Bay 3.");
    await form.get("form").trigger("submit");
    await flushPromises();

    expect(posted).toEqual([
      {
        subjectType: "disk",
        subjectId: 4,
        title: "Replaced SATA cable",
        body: "Bay 3.",
      },
    ]);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("clears the subject when the subject type changes", async () => {
    const form = await mountSuspended(DiaryEntryForm, {
      props: { subjectType: "disk", subjectId: 4 },
    });
    (form.vm as unknown as { subjectType: string }).subjectType = "host";
    await form.get('input[name="title"]').setValue("Moved rack");
    await form.get("form").trigger("submit");
    await flushPromises();

    expect(posted.at(-1)).toMatchObject({
      subjectType: "host",
      subjectId: null,
    });
  });

  it("hides the subject pickers and posts the fixed subject", async () => {
    const fetchesBefore = diskListFetches;
    const form = await mountSuspended(DiaryEntryForm, {
      props: { subjectType: "disk", subjectId: 3, fixedSubject: true },
    });
    expect(form.find('[data-testid="subject-picker"]').exists()).toBe(false);
    expect(form.text()).not.toContain("Subject type");

    await form.get('input[name="title"]').setValue("Relabelled");
    await form.get("form").trigger("submit");
    await flushPromises();

    expect(posted.at(-1)).toEqual({
      subjectType: "disk",
      subjectId: 3,
      title: "Relabelled",
      body: "",
    });
    expect(diskListFetches).toBe(fetchesBefore);
  });
});
