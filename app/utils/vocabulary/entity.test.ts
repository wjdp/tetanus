import { describe, expect, it } from "vitest";
import { ENTITIES, ENTITY_ICON } from "./entity";

describe("ENTITY_ICON", () => {
  it.each(ENTITIES)("has a lucide icon for %s", (entity) => {
    expect(ENTITY_ICON[entity]).toMatch(/^i-lucide-/);
  });

  it("uses the siren for faults", () => {
    expect(ENTITY_ICON.fault).toBe("i-lucide-siren");
  });
});
