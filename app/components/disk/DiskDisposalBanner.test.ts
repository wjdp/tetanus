// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { readBody } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearNuxtData } from "#app";
import type { Disposal } from "#shared/disk";
import DiskDisposalBanner from "./DiskDisposalBanner.vue";
import type { DiskDetail } from "./types";

const patched = vi.fn();

registerEndpoint("/api/settings", () => ({
  enrolToken: "x",
  config: { currency: "GBP" },
}));
registerEndpoint("/api/disks/7", {
  method: "PATCH",
  handler: async (event) => {
    const body = await readBody(event);
    patched(body);
    return { id: 7, disposal: body.disposal };
  },
});

beforeEach(() => {
  clearNuxtData();
  patched.mockReset();
});

const mountBanner = (
  disposal: Disposal,
  overrides: Partial<DiskDetail> = {},
  replacedByLabel: string | null = null,
) =>
  mountSuspended(DiskDisposalBanner, {
    props: {
      disk: {
        id: 7,
        disposal,
        replacedByDiskId: null,
        seenSinceDisposal: null,
        ...overrides,
      } as unknown as DiskDetail & { disposal: Disposal },
      label: "K2",
      replacedByLabel,
    },
  });

const banner = '[data-testid="disk-disposal-banner"]';

describe("DiskDisposalBanner", () => {
  it("shows a sold disposal with its date and price, neutral", async () => {
    const wrapper = await mountBanner({
      kind: "sold",
      on: "2026-09-01",
      salePrice: 40,
    });
    await flushPromises();

    const root = wrapper.get(banner);
    expect(root.text()).toContain("Sold · 2026-09-01 · £40.00");
    expect(root.attributes("data-colour")).toBe("neutral");
    expect(wrapper.find('[data-testid="disposal-reconfirm"]').exists()).toBe(
      false,
    );
  });

  it("says an RMA is awaiting replacement, then links the replacement", async () => {
    const awaiting = await mountBanner({ kind: "rma", on: "2026-10-02" });
    expect(awaiting.get(banner).text()).toContain(
      "RMA · awaiting replacement · 2026-10-02",
    );

    const replaced = await mountBanner(
      { kind: "rma", on: "2026-10-02" },
      { replacedByDiskId: 9 },
      "K7",
    );
    const link = replaced.get('[data-testid="disposal-replaced-by"]');
    expect(replaced.get(banner).text()).toContain("RMA · replaced by K7");
    expect(link.attributes("href")).toBe("/disks/9");
  });

  it("turns amber when seen since the latest disposal, and re-confirms it", async () => {
    const wrapper = await mountBanner({ kind: "rma", on: "2026-10-02" }, {
      seenSinceDisposal: {
        at: "2026-10-03T08:00:00.000Z",
        title: "seen on mars while RMA'd on 2026-10-02",
      },
    } as unknown as Partial<DiskDetail>);

    expect(wrapper.get(banner).attributes("data-colour")).toBe("warning");
    expect(wrapper.get('[data-testid="disposal-seen"]').text()).toBe(
      "Seen again 2026-10-03: seen on mars while RMA'd on 2026-10-02",
    );

    await wrapper.get('[data-testid="disposal-reconfirm"]').trigger("click");
    await vi.waitFor(() =>
      expect(patched).toHaveBeenCalledWith({
        disposal: { kind: "rma", on: "2026-10-02" },
      }),
    );
    await vi.waitFor(() => expect(wrapper.emitted("updated")).toHaveLength(1));
  });

  it("undoes the disposal", async () => {
    const wrapper = await mountBanner({ kind: "recycled", on: "2026-09-20" });

    await wrapper.get('[data-testid="disposal-undo"]').trigger("click");

    await vi.waitFor(() =>
      expect(patched).toHaveBeenCalledWith({ disposal: null }),
    );
    await vi.waitFor(() => expect(wrapper.emitted("updated")).toHaveLength(1));
  });
});
