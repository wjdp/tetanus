// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import DiskTile from "./DiskTile.vue";
import {
  diskFixture,
  leafFixture,
  vdevDiskFixture,
  vdevFixture,
} from "./testFixtures";

const TooltipPassthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      slots.default?.(),
});
const stubs = { UTooltip: TooltipPassthrough };

const mountTile = (props: InstanceType<typeof DiskTile>["$props"]) =>
  mountSuspended(DiskTile, { props, global: { stubs } });

const exos = vdevDiskFixture(1, "K2", {
  capacityBytes: 18e12,
  latestTemp: 34,
  modelShort: "Exos X18",
  media: "hdd",
  purpose: "system",
});

describe("TopologyDiskTile", () => {
  it("shows alias, model and capacity with temperature for a leaf", async () => {
    const tile = await mountTile({
      leaf: leafFixture("K2", 1, { disk: exos }),
    });

    expect(tile.get('[data-testid="disk-tile-label"]').text()).toBe("K2");
    expect(tile.text()).toContain("sys");
    expect(tile.get('[data-testid="disk-tile-model"]').text()).toBe("Exos X18");
    expect(tile.get('[data-testid="disk-tile-facts"]').text()).toBe(
      "18.0 TB · 34°",
    );
    expect(tile.find('[data-media="hdd"]').exists()).toBe(true);
    expect(tile.get('[data-testid="disk-tile"]').attributes("href")).toBe(
      "/disks/1",
    );
  });

  it("shows the same three lines for a disk outside a pool", async () => {
    const tile = await mountTile({
      disk: diskFixture(9, {
        alias: null,
        serial: "ZL0001",
        modelShort: "WD Red Plus",
        capacityBytes: 4e12,
        media: "ssd",
      }),
    });

    expect(tile.get('[data-testid="disk-tile-label"]').text()).toBe("ZL0001");
    expect(tile.get('[data-testid="disk-tile-model"]').text()).toBe(
      "WD Red Plus",
    );
    expect(tile.get('[data-testid="disk-tile-facts"]').text()).toBe(
      "4.00 TB · —",
    );
    expect(tile.find('[data-media="ssd"]').exists()).toBe(true);
  });

  it("leads line 2 with the bay label only when one is set", async () => {
    const bay = {
      locationKey: "enc:5001:8",
      label: "Bay 1",
      defaultLabel: "RES2SV240 slot 8",
    };
    const labelled = await mountTile({
      leaf: leafFixture("K2", 1, { disk: { ...exos, bay } }),
    });
    expect(labelled.get('[data-testid="disk-tile-model"]').text()).toBe(
      "Bay 1 · Exos X18",
    );

    const unlabelled = await mountTile({
      leaf: leafFixture("K2", 1, {
        disk: { ...exos, bay: { ...bay, label: null } },
      }),
    });
    expect(unlabelled.get('[data-testid="disk-tile-model"]').text()).toBe(
      "Exos X18",
    );
  });

  it("marks a disk tile with its state only when the disk is gone", async () => {
    const dead = await mountTile({ disk: diskFixture(9, { state: "dead" }) });
    expect(
      dead.get('[data-testid="disk-tile-state-mark"]').attributes("title"),
    ).toBe("Dead");

    const spare = await mountTile({ disk: diskFixture(9, { state: "spare" }) });
    expect(spare.find('[data-testid="disk-tile-state-mark"]').exists()).toBe(
      false,
    );
  });

  it("colours temperature by the disk's thresholds", async () => {
    const at = async (latestTemp: number) => {
      const tile = await mountTile({
        leaf: leafFixture("K2", 1, {
          disk: {
            ...exos,
            latestTemp,
            tempThresholds: { warning: 40, error: 50 },
          },
        }),
      });
      return tile.get('[data-testid="disk-tile-temp"]').classes();
    };

    expect(await at(39)).not.toEqual(expect.arrayContaining(["text-warning"]));
    expect(await at(40)).toContain("text-warning");
    expect(await at(50)).toContain("text-error");
  });

  it("replaces line 3 with error counters", async () => {
    const tile = await mountTile({
      leaf: leafFixture("K2", 1, {
        disk: exos,
        checksumErrors: 4,
        readErrors: 0,
        slowIos: 2,
      }),
    });

    const counters = tile.get('[data-testid="disk-tile-counters"]');
    expect(counters.text()).toContain("C4");
    expect(counters.text()).not.toContain("R");
    expect(counters.get(".text-warning").text()).toBe("S2");
    expect(tile.find('[data-testid="disk-tile-facts"]').exists()).toBe(false);
  });

  it("replaces line 2 with a non-ONLINE state in its colour", async () => {
    const tile = await mountTile({
      leaf: leafFixture("K2", 1, { disk: exos, state: "FAULTED" }),
    });

    const state = tile.get('[data-testid="disk-tile-state"]');
    expect(state.text()).toBe("FAULTED");
    expect(state.classes()).toContain("text-error");
  });

  it("draws an unlinked leaf dashed, by path, without a glyph", async () => {
    const tile = await mountTile({
      leaf: vdevFixture({ name: "/dev/sdz1", path: "/dev/sdz1" }),
    });

    expect(tile.get('[data-testid="disk-tile"]').classes()).toContain(
      "border-dashed",
    );
    expect(
      tile.get('[data-testid="disk-tile"]').attributes("href"),
    ).toBeUndefined();
    expect(tile.get('[data-testid="disk-tile-label"]').text()).toBe("sdz1");
    expect(tile.text()).toContain("unlinked");
    expect(tile.find("[data-media]").exists()).toBe(false);
    expect(tile.find('[data-shape="hollow"]').exists()).toBe(true);
  });
});
