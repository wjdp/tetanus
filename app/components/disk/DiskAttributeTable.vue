<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { AcceptanceKind } from "#shared/smart/status";
import {
  ACCEPTANCE_KIND_VOCABULARY,
  ATTRIBUTE_TREND_COLOUR,
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
  accept: [attribute: LatestAttribute, kind: AcceptanceKind];
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

const LESS_USEFUL_TOOLTIP =
  "Usage and environment counters with unremarkable values. They never affect disk status.";

const visibilitySummary = computed(() =>
  hiddenCount.value && !showAll.value
    ? `${shownByDefault.value.length} shown, ${hiddenCount.value} less useful hidden`
    : `${ordered.value.length} shown`,
);

const expanded = ref<Record<string, boolean>>({});

watch(
  ordered,
  (current) => {
    if (Object.values(expanded.value).some(Boolean)) return;
    const firstFault = current.find(
      (attribute) =>
        attribute.displayStatus === "failed" ||
        attribute.displayStatus === "warning" ||
        attribute.displayStatus === "acknowledged",
    );
    expanded.value = firstFault ? { [firstFault.attrId]: true } : {};
  },
  { immediate: true },
);

const ROW_TINT = {
  failed: "bg-error/5",
  warning: "bg-warning/5",
  acknowledged: "bg-warning/5",
  accepted: "bg-elevated/40",
  passed: "",
} as const;

const isAcceptable = (attribute: LatestAttribute) =>
  attribute.displayStatus === "failed" || attribute.displayStatus === "warning";

const isCovered = (attribute: LatestAttribute) =>
  attribute.displayStatus === "accepted" ||
  attribute.displayStatus === "acknowledged";

const coveredVocabulary = (attribute: LatestAttribute) =>
  ACCEPTANCE_KIND_VOCABULARY[attribute.acceptance?.kind ?? "accept"];

const acceptedAt = (attribute: LatestAttribute) => {
  const { verb } = coveredVocabulary(attribute);
  return attribute.acceptance
    ? `${verb} at ${attribute.acceptance.acceptedValue.toLocaleString("en-GB")}`
    : verb;
};

const acceptanceTooltip = (attribute: LatestAttribute) =>
  attribute.acceptance
    ? `${acceptedAt(attribute)} on ${formatDate(attribute.acceptance.acceptedAt)}`
    : acceptedAt(attribute);

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
          :text="acceptanceTooltip(row.original)"
          :disabled="!isCovered(row.original)"
        >
          <DiskAttributeStatus :status="row.original.displayStatus" />
        </UTooltip>
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
        <span class="inline-flex items-center gap-1.5">
          {{ formatValue(row.original) }}
          <span
            v-if="isCovered(row.original)"
            class="text-dimmed inline-flex items-center gap-1 text-xs"
            data-testid="accepted-value"
          >
            <UIcon :name="coveredVocabulary(row.original).icon" class="size-3.5" />
            {{ acceptedAt(row.original) }}
          </span>
        </span>
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
          :color="ATTRIBUTE_TREND_COLOUR[row.original.trend]"
          variant="soft"
          size="sm"
          :label="row.original.trend"
        />
      </template>

      <template #history-cell="{ row }">
        <ChartsSparkline :values="sparklineValues(row.original.attrId)" />
      </template>

      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-1">
          <UButton
            v-if="isAcceptable(row.original)"
            color="neutral"
            variant="soft"
            size="xs"
            label="Acknowledge"
            @click.stop="emit('accept', row.original, 'acknowledge')"
          />
          <UButton
            v-else-if="row.original.displayStatus === 'acknowledged'"
            color="neutral"
            variant="soft"
            size="xs"
            label="Accept"
            @click.stop="emit('accept', row.original, 'accept')"
          />
          <UButton
            v-if="isCovered(row.original)"
            color="neutral"
            variant="ghost"
            size="xs"
            label="Clear"
            @click.stop="emit('clear', row.original)"
          />
        </div>
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
      <UTooltip :text="LESS_USEFUL_TOOLTIP">
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          :label="showAll ? 'Hide less useful attributes' : `Show ${hiddenCount} less useful attributes`"
          :icon="showAll ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          data-testid="attribute-visibility-toggle"
          @click="toggleShowAll"
        />
      </UTooltip>
    </div>
  </div>
</template>
