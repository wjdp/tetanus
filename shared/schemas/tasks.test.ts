import { describe, expect, it } from "vitest";
import { runTaskBodySchema } from "./tasks";

describe("runTaskBodySchema", () => {
  it("accepts a task name without a payload", () => {
    expect(runTaskBodySchema.parse({ taskName: "noop" })).toEqual({
      taskName: "noop",
    });
  });

  it("accepts a flat payload", () => {
    expect(
      runTaskBodySchema.parse({ taskName: "noop", payload: { source: "x" } }),
    ).toEqual({ taskName: "noop", payload: { source: "x" } });
  });

  it("rejects an unknown task", () => {
    expect(() => runTaskBodySchema.parse({ taskName: "format-c" })).toThrow();
  });

  it("rejects a nested payload", () => {
    expect(() =>
      runTaskBodySchema.parse({ taskName: "noop", payload: { a: { b: 1 } } }),
    ).toThrow();
  });
});
