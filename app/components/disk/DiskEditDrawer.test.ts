// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import type { VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_DISK_FAULTS } from "#shared/faults";
import { NO_COUNTERS } from "#shared/smart/counters";
import DiskEditDrawer from "./DiskEditDrawer.vue";

const baseDisk = {
  id: 7,
  alias: "K7",
  model: "ST8000VN004",
  serial: "ZA100007",
  capacityBytes: 8e12,
  hostName: "mars",
  lastSeenHostId: null,
  present: true,
  bay: null,
  specs: null,
  vendor: "seagate",
  detectedVendor: "seagate",
  media: "hdd",
  recordingTech: "cmr",
  hardware: null,
  modelShort: null,
  inventory: {},
  notes: "",
  usage: { kind: "empty", fsTypes: [], mounts: [], system: false },
  purpose: null,
  purposeInferred: false,
  disposal: null,
  replacesDiskId: null,
  replacedByDiskId: null,
  warrantyDaysLeft: null,
  ageDays: null,
  counters: NO_COUNTERS,
  faultCounts: NO_DISK_FAULTS,
};

let detail: Record<string, unknown> = baseDisk;
registerEndpoint("/api/disks/7", () => detail);
registerEndpoint("/api/settings", () => ({
  enrolToken: "x",
  config: { currency: "GBP" },
}));

let mounted: VueWrapper | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const openDrawer = async (overrides: Record<string, unknown>) => {
  detail = { ...baseDisk, ...overrides };
  mounted = await mountSuspended(DiskEditDrawer, {
    props: { diskId: 7, order: [7] },
    attachTo: document.body,
  });
  await vi.waitFor(() => expect(shownFields()).toContain("supplier"), {
    timeout: 5000,
  });
};

const shownFields = () =>
  [
    ...document.body.querySelectorAll<HTMLElement>(
      '[role="dialog"] [data-field]',
    ),
  ].map((element) => element.dataset.field);

describe("DiskEditDrawer", () => {
  it("shows BPID and recording for a Seagate HDD", async () => {
    await openDrawer({});

    expect(shownFields()).toEqual(
      expect.arrayContaining([
        "alias",
        "seagateBpid",
        "recordingTech",
        "purpose",
      ]),
    );
    expect(shownFields()).not.toContain("storageLocation");
  });

  it("hides BPID and recording for a non-Seagate SSD, and offers Stored at when unplugged", async () => {
    await openDrawer({
      vendor: "samsung",
      detectedVendor: "samsung",
      media: "ssd",
      present: false,
    });

    expect(shownFields()).not.toContain("seagateBpid");
    expect(shownFields()).not.toContain("recordingTech");
    expect(shownFields()).toContain("storageLocation");
  });
});
