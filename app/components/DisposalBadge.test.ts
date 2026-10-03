// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import DisposalBadge from "./DisposalBadge.vue";

describe("DisposalBadge", () => {
  it("shows the kind's label and icon with the date as its title", async () => {
    const badge = await mountSuspended(DisposalBadge, {
      props: {
        disposal: { kind: "sold", on: "2026-09-01", salePrice: 40 },
        replacedByDiskId: null,
      },
    });

    expect(badge.text()).toBe("Sold");
    expect(badge.html()).toContain("i-lucide:banknote");
    expect(badge.attributes("title")).toBe("Disposed 2026-09-01");
    expect(badge.attributes("data-disposal")).toBe("sold");
  });

  it("names an RMA's replacement", async () => {
    const badge = await mountSuspended(DisposalBadge, {
      props: {
        disposal: { kind: "rma", on: "2026-10-02" },
        replacedByDiskId: 9,
        replacedByLabel: "K7",
      },
    });

    expect(badge.text()).toBe("RMA · replaced by K7");
  });
});
