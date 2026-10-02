// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FaultView } from "#shared/faults";
import AppFaultBanners from "./AppFaultBanners.vue";

const faults = ref<FaultView[]>([]);
const acknowledge = vi.fn();
const useFaultsMock = vi.fn((_query: unknown) => ({ faults, acknowledge }));
mockNuxtImport("useFaults", () => (query: unknown) => useFaultsMock(query));

const fault = (id: number, overrides: Partial<FaultView> = {}): FaultView => ({
  id,
  kind: "collector-silent",
  category: "host",
  severity: "error",
  state: "open",
  key: String(id),
  data: { lastOkAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() },
  note: "",
  openedAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  resolvedAt: null,
  stateChangedAt: new Date().toISOString(),
  subject: { type: "host", id, label: "mars", hostName: "mars" },
  ...overrides,
});

beforeEach(() => {
  faults.value = [];
  acknowledge.mockReset();
});

describe("AppFaultBanners", () => {
  it("asks for open errors only", async () => {
    await mountSuspended(AppFaultBanners);

    expect(useFaultsMock).toHaveBeenCalledWith({
      state: "open",
      severity: "error",
    });
  });

  it("renders nothing without faults", async () => {
    const component = await mountSuspended(AppFaultBanners);
    expect(component.html()).not.toContain("<section");
  });

  it("renders one banner per fault with its host and title", async () => {
    faults.value = [
      fault(1),
      fault(2, {
        kind: "collector-incompatible",
        data: { version: "0.2.0", minVersion: "0.3.0" },
        subject: { type: "host", id: 2, label: "pihost", hostName: "pihost" },
      }),
    ];
    const component = await mountSuspended(AppFaultBanners);

    expect(component.text()).toContain("mars");
    expect(component.text()).toContain("No data for 3 h");
    expect(component.text()).toContain("pihost");
    expect(component.text()).toContain(
      "Collector 0.2.0 is too old; 0.3.0 or later is needed",
    );
    expect(component.findAll("code")).toHaveLength(1);
    expect(component.get("code").text()).toMatch(
      /^curl -fsSL .+\/host\/install\.sh \| sudo bash$/,
    );
  });

  it("labels a disk fault with the disk's host", async () => {
    faults.value = [
      fault(1, {
        kind: "disk-missing",
        category: "disk",
        data: {},
        subject: { type: "disk", id: 9, label: "V5", hostName: "venus" },
      }),
    ];
    const component = await mountSuspended(AppFaultBanners);

    expect(component.text()).toContain("venus");
    expect(component.text()).toContain("Missing");
  });

  it("marks each fault with a 3 px error gutter", async () => {
    faults.value = [fault(1)];
    const component = await mountSuspended(AppFaultBanners);
    const row = component.get('[data-testid="fault-banner"]');
    expect(row.classes()).toEqual(
      expect.arrayContaining(["border-s-[3px]", "border-s-error"]),
    );
  });

  it("caps the strip at three with an overflow link to the faults page", async () => {
    faults.value = [1, 2, 3, 4, 5].map((id) => fault(id));
    const component = await mountSuspended(AppFaultBanners);

    expect(component.findAll('[data-testid="fault-banner"]')).toHaveLength(3);
    const overflow = component.get('[data-testid="fault-banner-overflow"]');
    expect(overflow.text()).toContain("and 2 more");
    expect(overflow.attributes("href")).toBe("/faults");
  });

  it("has no overflow row at three or fewer", async () => {
    faults.value = [1, 2, 3].map((id) => fault(id));
    const component = await mountSuspended(AppFaultBanners);

    expect(
      component.find('[data-testid="fault-banner-overflow"]').exists(),
    ).toBe(false);
  });

  it("acknowledges a fault via its button", async () => {
    faults.value = [fault(4)];
    const component = await mountSuspended(AppFaultBanners);

    const button = component
      .findAll("button")
      .find((candidate) => candidate.text() === "Acknowledge");
    await button?.trigger("click");

    expect(acknowledge).toHaveBeenCalledWith(4);
  });
});
