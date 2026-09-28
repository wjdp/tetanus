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

describe("DiaryEntryForm", () => {
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
});
