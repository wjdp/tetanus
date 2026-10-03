import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diskPatchSchema } from "./disks";

describe("diskPatchSchema disposal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-02T23:30:00Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a sold disposal with a price", () => {
    const disposal = { kind: "sold", on: "2026-10-01", salePrice: 40 };
    expect(diskPatchSchema.parse({ disposal })).toEqual({ disposal });
  });

  it("accepts null to clear a disposal", () => {
    expect(diskPatchSchema.parse({ disposal: null })).toEqual({
      disposal: null,
    });
  });

  it("rejects a sale price on a disposal that is not sold", () => {
    expect(
      diskPatchSchema.safeParse({
        disposal: { kind: "rma", on: "2026-10-01", salePrice: 40 },
      }).success,
    ).toBe(false);
  });

  it.each([0, -5])("rejects a sale price of %d", (salePrice) => {
    expect(
      diskPatchSchema.safeParse({
        disposal: { kind: "sold", on: "2026-10-01", salePrice },
      }).success,
    ).toBe(false);
  });

  it("accepts a date up to UTC tomorrow, for clocks ahead of UTC", () => {
    expect(
      diskPatchSchema.safeParse({
        disposal: { kind: "recycled", on: "2026-10-03" },
      }).success,
    ).toBe(true);
  });

  it("rejects a date beyond UTC tomorrow", () => {
    expect(
      diskPatchSchema.safeParse({
        disposal: { kind: "recycled", on: "2026-10-04" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(
      diskPatchSchema.safeParse({
        disposal: { kind: "lost", on: "2026-10-01" },
      }).success,
    ).toBe(false);
  });
});

describe("diskPatchSchema replacesDiskId", () => {
  it("accepts a disk id or null", () => {
    expect(diskPatchSchema.parse({ replacesDiskId: 3 })).toEqual({
      replacesDiskId: 3,
    });
    expect(diskPatchSchema.parse({ replacesDiskId: null })).toEqual({
      replacesDiskId: null,
    });
  });

  it("rejects a non-positive id", () => {
    expect(diskPatchSchema.safeParse({ replacesDiskId: 0 }).success).toBe(
      false,
    );
  });
});
