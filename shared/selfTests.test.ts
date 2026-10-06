import { describe, expect, it } from "vitest";
import { selfTestOutcome, selfTestResultLabel } from "./selfTests";

describe("selfTestOutcome", () => {
  it.each([
    ["Completed without error", true, "passed"],
    ["Completed", true, "passed"],
    ["Completed: read failure", false, "failed"],
    ["Completed: electrical failure", false, "failed"],
    ["Completed: servo/seek failure", false, "failed"],
    ["Completed: unknown failure", false, "failed"],
    ["Completed: handling damage??", false, "failed"],
    ["Completed: failed segments", false, "failed"],
    ["Fatal or unknown error", false, "failed"],
    ["Aborted by host", false, "inconclusive"],
    ["Interrupted (host reset)", false, "inconclusive"],
    ["Self-test routine in progress", false, "inconclusive"],
    ["Aborted: Controller Reset", false, "inconclusive"],
    ["Aborted by host", true, "inconclusive"],
    ["Something new", true, "passed"],
    ["Something new", false, "failed"],
  ])("classifies %s (passed %s)", (status, passed, outcome) => {
    expect(selfTestOutcome({ status, passed })).toBe(outcome);
  });
});

describe("selfTestResultLabel", () => {
  it.each([
    ["Completed without error", true, "passed"],
    ["Completed: read failure", false, "failed"],
    ["Aborted by host", true, "aborted"],
    ["Interrupted (host reset)", true, "interrupted"],
    ["Self-test routine in progress", true, "in progress"],
  ])("labels %s", (status, passed, label) => {
    expect(selfTestResultLabel({ status, passed })).toBe(label);
  });
});
