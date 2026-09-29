import { describe, expect, it } from "vitest";
import { DISK_STATES, STATE_OVERRIDES } from "#shared/disk";
import { LIFECYCLE_VOCABULARY } from "./lifecycle";

describe("LIFECYCLE_VOCABULARY", () => {
  it.each([...DISK_STATES, ...STATE_OVERRIDES])(
    "has an entry for %s",
    (state) => {
      expect(LIFECYCLE_VOCABULARY[state].icon).toMatch(/^i-lucide-/);
      expect(LIFECYCLE_VOCABULARY[state].label).not.toBe("");
    },
  );

  it("keeps dead neutral: history, not a problem", () => {
    expect(LIFECYCLE_VOCABULARY.dead.colour).toBe("neutral");
  });

  it("keeps missing as the only red state", () => {
    const red = Object.entries(LIFECYCLE_VOCABULARY)
      .filter(([, { colour }]) => colour === "error")
      .map(([state]) => state);
    expect(red).toEqual(["missing"]);
  });
});
