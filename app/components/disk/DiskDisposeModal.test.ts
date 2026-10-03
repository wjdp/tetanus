// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { createError, readBody } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearNuxtData } from "#app";
import DiskDisposeModal from "./DiskDisposeModal.vue";
import { localToday } from "./disposal";

const patched = vi.fn();

registerEndpoint("/api/settings", () => ({
  enrolToken: "x",
  config: { currency: "JPY" },
}));
registerEndpoint("/api/disks/7", {
  method: "PATCH",
  handler: async (event) => {
    const body = await readBody(event);
    patched(body);
    return { id: 7, disposal: body.disposal };
  },
});
registerEndpoint("/api/disks/8", {
  method: "PATCH",
  handler: () => {
    throw createError({
      statusCode: 409,
      statusMessage: "K3 is still attached to mars",
      message: "K3 is still attached to mars",
    });
  },
});

beforeEach(() => {
  clearNuxtData();
  patched.mockReset();
  useToast().clear();
});

const mountModal = (id = 7, disposal: object | null = null) =>
  mountSuspended(DiskDisposeModal, {
    props: { disk: { id, disposal } as never, label: "K2", open: true },
    attachTo: document.body,
  });

const form = () =>
  document.querySelector<HTMLFormElement>("#disk-dispose-form");

const setInput = (selector: string, value: string) => {
  const input = form()?.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`${selector} missing`);
  input.value = value;
  input.dispatchEvent(new Event("input"));
};

describe("DiskDisposeModal", () => {
  it("defaults to sold today and sends the sale price in the display currency", async () => {
    const modal = await mountModal();
    await flushPromises();

    expect(document.body.textContent).toContain("Dispose of K2");
    expect(
      form()?.querySelector<HTMLInputElement>('input[type="date"]')?.value,
    ).toBe(localToday());
    expect(
      form()?.querySelector('[data-testid="currency-symbol"]')?.textContent,
    ).toBe("¥");

    setInput('input[type="date"]', "2026-09-30");
    setInput('input[type="number"]', "4000");
    form()?.requestSubmit();
    await flushPromises();

    await vi.waitFor(() =>
      expect(patched).toHaveBeenCalledWith({
        disposal: { kind: "sold", on: "2026-09-30", salePrice: 4000 },
      }),
    );
    await vi.waitFor(() => expect(modal.emitted("updated")).toHaveLength(1));
  });

  it("asks for a price only when sold, and edits an existing disposal", async () => {
    await mountModal(7, { kind: "rma", on: "2026-10-02" });
    await flushPromises();

    expect(document.body.textContent).toContain("Edit disposal of K2");
    expect(form()?.querySelector('input[type="number"]')).toBeNull();

    form()?.requestSubmit();
    await flushPromises();

    await vi.waitFor(() =>
      expect(patched).toHaveBeenCalledWith({
        disposal: { kind: "rma", on: "2026-10-02" },
      }),
    );
  });

  it("surfaces the server's refusal", async () => {
    const modal = await mountModal(8);
    await flushPromises();

    form()?.requestSubmit();
    await flushPromises();

    await vi.waitFor(() =>
      expect(useToast().toasts.value.at(-1)).toMatchObject({
        title: "Could not dispose of K2",
        description: "K3 is still attached to mars",
        color: "error",
      }),
    );
    expect(modal.emitted("updated")).toBeUndefined();
  });
});
