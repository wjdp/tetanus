<script setup lang="ts">
import { PURPOSES, USAGE_KINDS } from "#shared/usage";
import { VENDORS } from "#shared/vendor";

const props = defineProps<{
  hosts: string[];
  pools: string[];
  states: string[];
}>();

const filters = defineModel<InventoryFilterState>({ required: true });
const showSectors = defineModel<boolean>("showSectors", { default: false });

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

const usageItems = [
  { label: "All usage", value: ALL_USAGE },
  ...USAGE_KINDS.map((kind) => ({ label: kind, value: kind })),
];

const purposeItems = [
  { label: "All purposes", value: ALL_PURPOSES },
  ...PURPOSES.map((purpose) => ({ label: purpose, value: purpose })),
  { label: "No purpose", value: NO_PURPOSE },
];

const mediaItems = [
  { label: "All media", value: ALL_MEDIA },
  { label: "HDD", value: "hdd" },
  { label: "SSD", value: "ssd" },
  { label: "Unknown media", value: NO_MEDIA },
];

const interfaceItems = [
  { label: "All interfaces", value: ALL_INTERFACES },
  { label: "SATA", value: "sata" },
  { label: "SAS", value: "sas" },
  { label: "NVMe", value: "nvme" },
  { label: "USB", value: "usb" },
  { label: "No interface", value: NO_INTERFACE },
];

const recordingItems = [
  { label: "All recording", value: ALL_RECORDING },
  { label: "CMR", value: "cmr" },
  { label: "SMR", value: "smr" },
  { label: "No recording", value: NO_RECORDING },
];

const vendorItems = [
  { label: "All vendors", value: ALL_VENDORS },
  ...VENDORS.map((vendor) => ({ label: vendorLabel(vendor) ?? vendor, value: vendor })),
  { label: "No vendor", value: NO_VENDOR },
];

const isFiltered = computed(
  () =>
    filters.value.search ||
    filters.value.host !== ALL_HOSTS ||
    filters.value.pool !== ALL_POOLS ||
    filters.value.usage !== ALL_USAGE ||
    filters.value.purpose !== ALL_PURPOSES ||
    filters.value.media !== ALL_MEDIA ||
    filters.value.interface !== ALL_INTERFACES ||
    filters.value.recording !== ALL_RECORDING ||
    filters.value.vendor !== ALL_VENDORS ||
    filters.value.states.length,
);

const update = (patch: Partial<InventoryFilterState>) => {
  filters.value = { ...filters.value, ...patch };
};
</script>

<script lang="ts">
export interface InventoryFilterState {
  host: string;
  pool: string;
  usage: string;
  purpose: string;
  media: string;
  interface: string;
  recording: string;
  vendor: string;
  states: string[];
  search: string;
}

export const ALL_HOSTS = "*";
export const NO_HOST = "-";
export const ALL_POOLS = "*";
export const NO_POOL = "-";
export const ALL_USAGE = "*";
export const ALL_PURPOSES = "*";
export const NO_PURPOSE = "-";
export const ALL_MEDIA = "*";
export const NO_MEDIA = "-";
export const ALL_INTERFACES = "*";
export const NO_INTERFACE = "-";
export const ALL_RECORDING = "*";
export const NO_RECORDING = "-";
export const ALL_VENDORS = "*";
export const NO_VENDOR = "-";

export const CLEARED_FILTERS: InventoryFilterState = {
  search: "",
  host: ALL_HOSTS,
  pool: ALL_POOLS,
  usage: ALL_USAGE,
  purpose: ALL_PURPOSES,
  media: ALL_MEDIA,
  interface: ALL_INTERFACES,
  recording: ALL_RECORDING,
  vendor: ALL_VENDORS,
  states: [],
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
      @update:model-value="update({ states: $event as string[] })"
    />
    <UCheckbox
      v-model="showSectors"
      label="Sectors column"
      class="hidden md:flex"
      data-testid="show-sectors"
    />
    <UButton
      v-if="isFiltered"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      label="Clear"
      class="col-span-3 justify-self-start"
      @click="filters = { ...CLEARED_FILTERS }"
    />
  </div>
</template>
