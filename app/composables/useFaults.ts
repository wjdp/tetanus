import type { Fault } from "#shared/faults";

const DISMISSED_STORAGE_KEY = "tetanus:dismissedFaults";

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Private browsing or a full quota: dismissals just don't persist.
  }
}

export function useFaults() {
  const { data: hosts } = useFetch("/api/hosts", { default: () => [] });
  const cadences = useRuntimeConfig().public.demo ? DEMO_CADENCES : undefined;
  const dismissed = useState<Set<string>>("faults-dismissed", () => new Set());

  onMounted(() => {
    dismissed.value = readDismissed();
  });

  const faults = computed<Fault[]>(() => {
    const now = Date.now();
    const result: Fault[] = [];
    for (const host of hosts.value ?? []) {
      const groups = allGroupFreshness(host.lastRuns, now, cadences);
      const allSilent = groups.every((group) => group.status !== "ok");
      if (!allSilent) continue;

      const id = `collector-silent:${host.name}`;
      if (dismissed.value.has(id)) continue;

      const ages = groups
        .map((group) => group.ageMs)
        .filter((ageMs): ageMs is number => ageMs !== null);
      const worstAgeMs =
        ages.length > 0
          ? Math.max(...ages)
          : now - new Date(host.lastSeenAt).getTime();

      result.push({
        id,
        title: `No data from ${host.name} for ${formatDuration(worstAgeMs)}`,
      });
    }
    return result;
  });

  const dismiss = (id: string) => {
    dismissed.value = new Set(dismissed.value).add(id);
    writeDismissed(dismissed.value);
  };

  return { faults, dismiss };
}
