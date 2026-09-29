<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";
import { isScanActive, scanEndedAt } from "~/components/pool/scan";
import { capacityColour, zfsStateColour } from "~/utils/vocabulary";

useSeoMeta({ title: getPageTitle("ZFS") });

const { data: pools } = await useFetch("/api/pools");

type Pool = NonNullable<typeof pools.value>[number];

const columns: TableColumn<Pool>[] = [
  { id: "host", header: "Host" },
  { accessorKey: "name", header: "Pool" },
  { accessorKey: "state", header: "State" },
  { id: "size", header: "Size" },
  { id: "alloc", header: "Alloc" },
  { id: "free", header: "Free" },
  { id: "cap", header: "Cap" },
  { id: "frag", header: "Frag" },
  { id: "dedup", header: "Dedup" },
  { id: "lastScrub", header: "Last scrub" },
  { id: "errors", header: "Data errors" },
];

const lastScrub = (pool: Pool) => {
  if (!pool.scan) return "—";
  if (isScanActive(pool.scan)) return `${pool.scan.function.toLowerCase()} running`;
  const date = formatDate(scanEndedAt(pool.scan));
  return pool.scan.errors > 0 ? `${date} · ${pool.scan.errors} errors` : date;
};

const percent = (value: number | null) => (value === null ? "—" : `${value} %`);

const onSelectRow = (_event: Event, row: { original: Pool }) =>
  navigateTo(`/zfs/${row.original.id}`);
</script>

<template>
  <AppPanel title="ZFS" class="max-w-7xl">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      ZFS
    </h1>

    <UTable
      :data="pools ?? []"
      :columns="columns"
      empty="No pools reported yet."
      :on-select="onSelectRow"
      class="mt-6"
    >
      <template #host-cell="{ row }">
        {{ row.original.host.displayName || row.original.host.name }}
      </template>
      <template #name-cell="{ row }">
        <NuxtLink
          :to="`/zfs/${row.original.id}`"
          class="text-highlighted font-semibold hover:underline"
        >
          {{ row.original.name }}
        </NuxtLink>
      </template>
      <template #state-cell="{ row }">
        <UBadge
          :color="zfsStateColour(row.original.state)"
          variant="subtle"
          size="sm"
        >
          {{ row.original.state }}
        </UBadge>
      </template>
      <template #size-cell="{ row }">
        <span class="tabular">{{ formatBytes(row.original.sizeBytes) }}</span>
      </template>
      <template #alloc-cell="{ row }">
        <span class="tabular">{{ formatBytes(row.original.allocBytes) }}</span>
      </template>
      <template #free-cell="{ row }">
        <span class="tabular">{{ formatBytes(row.original.freeBytes) }}</span>
      </template>
      <template #cap-cell="{ row }">
        <div class="flex min-w-20 flex-col gap-1">
          <span class="tabular">{{ percent(row.original.cap) }}</span>
          <UProgress
            v-if="row.original.cap !== null"
            :model-value="row.original.cap"
            :color="capacityColour(row.original.cap)"
            size="2xs"
            data-testid="pool-capacity-bar"
          />
        </div>
      </template>
      <template #frag-cell="{ row }">
        <span class="tabular">{{ percent(row.original.frag) }}</span>
      </template>
      <template #dedup-cell="{ row }">
        <span class="tabular">
          {{ row.original.dedup === null ? "—" : `${row.original.dedup.toFixed(2)}×` }}
        </span>
      </template>
      <template #lastScrub-cell="{ row }">
        <span
          class="tabular"
          :class="(row.original.scan?.errors ?? 0) > 0 ? 'text-warning' : ''"
        >
          {{ lastScrub(row.original) }}
        </span>
      </template>
      <template #errors-cell="{ row }">
        <span
          class="tabular"
          :class="(row.original.errors ?? 0) > 0 ? 'text-error' : ''"
        >
          {{ row.original.errors ?? "—" }}
        </span>
      </template>
    </UTable>
  </AppPanel>
</template>
