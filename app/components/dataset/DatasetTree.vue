<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { lastSegment, type TreeRow, visibleTreeRows } from "./treeRows";
import type { DatasetTreeRow } from "./types";

const props = defineProps<{
  datasets: DatasetTreeRow[];
  now: number;
  loading?: boolean;
}>();

type Row = TreeRow<DatasetTreeRow>;

const collapsedIds = ref(new Set<number>());

const rows = computed(() => visibleTreeRows(props.datasets, collapsedIds.value));

const toggle = (id: number) => {
  const next = new Set(collapsedIds.value);
  if (!next.delete(id)) next.add(id);
  collapsedIds.value = next;
};

const columns: TableColumn<Row>[] = [
  { id: "name", header: "Name" },
  { id: "type", header: "Type" },
  { id: "used", header: "Used" },
  { id: "referenced", header: "Referenced" },
  { id: "ratio", header: "Ratio" },
  { id: "quota", header: "Quota" },
  { id: "snapshots", header: "Snapshots" },
  { id: "newest", header: "Newest snapshot" },
  { id: "replication", header: "Replication" },
];

const formatRatio = (ratio: number | null) =>
  ratio === null ? "—" : `${ratio.toFixed(2)}×`;

const snapshotAge = (at: string | null) =>
  at ? `${formatDuration(props.now - new Date(at).getTime())} ago` : "—";
</script>

<template>
  <UTable
    :data="rows"
    :columns="columns"
    :loading="loading"
    empty="No datasets reported."
    :meta="{
      class: {
        tr: (row) => (row.original.dataset.present ? '' : 'opacity-50'),
      },
    }"
    data-testid="dataset-tree"
  >
    <template #name-cell="{ row }">
      <div
        class="flex items-center gap-1"
        :style="{ paddingLeft: `${row.original.dataset.depth * 1.25}rem` }"
        data-testid="dataset-name"
        :data-depth="row.original.dataset.depth"
      >
        <UButton
          v-if="row.original.hasChildren"
          color="neutral"
          variant="ghost"
          size="xs"
          :icon="
            row.original.collapsed
              ? 'i-lucide-chevron-right'
              : 'i-lucide-chevron-down'
          "
          :aria-label="`${row.original.collapsed ? 'Expand' : 'Collapse'} ${row.original.dataset.name}`"
          :aria-expanded="!row.original.collapsed"
          @click="toggle(row.original.dataset.id)"
        />
        <span v-else class="inline-block w-6" />
        <NuxtLink
          :to="`/datasets/${row.original.dataset.id}`"
          :title="row.original.dataset.name"
          class="text-highlighted font-mono text-sm hover:underline"
        >
          {{ lastSegment(row.original.dataset.name) }}
        </NuxtLink>
        <UBadge
          v-if="!row.original.dataset.present"
          color="neutral"
          variant="subtle"
          size="sm"
        >
          destroyed
        </UBadge>
      </div>
    </template>
    <template #type-cell="{ row }">
      <UBadge
        v-if="row.original.dataset.type === 'volume'"
        color="info"
        variant="subtle"
        size="sm"
      >
        volume
      </UBadge>
      <span v-else class="text-muted">{{ row.original.dataset.type }}</span>
    </template>
    <template #used-cell="{ row }">
      <span class="tabular">{{ formatBytes(row.original.dataset.used) }}</span>
    </template>
    <template #referenced-cell="{ row }">
      <span class="text-muted tabular">
        {{ formatBytes(row.original.dataset.referenced) }}
      </span>
    </template>
    <template #ratio-cell="{ row }">
      <span class="text-muted tabular">
        {{ formatRatio(row.original.dataset.compressRatio) }}
      </span>
    </template>
    <template #quota-cell="{ row }">
      <span class="text-muted tabular">
        {{ formatBytes(row.original.dataset.quota) }}
      </span>
    </template>
    <template #snapshots-cell="{ row }">
      <span
        class="tabular"
        :class="row.original.dataset.snapshotCount ? '' : 'text-dimmed'"
      >
        {{ row.original.dataset.snapshotCount }}
      </span>
    </template>
    <template #newest-cell="{ row }">
      <span class="text-muted tabular">
        {{ snapshotAge(row.original.dataset.latestSnapshotAt) }}
      </span>
    </template>
    <template #replication-cell="{ row }">
      <ReplicationDatasetLinks
        :replications="row.original.dataset.replications"
      />
    </template>
  </UTable>
</template>
