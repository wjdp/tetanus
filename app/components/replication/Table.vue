<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { ReplicationRow } from "#shared/replications";
import {
  REPLICATION_STATUS_VOCABULARY,
  STATUS_TEXT_CLASS,
} from "~/utils/vocabulary";
import { dueText, lastSyncText } from "./timing";

defineProps<{ rows: ReplicationRow[]; now: number }>();

const fixedWidth = (width: string) => ({ class: { th: width } });

const columns: TableColumn<ReplicationRow>[] = [
  { id: "source", header: "Source" },
  { id: "target", header: "Target" },
  { id: "status", header: "Status", meta: fixedWidth("w-28") },
  { id: "cadence", header: "Cadence", meta: fixedWidth("w-32") },
  { id: "lastSync", header: "Last sync", meta: fixedWidth("w-28") },
  { id: "due", header: "Next due", meta: fixedWidth("w-32") },
];

const dueClass = (row: ReplicationRow) => {
  const { colour } = REPLICATION_STATUS_VOCABULARY[row.status];
  return colour === "neutral" ? "text-muted" : STATUS_TEXT_CLASS[colour];
};

const onSelectRow = (_event: Event, row: { original: ReplicationRow }) =>
  navigateTo(`/replications/${row.original.id}`);
</script>

<template>
  <UTable
    :data="rows"
    :columns="columns"
    :on-select="onSelectRow"
    :ui="{ base: 'table-fixed min-w-3xl' }"
    data-testid="replication-table"
  >
    <template #source-cell="{ row }">
      <span
        v-if="row.original.source"
        class="block truncate font-mono text-sm"
        :class="
          row.original.source.dataset.present ? 'text-toned' : 'text-dimmed'
        "
        :title="row.original.source.dataset.name"
      >
        {{ row.original.source.dataset.name }}
      </span>
      <span v-else class="text-dimmed text-sm">not monitored</span>
    </template>
    <template #target-cell="{ row }">
      <NuxtLink
        :to="`/replications/${row.original.id}`"
        class="block truncate font-mono text-sm hover:underline"
        :class="
          row.original.target.dataset.present
            ? 'text-highlighted'
            : 'text-dimmed'
        "
        :title="row.original.target.dataset.name"
      >
        {{ row.original.target.dataset.name }}
      </NuxtLink>
    </template>
    <template #status-cell="{ row }">
      <ReplicationStatusLabel :status="row.original.status" />
    </template>
    <template #cadence-cell="{ row }">
      <ReplicationCadence
        :interval-sec="row.original.intervalSec"
        :manual="row.original.intervalManual"
      />
    </template>
    <template #lastSync-cell="{ row }">
      <span
        class="tabular"
        :class="row.original.lastSyncAt ? 'text-muted' : 'text-dimmed'"
      >
        {{ lastSyncText(row.original, now) }}
      </span>
    </template>
    <template #due-cell="{ row }">
      <span class="tabular" :class="dueClass(row.original)">
        {{ dueText(row.original, now) }}
      </span>
    </template>
  </UTable>
</template>
