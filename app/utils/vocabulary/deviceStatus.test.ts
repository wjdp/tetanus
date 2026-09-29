import { describe, expect, it } from "vitest";
import { DEVICE_STATUSES } from "#shared/smart/status";
import { DEVICE_STATUS_VOCABULARY } from "./deviceStatus";

describe("DEVICE_STATUS_VOCABULARY", () => {
  it.each(DEVICE_STATUSES)("has an entry for %s", (status) => {
    expect(DEVICE_STATUS_VOCABULARY[status].label).toBe(`SMART ${status}`);
  });

  it("gives passed the one green dot", () => {
    expect(DEVICE_STATUS_VOCABULARY.passed).toMatchObject({
      colour: "success",
      shape: "filled",
    });
  });

  it("draws unknown as a hollow neutral ring", () => {
    expect(DEVICE_STATUS_VOCABULARY.unknown).toMatchObject({
      colour: "neutral",
      shape: "hollow",
    });
  });
});
