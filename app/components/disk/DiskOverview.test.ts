// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { readBody } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveSpec } from "#shared/drive-spec";
import DiskOverview from "./DiskOverview.vue";
import type { DiskDetail, ReplacementCandidate } from "./types";

const at = "2026-09-01T12:00:00.000Z";

const redSpec: DriveSpec = {
  source: "nasdisks",
  snapshot: "2026-09-04",
  matchedModel: "WD80EFAX",
  model: "WD80EFAX",
  brand: "WD",
  line: "Red Plus",
  capacityTb: 8,
  rpm: 5400,
  cacheMb: 256,
  interface: "SATA",
  formFactor: "3.5",
  recordingTech: "cmr",
  ercTler: true,
  isHelium: true,
  driveClass: "NAS",
  mediaType: "hdd",
  inProduction: true,
  alsoSoldAs: [],
  nandType: null,
  tbwTb: null,
  dwpd: null,
  hasDram: null,
  hasPlp: null,
  sustainedWriteMbps: null,
  afrPct: 1.2,
  reliabilityDriveCount: 12345,
  reliabilitySource: "Backblaze thru Q2 2026 (merged WD80EFZZ)",
};

const baseDisk = {
  id: 7,
  alias: "K2",
  model: "WDC WD80EFAX-68LHPN0",
  serial: "VK0ABC",
  firmware: "83.H0A83",
  capacityBytes: 8_000_000_000_000,
  link: null,
  vendor: "western-digital",
  media: "hdd",
  interface: "sata",
  recordingTech: "cmr",
  rotationRate: 5400,
  sectorFormat: "512e",
  trimSupported: null,
  hardware: {
    sataVersion: "SATA 3.1",
    linkSpeed: { maxBps: 6_000_000_000, currentBps: 6_000_000_000 },
  },
  specs: redSpec,
  lastDevicePath: "/dev/sdb",
  present: true,
  firstSeenAt: at,
  lastSeenAt: at,
  hostName: "mars",
  lastSeenHostId: 2,
  latestStatus: "passed",
  latestReadingAt: at,
  latestTemp: 34,
  tempThresholds: { warning: 45, error: 55 },
  latestPowerOnHours: 40_000,
  latestPowerCycles: 120,
  notes: "",
  inventory: {},
  ageDays: null,
  warrantyDaysLeft: null,
  keys: [{ kind: "wwn", value: "0x50014ee2b5c1d2e3" }],
  formFactor: null,
  counters: {
    reallocated: { value: 0, status: "passed" },
    pending: { value: 16, status: "warning" },
    uncorrectable: null,
    wearPercent: { value: 3, status: "passed" },
    bytesWritten: null,
    bytesWrittenInferred: false,
  },
  faultCounts: { error: 0, warning: 0, acknowledged: 0 },
  replacesDiskId: null,
  modelShort: "Red Plus",
  usage: { kind: "empty", fsTypes: [], mounts: [], system: false },
  purpose: null,
  purposeInferred: false,
  membership: null,
};

const patched = vi.fn();
let response: Record<string, unknown> = {};

registerEndpoint("/api/settings", () => ({
  enrolToken: "x",
  config: { currency: "GBP" },
}));
registerEndpoint("/api/disks/7", {
  method: "PATCH",
  handler: async (event) => {
    patched(await readBody(event));
    return response;
  },
});

const bayPatched = vi.fn();
registerEndpoint("/api/hosts/3/bays", {
  method: "PATCH",
  handler: async (event) => {
    bayPatched(await readBody(event));
    return { enclosures: [], paths: [], orphans: [] };
  },
});
registerEndpoint("/api/disks/7", {
  method: "GET",
  handler: () => response,
});

beforeEach(() => {
  patched.mockReset();
  bayPatched.mockReset();
  response = {};
});

const asDisk = (overrides: Record<string, unknown> = {}) =>
  ({ ...baseDisk, ...overrides }) as unknown as DiskDetail;

const mountOverview = (
  overrides: Record<string, unknown> = {},
  disks: ReplacementCandidate[] = [],
) =>
  mountSuspended(DiskOverview, {
    props: { disk: asDisk(overrides), disks },
  });

const row = (wrapper: VueWrapper, label: string) => {
  const term = wrapper.findAll("dt").find((dt) => dt.text() === label);
  return term?.element.nextElementSibling?.textContent?.trim() ?? null;
};

const field = (wrapper: VueWrapper, key: string) =>
  wrapper.get(`[data-field="${key}"]`);

const emittedDisk = async (wrapper: VueWrapper) => {
  await vi.waitFor(() => expect(wrapper.emitted("updated")).toBeDefined());
  return wrapper.emitted("updated")?.[0]?.[0] as DiskDetail;
};

const pickChoice = async (wrapper: VueWrapper, key: string, label: string) => {
  await field(wrapper, key)
    .get('[data-testid="inline-display"]')
    .trigger("click");
  const select = wrapper
    .findAllComponents({ name: "USelect" })
    .find((candidate) =>
      field(wrapper, key).element.contains(candidate.element),
    );
  const items = select?.props("items") as { label: string; value: string }[];
  const item = items.find((candidate) => candidate.label === label);
  select?.vm.$emit("update:modelValue", item?.value);
  await flushPromises();
};

describe("DiskOverview", () => {
  it("renders the five groups and Notes", async () => {
    const wrapper = await mountOverview();
    for (const group of [
      "identity",
      "hardware",
      "placement",
      "health",
      "ownership",
    ]) {
      expect(wrapper.find(`[data-testid="group-${group}"]`).exists()).toBe(
        true,
      );
    }
    expect(wrapper.find('[data-testid="disk-notes"]').exists()).toBe(true);
  });

  it("shows identity, hardware, placement and health facts", async () => {
    const wrapper = await mountOverview();

    expect(row(wrapper, "Model")).toBe("WD WD80EFAX-68LHPN0");
    expect(row(wrapper, "Serial")).toBe("VK0ABC");
    expect(row(wrapper, "WWN")).toBe("0x50014ee2b5c1d2e3");
    expect(row(wrapper, "Media")).toBe("HDD · 5400 rpm · helium");
    expect(row(wrapper, "Recording")).toBe("CMR");
    expect(row(wrapper, "Interface")).toBe("SATA 3.1 · 6.0 Gb/s");
    expect(row(wrapper, "Sectors")).toBe("512e");
    expect(row(wrapper, "Host")).toBe("mars");
    expect(row(wrapper, "Usage")).toBe("empty");
    expect(row(wrapper, "SMART")).toContain("read 2026-09-01");
  });

  it("hides null rows and shows always-rows as —", async () => {
    const wrapper = await mountOverview({
      model: null,
      serial: null,
      firmware: null,
      keys: [],
      capacityBytes: null,
      interface: null,
      hostName: null,
      lastSeenHostId: null,
      lastDevicePath: null,
      latestTemp: null,
      latestPowerOnHours: null,
      latestPowerCycles: null,
      latestReadingAt: null,
      sectorFormat: null,
    });

    for (const label of [
      "Model",
      "Serial",
      "Capacity",
      "Interface",
      "Host",
      "Temperature",
    ]) {
      expect(row(wrapper, label)).toBe("—");
    }
    for (const label of [
      "WWN",
      "Firmware",
      "Form factor",
      "Sectors",
      "TRIM",
      "Device",
      "Pool",
      "Last reading",
      "Power-on",
      "Power cycles",
      "Uncorrectable",
      "Written",
      "Faults",
    ]) {
      expect(row(wrapper, label)).toBeNull();
    }
  });

  it("dims a last-known device path", async () => {
    const wrapper = await mountOverview({ present: false });
    const device = wrapper.get('[data-testid="fact-device"]');
    expect(device.classes()).toContain("text-dimmed");
    expect(device.attributes("title")).toBe("last known");
  });

  it("hides Wear on an HDD and Pending on an SSD", async () => {
    const hdd = await mountOverview();
    expect(hdd.find('[data-counter="pending"]').exists()).toBe(true);
    expect(hdd.find('[data-counter="wear"]').exists()).toBe(false);

    const ssd = await mountOverview({ media: "ssd", trimSupported: true });
    expect(ssd.find('[data-counter="pending"]').exists()).toBe(false);
    expect(ssd.find('[data-counter="wear"]').text()).toContain("3 %");
    expect(row(ssd, "TRIM")).toBe("yes");
    expect(row(ssd, "Recording")).toBeNull();
  });

  it("links counters to the SMART tab", async () => {
    const wrapper = await mountOverview();
    expect(
      wrapper.get('[data-counter="pending"] a').attributes("href"),
    ).toContain("?tab=smart");
  });

  it("shows fault badges only when there are faults", async () => {
    const wrapper = await mountOverview({
      faultCounts: { error: 1, warning: 0, acknowledged: 2 },
    });
    expect(wrapper.find('[data-testid="fact-faults"]').exists()).toBe(true);
  });

  describe("temperature", () => {
    const temperature = '[data-testid="overview-temperature"]';

    it("leaves a cool temperature in the default colour", async () => {
      const reading = (await mountOverview()).get(temperature);
      expect(reading.text()).toBe("34 °C");
      expect(reading.classes()).not.toContain("text-warning");
      expect(reading.classes()).not.toContain("text-error");
    });

    it.each([
      [48, "text-warning"],
      [57, "text-error"],
    ])("colours %i °C with %s", async (celsius, textClass) => {
      const reading = (await mountOverview({ latestTemp: celsius })).get(
        temperature,
      );
      expect(reading.classes()).toContain(textClass);
    });

    it("follows the disk's own thresholds", async () => {
      const reading = (
        await mountOverview({
          latestTemp: 50,
          tempThresholds: { warning: 60, error: 70 },
        })
      ).get(temperature);
      expect(reading.classes()).not.toContain("text-warning");
    });
  });

  describe("specs", () => {
    it("lists dataset rows in the Hardware group with the footer", async () => {
      const wrapper = await mountOverview();

      expect(row(wrapper, "Line")).toBe("WD Red Plus");
      expect(row(wrapper, "TLER/ERC")).toBe("Yes");
      expect(row(wrapper, "Helium")).toBeNull();
      expect(row(wrapper, "AFR")).toBe(
        "1.2 % · 12,345 drives · Backblaze thru Q2 2026",
      );
      expect(wrapper.get('[data-testid="specs-footer"]').text()).toBe(
        "Specs: nasdisks.com (CC BY 4.0) · Failure rates: Backblaze Drive Stats · snapshot 2026-09-04",
      );
    });

    it("says there is no match, naming the bare model", async () => {
      const wrapper = await mountOverview({ specs: null });

      expect(row(wrapper, "Specs")).toBe("none for WD80EFAX");
      expect(wrapper.find('[data-testid="specs-footer"]').exists()).toBe(false);
    });

    it("notes mismatches dimmed, not as faults", async () => {
      const wrapper = await mountOverview({
        hardware: {
          specMismatch: ["rotationRate: observed 7200, dataset 5400"],
        },
      });
      const note = wrapper.get('[data-testid="spec-mismatch"]');

      expect(note.text()).toBe(
        "Observed differs from dataset: rotationRate: observed 7200, dataset 5400",
      );
      expect(note.element.closest(".text-dimmed")).not.toBeNull();
      expect(note.element.closest(".text-error")).toBeNull();
    });

    it("has no mismatch note when the dataset agrees", async () => {
      const wrapper = await mountOverview({ hardware: { specMismatch: [] } });
      expect(wrapper.find('[data-testid="spec-mismatch"]').exists()).toBe(
        false,
      );
    });
  });

  it("shows the fallback display model dimmed with its source", async () => {
    const wrapper = await mountOverview();
    const fallback = wrapper.get('[data-testid="model-short-fallback"]');
    expect(fallback.text()).toBe("Red Plus");
    expect(fallback.attributes("title")).toBe("from spec line");
  });

  it("sends only purchaseDate and updates the age hint from the response", async () => {
    response = asDisk({
      inventory: { purchaseDate: "2020-01-01" },
      ageDays: 2100,
    });
    const wrapper = await mountOverview();
    const purchased = () => field(wrapper, "purchaseDate");

    await purchased().get('[data-testid="inline-display"]').trigger("click");
    await purchased().get("input").setValue("2020-01-01");
    await flushPromises();

    expect(patched).toHaveBeenCalledWith({
      inventory: { purchaseDate: "2020-01-01" },
    });
    const updated = await emittedDisk(wrapper);
    expect(updated.ageDays).toBe(2100);

    await wrapper.setProps({ disk: updated });
    expect(purchased().get('[data-testid="inline-hint"]').text()).toBe(
      "5.7 y old",
    );
  });

  describe("Bay", () => {
    const bay = {
      locationKey: "enc:5001:8",
      label: null,
      defaultLabel: "RES2SV240 slot 8",
    };

    it("is hidden without a known location", async () => {
      const wrapper = await mountOverview({ bay: null });
      expect(wrapper.find('[data-field="bay"]').exists()).toBe(false);
    });

    it("shows the default dimmed until labelled", async () => {
      const wrapper = await mountOverview({ bay, lastSeenHostId: 3 });
      expect(
        field(wrapper, "bay").get('[data-testid="bay-default"]').text(),
      ).toBe("RES2SV240 slot 8");
    });

    it("labels the place through the host's bays and reloads the disk", async () => {
      response = asDisk({ bay: { ...bay, label: "Bay 1" }, lastSeenHostId: 3 });
      const wrapper = await mountOverview({ bay, lastSeenHostId: 3 });
      const bayField = () => field(wrapper, "bay");

      await bayField().get('[data-testid="inline-display"]').trigger("click");
      await bayField().get("input").setValue("Bay 1");
      await bayField().get("input").trigger("keydown", { key: "Enter" });
      await flushPromises();

      expect(bayPatched).toHaveBeenCalledWith({ "enc:5001:8": "Bay 1" });
      expect(patched).not.toHaveBeenCalled();
      expect((await emittedDisk(wrapper)).bay?.label).toBe("Bay 1");
    });
  });

  it("shows price per TB", async () => {
    const wrapper = await mountOverview({ inventory: { purchasePrice: 190 } });
    await flushPromises();
    expect(
      field(wrapper, "purchasePrice").get('[data-testid="inline-hint"]').text(),
    ).toBe("£23.75/TB");
  });

  it.each([
    ["not taped", false],
    ["—", null],
  ])("3.3 V %s sends %s", async (label, value) => {
    const wrapper = await mountOverview({ inventory: { pin33Taped: true } });
    await pickChoice(wrapper, "pin33Taped", label);

    expect(patched).toHaveBeenCalledWith({ inventory: { pin33Taped: value } });
  });

  it("shows the 3.3 V pin only on shucked disks or once recorded", async () => {
    const pin = '[data-field="pin33Taped"]';
    expect((await mountOverview()).find(pin).exists()).toBe(false);
    expect(
      (await mountOverview({ inventory: { purchaseCondition: "new" } }))
        .find(pin)
        .exists(),
    ).toBe(false);
    expect(
      (await mountOverview({ inventory: { pin33Taped: false } }))
        .find(pin)
        .exists(),
    ).toBe(true);
  });

  it("shows the BPID on Seagate disks or once recorded", async () => {
    const bpid = '[data-field="seagateBpid"]';
    expect((await mountOverview()).find(bpid).exists()).toBe(false);
    expect(
      (await mountOverview({ vendor: "seagate" })).find(bpid).exists(),
    ).toBe(true);
    expect(
      (await mountOverview({ inventory: { seagateBpid: "1004526218" } }))
        .find(bpid)
        .exists(),
    ).toBe(true);
  });

  it("shows an unrecorded 3.3 V pin dimmed", async () => {
    const wrapper = await mountOverview({
      inventory: { purchaseCondition: "shucked" },
    });
    const display = field(wrapper, "pin33Taped").get(
      '[data-testid="inline-display"] span',
    );
    expect(display.text()).toBe("not recorded");
    expect(display.classes()).toContain("text-dimmed");
  });

  it("colours warranty left and expired", async () => {
    const soon = await mountOverview({
      inventory: { warrantyExpiry: "2026-11-01" },
      warrantyDaysLeft: 30,
    });
    const left = soon.get('[data-testid="warranty-left"]');
    expect(left.text()).toBe("30 d left");
    expect(left.classes()).toContain("text-warning");

    const expired = await mountOverview({
      inventory: { warrantyExpiry: "2022-01-01" },
      warrantyDaysLeft: -1650,
    });
    expect(expired.get('[data-testid="warranty-left"]').text()).toBe(
      "expired 4.5 y ago",
    );
  });

  it("applies the warranty suggestion", async () => {
    const wrapper = await mountOverview({
      inventory: { purchaseDate: "2021-01-10", purchaseCondition: "new" },
    });
    const suggestion = wrapper.get('[data-testid="warranty-suggestion"]');
    expect(suggestion.text()).toContain("3 y from purchase → 2024-01-10");

    await suggestion.get("button").trigger("click");
    await flushPromises();
    expect(patched).toHaveBeenCalledWith({
      inventory: { warrantyExpiry: "2024-01-10" },
    });
  });

  it("asks where an absent disk is stored, suggesting places in use", async () => {
    const storage = '[data-field="storageLocation"]';
    expect((await mountOverview()).find(storage).exists()).toBe(false);

    const shelved: ReplacementCandidate = {
      id: 5,
      alias: "K1",
      serial: "OLD",
      hostName: null,
      purpose: null,
      disposal: null,
      replacedByDiskId: null,
      inventory: { storageLocation: "drawer" },
    };
    const wrapper = await mountOverview(
      { present: false, inventory: { storageLocation: "offsite" } },
      [shelved],
    );
    expect(row(wrapper, "Stored at")).toContain("offsite");

    await wrapper
      .get(`${storage} [data-testid="inline-display"]`)
      .trigger("click");
    expect(
      wrapper
        .findAll(`${storage} datalist option`)
        .map((option) => option.attributes("value")),
    ).toEqual(["drawer"]);
  });

  it("shows tags as chips", async () => {
    const wrapper = await mountOverview({
      inventory: { tags: ["spare", "offsite"] },
    });
    expect(
      wrapper.findAll('[data-field="tags"] [data-testid="inline-tags"] span')
        .length,
    ).toBeGreaterThan(0);
    expect(wrapper.get('[data-field="tags"]').text()).toContain("spare");
    expect(wrapper.get('[data-field="tags"]').text()).toContain("offsite");
  });

  it("copies the warranty from the replaced disk", async () => {
    const replaced: ReplacementCandidate = {
      id: 5,
      alias: "K1",
      serial: "OLD",
      hostName: null,
      purpose: null,
      disposal: { kind: "rma", on: "2026-08-01" },
      replacedByDiskId: 7,
      inventory: { warrantyExpiry: "2027-03-01" },
    };
    const wrapper = await mountOverview({ replacesDiskId: 5, specs: null }, [
      replaced,
    ]);
    expect(row(wrapper, "Replaces")).toContain("K1");

    const copy = wrapper.get('[data-testid="warranty-copy"]');
    expect(copy.text()).toBe("Copy from K1");
    await copy.trigger("click");
    await flushPromises();
    expect(patched).toHaveBeenCalledWith({
      inventory: { warrantyExpiry: "2027-03-01" },
    });
  });

  it("hides Replaces with no candidates", async () => {
    const wrapper = await mountOverview();
    expect(row(wrapper, "Replaces")).toBeNull();
  });

  describe("notes", () => {
    it("says there are no notes, and saves edited notes", async () => {
      response = asDisk({ notes: "Shucked from a **My Book**" });
      const wrapper = await mountOverview();
      const notes = () => wrapper.get('[data-testid="disk-notes"]');
      expect(notes().text()).toContain("No notes");

      await notes().get('[data-testid="notes-edit"]').trigger("click");
      await notes().get("textarea").setValue("Shucked from a **My Book**");
      await notes().get("form").trigger("submit");
      await flushPromises();

      expect(patched).toHaveBeenCalledWith({
        notes: "Shucked from a **My Book**",
      });
      await wrapper.setProps({ disk: await emittedDisk(wrapper) });
      expect(notes().find("textarea").exists()).toBe(false);
      expect(notes().get("strong").text()).toBe("My Book");
    });

    it("cancels without saving", async () => {
      const wrapper = await mountOverview({ notes: "old" });
      await wrapper.get('[data-testid="notes-edit"]').trigger("click");
      await wrapper.get("textarea").setValue("new");
      await wrapper.get('[data-testid="notes-cancel"]').trigger("click");

      expect(patched).not.toHaveBeenCalled();
      expect(wrapper.get('[data-testid="disk-notes"]').text()).toContain("old");
    });
  });
});
