import {
  collectorStatus,
  MIN_COLLECTOR_VERSION,
  upgradeCommand,
} from "#shared/collector";
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
  const serverUrl = useRequestURL().origin;

  onMounted(() => {
    dismissed.value = readDismissed();
  });

  const faults = computed<Fault[]>(() => {
    const now = Date.now();
    const result: Fault[] = [];
    for (const host of hosts.value ?? []) {
      const version = host.collectorVersion;
      const incompatibleId = `collector-incompatible:${host.name}:${version}`;
      if (
        version &&
        collectorStatus(version) === "incompatible" &&
        !dismissed.value.has(incompatibleId)
      ) {
        result.push({
          id: incompatibleId,
          host: host.name,
          title: `Collector ${version} is too old; ${MIN_COLLECTOR_VERSION} or later is needed`,
          command: upgradeCommand(serverUrl),
        });
      }

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
        host: host.name,
        title: `No data for ${formatDuration(worstAgeMs)}`,
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
