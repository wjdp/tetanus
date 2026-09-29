import { describe, expect, it } from "vitest";
import {
  attributeTrendColour,
  deviceStatusColour,
  diskStateColour,
  zfsStateColour,
} from "./statusColour";

describe("statusColour", () => {
  it("keeps SMART passed quiet in the legacy wrapper", () => {
    expect(deviceStatusColour("passed")).toBe("neutral");
    expect(deviceStatusColour("warning")).toBe("warning");
    expect(deviceStatusColour("failed")).toBe("error");
    expect(deviceStatusColour("unknown")).toBe("neutral");
  });

  it("colours dead neutral and missing error", () => {
    expect(diskStateColour("dead")).toBe("neutral");
    expect(diskStateColour("missing")).toBe("error");
    expect(diskStateColour(null)).toBe("neutral");
  });

  it("colours ONLINE success", () => {
    expect(zfsStateColour("ONLINE")).toBe("success");
  });

  it("colours trends", () => {
    expect(attributeTrendColour("worsening")).toBe("warning");
    expect(attributeTrendColour("improving")).toBe("success");
    expect(attributeTrendColour("new")).toBe("neutral");
  });
});
