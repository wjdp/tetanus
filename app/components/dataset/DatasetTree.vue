<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { datasetPath } from "#shared/entityPaths";
import {
  DATASET_COLUMNS,
  type DatasetColumn,
  type DatasetSorting,
  datasetComparator,
  nextSorting,
} from "./columns";
import { spaceSplit } from "./spaceHierarchy";
import {
  lastSegment,
  sortSiblings,
  type TreeRow,
  visibleTreeRows,
} from "./treeRows";
import type { DatasetTreeRow } from "./types";

const props = defineProps<{
  datasets: DatasetTreeRow[];
  poolPath: string;
  now: number;
  loading?: boolean;
}>();

type Row = TreeRow<DatasetTreeRow>;

const collapsedIds = ref(new Set<number>());
const sorting = ref<DatasetSorting | null>(null);

const sortedDatasets = computed(() =>
  sorting.value
    ? sortSiblings(props.datasets, datasetComparator(sorting.value))
    : props.datasets,
);

const rows = computed(() =>
  visibleTreeRows(sortedDatasets.value, collapsedIds.value),
);

const toggle = (id: number) => {
  const next = new Set(collapsedIds.value);
  if (!next.delete(id)) next.add(id);
  collapsedIds.value = next;
};

const collapsibleIds = computed(() => {
  const parentIds = new Set(props.datasets.map((dataset) => dataset.parentId));
  return props.datasets
    .filter((dataset) => dataset.parentId !== null && parentIds.has(dataset.id))
    .map((dataset) => dataset.id);
});

const expandAll = () => {
  collapsedIds.value = new Set();
};

const collapseAll = () => {
  collapsedIds.value = new Set(collapsibleIds.value);
};

const UButton = resolveComponent("UButton");

const sortIcon = (column: DatasetColumn) => {
  if (sorting.value?.id !== column.id) return "i-lucide-arrow-up-down";
  return sorting.value.desc ? "i-lucide-arrow-down" : "i-lucide-arrow-up";
};

const sortButton = (column: DatasetColumn) => ({
  color: "neutral" as const,
  variant: "ghost" as const,
  size: "xs" as const,
  label: column.label,
  class: "text-highlighted -mx-2 text-sm font-semibold",
  trailingIcon: sortIcon(column),
  "aria-label": `Sort by ${column.label}`,
  "data-testid": `dataset-sort-${column.id}`,
  onClick: () => {
    sorting.value = nextSorting(sorting.value, column);
  },
});

const sortableHeader = (column: DatasetColumn) => () =>
  h(UButton, sortButton(column));

const nameColumn = DATASET_COLUMNS.find(({ id }) => id === "name");

const columns = computed<TableColumn<Row>[]>(() =>
  DATASET_COLUMNS.map((column) => ({
    id: column.id,
    header: column.sortValue ? sortableHeader(column) : column.label,
    meta: { class: { th: column.cellClass, td: column.cellClass } },
  })),
);

const isEncrypted = (dataset: DatasetTreeRow) =>
  dataset.encryption !== null && dataset.encryption !== "off";

const formatRatio = (ratio: number | null) =>
  ratio === null ? "—" : `${ratio.toFixed(2)}×`;

const isCompressing = (dataset: DatasetTreeRow) =>
  dataset.compressRatio !== null && dataset.compressRatio >= 1.005;

const snapshotAge = (at: string | null) =>
  at ? `${formatDuration(props.now - new Date(at).getTime())} ago` : "—";

const { formatZfsBytes } = useZfsByteSystem();

const formatGrowth = (bytes: number) => {
  if (bytes === 0) return formatZfsBytes(0);
  return `${bytes > 0 ? "+" : "−"}${formatZfsBytes(Math.abs(bytes))}`;
};

const USED_PARTS = ["data", "snapshots", "children"] as const;

const USED_PART_CLASS: Record<(typeof USED_PARTS)[number], string> = {
  data: "bg-(--ui-text-toned)",
  snapshots: "bg-info",
  children: "bg-(--ui-border-accented)",
};

const poolUsed = computed(() =>
  Math.max(
    0,
    ...props.datasets
      .filter((dataset) => dataset.present)
      .map((dataset) => dataset.used),
  ),
);

const usedSegments = (dataset: DatasetTreeRow) => {
  if (poolUsed.value === 0) return [];
  const split = spaceSplit(dataset, 0);
  return USED_PARTS.map((part) => ({
    part,
    percent: Math.min(100, (split[part] / poolUsed.value) * 100),
  })).filter((segment) => segment.percent > 0);
};

const usedBreakdown = (dataset: DatasetTreeRow) => {
  const split = spaceSplit(dataset, 0);
  const parts = `Data ${formatZfsBytes(split.data)} · snapshots ${formatZfsBytes(split.snapshots)} · children ${formatZfsBytes(split.children)}`;
  return split.reserved > 0
    ? `${parts} · reserved ${formatZfsBytes(split.reserved)}`
    : parts;
};

const limits = (dataset: DatasetTreeRow) =>
  [
    dataset.quota && `${formatZfsBytes(dataset.quota)} quota`,
    dataset.refQuota && `${formatZfsBytes(dataset.refQuota)} refquota`,
    dataset.reservation && `${formatZfsBytes(dataset.reservation)} reserved`,
  ].filter((line): line is string => Boolean(line));
</script>

<template>
  <div class="@container">
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
      <template v-if="nameColumn" #name-header>
        <span class="flex items-center gap-3">
          <UButton v-bind="sortButton(nameColumn)" />
          <span class="flex items-center">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-chevrons-up-down"
              title="Expand all"
              aria-label="Expand all"
              :disabled="collapsedIds.size === 0"
              data-testid="dataset-expand-all"
              @click="expandAll"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-chevrons-down-up"
              title="Collapse all"
              aria-label="Collapse all"
              :disabled="collapsibleIds.length === 0"
              data-testid="dataset-collapse-all"
              @click="collapseAll"
            />
          </span>
        </span>
      </template>
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
          <span v-else class="inline-block w-6 shrink-0" />
          <NuxtLink
            :to="datasetPath(poolPath, row.original.dataset.name)"
            :title="row.original.dataset.name"
            class="text-highlighted max-w-40 truncate font-mono text-sm hover:underline @3xl:max-w-64"
          >
            {{ lastSegment(row.original.dataset.name) }}
          </NuxtLink>
          <UIcon
            v-if="isEncrypted(row.original.dataset)"
            name="i-lucide-lock"
            class="text-dimmed size-3.5 shrink-0"
            :title="`Encrypted · ${row.original.dataset.encryption}`"
            :aria-label="`Encrypted · ${row.original.dataset.encryption}`"
            data-testid="dataset-encrypted"
          />
          <UBadge
            v-if="row.original.dataset.type === 'volume'"
            color="info"
            variant="subtle"
            size="sm"
          >
            volume
          </UBadge>
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
      <template #used-cell="{ row }">
        <div
          class="-my-1 flex w-24 flex-col gap-1"
          :title="usedBreakdown(row.original.dataset)"
          data-testid="dataset-used"
        >
          <span class="tabular whitespace-nowrap">
            {{ formatZfsBytes(row.original.dataset.used) }}
          </span>
          <span class="bg-elevated flex h-1 overflow-hidden rounded-full">
            <span
              v-for="segment in usedSegments(row.original.dataset)"
              :key="segment.part"
              :class="USED_PART_CLASS[segment.part]"
              :style="{ width: `${segment.percent}%` }"
              :data-part="segment.part"
            />
          </span>
        </div>
      </template>
      <template #growth-cell="{ row }">
        <span
          v-if="row.original.dataset.growth"
          class="tabular whitespace-nowrap"
          :class="row.original.dataset.growth.used ? 'text-muted' : 'text-dimmed'"
          :title="`Since ${formatDate(row.original.dataset.growth.sinceAt)}`"
          data-testid="dataset-growth"
        >
          {{ formatGrowth(row.original.dataset.growth.used) }}
        </span>
        <span v-else class="text-dimmed">—</span>
      </template>
      <template #compression-cell="{ row }">
        <span
          class="tabular whitespace-nowrap"
          :class="isCompressing(row.original.dataset) ? 'text-muted' : 'text-dimmed'"
          data-testid="dataset-compression"
        >
          {{ formatRatio(row.original.dataset.compressRatio) }}
          <span v-if="row.original.dataset.compression" class="text-dimmed">
            {{ row.original.dataset.compression }}
          </span>
        </span>
      </template>
      <template #limits-cell="{ row }">
        <span
          class="text-muted tabular flex flex-col whitespace-nowrap"
          data-testid="dataset-limits"
        >
          <span v-for="line in limits(row.original.dataset)" :key="line">
            {{ line }}
          </span>
          <span
            v-if="limits(row.original.dataset).length === 0"
            class="text-dimmed"
          >
            —
          </span>
        </span>
      </template>
      <template #snapshots-cell="{ row }">
        <span
          v-if="row.original.dataset.snapshotCount"
          class="tabular whitespace-nowrap"
        >
          {{ row.original.dataset.snapshotCount }}
          <span class="text-muted">
            · {{ snapshotAge(row.original.dataset.latestSnapshotAt) }}
          </span>
        </span>
        <span v-else class="text-dimmed">—</span>
      </template>
      <template #replication-cell="{ row }">
        <ReplicationDatasetLinks
          :replications="row.original.dataset.replications"
        />
      </template>
    </UTable>
  </div>
</template>
