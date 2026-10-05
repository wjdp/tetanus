<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { SeagateFarm } from "#shared/smartctl";
import {
  driveFacts,
  environmentFacts,
  errorFacts,
  type FarmFact,
  type HeadRow,
  headRows,
  presentFacts,
  workloadFacts,
} from "./farmRows";

const props = defineProps<{
  farm: SeagateFarm;
  smartHours: number | null;
}>();

const groups = computed(() =>
  [
    { title: "Drive", facts: driveFacts(props.farm, props.smartHours) },
    { title: "Workload", facts: workloadFacts(props.farm) },
    { title: "Errors", facts: errorFacts(props.farm) },
    { title: "Environment", facts: environmentFacts(props.farm) },
  ]
    .map((group) => ({ ...group, facts: presentFacts(group.facts) }))
    .filter((group) => group.facts.length > 0),
);

const factClass = (fact: FarmFact) => (fact.warning ? "text-warning" : undefined);

const heads = computed(() => headRows(props.farm));

const hasValue = (key: keyof HeadRow) =>
  heads.value.some((row) => row[key] !== undefined);

const numberCell = { class: { td: "tabular text-end", th: "text-end" } };

const headColumn: TableColumn<HeadRow> = {
  accessorKey: "head",
  header: "Head",
  meta: { class: { td: "tabular" } },
};

const optionalColumns: { field: keyof HeadRow; column: TableColumn<HeadRow> }[] = [
  { field: "mrResistance", column: { id: "resistance", header: "Resistance", meta: numberCell } },
  { field: "reallocatedSectors", column: { id: "reallocated", header: "Reallocated", meta: numberCell } },
  { field: "reallocationCandidates", column: { id: "candidates", header: "Candidates", meta: numberCell } },
  { field: "unrecoverableReadsUnique", column: { id: "unrecoverable", header: "Unrecoverable reads", meta: numberCell } },
  { field: "skipWriteDetections", column: { id: "skipWrites", header: "Skip-write detections", meta: numberCell } },
  { field: "writeWorkloadPowerOn", column: { id: "writeWorkload", header: "Write workload", meta: numberCell } },
];

const columns = computed(() => [
  headColumn,
  ...optionalColumns
    .filter(({ field }) => hasValue(field))
    .map(({ column }) => column),
]);

const count = (value: number | undefined) =>
  value === undefined ? "—" : value.toLocaleString("en-GB");
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="farm">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-muted text-sm font-medium">Seagate FARM</h3>
      <p class="text-dimmed text-xs">
        Factory reliability log, kept apart from SMART
      </p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <DiskFactGroup
        v-for="group in groups"
        :key="group.title"
        :title="group.title"
      >
        <DiskFact
          v-for="fact in group.facts"
          :key="fact.label"
          :label="fact.label"
          :class="factClass(fact)"
          :data-fact="fact.label"
        >
          {{ fact.value }}
          <span v-if="fact.note" class="text-dimmed text-xs">· {{ fact.note }}</span>
        </DiskFact>
      </DiskFactGroup>
    </div>

    <div v-if="heads.length" class="flex flex-col gap-2" data-testid="farm-heads">
      <h4 class="text-muted text-sm font-medium">
        Per head
        <span class="text-dimmed font-normal">
          · resistance more than 20 % from the median is highlighted</span
        >
      </h4>
      <UTable :data="heads" :columns="columns" :ui="{ td: 'whitespace-nowrap' }">
        <template #resistance-cell="{ row }">
          <span :class="row.original.resistanceOutlier ? 'text-warning' : undefined">
            {{ count(row.original.mrResistance) }}
          </span>
        </template>
        <template #reallocated-cell="{ row }">
          <span
            :class="(row.original.reallocatedSectors ?? 0) > 0 ? 'text-warning' : undefined"
          >
            {{ count(row.original.reallocatedSectors) }}
          </span>
        </template>
        <template #candidates-cell="{ row }">
          {{ count(row.original.reallocationCandidates) }}
        </template>
        <template #unrecoverable-cell="{ row }">
          {{ count(row.original.unrecoverableReadsUnique) }}
          <span class="text-dimmed">
            / {{ count(row.original.unrecoverableReadsRepeating) }} repeating</span
          >
        </template>
        <template #skipWrites-cell="{ row }">
          {{ count(row.original.skipWriteDetections) }}
        </template>
        <template #writeWorkload-cell="{ row }">
          {{ count(row.original.writeWorkloadPowerOn) }}
        </template>
      </UTable>
    </div>
  </section>
</template>
