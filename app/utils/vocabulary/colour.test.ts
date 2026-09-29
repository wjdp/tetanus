import { describe, expect, it } from "vitest";
import { worstColour } from "./colour";

describe("worstColour", () => {
  it("is neutral with nothing to compare", () => {
    expect(worstColour()).toBe("neutral");
  });

  it("orders neutral < success < info < warning < error", () => {
    expect(worstColour("success", "neutral")).toBe("success");
    expect(worstColour("success", "info")).toBe("info");
    expect(worstColour("warning", "info")).toBe("warning");
    expect(worstColour("warning", "error", "success")).toBe("error");
  });
});
