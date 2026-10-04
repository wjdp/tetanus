// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import DiskSelfTests from "./DiskSelfTests.vue";

const selfTests = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    diskId: 3,
    type: "Short offline",
    status: "Completed without error",
    passed: true,
    lifetimeHours: 1000 - index,
    lba: null,
    seenAt: "2026-09-01T12:00:00.000Z",
  }));

const bodyRows = (component: Awaited<ReturnType<typeof mountSuspended>>) =>
  component.findAll("tbody tr");

const toggle = '[data-testid="self-tests-toggle"]';

describe("DiskSelfTests", () => {
  it("shows the latest 10 and toggles the rest", async () => {
    const component = await mountSuspended(DiskSelfTests, {
      props: { selfTests: selfTests(12) },
    });
    expect(bodyRows(component)).toHaveLength(10);

    await component.get(toggle).trigger("click");
    expect(bodyRows(component)).toHaveLength(12);
    expect(component.get(toggle).text()).toBe("Show latest");

    await component.get(toggle).trigger("click");
    expect(bodyRows(component)).toHaveLength(10);
    expect(component.get(toggle).text()).toBe("Show all (12)");
  });

  it("offers no toggle for 10 or fewer", async () => {
    const component = await mountSuspended(DiskSelfTests, {
      props: { selfTests: selfTests(10) },
    });
    expect(bodyRows(component)).toHaveLength(10);
    expect(component.find(toggle).exists()).toBe(false);
  });
});
