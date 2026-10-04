// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import AddHostPage from "./add.vue";

registerEndpoint("/api/hosts", () => []);
registerEndpoint("/api/settings", () => ({ enrolToken: "ab".repeat(32) }));

describe("add host page", () => {
  it("shows the install command with the enrol token", async () => {
    const page = await mountSuspended(AddHostPage);

    const commands = page
      .findAll('[data-testid="command"]')
      .map((command) => command.text());
    expect(commands[0]).toContain("/host/install.sh");
    expect(commands[0]).toContain("ab".repeat(32));
    expect(commands[1]).toContain("journalctl");
  });

  it("explains the install options", async () => {
    const page = await mountSuspended(AddHostPage);

    expect(page.text()).toContain("--host <name>");
    expect(page.text()).toContain("--no-collect");
  });
});
