// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { config } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { clearNuxtData } from "#app";
import { photos } from "~/components/dataset/testFixtures";
import { tank } from "~/components/pool/testFixtures";
import { ZFS_BYTE_SYSTEM_COOKIE } from "~/composables/useZfsByteSystem";
import { clearCookie } from "~~/test/cookies";
import { FakeEventSource } from "~~/test/fakeEventSource";
import ZfsPathPage from "./[...path].vue";

// UTooltip needs the provider UApp installs in app.vue; the page is mounted alone.
config.global.stubs.UTooltip = defineComponent({
  setup:
    (_, { slots }) =>
    () => [slots.default?.(), slots.content?.()],
});

registerEndpoint("/api/zfs/nas1/tank", () => ({
  kind: "pool",
  pool: { ...tank, path: "/zfs/nas1/tank" },
}));
registerEndpoint("/api/zfs/nas1/tank/media/photos", () => ({
  kind: "dataset",
  dataset: photos(),
}));
registerEndpoint("/api/pools/7/datasets", () => ({ datasets: [] }));
registerEndpoint("/api/faults", () => ({
  faults: [],
  counts: { open: 0, acknowledged: 0, accepted: 0, resolved: 0 },
  badge: 0,
}));

beforeEach(() => {
  FakeEventSource.install();
  clearNuxtData();
  clearNuxtState(ZFS_BYTE_SYSTEM_COOKIE);
  clearCookie(ZFS_BYTE_SYSTEM_COOKIE);
});

describe("zfs path page", () => {
  it("renders the pool page for a pool path", async () => {
    const page = await mountSuspended(ZfsPathPage, { route: "/zfs/nas1/tank" });

    expect(page.get("h1").text()).toBe("tank");
    expect(page.find('[data-testid="vdev-tree"]').exists()).toBe(true);
  });

  it("renders the dataset page for a dataset path", async () => {
    const page = await mountSuspended(ZfsPathPage, {
      route: "/zfs/nas1/tank/media/photos",
    });

    expect(page.get("h1").text()).toBe("photos");
    expect(page.find('[data-testid="properties-panel"]').exists()).toBe(true);
  });
});
