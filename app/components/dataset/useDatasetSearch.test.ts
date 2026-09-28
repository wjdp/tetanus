// @vitest-environment nuxt
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { getQuery } from "h3";
import { describe, expect, it, vi } from "vitest";
import { useDatasetSearch } from "./useDatasetSearch";

const queries: string[] = [];

registerEndpoint("/api/datasets", (event) => {
  const { q } = getQuery(event);
  queries.push(String(q));
  return {
    datasets: [
      {
        id: 22,
        name: "tank/media/photos",
        pool: { id: 7, name: "tank" },
        host: { id: 1, name: "mars", displayName: null },
      },
    ],
  };
});

describe("useDatasetSearch", () => {
  it("searches once the term settles and clears on an empty term", async () => {
    const term = ref("");
    const { results, loading } = useDatasetSearch(term, 10);

    term.value = "p";
    term.value = "pho";
    await nextTick();
    expect(loading.value).toBe(true);

    await vi.waitFor(() => expect(results.value).toHaveLength(1));
    expect(queries).toEqual(["pho"]);
    expect(loading.value).toBe(false);

    term.value = "  ";
    await nextTick();
    expect(results.value).toEqual([]);
    expect(queries).toEqual(["pho"]);
  });
});
