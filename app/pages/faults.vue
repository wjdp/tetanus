<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import { upgradeCommand } from "#shared/collector";
import {
  FAULT_CATEGORIES,
  FAULT_SEVERITIES,
  FAULT_STATES,
  type FaultAction,
  type FaultState,
  type FaultView,
  LIVE_FAULT_STATES,
} from "#shared/faults";
import { ENTITY_ICON } from "~/utils/vocabulary";

useSeoMeta({ title: getPageTitle("Faults") });

const ALL = "all";
const CLOCK_TICK_MS = 60_000;

const STATE_VIEWS = {
  live: { label: "Live", states: LIVE_FAULT_STATES },
  accepted: { label: "Accepted", states: ["accepted"] },
  resolved: { label: "Resolved", states: ["resolved"] },
  all: { label: "All", states: FAULT_STATES },
} as const satisfies Record<
  string,
  { label: string; states: readonly FaultState[] }
>;
type StateView = keyof typeof STATE_VIEWS;
const STATE_VIEW_NAMES = Object.keys(STATE_VIEWS) as StateView[];
const DEFAULT_VIEW: StateView = "live";

const route = useRoute();
const router = useRouter();

const queryFilter = <Value extends string>(
  name: string,
  fallback: Value,
  isAllowed: (value: string) => boolean,
) =>
  computed<Value>({
    get: () => {
      const value = route.query[name];
      return typeof value === "string" && isAllowed(value)
        ? (value as Value)
        : fallback;
    },
    set: (value) => {
      router.replace({
        query: { ...route.query, [name]: value === fallback ? undefined : value },
      });
    },
  });

const oneOf = (values: readonly string[]) => (value: string) =>
  values.includes(value);

const view = queryFilter<StateView>("state", DEFAULT_VIEW, oneOf(STATE_VIEW_NAMES));
const category = queryFilter("category", ALL, oneOf(FAULT_CATEGORIES));
const severity = queryFilter("severity", ALL, oneOf(FAULT_SEVERITIES));
const hostFilter = queryFilter("host", ALL, (value) => value.length > 0);

const hasNarrowingFilter = computed(() =>
  [category.value, severity.value, hostFilter.value].some(
    (value) => value !== ALL,
  ),
);

const apiQuery = computed(() => ({
  state: STATE_VIEWS[view.value].states.join(","),
  ...(category.value === ALL ? {} : { category: category.value }),
  ...(severity.value === ALL ? {} : { severity: severity.value }),
  ...(hostFilter.value === ALL ? {} : { host: hostFilter.value }),
}));

const { faults, counts, status, perform, refresh } = useFaults(apiQuery);
const { data: hosts } = useFetch("/api/hosts", {
  lazy: true,
  default: () => [],
});

const now = ref(Date.now());
let clockHandle: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clockHandle = setInterval(() => {
    now.value = Date.now();
  }, CLOCK_TICK_MS);
});
onUnmounted(() => {
  if (clockHandle) clearInterval(clockHandle);
});

const countFor = (states: readonly FaultState[]) =>
  states.reduce((total, state) => total + counts.value[state], 0);

const viewItems = computed(() =>
  STATE_VIEW_NAMES.map((value) => ({
    value,
    label: STATE_VIEWS[value].label,
    badge: {
      label: String(countFor(STATE_VIEWS[value].states)),
      color: "neutral" as const,
      variant: "subtle" as const,
    },
  })),
);

const categoryItems = [
  { label: "All categories", value: ALL },
  ...FAULT_CATEGORIES.map((value) => ({ label: value, value })),
];
const severityItems = [
  { label: "All severities", value: ALL },
  ...FAULT_SEVERITIES.map((value) => ({ label: value, value })),
];
const hostItems = computed(() => [
  { label: "All hosts", value: ALL },
  ...(hosts.value ?? []).map((row) => ({
    label: row.displayName ?? row.name,
    value: row.name,
    icon: ENTITY_ICON.host,
  })),
]);

const lastIngestAt = computed(() => {
  const times = (hosts.value ?? []).map((row) => Date.parse(row.lastSeenAt));
  return times.length ? Math.max(...times) : null;
});
const lastIngest = computed(() =>
  lastIngestAt.value === null
    ? "No data received yet"
    : `Last ingest ${formatDuration(now.value - lastIngestAt.value)} ago`,
);

const command = upgradeCommand(useRequestURL().origin);
const toast = useToast();

const ACTION_DONE: Record<FaultAction, string> = {
  acknowledge: "Acknowledged",
  accept: "Accepted",
  clear: "Cleared",
};
const ACTION_FAILED: Record<FaultAction, string> = {
  acknowledge: "Could not acknowledge the fault",
  accept: "Could not accept the fault",
  clear: "Could not clear the fault",
};

const performFor =
  (fault: FaultView) => async (action: FaultAction, note?: string) => {
    try {
      await perform(fault.id, action, note);
      toast.add({ title: ACTION_DONE[action], color: "neutral" });
    } catch {
      toast.add({ title: ACTION_FAILED[action], color: "error" });
    }
  };
</script>

<template>
  <AppPanel title="Faults" class="flex max-w-5xl flex-col gap-6">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Faults
    </h1>

    <div class="flex flex-wrap items-center gap-2">
      <UTabs
        v-model="view"
        :items="viewItems"
        :content="false"
        size="xs"
        color="neutral"
        variant="pill"
        aria-label="Fault state"
      />
      <div class="flex flex-wrap gap-2 sm:ms-auto">
        <USelect
          v-model="category"
          :items="categoryItems"
          class="w-36"
          aria-label="Filter by category"
        />
        <USelect
          v-model="severity"
          :items="severityItems"
          class="w-36"
          aria-label="Filter by severity"
        />
        <USelect
          v-model="hostFilter"
          :items="hostItems"
          class="w-36"
          aria-label="Filter by host"
        />
      </div>
    </div>

    <div
      v-if="faults.length"
      class="border-default divide-default divide-y overflow-hidden rounded-md border"
    >
      <FaultRow
        v-for="fault in faults"
        :key="fault.id"
        :fault="fault"
        :now="now"
        :upgrade-command="command"
        :perform="performFor(fault)"
        @changed="refresh"
      />
    </div>

    <div
      v-else-if="status !== 'pending'"
      class="border-default flex flex-col items-center gap-1 rounded-md border border-dashed px-4 py-10 text-center"
      data-testid="faults-empty"
    >
      <template v-if="view === 'live' && !hasNarrowingFilter">
        <p class="text-highlighted font-medium">Nothing needs attention</p>
        <p class="text-muted text-sm">{{ lastIngest }}</p>
      </template>
      <p v-else class="text-muted text-sm">
        No faults match these filters.
      </p>
    </div>
  </AppPanel>
</template>
