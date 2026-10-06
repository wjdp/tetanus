// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import type { TopologyPool, TopologyVdev } from "./groupDisks";
import PoolCard from "./PoolCard.vue";
import { leafFixture, vdevFixture } from "./testFixtures";

const TooltipPassthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      slots.default?.(),
});

const poolOf = (children: TopologyVdev[]): TopologyPool => ({
  id: 7,
  name: "tank",
  path: "/zfs/nas1/tank",
  state: "ONLINE",
  displayState: "ONLINE",
  sizeBytes: null,
  allocBytes: null,
  usable: null,
  cap: 85,
  frag: null,
  scan: null,
  vdevs: vdevFixture({ name: "tank", type: "root", children }),
});

const mountCard = (pool: TopologyPool) =>
  mountSuspended(PoolCard, {
    props: { pool, now: Date.now() },
    global: { stubs: { UTooltip: TooltipPassthrough } },
  });

const rowLabels = (card: Awaited<ReturnType<typeof mountCard>>) =>
  card
    .findAll('[data-testid="vdev-group"]')
    .map((row) => row.find(".font-mono").text());

describe("TopologyPoolCard", () => {
  it("leads with usable space and falls back to raw figures", async () => {
    const space = async (extra: Partial<TopologyPool>) =>
      (await mountCard({ ...poolOf([]), ...extra }))
        .get('[data-testid="pool-space"]')
        .text()
        .replace(/\s+/g, " ");

    expect(
      await space({ usable: { used: 2 ** 40, available: 3 * 2 ** 40 } }),
    ).toBe("1.00 TiB used · 3.00 TiB available · cap 85 % · frag — %");
    expect(await space({ allocBytes: 2 ** 41, sizeBytes: 2 ** 42 })).toBe(
      "2.00 TiB of 4.00 TiB raw · cap 85 % · frag — %",
    );
  });

  it("sets class vdevs apart below the data vdevs", async () => {
    const card = await mountCard(
      poolOf([
        leafFixture("C1", 1, { type: "cache" }),
        vdevFixture({
          name: "raidz1-0",
          type: "raidz1",
          children: [leafFixture("K1", 2)],
        }),
        leafFixture("L1", 3, { type: "log" }),
      ]),
    );

    expect(rowLabels(card)).toEqual(["raidz1-0", "log", "cache"]);
    const dividers = card.findAll("[data-class-divider]");
    expect(dividers).toHaveLength(1);
    expect(dividers[0]?.text()).toContain("log");
    expect(dividers[0]?.classes()).toContain("border-t");
  });

  it("draws no divider when the pool has only data vdevs", async () => {
    const card = await mountCard(
      poolOf([
        vdevFixture({
          name: "mirror-0",
          type: "mirror",
          children: [leafFixture("K1", 1)],
        }),
      ]),
    );

    expect(card.find("[data-class-divider]").exists()).toBe(false);
  });
});
