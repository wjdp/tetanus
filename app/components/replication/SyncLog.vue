<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { formatDuration } from "#shared/hostFreshness";
import {
  DEFAULT_REPLICATION_THRESHOLDS,
  type ReplicationSyncView,
} from "#shared/replications";
import { formatTimestamp } from "../pool/timestamp";
import { type GapSeverity, type SyncLogRow, syncLogRows } from "./syncGaps";

const props = defineProps<{
  syncs: {
    items: ReplicationSyncView[];
    total: number;
    pageSize: number;
  };
  intervalSec: number | null;
}>();

const page = defineModel<number>("page", { default: 1 });

const { data: settings } = useSettings();

const thresholds = computed(() => {
  const config = settings.value?.config;
  return config
    ? {
        lateFloorHours: config.replicationLateFloorHours,
        lateFactor: config.replicationLateFactor,
        stalledFloorHours: config.replicationStalledFloorHours,
        stalledFactor: config.replicationStalledFactor,
      }
    : DEFAULT_REPLICATION_THRESHOLDS;
});

const rows = computed(() =>
  syncLogRows(props.syncs.items, props.intervalSec, thresholds.value),
);

const columns: TableColumn<SyncLogRow>[] = [
  { id: "at", header: "Time" },
  { id: "snapshot", header: "Snapshot" },
  { id: "snapshots", header: "Snapshots received" },
  { id: "gap", header: "Gap" },
];

const GAP_CLASS: Record<NonNullable<GapSeverity>, string> = {
  late: "text-warning",
  stalled: "text-error",
};
</script>

<template>
  <div class="flex flex-col gap-2">
    <UTable
      :data="rows"
      :columns="columns"
      empty="No syncs recorded."
      data-testid="sync-log"
    >
      <template #at-cell="{ row }">
        <span class="text-muted tabular">
          {{ formatTimestamp(row.original.at) }}
        </span>
      </template>
      <template #snapshot-cell="{ row }">
        <span
          class="font-mono text-sm"
          :class="row.original.snapshotName ? 'text-highlighted' : 'text-dimmed'"
          :title="row.original.guid ? `guid ${row.original.guid}` : undefined"
        >
          {{ row.original.snapshotName ?? "—" }}
        </span>
      </template>
      <template #snapshots-cell="{ row }">
        <span class="tabular">{{ row.original.snapshots }}</span>
      </template>
      <template #gap-cell="{ row }">
        <span
          class="tabular"
          :class="
            row.original.gapSeverity
              ? ['font-medium', GAP_CLASS[row.original.gapSeverity]]
              : 'text-muted'
          "
          :data-gap="row.original.gapSeverity ?? undefined"
        >
          {{
            row.original.gapMs === null ? "—" : formatDuration(row.original.gapMs)
          }}
        </span>
      </template>
    </UTable>
    <UPagination
      v-if="syncs.total > syncs.pageSize"
      v-model:page="page"
      :total="syncs.total"
      :items-per-page="syncs.pageSize"
      size="sm"
      class="self-start"
      data-testid="sync-log-pages"
    />
  </div>
</template>
