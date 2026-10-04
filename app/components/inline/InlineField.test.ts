// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import InlineField from "./InlineField.vue";

registerEndpoint("/api/settings", () => ({
  enrolToken: "x",
  config: { currency: "GBP" },
}));

const display = '[data-testid="inline-display"]';

const mountField = (props: Record<string, unknown> = {}) =>
  mountSuspended(InlineField, {
    props: { type: "text", value: "eBay", label: "Supplier", ...props },
  });

describe("InlineField", () => {
  it("shows the value with its label, and a dimmed placeholder when blank", async () => {
    const field = await mountField();
    expect(field.get("dt").text()).toBe("Supplier");
    expect(field.get(display).text()).toBe("eBay");

    const blank = await mountField({ value: null });
    expect(blank.get(display).text()).toBe("—");
    expect(blank.get(`${display} span`).classes()).toContain("text-dimmed");
  });

  it("enters edit mode on click and commits on Enter", async () => {
    const field = await mountField();
    await field.get(display).trigger("click");
    const input = field.get("input");
    expect((input.element as HTMLInputElement).value).toBe("eBay");

    await input.setValue("Scan");
    await input.trigger("keydown", { key: "Enter" });
    expect(field.emitted("commit")).toEqual([["Scan"]]);
    expect(field.find("input").exists()).toBe(false);
  });

  it("is a button, so Enter and Space open it from the keyboard", async () => {
    const field = await mountField();
    expect(field.get(display).element.tagName).toBe("BUTTON");
    expect(field.get(display).attributes("aria-label")).toBe("Edit Supplier");
  });

  it("reverts on Escape without emitting", async () => {
    const field = await mountField();
    await field.get(display).trigger("click");
    await field.get("input").setValue("Scan");
    await field.get("input").trigger("keydown", { key: "Escape" });

    expect(field.emitted("commit")).toBeUndefined();
    expect(field.get(display).text()).toBe("eBay");
  });

  it("does not emit an unchanged value", async () => {
    const field = await mountField();
    await field.get(display).trigger("click");
    await field.get("input").setValue("  eBay ");
    await field.get("input").trigger("blur");
    expect(field.emitted("commit")).toBeUndefined();
  });

  it("commits on blur, blank as null", async () => {
    const field = await mountField();
    await field.get(display).trigger("click");
    await field.get("input").setValue("");
    await field.get("input").trigger("blur");
    expect(field.emitted("commit")).toEqual([[null]]);
  });

  it("commits money as a number with the currency symbol", async () => {
    const field = await mountField({
      type: "money",
      value: 99.5,
      label: "Price",
    });
    await flushPromises();
    expect(field.get(display).text()).toBe("£99.50");

    await field.get(display).trigger("click");
    expect(field.get('[data-testid="currency-symbol"]').text()).toBe("£");
    await field.get("input").setValue("120");
    await field.get("input").trigger("blur");
    expect(field.emitted("commit")).toEqual([[120]]);
  });

  it("formats choices by their label", async () => {
    const field = await mountField({
      type: "enum",
      value: false,
      label: "3.3 V pin",
      items: [
        { label: "—", value: null },
        { label: "taped", value: true },
        { label: "not taped", value: false },
      ],
    });
    expect(field.get(display).text()).toBe("not taped");
  });

  it("keeps the control open with the message when the save fails", async () => {
    const field = await mountField();
    await field.get(display).trigger("click");
    await field.get("input").setValue("Scan");
    await field.get("input").trigger("keydown", { key: "Enter" });

    await field.setProps({ saving: true });
    expect(field.get(display).text()).toBe("Scan");
    expect(field.get("[data-status]").attributes("data-status")).toBe("saving");

    await field.setProps({ saving: false, error: "Too long" });
    expect(field.get('[data-testid="inline-error"]').text()).toBe("Too long");
    expect((field.get("input").element as HTMLInputElement).value).toBe("Scan");
  });

  it("shows a tick after a successful save", async () => {
    const field = await mountField();
    await field.get(display).trigger("click");
    await field.get("input").setValue("Scan");
    await field.get("input").trigger("keydown", { key: "Enter" });
    await field.setProps({ saving: true });
    await field.setProps({ saving: false, value: "Scan" });

    expect(field.find("input").exists()).toBe(false);
    expect(field.get("[data-status]").attributes("data-status")).toBe("saved");
  });

  it("renders a hint after the value", async () => {
    const field = await mountField({ hint: "5.7 y old" });
    expect(field.get('[data-testid="inline-hint"]').text()).toBe("5.7 y old");
  });

  it("renders no label in the compact variant", async () => {
    const field = await mountField({ compact: true, hint: "5.7 y old" });
    expect(field.find("dt").exists()).toBe(false);
    expect(field.find("dd").exists()).toBe(false);
    expect(field.find('[data-testid="inline-hint"]').exists()).toBe(false);
    expect(field.get(display).text()).toBe("eBay");
  });

  it("offers an info button beside the label when the field has a description", async () => {
    const described = await mountField({ description: "Where it came from." });
    expect(
      described
        .get('[data-testid="inline-description"]')
        .attributes("aria-label"),
    ).toBe("About Supplier");
    const plain = await mountField();
    expect(plain.find('[data-testid="inline-description"]').exists()).toBe(
      false,
    );
  });
});
