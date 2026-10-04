import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { parse } from "./enclosure";
import { ParseError } from "./parseError";

describe("enclosure parser", () => {
  it("reads the mars expander's slots and attached disks", () => {
    const { data, summary } = parse(readFixture("mars/enclosure.txt"), {});

    expect(data.enclosures).toHaveLength(1);
    const [enclosure] = data.enclosures;
    expect(enclosure).toMatchObject({
      name: "8:0:0:0",
      vendor: "Intel",
      model: "RES2SV240",
      components: 24,
    });
    expect(enclosure?.id).toMatch(/^5[0-9a-f]{15}$/);
    expect(enclosure?.slots).toHaveLength(24);
    expect(enclosure?.slots[0]).toEqual({
      element: "ArrayDevice00",
      slot: 0,
      status: "not installed",
      locate: false,
      fault: false,
      device: null,
      devnum: null,
    });
    expect(enclosure?.slots[8]).toMatchObject({
      element: "ArrayDevice08",
      slot: 8,
      status: "OK",
      device: "sda",
      devnum: "8:0",
    });
    expect(summary).toEqual({ enclosures: 1, slots: 24, occupied: 15 });
  });

  it("keeps element names with spaces and ignores elements without a slot", () => {
    const body = [
      "1:0:0:0/id\t0x5000000000000001",
      "1:0:0:0/Slot 01/slot\t1",
      "1:0:0:0/Slot 01/locate\t1",
      "1:0:0:0/Slot 01/device/block/sdx/dev\t65:112",
      "1:0:0:0/Fan 1/status\tOK",
    ].join("\n");
    const { data } = parse(body, {});
    expect(data.enclosures[0]?.id).toBe("5000000000000001");
    expect(data.enclosures[0]?.slots).toEqual([
      {
        element: "Slot 01",
        slot: 1,
        status: null,
        locate: true,
        fault: null,
        device: "sdx",
        devnum: "65:112",
      },
    ]);
  });

  it("reads an empty body as no enclosures", () => {
    expect(parse("", {})).toEqual({
      data: { enclosures: [] },
      summary: { enclosures: 0, slots: 0, occupied: 0 },
    });
  });

  it("rejects lines that are not <enclosure>/<file>\\t<value>", () => {
    expect(() => parse("8:0:0:0/id 0x5", {})).toThrow(ParseError);
    expect(() => parse("id\t0x5", {})).toThrow(ParseError);
  });
});
