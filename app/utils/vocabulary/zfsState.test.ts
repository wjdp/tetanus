import { describe, expect, it } from "vitest";
import { zfsStateColour } from "./zfsState";

describe("zfsStateColour", () => {
  it.each([
    ["ONLINE", "success"],
    ["AVAIL", "success"],
    ["INUSE", "success"],
    ["DEGRADED", "warning"],
    ["OFFLINE", "warning"],
    ["REMOVED", "warning"],
    ["FAULTED", "error"],
    ["UNAVAIL", "error"],
    ["SUSPENDED", "error"],
    ["SOMETHING_NEW", "warning"],
    ["constructor", "warning"],
  ])("colours %s as %s", (state, colour) => {
    expect(zfsStateColour(state)).toBe(colour);
  });
});
