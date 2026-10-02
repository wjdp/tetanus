// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { readBody } from "h3";
import { describe, expect, it, vi } from "vitest";
import ArchiveModal from "./ArchiveModal.vue";

const archived = vi.fn();

registerEndpoint("/api/pools/12/archive", {
  method: "POST",
  handler: async (event) => {
    archived(await readBody(event));
    return {};
  },
});

describe("PoolArchiveModal", () => {
  it("archives the pool with the trimmed note", async () => {
    const modal = await mountSuspended(ArchiveModal, {
      props: { poolId: 12, poolName: "tfault", open: true },
      attachTo: document.body,
    });
    await flushPromises();

    expect(document.body.textContent).toContain("Archive tfault");
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "#pool-archive-form textarea",
    );
    if (!textarea) throw new Error("note field missing");
    textarea.value = "  fixture capture ";
    textarea.dispatchEvent(new Event("input"));
    document
      .querySelector<HTMLFormElement>("#pool-archive-form")
      ?.requestSubmit();
    await flushPromises();

    await vi.waitFor(() =>
      expect(archived).toHaveBeenCalledWith({ note: "fixture capture" }),
    );
    await vi.waitFor(() => expect(modal.emitted("archived")).toHaveLength(1));
  });
});
