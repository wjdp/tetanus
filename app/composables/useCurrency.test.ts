// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { clearNuxtData } from "#app";
import { useCurrency } from "./useCurrency";

let config: Record<string, unknown> = {};
registerEndpoint("/api/settings", () => ({ enrolToken: "x", config }));

const mountProbe = async () => {
  const Probe = defineComponent({
    setup() {
      const currency = useCurrency();
      return () => h("pre", currency.value);
    },
  });
  const component = await mountSuspended(Probe);
  await flushPromises();
  return component;
};

beforeEach(() => {
  clearNuxtData();
});

describe("useCurrency", () => {
  it("reads the currency from settings", async () => {
    config = { currency: "EUR" };
    expect((await mountProbe()).text()).toBe("EUR");
  });

  it("falls back to GBP", async () => {
    config = {};
    expect((await mountProbe()).text()).toBe("GBP");
  });
});
