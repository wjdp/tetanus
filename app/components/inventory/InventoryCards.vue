<script setup lang="ts">
import { interfaceLabel } from "#shared/hardware";
import { displayModel } from "#shared/model";
import { usageColour, usageShort } from "#shared/usage";
import { DEVICE_STATUS_VOCABULARY, PURPOSE_BADGE } from "~/utils/vocabulary";
import { SORT_FIELDS, sortDisks } from "./inventorySort";
import {
  type InventoryDisk,
  type SortingState,
  temperatureClass,
  warrantyClass,
  warrantyLabel,
} from "./types";

const props = defineProps<{ disks: InventoryDisk[] }>();

const sorting = defineModel<SortingState>("sorting", {
  default: () => [{ id: "alias", desc: false }],
});

const sortItems = SORT_FIELDS.map(({ id, label }) => ({ value: id, label }));

const sortId = computed({
  get: () => sorting.value[0]?.id ?? "alias",
  set: (id: string) => {
    sorting.value = [{ id, desc: sorting.value[0]?.desc ?? false }];
  },
});

const descending = computed(() => sorting.value[0]?.desc ?? false);

const toggleDirection = () => {
  sorting.value = [{ id: sortId.value, desc: !descending.value }];
};

const sortedDisks = computed(() => sortDisks(props.disks, sorting.value));
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="inventory-cards">
    <div class="flex items-center gap-2">
      <span class="text-muted text-sm">Sort by</span>
      <USelect
        v-model="sortId"
        :items="sortItems"
        size="sm"
        class="w-36"
        aria-label="Sort disks by"
      />
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        :icon="descending ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'"
        :aria-label="descending ? 'Sort ascending' : 'Sort descending'"
        @click="toggleDirection"
      />
    </div>

    <p v-if="sortedDisks.length === 0" class="text-muted py-6 text-center text-sm">
      No disks match the filters.
    </p>

    <ul v-else class="flex flex-col gap-2">
      <li v-for="disk in sortedDisks" :key="disk.id">
        <NuxtLink
          :to="`/disks/${disk.id}`"
          class="bg-elevated border-default hover:border-accented flex flex-col gap-3 rounded-md border p-3 transition-colors"
          data-testid="inventory-card"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-col">
              <span class="text-highlighted font-semibold">
                {{ disk.alias ?? disk.serial ?? "—" }}
              </span>
              <span class="text-muted truncate text-sm">{{ displayModel(disk.model, disk.vendor) ?? "—" }}</span>
              <span
                v-if="disk.alias"
                class="text-dimmed truncate font-mono text-xs"
              >
                {{ disk.serial ?? "—" }}
              </span>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
              <span
                class="text-muted flex items-center gap-1.5 text-sm"
                :title="DEVICE_STATUS_VOCABULARY[disk.latestStatus].label"
              >
                <TopologyStatusDot
                  :colour="DEVICE_STATUS_VOCABULARY[disk.latestStatus].colour"
                  :shape="DEVICE_STATUS_VOCABULARY[disk.latestStatus].shape"
                />
                {{ disk.latestStatus }}
              </span>
              <LifecycleBadge
                :state="disk.state"
                :overridden="disk.stateOverride !== null"
                :as-of="disk.stateAsOf"
                size="sm"
              />
            </div>
          </div>

          <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
            <div class="flex flex-col">
              <dt class="text-dimmed text-xs">Capacity</dt>
              <dd class="tabular-nums">{{ formatBytes(disk.capacityBytes) }}</dd>
            </div>
            <div class="flex min-w-0 flex-col">
              <dt class="text-dimmed text-xs">Host</dt>
              <dd class="truncate">{{ disk.hostName ?? "—" }}</dd>
            </div>
            <div class="flex min-w-0 flex-col">
              <dt class="text-dimmed text-xs">Pool</dt>
              <dd v-if="disk.membership" class="truncate">
                {{ disk.membership.poolName }}
              </dd>
              <dd v-else-if="disk.purpose">
                <UBadge
                  v-bind="PURPOSE_BADGE[disk.purpose]"
                  :class="{ italic: disk.purposeInferred }"
                  :title="disk.purposeInferred ? 'Purpose inferred from usage' : undefined"
                />
              </dd>
              <dd v-else class="text-dimmed">—</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-dimmed text-xs">Temp</dt>
              <dd class="tabular-nums" :class="temperatureClass(disk)">
                {{ formatCelsius(disk.latestTemp) }}
              </dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-dimmed text-xs">Power-on</dt>
              <dd class="tabular-nums">{{ formatHours(disk.latestPowerOnHours) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-dimmed text-xs">Warranty</dt>
              <dd class="tabular-nums" :class="warrantyClass(disk.warrantyDaysLeft)">
                {{ warrantyLabel(disk.warrantyDaysLeft) }}
              </dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-dimmed text-xs">Media</dt>
              <dd v-if="mediaLabel(disk.media, disk.rotationRate)" class="flex items-center gap-1">
                <MediaGlyph :media="disk.media" :size="16" class="text-muted" />
                {{ mediaLabel(disk.media, disk.rotationRate) }}
              </dd>
              <dd v-else class="text-dimmed">—</dd>
            </div>
            <div class="flex min-w-0 flex-col">
              <dt class="text-dimmed text-xs">Interface</dt>
              <dd class="truncate">
                {{ interfaceLabel(disk.interface, disk.link) ?? "—" }}
              </dd>
            </div>
            <div class="flex flex-col items-start">
              <dt class="text-dimmed text-xs">Recording</dt>
              <dd v-if="recordingBadge(disk)">
                <UBadge v-bind="recordingBadge(disk)" size="xs" />
              </dd>
              <dd v-else class="text-dimmed">—</dd>
            </div>
            <div class="col-span-3 flex min-w-0 flex-col items-start">
              <dt class="text-dimmed text-xs">Usage</dt>
              <dd class="max-w-full">
                <UBadge
                  size="xs"
                  variant="subtle"
                  :color="usageColour(disk.usage.kind)"
                  :class="{ 'opacity-60': disk.usage.kind === 'empty' }"
                  class="max-w-full truncate"
                >
                  {{ usageShort(disk.usage, disk.membership?.poolName ?? null) }}
                </UBadge>
              </dd>
            </div>
          </dl>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
