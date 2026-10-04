import { describe, expect, it } from "vitest";
import { DISPOSAL_KINDS } from "#shared/disk";
import { DISPOSAL_VOCABULARY, disposalLabel } from "./disposal";

describe("DISPOSAL_VOCABULARY", () => {
  it.each(DISPOSAL_KINDS)("has a neutral entry for %s", (kind) => {
    expect(DISPOSAL_VOCABULARY[kind].icon).toMatch(/^i-lucide-/);
    expect(DISPOSAL_VOCABULARY[kind].label).not.toBe("");
    expect(DISPOSAL_VOCABULARY[kind].colour).toBe("neutral");
  });
});

describe("disposalLabel", () => {
  const unreplaced = { replacedByDiskId: null };

  it("uses the kind's label outside RMA", () => {
    expect(disposalLabel({ kind: "given-away" }, unreplaced)).toBe(
      "Given away",
    );
  });

  it("says an RMA is awaiting its replacement", () => {
    expect(disposalLabel({ kind: "rma" }, unreplaced)).toBe(
      "RMA · awaiting replacement",
    );
  });

  it("names the replacement once linked", () => {
    expect(
      disposalLabel(
        { kind: "rma" },
        { replacedByDiskId: 9, replacedByLabel: "K7" },
      ),
    ).toBe("RMA · replaced by K7");
    expect(disposalLabel({ kind: "rma" }, { replacedByDiskId: 9 })).toBe(
      "RMA · replaced by another disk",
    );
  });
});
