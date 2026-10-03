import { describe, expect, it } from "vitest";
import { fetchErrorMessage } from "./fetchErrorMessage";

describe("fetchErrorMessage", () => {
  it("prefers the body's message, then the status message", () => {
    expect(
      fetchErrorMessage({
        statusMessage: "Conflict",
        data: { message: "K2 is still attached to mars" },
      }),
    ).toBe("K2 is still attached to mars");
    expect(fetchErrorMessage({ statusMessage: "Conflict" })).toBe("Conflict");
    expect(fetchErrorMessage(new Error("x"))).toBeUndefined();
    expect(fetchErrorMessage(null)).toBeUndefined();
  });
});
