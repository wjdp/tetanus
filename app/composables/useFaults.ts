import type { FaultAction, FaultCounts, FaultsResponse } from "#shared/faults";

export const FAULTS_POLL_MS = 30_000;

export interface FaultsQuery {
  state?: string;
  category?: string;
  severity?: string;
  host?: string;
  subject?: string;
}

export const OPEN_ERRORS_QUERY: FaultsQuery = {
  state: "open",
  severity: "error",
};

const EMPTY_COUNTS: FaultCounts = {
  open: 0,
  acknowledged: 0,
  accepted: 0,
  resolved: 0,
};

const emptyResponse = (): FaultsResponse => ({
  faults: [],
  counts: { ...EMPTY_COUNTS },
});

const ACTION_REQUEST: Record<
  FaultAction,
  { path: string; method: "POST" | "DELETE" }
> = {
  acknowledge: { path: "acknowledge", method: "POST" },
  accept: { path: "accept", method: "POST" },
  clear: { path: "acknowledgement", method: "DELETE" },
  resolve: { path: "resolve", method: "POST" },
};

export function useFaults(query: MaybeRefOrGetter<FaultsQuery> = {}) {
  const { data, refresh, status } = useFetch<FaultsResponse>("/api/faults", {
    query: computed(() => toValue(query)),
    default: emptyResponse,
  });

  let pollHandle: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    pollHandle = setInterval(refresh, FAULTS_POLL_MS);
  });
  onUnmounted(() => {
    if (pollHandle) clearInterval(pollHandle);
  });

  useSseClient().onMessage("faults", () => refresh());

  const faults = computed(() => data.value?.faults ?? []);
  const counts = computed(() => data.value?.counts ?? EMPTY_COUNTS);

  const perform = async (id: number, action: FaultAction, note?: string) => {
    const { path, method } = ACTION_REQUEST[action];
    await $fetch(`/api/faults/${id}/${path}`, {
      method,
      ...(method === "POST" ? { body: note ? { note } : {} } : {}),
    });
    await refresh();
  };

  return {
    faults,
    counts,
    status,
    refresh,
    perform,
    acknowledge: (id: number, note?: string) =>
      perform(id, "acknowledge", note),
    accept: (id: number, note?: string) => perform(id, "accept", note),
    clear: (id: number) => perform(id, "clear"),
  };
}
