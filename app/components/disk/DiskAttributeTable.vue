<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import {
  attributeNote,
  isNotableContextRate,
  isShownByDefault,
  orderAttributes,
} from "./attributeRows";
import type { LatestAttribute, SmartOverview } from "./types";

const props = defineProps<{
  attributes: LatestAttribute[];
  history: SmartOverview["history"]["attributes"];
  acceptances: SmartOverview["acceptances"];
  showNormalised: boolean;
}>();

const emit = defineEmits<{
  accept: [attribute: LatestAttribute];
  clear: [attribute: LatestAttribute];
}>();

const SHOW_ALL_STORAGE_KEY = "tetanus:showAllAttributes";

const showAll = ref(false);

onMounted(() => {
  try {
    showAll.value = localStorage.getItem(SHOW_ALL_STORAGE_KEY) === "true";
  } catch {
    showAll.value = false;
  }
});

const toggleShowAll = () => {
  showAll.value = !showAll.value;
  try {
    localStorage.setItem(SHOW_ALL_STORAGE_KEY, String(showAll.value));
  } catch {
    // Private browsing or a full quota: the toggle just doesn't persist.
  }
};

const ordered = computed(() => orderAttributes(props.attributes));
const shownByDefault = computed(() => ordered.value.filter(isShownByDefault));
const hiddenCount = computed(
  () => ordered.value.length - shownByDefault.value.length,
);
const rows = computed(() => (showAll.value ? ordered.value : shownByDefault.value));

const visibilitySummary = computed(() =>
  hiddenCount.value && !showAll.value
    ? `${shownByDefault.value.length} shown, ${hiddenCount.value} hidden`
    : `${ordered.value.length} shown`,
);

const expanded = ref<Record<string, boolean>>({});

watch(
  ordered,
  (current) => {
    if (Object.values(expanded.value).some(Boolean)) return;
    const firstFault = current.find(
      (attribute) =>
        attribute.displayStatus === "failed" || attribute.displayStatus === "warning",
    );
    expanded.value = firstFault ? { [firstFault.attrId]: true } : {};
  },
  { immediate: true },
);

const ATTRIBUTE_STATUS_COLOUR = {
  failed: "error",
  warning: "warning",
  accepted: "neutral",
  passed: "neutral",
} as const;

const ROW_TINT = {
  failed: "bg-error/5",
  warning: "bg-warning/5",
  accepted: "bg-elevated/40",
  passed: "",
} as const;

const isAcceptable = (attribute: LatestAttribute) =>
  attribute.displayStatus === "failed" || attribute.displayStatus === "warning";

const acceptanceTooltip = (attribute: LatestAttribute) =>
  attribute.acceptance
    ? `accepted at ${attribute.acceptance.acceptedValue.toLocaleString("en-GB")} on ${formatDate(attribute.acceptance.acceptedAt)}`
    : "accepted";

const formatValue = (attribute: LatestAttribute) => {
  const unit = attribute.metadata?.transformValueUnit;
  const value = attribute.transformedValue.toLocaleString("en-GB");
  return unit ? `${value} ${unit}` : value;
};

const formatNormalised = (attribute: LatestAttribute) =>
  [attribute.value, attribute.worst, attribute.thresh]
    .map((part) => part ?? "—")
    .join(" / ");

const formatFailureRate = (rate: number | null) =>
  rate === null ? "—" : `${(rate * 100).toFixed(1)} %`;

const pointsFor = (attrId: string) => props.history[attrId] ?? [];

const sparklineValues = (attrId: string) =>
  pointsFor(attrId).map((point) => point.value);

const acceptancesFor = (attrId: string) =>
  props.acceptances.filter((acceptance) => acceptance.attrId === attrId);

const mutedClass = { td: "text-dimmed tabular" };

const columns = computed<TableColumn<LatestAttribute>[]>(() => [
  { id: "status", header: "Status" },
  { accessorKey: "attrId", header: "ID", meta: { class: { td: "font-mono text-xs text-muted" } } },
  { id: "name", header: "Name" },
  { id: "value", header: "Value", meta: { class: { td: "tabular text-highlighted" } } },
  ...(props.showNormalised
    ? [{ id: "normalised", header: "Norm / worst / thresh", meta: { class: mutedClass } }]
    : []),
  { id: "ideal", header: "Ideal", meta: { class: { td: "text-muted" } } },
  { id: "failureRate", header: "Failure rate", meta: { class: { td: "tabular" } } },
  { id: "trend", header: "Trend" },
  { id: "history", header: "History", meta: { class: { td: "text-muted" } } },
  { id: "actions", header: "", meta: { class: { td: "text-right" } } },
]);

const onSelect = (_event: Event, row: { toggleExpanded: () => void }) =>
  row.toggleExpanded();

const rowClass = (row: { original: LatestAttribute }) =>
  ROW_TINT[row.original.displayStatus];
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="attribute-table">
    <p class="text-muted text-xs" data-testid="attribute-visibility">
      {{ visibilitySummary }}
    </p>
    <UTable
      v-model:expanded="expanded"
      :data="rows"
      :columns="columns"
      :get-row-id="(row: LatestAttribute) => row.attrId"
      :on-select="onSelect"
      :meta="{ class: { tr: rowClass } }"
      empty="No attributes in the latest reading."
    >
      <template #status-cell="{ row }">
        <UTooltip
          v-if="row.original.displayStatus === 'accepted'"
          :text="acceptanceTooltip(row.original)"
        >
          <UBadge
            color="neutral"
            variant="outline"
            size="sm"
            label="accepted"
            data-testid="accepted-badge"
          />
        </UTooltip>
        <UBadge
          v-else
          :color="ATTRIBUTE_STATUS_COLOUR[row.original.displayStatus]"
          variant="subtle"
          size="sm"
          :label="row.original.displayStatus"
        />
      </template>

      <template #name-cell="{ row }">
        <span class="inline-flex items-center gap-1">
          {{ row.original.metadata?.displayName ?? row.original.name }}
          <UTooltip v-if="attributeNote(row.original)" :text="attributeNote(row.original) ?? ''">
            <UIcon
              name="i-lucide-info"
              class="text-muted size-3.5"
              data-testid="attribute-note"
            />
          </UTooltip>
        </span>
      </template>

      <template #value-cell="{ row }">
        {{ formatValue(row.original) }}
      </template>

      <template #normalised-cell="{ row }">
        {{ formatNormalised(row.original) }}
      </template>

      <template #ideal-cell="{ row }">
        {{ row.original.metadata?.ideal || "—" }}
      </template>

      <template #failureRate-cell="{ row }">
        <span
          v-if="isNotableContextRate(row.original)"
          class="text-info"
          data-testid="context-rate"
        >
          {{ formatFailureRate(row.original.failureRate) }}
        </span>
        <span v-else :class="row.original.failureRate === null ? 'text-dimmed' : ''">
          {{ formatFailureRate(row.original.failureRate) }}
        </span>
      </template>

      <template #trend-cell="{ row }">
        <UBadge
          :color="attributeTrendColour(row.original.trend)"
          variant="soft"
          size="sm"
          :label="row.original.trend"
        />
      </template>

      <template #history-cell="{ row }">
        <ChartsSparkline :values="sparklineValues(row.original.attrId)" />
      </template>

      <template #actions-cell="{ row }">
        <UButton
          v-if="isAcceptable(row.original)"
          color="neutral"
          variant="soft"
          size="xs"
          label="Accept"
          @click.stop="emit('accept', row.original)"
        />
        <UButton
          v-else-if="row.original.displayStatus === 'accepted'"
          color="neutral"
          variant="ghost"
          size="xs"
          label="Clear"
          @click.stop="emit('clear', row.original)"
        />
      </template>

      <template #expanded="{ row }">
        <DiskAttributeDetail
          :attribute="row.original"
          :points="pointsFor(row.original.attrId)"
          :acceptances="acceptancesFor(row.original.attrId)"
        />
      </template>
    </UTable>
    <div v-if="hiddenCount">
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        :label="showAll ? 'Show fewer' : `Show ${hiddenCount} more`"
        :icon="showAll ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        data-testid="attribute-visibility-toggle"
        @click="toggleShowAll"
      />
    </div>
  </div>
</template>
