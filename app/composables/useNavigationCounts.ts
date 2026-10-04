import type { NavigationCounts, StatusCounts } from "#shared/navigation";

export const NAVIGATION_COUNTS_POLL_MS = 30_000;

const emptyCounts = (): StatusCounts => ({ error: 0, warning: 0, neutral: 0 });

const emptyResponse = (): NavigationCounts => ({
  faults: emptyCounts(),
  hosts: emptyCounts(),
  disks: emptyCounts(),
  pools: emptyCounts(),
  replications: emptyCounts(),
});

export function useNavigationCounts() {
  const { data, refresh } = useFetch<NavigationCounts>("/api/navigation", {
    default: emptyResponse,
  });

  let pollHandle: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    pollHandle = setInterval(refresh, NAVIGATION_COUNTS_POLL_MS);
  });
  onUnmounted(() => {
    if (pollHandle) clearInterval(pollHandle);
  });

  useSseClient().onMessage("faults", () => refresh());

  return computed(() => data.value ?? emptyResponse());
}
