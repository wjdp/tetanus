import type { Ref } from "vue";
import type { DatasetSearchResult } from "./types";

const MAX_QUERY_LENGTH = 100;

export function useDatasetSearch(term: Ref<string>, delayMs = 250) {
  const results = ref<DatasetSearchResult[]>([]);
  const loading = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latestRequest = 0;

  const search = async (q: string) => {
    const request = ++latestRequest;
    if (!q) {
      results.value = [];
      loading.value = false;
      return;
    }
    try {
      const { datasets } = await $fetch("/api/datasets", { query: { q } });
      if (request === latestRequest) results.value = datasets;
    } catch (error) {
      console.error("Could not search datasets", error);
      if (request === latestRequest) results.value = [];
    } finally {
      if (request === latestRequest) loading.value = false;
    }
  };

  watch(term, (value) => {
    clearTimeout(timer);
    const q = value.trim().slice(0, MAX_QUERY_LENGTH);
    if (!q) {
      search("");
      return;
    }
    loading.value = true;
    timer = setTimeout(() => search(q), delayMs);
  });

  onScopeDispose(() => clearTimeout(timer));

  return { results, loading };
}
