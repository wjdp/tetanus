<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { SmartOverview } from "./types";

type SelfTest = SmartOverview["selfTests"][number];

const props = defineProps<{ selfTests: SelfTest[] }>();

const LATEST_COUNT = 10;
const showAll = ref(false);
const visibleSelfTests = computed(() =>
  showAll.value ? props.selfTests : props.selfTests.slice(0, LATEST_COUNT),
);

const columns: TableColumn<SelfTest>[] = [
  { accessorKey: "type", header: "Type" },
  { accessorKey: "status", header: "Status", meta: { class: { td: "text-muted" } } },
  { id: "result", header: "Result" },
  { id: "lifetime", header: "Lifetime", meta: { class: { td: "tabular" } } },
  { id: "lba", header: "First error LBA", meta: { class: { td: "font-mono text-xs" } } },
];
</script>

<template>
  <section v-if="selfTests.length" class="flex flex-col gap-2" data-testid="self-tests">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-muted text-sm font-medium">Self-tests</h3>
      <UButton
        v-if="selfTests.length > LATEST_COUNT"
        color="neutral"
        variant="ghost"
        size="xs"
        :label="showAll ? 'Show latest' : `Show all (${selfTests.length})`"
        data-testid="self-tests-toggle"
        @click="showAll = !showAll"
      />
    </div>
    <UTable :data="visibleSelfTests" :columns="columns" :ui="{ td: 'whitespace-nowrap' }">
      <template #result-cell="{ row }">
        <UBadge
          :color="row.original.passed ? 'neutral' : 'error'"
          variant="subtle"
          size="sm"
          :label="row.original.passed ? 'passed' : 'failed'"
        />
      </template>
      <template #lifetime-cell="{ row }">
        {{ row.original.lifetimeHours.toLocaleString("en-GB") }} h
      </template>
      <template #lba-cell="{ row }">
        <span :class="row.original.lba === null ? 'text-dimmed' : 'text-default'">
          {{ row.original.lba ?? "—" }}
        </span>
      </template>
    </UTable>
  </section>
</template>
