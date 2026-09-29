<script setup lang="ts">
import type { TimePoint } from "~/components/charts/alignSeries";
import type { LatestAttribute, SmartOverview } from "./types";

type Acceptance = SmartOverview["acceptances"][number];

const props = defineProps<{
  attribute: LatestAttribute;
  points: TimePoint[];
  acceptances: Acceptance[];
}>();

const unit = computed(() => props.attribute.metadata?.transformValueUnit);

const series = computed(() => [
  {
    label: props.attribute.metadata?.displayName ?? props.attribute.name,
    points: props.points,
  },
]);

const withUnit = (value: number) => {
  const formatted = value.toLocaleString("en-GB");
  return unit.value ? `${formatted} ${unit.value}` : formatted;
};

const currentStatus = computed(() => {
  const { status, statusSince } = props.attribute;
  return statusSince
    ? `${status} since ${formatDate(statusSince)}`
    : `${status} since first reading`;
});

const valueMilestones = computed(() => {
  const { transformedValue, valueSince, firstNonZeroAt } = props.attribute;
  const parts = [`${withUnit(transformedValue)} since ${formatDate(valueSince)}`];
  if (firstNonZeroAt && transformedValue > 0) {
    parts.push(`first non-zero ${formatDate(firstNonZeroAt)}`);
  }
  return parts.join(" · ");
});

const acceptanceLine = (acceptance: Acceptance) =>
  [
    `accepted at ${withUnit(acceptance.acceptedValue)} on ${formatDate(acceptance.acceptedAt)}`,
    acceptance.supersededAt && `superseded ${formatDate(acceptance.supersededAt)}`,
    acceptance.clearedAt && `cleared ${formatDate(acceptance.clearedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

const rawLine = computed(() => {
  const { value, worst, thresh, rawString } = props.attribute;
  const normalised = [
    value !== null && `norm ${value}`,
    worst !== null && `worst ${worst}`,
    thresh !== null && `thresh ${thresh}`,
  ]
    .filter(Boolean)
    .join(" / ");
  return [normalised, rawString && `raw ${rawString}`].filter(Boolean).join(" · ");
});
</script>

<template>
  <div
    class="flex max-w-3xl flex-col gap-3 text-sm whitespace-normal"
    data-testid="attribute-detail"
  >
    <ChartsTimeSeriesChart
      v-if="points.length"
      :series="series"
      :unit="unit"
      :height="160"
    />
    <p v-else class="text-dimmed">No history in this range</p>

    <div class="flex flex-col gap-1">
      <h4 class="text-muted text-xs font-medium">Status</h4>
      <p class="text-default">{{ currentStatus }}</p>
      <ul v-if="attribute.statusChanges.length" class="text-muted flex flex-col gap-0.5">
        <li v-for="change in attribute.statusChanges" :key="String(change.at)">
          {{ formatDate(change.at) }} · {{ change.to }} (was {{ change.from }}, value
          {{ change.value.toLocaleString("en-GB") }})
        </li>
      </ul>
      <p class="text-muted">{{ valueMilestones }}</p>
    </div>

    <div v-if="acceptances.length" class="flex flex-col gap-1">
      <h4 class="text-muted text-xs font-medium">Acceptances</h4>
      <div v-for="acceptance in acceptances" :key="acceptance.id">
        <p class="text-default">{{ acceptanceLine(acceptance) }}</p>
        <p v-if="acceptance.note" class="text-muted">{{ acceptance.note }}</p>
      </div>
    </div>

    <p v-if="attribute.reason" class="text-highlighted">{{ attribute.reason }}</p>
    <p class="text-muted">
      {{ attribute.metadata?.description || "No description for this attribute." }}
    </p>
    <p v-if="rawLine" class="text-dimmed font-mono text-xs">{{ rawLine }}</p>
  </div>
</template>
