// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImportPage from "./import.vue";

registerEndpoint("/api/import/obsidian", {
  method: "POST",
  handler: () => ({
    dryRun: true,
    columns: {},
    ignoredColumns: ["Age"],
    matched: [
      {
        row: 1,
        diskId: 4,
        alias: "K2",
        serial: "1AQLP5ME",
        changes: ["purchaseDate"],
        warnings: [],
      },
    ],
    created: [
      {
        row: 2,
        diskId: 9,
        alias: "H1",
        serial: "WD-1",
        changes: [],
        warnings: ['Price "free" not read'],
      },
    ],
    skipped: [{ row: 3, reason: "no serial or alias" }],
  }),
});

const TABLE =
  "| Name | Serial Number | Bought | Age |\n|---|---|---|---|\n| K2 | 1AQLP5ME | 2022-03-01 | 4 |";

describe("import settings page", () => {
  it("shows the detected columns as the table is pasted", async () => {
    const page = await mountSuspended(ImportPage);
    await page.get("textarea").setValue(TABLE);

    const columns = page.get('[data-testid="detected-columns"]').text();
    expect(columns).toContain("Alias ← Name");
    expect(columns).toContain("Serial ← Serial Number");
    expect(columns).toContain("Purchased ← Bought");
    expect(columns).not.toContain("Age");
  });

  it("previews matched, created and skipped rows", async () => {
    const page = await mountSuspended(ImportPage);
    await page.get("textarea").setValue(TABLE);
    const preview = page
      .findAll("button")
      .find((button) => button.text() === "Preview");
    await preview?.trigger("click");
    await flushPromises();

    const result = page.get('[data-testid="import-result"]').text();
    expect(result).toContain("Will update");
    expect(result).toContain("purchaseDate");
    expect(result).toContain('Price "free" not read');
    expect(result).toContain("no serial or alias");
    expect(result).toContain("Ignored columns: Age");
  });
});
