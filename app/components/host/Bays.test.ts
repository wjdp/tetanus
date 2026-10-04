import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { readBody } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostBays as HostBaysData } from "#shared/bays";
import HostBays from "./Bays.vue";

const slot = (slotNumber: number, overrides = {}) => ({
  locationKey: `enc:5001:${slotNumber}`,
  label: null,
  defaultLabel: `RES2SV240 slot ${slotNumber}`,
  slot: slotNumber,
  element: `ArrayDevice0${slotNumber}`,
  status: "OK",
  fault: false,
  disk: null,
  ...overrides,
});

const bays = (): HostBaysData => ({
  enclosures: [
    {
      enclosureId: "5001",
      name: "8:0:0:0",
      vendor: "Intel",
      model: "RES2SV240",
      slots: [
        slot(7, { status: "not installed" }),
        slot(8, {
          label: "Bay 1",
          disk: { id: 1, label: "K1", present: true },
        }),
        slot(9, {
          fault: true,
          disk: { id: 2, label: "ST18000NM ZR1", present: false },
        }),
      ],
    },
  ],
  paths: [
    {
      locationKey: "path:pci-0000:06:00.1-ata-5",
      label: null,
      defaultLabel: "SATA port 5",
      disk: { id: 3, label: "Z3", present: true },
    },
  ],
  orphans: [
    {
      locationKey: "path:pci-0000:99:00.0-ata-1",
      label: "Old card",
      defaultLabel: "SATA port 1",
    },
  ],
});

const patched = vi.fn();
let current = bays();
registerEndpoint("/api/hosts/4/bays", () => current);
registerEndpoint("/api/hosts/4/bays", {
  method: "PATCH",
  handler: async (event) => {
    const body = await readBody(event);
    patched(body);
    current.enclosures[0].slots[0].label = body["enc:5001:7"];
    return current;
  },
});

beforeEach(() => {
  patched.mockReset();
  current = bays();
});

const mountBays = async () => {
  const wrapper = await mountSuspended(HostBays, { props: { hostId: 4 } });
  await flushPromises();
  return wrapper;
};

describe("HostBays", () => {
  it("lists every slot of each enclosure with its disk and SES status", async () => {
    const wrapper = await mountBays();
    const enclosure = wrapper.get('[data-testid="bay-enclosure"]');
    expect(enclosure.text()).toContain("Intel RES2SV240");
    const rows = enclosure.findAll("tbody tr").map((row) => row.text());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("RES2SV240 slot 7");
    expect(rows[0]).toContain("not installed");
    expect(rows[1]).toContain("Bay 1");
    expect(rows[1]).toContain("K1");
    expect(rows[2]).toContain("ST18000NM ZR1");
    expect(rows[2]).toContain("fault");
  });

  it("lists path locations and orphaned labels", async () => {
    const wrapper = await mountBays();
    const text = wrapper.get('[data-testid="bay-paths"]').text();
    expect(text).toContain("SATA port 5");
    expect(text).toContain("Z3");
    expect(text).toContain("Old card");
  });

  it("labels a bay", async () => {
    const wrapper = await mountBays();
    const field = () => wrapper.get('[data-location="enc:5001:7"]');
    await field().get('[data-testid="inline-display"]').trigger("click");
    await field().get("input").setValue("Spare");
    await field().get("input").trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(patched).toHaveBeenCalledWith({ "enc:5001:7": "Spare" });
    await vi.waitFor(() => expect(field().text()).toContain("Spare"));
  });

  it("explains an empty host", async () => {
    current = { enclosures: [], paths: [], orphans: [] };
    const wrapper = await mountBays();
    expect(wrapper.text()).toContain("No locations reported yet");
  });
});
