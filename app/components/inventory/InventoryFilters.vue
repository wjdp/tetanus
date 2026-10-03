<script setup lang="ts">
import type { EffectiveDiskState } from "#shared/disk";
import { interfaceLabel } from "#shared/hardware";
import { DEVICE_STATUSES, type DeviceStatus } from "#shared/smart/status";
import { PURPOSES, USAGE_KINDS } from "#shared/usage";
import { VENDORS } from "#shared/vendor";
import { ENTITY_ICON, LIFECYCLE_VOCABULARY } from "~/utils/vocabulary";
import {
  ALL,
  CLEARED_FILTERS,
  disposedCount,
  facetCounts,
  INTERFACE_OPTIONS,
  type InventoryFilterState,
  isFacetActive,
  isFiltered,
  LIFECYCLE_STATES,
  MEDIA_OPTIONS,
  NONE,
  RECORDING_OPTIONS,
  type SingleFacet,
} from "./filterDisks";
import type { FilterOption } from "./InventoryFilterSelect.vue";
import type { InventoryDisk } from "./types";

const props = defineProps<{ disks: InventoryDisk[] }>();

const filters = defineModel<InventoryFilterState>({ required: true });

const counts = computed(() => facetCounts(props.disks, filters.value));

const update = (patch: Partial<InventoryFilterState>) => {
  filters.value = { ...filters.value, ...patch };
};

const namesWithSelected = (names: (string | undefined)[], selected: string) =>
  [
    ...new Set([
      ...names.filter((name): name is string => Boolean(name)),
      ...(selected === ALL || selected === NONE ? [] : [selected]),
    ]),
  ].sort();

const nameOptions = (names: string[]): FilterOption[] =>
  names.map((name) => ({ label: name, value: name }));

const hostOptions = computed<FilterOption[]>(() => [
  { label: "All hosts", value: ALL },
  ...nameOptions(
    namesWithSelected(
      props.disks.map(({ hostName }) => hostName ?? undefined),
      filters.value.host,
    ),
  ),
  { label: "No host", value: NONE },
]);

const poolOptions = computed<FilterOption[]>(() => [
  { label: "All pools", value: ALL },
  ...nameOptions(
    namesWithSelected(
      props.disks.map(({ membership }) => membership?.poolName),
      filters.value.pool,
    ),
  ),
  { label: "No pool", value: NONE },
]);

const stateOptions: FilterOption[] = LIFECYCLE_STATES.map((state) => ({
  value: state,
  label: LIFECYCLE_VOCABULARY[state].label,
  icon: LIFECYCLE_VOCABULARY[state].icon,
}));

const capitalise = (word: string) => word[0]?.toUpperCase() + word.slice(1);

const statusOptions: FilterOption[] = DEVICE_STATUSES.map((status) => ({
  value: status,
  label: capitalise(status),
  status,
}));

interface PopoverFilter {
  facet: SingleFacet;
  icon: string;
  options: FilterOption[];
}

const POPOVER_FILTERS: PopoverFilter[] = [
  {
    facet: "usage",
    icon: "i-lucide-pie-chart",
    options: [
      { label: "All usage", value: ALL },
      ...USAGE_KINDS.map((kind) => ({ label: kind, value: kind })),
    ],
  },
  {
    facet: "purpose",
    icon: "i-lucide-bookmark",
    options: [
      { label: "All purposes", value: ALL },
      ...PURPOSES.map((purpose) => ({ label: purpose, value: purpose })),
      { label: "No purpose", value: NONE },
    ],
  },
  {
    facet: "media",
    icon: ENTITY_ICON.disk,
    options: [
      { label: "All media", value: ALL },
      ...MEDIA_OPTIONS.map((media) => ({
        label: mediaLabel(media, null) ?? media,
        value: media,
        media,
      })),
      { label: "Unknown media", value: NONE },
    ],
  },
  {
    facet: "interface",
    icon: "i-lucide-cable",
    options: [
      { label: "All interfaces", value: ALL },
      ...INTERFACE_OPTIONS.map((driveInterface) => ({
        label: interfaceLabel(driveInterface, null) ?? driveInterface,
        value: driveInterface,
      })),
      { label: "No interface", value: NONE },
    ],
  },
  {
    facet: "recording",
    icon: "i-lucide-disc-3",
    options: [
      { label: "All recording", value: ALL },
      ...RECORDING_OPTIONS.map((tech) => ({
        label: tech.toUpperCase(),
        value: tech,
      })),
      { label: "No recording", value: NONE },
    ],
  },
  {
    facet: "vendor",
    icon: "i-lucide-factory",
    options: [
      { label: "All vendors", value: ALL },
      ...VENDORS.map((vendor) => ({
        label: vendorLabel(vendor) ?? vendor,
        value: vendor,
      })),
      { label: "No vendor", value: NONE },
    ],
  },
];

const disposed = computed(() => disposedCount(props.disks, filters.value));

const popoverActiveCount = computed(
  () =>
    POPOVER_FILTERS.filter(({ facet }) => isFacetActive(filters.value, facet))
      .length + (filters.value.includeDisposed ? 1 : 0),
);
</script>

<template>
  <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
    <UInput
      :model-value="filters.search"
      icon="i-lucide-search"
      placeholder="Search alias, model, serial"
      class="col-span-2 sm:w-64"
      aria-label="Search disks"
      @update:model-value="update({ search: String($event) })"
    />
    <InventoryFilterSelect
      :model-value="filters.host"
      :options="hostOptions"
      :icon="ENTITY_ICON.host"
      :counts="counts.host"
      class="min-w-0 sm:w-40"
      aria-label="Filter by host"
      @update:model-value="update({ host: String($event) })"
    />
    <InventoryFilterSelect
      :model-value="filters.pool"
      :options="poolOptions"
      :icon="ENTITY_ICON.pool"
      :counts="counts.pool"
      class="min-w-0 sm:w-40"
      aria-label="Filter by pool"
      @update:model-value="update({ pool: String($event) })"
    />
    <InventoryFilterSelect
      :model-value="filters.states"
      :options="stateOptions"
      icon="i-lucide-tags"
      :counts="counts.states"
      placeholder="All states"
      class="min-w-0 sm:w-44"
      aria-label="Filter by state"
      @update:model-value="update({ states: $event as EffectiveDiskState[] })"
    />
    <InventoryFilterSelect
      :model-value="filters.statuses"
      :options="statusOptions"
      icon="i-lucide-heart-pulse"
      :counts="counts.statuses"
      placeholder="All statuses"
      class="min-w-0 sm:w-44"
      aria-label="Filter by status"
      @update:model-value="update({ statuses: $event as DeviceStatus[] })"
    />
    <UPopover :content="{ align: 'start' }">
      <UButton
        :color="popoverActiveCount ? 'primary' : 'neutral'"
        :variant="popoverActiveCount ? 'soft' : 'outline'"
        icon="i-lucide-sliders-horizontal"
        label="Filters"
        class="justify-center"
        data-testid="more-filters"
      >
        <template v-if="popoverActiveCount" #trailing>
          <UBadge
            :label="String(popoverActiveCount)"
            color="primary"
            size="sm"
            class="tabular-nums"
            data-testid="more-filters-count"
          />
        </template>
      </UButton>
      <template #content>
        <div class="flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-2 p-2">
          <InventoryFilterSelect
            v-for="filter in POPOVER_FILTERS"
            :key="filter.facet"
            :model-value="filters[filter.facet]"
            :options="filter.options"
            :icon="filter.icon"
            :counts="counts[filter.facet]"
            class="w-full"
            :aria-label="`Filter by ${filter.facet}`"
            @update:model-value="update({ [filter.facet]: String($event) })"
          />
          <div class="px-1 py-1.5" data-testid="include-disposed">
            <USwitch
              :model-value="filters.includeDisposed"
              @update:model-value="update({ includeDisposed: $event })"
            >
              <template #label>
                Include disposed
                <span class="text-dimmed tabular-nums">{{ disposed }}</span>
              </template>
            </USwitch>
          </div>
        </div>
      </template>
    </UPopover>
    <UButton
      v-if="isFiltered(filters)"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      label="Clear"
      class="justify-self-start"
      @click="filters = { ...CLEARED_FILTERS }"
    />
  </div>
</template>
