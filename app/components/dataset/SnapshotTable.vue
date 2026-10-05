<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { formatTimestamp } from "../pool/timestamp";
import type { DatasetSnapshot } from "./types";

const PAGE_SIZE = 100;

const props = defineProps<{ snapshots: DatasetSnapshot[] }>();

const shownCount = ref(PAGE_SIZE);

const shown = computed(() => props.snapshots.slice(0, shownCount.value));
const remaining = computed(() => props.snapshots.length - shownCount.value);

const columns: TableColumn<DatasetSnapshot>[] = [
  { id: "name", header: "Name" },
  { id: "created", header: "Created" },
  { id: "age", header: "Age" },
  { id: "used", header: "Used" },
  { id: "referenced", header: "Referenced" },
  { id: "written", header: "Written" },
];

const { formatZfsBytes } = useZfsByteSystem();
</script>

<template>
  <div class="flex flex-col gap-2">
    <UTable
      :data="shown"
      :columns="columns"
      empty="No snapshots."
      data-testid="snapshot-table"
    >
      <template #name-cell="{ row }">
        <span class="text-highlighted font-mono text-sm">
          {{ row.original.name }}
        </span>
      </template>
      <template #created-cell="{ row }">
        <span class="text-muted tabular">
          {{ formatTimestamp(row.original.creation) }}
        </span>
      </template>
      <template #age-cell="{ row }">
        <span class="text-muted tabular">
          {{ formatDuration(row.original.ageMs) }}
        </span>
      </template>
      <template #used-cell="{ row }">
        <span class="tabular">{{ formatZfsBytes(row.original.used) }}</span>
      </template>
      <template #referenced-cell="{ row }">
        <span class="text-muted tabular">
          {{ formatZfsBytes(row.original.referenced) }}
        </span>
      </template>
      <template #written-cell="{ row }">
        <span class="text-muted tabular">
          {{ formatZfsBytes(row.original.written) }}
        </span>
      </template>
    </UTable>
    <UButton
      v-if="remaining > 0"
      color="neutral"
      variant="soft"
      size="sm"
      class="self-start"
      :label="`Show ${Math.min(remaining, PAGE_SIZE)} more of ${remaining}`"
      @click="shownCount += PAGE_SIZE"
    />
  </div>
</template>
