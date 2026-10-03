import { describe, expect, it } from "vitest";
import { localToday, seenSinceDisposal } from "./disposal";

describe("localToday", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(localToday(new Date(2026, 9, 3, 0, 30))).toBe("2026-10-03");
    expect(localToday(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
  });
});

describe("seenSinceDisposal", () => {
  const entry = (eventType: string, at: string) => ({ eventType, at });

  it("finds a sighting newer than the latest disposal", () => {
    const seen = entry("disposed-disk-seen", "2026-10-03T10:00:00Z");
    expect(
      seenSinceDisposal([seen, entry("disposed", "2026-10-02T09:00:00Z")]),
    ).toBe(seen);
  });

  it("clears once the disposal is re-confirmed", () => {
    expect(
      seenSinceDisposal([
        entry("disposed", "2026-10-04T09:00:00Z"),
        entry("disposed-disk-seen", "2026-10-03T10:00:00Z"),
        entry("disposed", "2026-10-02T09:00:00Z"),
      ]),
    ).toBeNull();
  });

  it("has nothing to say without a sighting", () => {
    expect(
      seenSinceDisposal([entry("disposed", "2026-10-02T09:00:00Z")]),
    ).toBeNull();
  });
});
