// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { FAULT_KINDS } from "#shared/faults";
import ReferencePage from "./reference.vue";

describe("fault reference page", () => {
  it("lists every fault kind with an anchor, its severities and settings", async () => {
    const page = await mountSuspended(ReferencePage, {
      route: "/faults/reference",
    });

    const kinds = page.findAll('[data-testid="fault-kind"]');
    expect(kinds.map((kind) => kind.attributes("id")).sort()).toEqual(
      [...FAULT_KINDS].sort(),
    );

    const scrub = page.get("#scrub-overdue");
    expect(scrub.get("h3").text()).toBe("Scrub overdue");
    expect(scrub.text()).toContain("warning");
    expect(scrub.text()).not.toContain("error");
    expect(scrub.text()).toContain("Pool settings › Scrub interval (days)");

    expect(page.get("#scan-stalled").text()).toMatch(/warning\s*error/);

    expect(
      page
        .get("#leaf-errors")
        .findAll("[data-action]")
        .map((badge) => badge.attributes("data-action")),
    ).toEqual(["acknowledge", "accept", "clear", "resolve"]);
    expect(page.get("#disk-missing").text()).toContain(
      "Setting a state override on the disk page (spare, removed, dead or retired)",
    );
  });
});
