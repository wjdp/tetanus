// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AcceptFaultModal from "./AcceptFaultModal.vue";
import type { LatestAttribute } from "./types";

const historyFetched = vi.fn();

registerEndpoint("/api/disks/7/smart", () => {
  historyFetched();
  return {
    history: {
      attributes: {
        "5": [
          { at: "2026-09-01T00:00:00.000Z", value: 24 },
          { at: "2026-10-01T00:00:00.000Z", value: 24 },
        ],
      },
    },
  };
});

beforeEach(() => {
  historyFetched.mockReset();
});

const reallocated = (source: LatestAttribute["source"]) =>
  ({
    attrId: "5",
    name: "Reallocated_Sector_Ct",
    source,
    takenAt: "2026-10-01T00:00:00.000Z",
    transformedValue: 24,
    trend: "stable",
    failureRate: null,
    metadata: null,
    acceptance: null,
  }) as unknown as LatestAttribute;

const mountModal = (attribute: LatestAttribute) =>
  mountSuspended(AcceptFaultModal, {
    props: { diskId: 7, attribute, kind: "accept", open: true },
    attachTo: document.body,
  });

const byTestId = (id: string) =>
  document.querySelector(`[data-testid="${id}"]`);

describe("AcceptFaultModal", () => {
  it("shows the trend and history references for a stored attribute", async () => {
    const modal = await mountModal(reallocated(null));
    await flushPromises();

    expect(historyFetched).toHaveBeenCalled();
    expect(byTestId("acceptance-trend")?.textContent).toContain("stable");
    expect(document.body.textContent).toContain("30 d ago");
    expect(byTestId("acceptance-summary")?.textContent).toContain("stable");
    modal.unmount();
  });

  it("says no history is kept for a substitute, without a trend", async () => {
    const modal = await mountModal(reallocated("device-statistics"));
    await flushPromises();

    expect(historyFetched).not.toHaveBeenCalled();
    expect(byTestId("acceptance-trend")).toBeNull();
    expect(document.body.textContent).not.toContain("d ago");
    expect(byTestId("acceptance-summary")?.textContent?.trim()).toBe(
      "24, read from device statistics; no history is kept",
    );
    modal.unmount();
  });
});
