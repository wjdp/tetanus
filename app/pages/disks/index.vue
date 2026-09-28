<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import {
  ALL_HOSTS,
  ALL_POOLS,
  type InventoryFilterState,
  NO_HOST,
  NO_POOL,
} from "~/components/inventory/InventoryFilters.vue";

useSeoMeta({ title: getPageTitle("Disks") });

const POLL_MS = 60_000;

const { data: disks, refresh } = await useFetch("/api/disks");

let pollHandle: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  pollHandle = setInterval(refresh, POLL_MS);
});
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});

const filters = ref<InventoryFilterState>({
  host: ALL_HOSTS,
  pool: ALL_POOLS,
  states: [],
  search: "",
});

const allDisks = computed(() => disks.value ?? []);

const hosts = computed(() =>
  [
    ...new Set(
      allDisks.value.flatMap((row) => (row.hostName ? [row.hostName] : [])),
    ),
  ].sort(),
);

const pools = computed(() =>
  [
    ...new Set(
      allDisks.value.flatMap((row) =>
        row.membership ? [row.membership.poolName] : [],
      ),
    ),
  ].sort(),
);

const states = computed(() =>
  [...new Set(allDisks.value.map((row) => row.state))].sort(),
);

const visibleDisks = computed(() => {
  const { host, pool, states: wantedStates, search } = filters.value;
  const needle = search.trim().toLowerCase();
  return allDisks.value.filter((row) => {
    if (host === NO_HOST && row.hostName !== null) return false;
    if (host !== ALL_HOSTS && host !== NO_HOST && row.hostName !== host) {
      return false;
    }
    const poolName = row.membership?.poolName ?? null;
    if (pool === NO_POOL && poolName !== null) return false;
    if (pool !== ALL_POOLS && pool !== NO_POOL && poolName !== pool) {
      return false;
    }
    if (wantedStates.length && !wantedStates.includes(row.state)) return false;
    if (!needle) return true;
    return [row.alias, row.model, row.serial].some((value) =>
      value?.toLowerCase().includes(needle),
    );
  });
});

const countLabel = computed(() =>
  visibleDisks.value.length === allDisks.value.length
    ? `${allDisks.value.length}`
    : `${visibleDisks.value.length} of ${allDisks.value.length}`,
);
</script>

<template>
  <AppPanel title="Disks" class="flex max-w-7xl flex-col gap-6">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Disks
      <span class="text-muted font-normal tabular-nums" data-testid="disk-count">
        · {{ countLabel }}
      </span>
    </h1>

    <div
      v-if="allDisks.length === 0"
      class="border-default flex flex-col items-start gap-2 rounded-md border border-dashed p-6"
    >
      <p class="text-highlighted font-medium">No disks yet.</p>
      <p class="text-muted text-sm">
        Disks appear once a collector reports.
        <NuxtLink to="/settings/hosts" class="text-highlighted hover:text-primary underline">
          Settings › Hosts
        </NuxtLink>
        has the install command; an Obsidian table can be pasted under
        <NuxtLink to="/settings/import" class="text-highlighted hover:text-primary underline">
          Settings › Import
        </NuxtLink>.
      </p>
    </div>

    <template v-else>
      <InventoryFilters v-model="filters" :hosts="hosts" :pools="pools" :states="states" />
      <InventoryTable :disks="visibleDisks" />
    </template>
  </AppPanel>
</template>
