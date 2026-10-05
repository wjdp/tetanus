<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";
import { isScanActive, scanEndedAt } from "~/components/pool/scan";
import { capacityColour } from "~/utils/vocabulary";

useSeoMeta({ title: getPageTitle("ZFS") });

const { formatZfsBytes } = useZfsByteSystem();

const route = useRoute();
const router = useRouter();

const showArchived = computed({
  get: () => route.query.archived === "include",
  set: (show: boolean) =>
    router.replace({
      query: { ...route.query, archived: show ? "include" : undefined },
    }),
});

const { data: pools } = await useFetch("/api/pools", {
  query: computed(() => ({
    archived: showArchived.value ? "include" : "exclude",
  })),
});

type Pool = NonNullable<typeof pools.value>[number];

const columns: TableColumn<Pool>[] = [
  { id: "host", header: "Host" },
  { accessorKey: "name", header: "Pool" },
  { id: "state", accessorKey: "displayState", header: "State" },
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
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
        ZFS
      </h1>
      <ZfsByteUnitToggle class="ms-auto" />
      <USwitch
        v-model="showArchived"
        label="Show archived"
        size="sm"
        data-testid="show-archived"
      />
    </div>

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
        <div class="flex items-center gap-2">
          <NuxtLink
            :to="`/zfs/${row.original.id}`"
            class="font-semibold hover:underline"
            :class="row.original.archivedAt ? 'text-muted' : 'text-highlighted'"
          >
            {{ row.original.name }}
          </NuxtLink>
          <UBadge
            v-if="row.original.archivedAt"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-archive"
            label="archived"
            data-testid="pool-archived-badge"
          />
        </div>
      </template>
      <template #state-cell="{ row }">
        <PoolStateBadge :pool="row.original" size="sm" />
      </template>
      <template #size-cell="{ row }">
        <span class="tabular">{{ formatZfsBytes(row.original.sizeBytes) }}</span>
      </template>
      <template #alloc-cell="{ row }">
        <span class="tabular">{{ formatZfsBytes(row.original.allocBytes) }}</span>
      </template>
      <template #free-cell="{ row }">
        <span class="tabular">{{ formatZfsBytes(row.original.freeBytes) }}</span>
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
