<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import {
  FAULT_CATEGORIES,
  FAULT_SEVERITIES,
  FAULT_STATES,
  FAULT_SUBJECT_TYPES,
  type FaultSeverity,
  type FaultState,
  LIVE_FAULT_STATES,
} from "#shared/faults";
import { ENTITY_ICON, FAULT_CATEGORY_ICON } from "~/utils/vocabulary";

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
const SUBJECT = new RegExp(`^(${FAULT_SUBJECT_TYPES.join("|")}):\\d+$`);
const subjectFilter = queryFilter<string>("subject", ALL, (value) =>
  SUBJECT.test(value),
);

const hasNarrowingFilter = computed(() =>
  [category.value, severity.value, hostFilter.value, subjectFilter.value].some(
    (value) => value !== ALL,
  ),
);

const apiQuery = computed(() => ({
  state: STATE_VIEWS[view.value].states.join(","),
  ...(category.value === ALL ? {} : { category: category.value }),
  ...(severity.value === ALL ? {} : { severity: severity.value }),
  ...(hostFilter.value === ALL ? {} : { host: hostFilter.value }),
  ...(subjectFilter.value === ALL ? {} : { subject: subjectFilter.value }),
}));

const { faults, counts, subject, status, perform, refresh } =
  useFaults(apiQuery);
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
  ...FAULT_CATEGORIES.map((value) => ({
    label: value,
    value,
    icon: FAULT_CATEGORY_ICON[value],
  })),
];
const CATEGORY_ICON = "i-lucide-shapes";
const SEVERITY_ICON = "i-lucide-triangle-alert";
const categoryIcon = computed(() =>
  category.value === ALL ? CATEGORY_ICON : FAULT_CATEGORY_ICON[category.value],
);
const severityItems = [
  { label: "All severities", value: ALL },
  ...FAULT_SEVERITIES.map((value) => ({ label: value, value })),
];
const isSeverity = (value: string): value is FaultSeverity =>
  value !== ALL;
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

</script>

<template>
  <AppPanel title="Faults" class="flex max-w-7xl flex-col gap-6">
    <div class="flex items-center gap-2">
      <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
        Faults
      </h1>
      <UButton
        to="/faults/reference"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-book-open"
        label="Reference"
        class="ms-auto"
        data-testid="fault-reference-link"
      />
    </div>

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
        <UButton
          v-if="subjectFilter !== ALL && subject"
          color="neutral"
          variant="subtle"
          :icon="ENTITY_ICON[subject.type]"
          trailing-icon="i-lucide-x"
          :label="subject.label"
          aria-label="Clear subject filter"
          data-testid="subject-filter"
          @click="subjectFilter = ALL"
        />
        <USelect
          v-model="category"
          :items="categoryItems"
          :icon="categoryIcon"
          :color="category === ALL ? 'neutral' : 'primary'"
          :variant="category === ALL ? 'outline' : 'soft'"
          :highlight="category !== ALL"
          class="w-36"
          aria-label="Filter by category"
        />
        <USelect
          v-model="severity"
          :items="severityItems"
          :color="isSeverity(severity) ? 'primary' : 'neutral'"
          :variant="isSeverity(severity) ? 'soft' : 'outline'"
          :highlight="isSeverity(severity)"
          class="w-40"
          aria-label="Filter by severity"
        >
          <template #leading="{ ui }">
            <span
              v-if="isSeverity(severity)"
              class="inline-flex items-center justify-center"
              :class="ui.leadingIcon()"
            >
              <TopologyStatusDot :colour="severity" />
            </span>
            <UIcon v-else :name="SEVERITY_ICON" :class="ui.leadingIcon()" />
          </template>
          <template #item-leading="{ item, ui }">
            <span
              v-if="isSeverity(item.value)"
              class="inline-flex items-center justify-center"
              :class="ui.itemLeadingIcon()"
            >
              <TopologyStatusDot :colour="item.value" />
            </span>
          </template>
        </USelect>
        <USelect
          v-model="hostFilter"
          :items="hostItems"
          :icon="ENTITY_ICON.host"
          :color="hostFilter === ALL ? 'neutral' : 'primary'"
          :variant="hostFilter === ALL ? 'outline' : 'soft'"
          :highlight="hostFilter !== ALL"
          class="w-36"
          aria-label="Filter by host"
        />
      </div>
    </div>

    <FaultList
      v-if="faults.length"
      :faults="faults"
      :now="now"
      :perform="perform"
      @changed="refresh"
    />

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
