import { describe, expect, it } from "vitest";
import { describeDisk, UNIDENTIFIED_DISK } from "./disk";

describe("describeDisk", () => {
  it("prefers the alias", () => {
    expect(
      describeDisk({ alias: "K1", model: "ST18000NM", serial: "ZR1" }),
    ).toBe("K1");
  });

  it("falls back to model and serial", () => {
    expect(
      describeDisk({ alias: null, model: "ST18000NM", serial: "ZR1" }),
    ).toBe("ST18000NM ZR1");
    expect(describeDisk({ serial: "ZR1" })).toBe("ZR1");
  });

  it("never falls back to an id", () => {
    expect(describeDisk({})).toBe(UNIDENTIFIED_DISK);
  });
});
