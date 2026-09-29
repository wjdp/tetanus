// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import InstallCommand from "./InstallCommand.vue";

describe("InstallCommand", () => {
  it("renders the server url and enrol token", async () => {
    const component = await mountSuspended(InstallCommand, {
      props: { url: "https://tetanus.example", token: "ab".repeat(32) },
    });

    const text = component.get('[data-testid="command"]').text();
    expect(text).toContain(
      "curl -fsSL https://tetanus.example/host/install.sh",
    );
    expect(text).toContain("--url https://tetanus.example");
    expect(text).toContain("ab".repeat(32));
  });
});
