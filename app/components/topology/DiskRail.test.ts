// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { afterEach, describe, expect, it } from "vitest";
import DiskRail from "./DiskRail.vue";
import { railGroups } from "./groupDisks";
import { diskFixture } from "./testFixtures";

const disks = [
  { ...diskFixture(1, { state: "missing", alias: "LOST" }), hostName: "mars" },
  { ...diskFixture(2, { state: "sold", alias: "GONE" }), hostName: null },
  { ...diskFixture(3, { state: "dead", alias: "DEAD" }), hostName: null },
];

const mountRail = () =>
  mountSuspended(DiskRail, {
    props: { groups: railGroups(disks, new Set()) },
  });

type Rail = Awaited<ReturnType<typeof mountRail>>;

const listShown = (rail: Rail, group: string) =>
  rail.get(`[data-group="${group}"] ul`).attributes("style") !==
  "display: none;";

afterEach(() => localStorage.clear());

describe("TopologyDiskRail", () => {
  it("keeps History closed by default", async () => {
    const rail = await mountRail();

    expect(rail.get('[data-testid="history-toggle"]').text()).toContain(
      "History",
    );
    expect(rail.get('[data-testid="history-toggle"]').text()).toContain("2");
    expect(listShown(rail, "history")).toBe(false);
    expect(listShown(rail, "missing")).toBe(true);
  });

  it("opens History on toggle and remembers it", async () => {
    const rail = await mountRail();

    await rail.get('[data-testid="history-toggle"]').trigger("click");

    expect(listShown(rail, "history")).toBe(true);
    expect(localStorage.getItem("topology.historyOpen")).toBe("true");

    const reopened = await mountRail();
    expect(listShown(reopened, "history")).toBe(true);

    await reopened.get('[data-testid="history-toggle"]').trigger("click");
    expect(localStorage.getItem("topology.historyOpen")).toBe("false");
  });

  it("says every disk is attached when nothing is left", async () => {
    const rail = await mountSuspended(DiskRail, { props: { groups: [] } });

    expect(rail.text()).toBe("Every known disk is attached to a host.");
  });
});
