import { describe, expect, it } from "vitest";
import { worstStatus } from "./status";

describe("worstStatus", () => {
  it("is unknown with nothing to compare", () => {
    expect(worstStatus()).toBe("unknown");
  });

  it("ranks failed over warning over passed over unknown", () => {
    expect(worstStatus("passed", "unknown")).toBe("passed");
    expect(worstStatus("passed", "warning", "unknown")).toBe("warning");
    expect(worstStatus("warning", "failed", "passed")).toBe("failed");
    expect(worstStatus("unknown", "unknown")).toBe("unknown");
  });
});
