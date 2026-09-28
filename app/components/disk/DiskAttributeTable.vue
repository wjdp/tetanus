<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { orderAttributes } from "./attributeOrder";
import type { LatestAttribute, SmartOverview } from "./types";

const props = defineProps<{
  attributes: LatestAttribute[];
  history: SmartOverview["history"]["attributes"];
  showNormalised: boolean;
}>();

const selected = defineModel<string | null>("selected", { default: null });
const expanded = ref<Record<string, boolean>>({});

const rows = computed(() => orderAttributes(props.attributes));

const ATTRIBUTE_STATUS_COLOUR = {
  failed: "error",
  warning: "warning",
  passed: "neutral",
} as const;

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

const sparklineValues = (attrId: string) =>
  (props.history[attrId] ?? []).map((point) => point.value);

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
]);

const onSelect = (
  _event: Event,
  row: { original: LatestAttribute; toggleExpanded: () => void },
) => {
  selected.value = row.original.attrId;
  row.toggleExpanded();
};

const rowClass = (row: { original: LatestAttribute }) =>
  row.original.attrId === selected.value ? "bg-elevated/60" : "";
</script>

<template>
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
      <UBadge
        :color="ATTRIBUTE_STATUS_COLOUR[row.original.status]"
        variant="subtle"
        size="sm"
        :label="row.original.status"
      />
    </template>

    <template #name-cell="{ row }">
      {{ row.original.metadata?.displayName ?? row.original.name }}
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
      <span :class="row.original.failureRate === null ? 'text-dimmed' : ''">
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

    <template #expanded="{ row }">
      <div class="flex max-w-3xl flex-col gap-2 text-sm whitespace-normal">
        <p v-if="row.original.reason" class="text-highlighted">
          {{ row.original.reason }}
        </p>
        <p class="text-muted">
          {{ row.original.metadata?.description || "No description for this attribute." }}
        </p>
        <p v-if="row.original.rawString" class="text-dimmed font-mono text-xs">
          raw {{ row.original.rawString }}
        </p>
      </div>
    </template>
  </UTable>
</template>
