<script setup lang="ts">
import type { EffectiveDiskState } from "#shared/disk";
import { PURPOSES, USAGE_KINDS } from "#shared/usage";
import { VENDORS } from "#shared/vendor";
import {
  ALL,
  CLEARED_FILTERS,
  type InventoryFilterState,
  isFiltered,
  NONE,
} from "./filterDisks";

const props = defineProps<{
  hosts: string[];
  pools: string[];
  states: string[];
}>();

const filters = defineModel<InventoryFilterState>({ required: true });

const hostItems = computed(() => [
  { label: "All hosts", value: ALL },
  ...props.hosts.map((host) => ({ label: host, value: host })),
  { label: "No host", value: NONE },
]);

const poolItems = computed(() => [
  { label: "All pools", value: ALL },
  ...props.pools.map((pool) => ({ label: pool, value: pool })),
  { label: "No pool", value: NONE },
]);

const usageItems = [
  { label: "All usage", value: ALL },
  ...USAGE_KINDS.map((kind) => ({ label: kind, value: kind })),
];

const purposeItems = [
  { label: "All purposes", value: ALL },
  ...PURPOSES.map((purpose) => ({ label: purpose, value: purpose })),
  { label: "No purpose", value: NONE },
];

const mediaItems = [
  { label: "All media", value: ALL },
  { label: "HDD", value: "hdd" },
  { label: "SSD", value: "ssd" },
  { label: "Unknown media", value: NONE },
];

const interfaceItems = [
  { label: "All interfaces", value: ALL },
  { label: "SATA", value: "sata" },
  { label: "SAS", value: "sas" },
  { label: "NVMe", value: "nvme" },
  { label: "USB", value: "usb" },
  { label: "No interface", value: NONE },
];

const recordingItems = [
  { label: "All recording", value: ALL },
  { label: "CMR", value: "cmr" },
  { label: "SMR", value: "smr" },
  { label: "No recording", value: NONE },
];

const vendorItems = [
  { label: "All vendors", value: ALL },
  ...VENDORS.map((vendor) => ({ label: vendorLabel(vendor) ?? vendor, value: vendor })),
  { label: "No vendor", value: NONE },
];

const update = (patch: Partial<InventoryFilterState>) => {
  filters.value = { ...filters.value, ...patch };
};
</script>

<template>
  <div class="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
    <UInput
      :model-value="filters.search"
      icon="i-lucide-search"
      placeholder="Search alias, model, serial"
      class="col-span-3 sm:w-64"
      aria-label="Search disks"
      @update:model-value="update({ search: String($event) })"
    />
    <USelect
      :model-value="filters.host"
      :items="hostItems"
      class="min-w-0 sm:w-40"
      aria-label="Filter by host"
      @update:model-value="update({ host: String($event) })"
    />
    <USelect
      :model-value="filters.pool"
      :items="poolItems"
      class="min-w-0 sm:w-40"
      aria-label="Filter by pool"
      @update:model-value="update({ pool: String($event) })"
    />
    <USelect
      :model-value="filters.usage"
      :items="usageItems"
      placeholder="All usage"
      class="min-w-0 sm:w-36"
      aria-label="Filter by usage"
      @update:model-value="update({ usage: String($event) })"
    />
    <USelect
      :model-value="filters.purpose"
      :items="purposeItems"
      placeholder="All purposes"
      class="min-w-0 sm:w-36"
      aria-label="Filter by purpose"
      @update:model-value="update({ purpose: String($event) })"
    />
    <USelect
      :model-value="filters.media"
      :items="mediaItems"
      class="min-w-0 sm:w-36"
      aria-label="Filter by media"
      @update:model-value="update({ media: String($event) })"
    />
    <USelect
      :model-value="filters.interface"
      :items="interfaceItems"
      class="min-w-0 sm:w-40"
      aria-label="Filter by interface"
      @update:model-value="update({ interface: String($event) })"
    />
    <USelect
      :model-value="filters.recording"
      :items="recordingItems"
      class="min-w-0 sm:w-36"
      aria-label="Filter by recording"
      @update:model-value="update({ recording: String($event) })"
    />
    <USelect
      :model-value="filters.vendor"
      :items="vendorItems"
      class="min-w-0 sm:w-36"
      aria-label="Filter by vendor"
      @update:model-value="update({ vendor: String($event) })"
    />
    <USelect
      :model-value="filters.states"
      :items="states"
      multiple
      placeholder="All states"
      class="min-w-0 sm:w-48"
      aria-label="Filter by state"
      @update:model-value="update({ states: $event as EffectiveDiskState[] })"
    />
    <UButton
      v-if="isFiltered(filters)"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      label="Clear"
      class="col-span-3 justify-self-start"
      @click="filters = { ...CLEARED_FILTERS }"
    />
  </div>
</template>
