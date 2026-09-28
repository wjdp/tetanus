<script setup lang="ts">
export interface InventoryFilterState {
  host: string;
  pool: string;
  states: string[];
  search: string;
}

const props = defineProps<{
  hosts: string[];
  pools: string[];
  states: string[];
}>();

const filters = defineModel<InventoryFilterState>({ required: true });

const hostItems = computed(() => [
  { label: "All hosts", value: ALL_HOSTS },
  ...props.hosts.map((host) => ({ label: host, value: host })),
  { label: "No host", value: NO_HOST },
]);

const poolItems = computed(() => [
  { label: "All pools", value: ALL_POOLS },
  ...props.pools.map((pool) => ({ label: pool, value: pool })),
  { label: "No pool", value: NO_POOL },
]);

const isFiltered = computed(
  () =>
    filters.value.search ||
    filters.value.host !== ALL_HOSTS ||
    filters.value.pool !== ALL_POOLS ||
    filters.value.states.length,
);

const update = (patch: Partial<InventoryFilterState>) => {
  filters.value = { ...filters.value, ...patch };
};
</script>

<script lang="ts">
export const ALL_HOSTS = "*";
export const NO_HOST = "-";
export const ALL_POOLS = "*";
export const NO_POOL = "-";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UInput
      :model-value="filters.search"
      icon="i-lucide-search"
      placeholder="Search alias, model, serial"
      class="w-64"
      aria-label="Search disks"
      @update:model-value="update({ search: String($event) })"
    />
    <USelect
      :model-value="filters.host"
      :items="hostItems"
      class="w-40"
      aria-label="Filter by host"
      @update:model-value="update({ host: String($event) })"
    />
    <USelect
      :model-value="filters.pool"
      :items="poolItems"
      class="w-40"
      aria-label="Filter by pool"
      @update:model-value="update({ pool: String($event) })"
    />
    <USelect
      :model-value="filters.states"
      :items="states"
      multiple
      placeholder="All states"
      class="w-48"
      aria-label="Filter by state"
      @update:model-value="update({ states: $event as string[] })"
    />
    <UButton
      v-if="isFiltered"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      label="Clear"
      @click="update({ search: '', host: ALL_HOSTS, pool: ALL_POOLS, states: [] })"
    />
  </div>
</template>
