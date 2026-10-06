// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { clearCookie, writeCookie } from "~~/test/cookies";
import { DATASET_COLUMNS_COOKIE, useDatasetColumns } from "./useDatasetColumns";

const mountColumns = async () => {
  let columns!: ReturnType<typeof useDatasetColumns>;
  await mountSuspended(
    defineComponent({
      setup() {
        columns = useDatasetColumns();
        return () => h("div");
      },
    }),
  );
  return columns;
};

const visibleIds = (columns: ReturnType<typeof useDatasetColumns>) =>
  columns.visibleColumns.value.map(({ id }) => id);

beforeEach(() => {
  clearCookie(DATASET_COLUMNS_COOKIE);
});

describe("useDatasetColumns", () => {
  it("shows the default columns in table order", async () => {
    expect(visibleIds(await mountColumns())).toEqual([
      "name",
      "used",
      "growth",
      "compression",
      "limits",
      "snapshots",
      "replication",
    ]);
  });

  it("shows and hides columns, storing only departures from the default", async () => {
    const columns = await mountColumns();
    columns.setColumnVisible("referenced", true);
    columns.setColumnVisible("growth", false);
    await nextTick();

    expect(visibleIds(columns)).toContain("referenced");
    expect(visibleIds(columns)).not.toContain("growth");
    expect(columns.isCustomised.value).toBe(true);

    columns.setColumnVisible("growth", true);
    columns.resetColumns();
    await nextTick();
    expect(columns.isCustomised.value).toBe(false);
    expect(visibleIds(columns)).not.toContain("referenced");
  });

  it("never hides the name and ignores unknown stored columns", async () => {
    writeCookie(
      DATASET_COLUMNS_COOKIE,
      JSON.stringify({ name: false, bogus: true }),
    );
    const columns = await mountColumns();
    columns.setColumnVisible("name", false);
    await nextTick();

    expect(visibleIds(columns)).toContain("name");
    expect(columns.isCustomised.value).toBe(false);
  });
});
