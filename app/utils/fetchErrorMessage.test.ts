import { describe, expect, it } from "vitest";
import { fetchErrorMessage, isNetworkFailure } from "./fetchErrorMessage";

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

  it("reads the messages out of a validation error", () => {
    const issues = [
      {
        path: ["alias"],
        message: "Alias may only contain letters, digits, . _ -",
      },
    ];
    expect(
      fetchErrorMessage({
        statusMessage: "Validation Error",
        data: {
          statusMessage: "Validation Error",
          message: JSON.stringify(issues),
          data: { name: "ZodError", message: JSON.stringify(issues) },
        },
      }),
    ).toBe("Alias may only contain letters, digits, . _ -");
  });
});

describe("isNetworkFailure", () => {
  it("is true only when no response came back", () => {
    expect(isNetworkFailure({ response: undefined })).toBe(true);
    expect(isNetworkFailure({ response: { status: 400 } })).toBe(false);
  });
});
