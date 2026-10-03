<script setup lang="ts">
import { interfaceLabel, sectorFormat } from "#shared/hardware";
import { displayModel } from "#shared/model";
import { usageColour, usageShort } from "#shared/usage";
import { DEVICE_STATUS_VOCABULARY, PURPOSE_BADGE } from "~/utils/vocabulary";
import type { InventoryColumn } from "./columns";
import {
  type InventoryDisk,
  temperatureClass,
  warrantyClass,
  warrantyLabel,
} from "./types";

const props = withDefaults(
  defineProps<{
    column: InventoryColumn;
    disk: InventoryDisk;
    linked?: boolean;
  }>(),
  { linked: true },
);

const isEmpty = computed(() => props.column.value(props.disk) === null);

const status = computed(() => DEVICE_STATUS_VOCABULARY[props.disk.latestStatus]);
</script>

<template>
  <span v-if="isEmpty" class="text-dimmed">—</span>

  <NuxtLink
    v-else-if="column.id === 'alias' && linked"
    :to="`/disks/${disk.id}`"
    class="text-highlighted hover:text-primary font-medium"
    @click.stop
  >
    {{ disk.alias }}
  </NuxtLink>

  <span v-else-if="column.id === 'alias'" class="text-highlighted font-medium">
    {{ disk.alias }}
  </span>

  <div v-else-if="column.id === 'model'" class="flex flex-col">
    <span>{{ displayModel(disk.model, disk.vendor) }}</span>
    <span class="text-dimmed font-mono text-xs">{{ disk.serial ?? "—" }}</span>
  </div>

  <span v-else-if="column.id === 'capacity'" class="tabular-nums">
    {{ formatBytes(disk.capacityBytes) }}
  </span>

  <span v-else-if="column.id === 'vendor'">{{ vendorLabel(disk.vendor) }}</span>

  <span v-else-if="column.id === 'media'" class="flex items-center gap-1.5">
    <MediaGlyph :media="disk.media" :size="16" class="text-muted" />
    {{ mediaLabel(disk.media, disk.rotationRate) }}
  </span>

  <span v-else-if="column.id === 'interface'">
    {{ interfaceLabel(disk.interface, disk.link) }}
  </span>

  <UBadge
    v-else-if="column.id === 'recording'"
    v-bind="recordingBadge(disk) ?? {}"
    size="xs"
  />

  <span v-else-if="column.id === 'sectors'" class="tabular-nums">
    {{ sectorFormat(disk.logicalBlockSize, disk.physicalBlockSize) }}
  </span>

  <span v-else-if="column.id === 'host'">{{ disk.hostName }}</span>

  <NuxtLink
    v-else-if="column.id === 'pool' && disk.membership && linked"
    :to="`/zfs/${disk.membership.poolId}`"
    class="text-default hover:text-primary"
    @click.stop
  >
    {{ disk.membership.poolName }}
  </NuxtLink>

  <span v-else-if="column.id === 'pool' && disk.membership">
    {{ disk.membership.poolName }}
  </span>

  <UBadge
    v-else-if="column.id === 'pool' && disk.purpose"
    v-bind="PURPOSE_BADGE[disk.purpose]"
    :class="{ italic: disk.purposeInferred }"
    :title="disk.purposeInferred ? 'Purpose inferred from usage' : undefined"
  />

  <UBadge
    v-else-if="column.id === 'usage'"
    size="xs"
    variant="subtle"
    :color="usageColour(disk.usage.kind)"
    :class="{ 'opacity-60': disk.usage.kind === 'empty' }"
    class="max-w-full truncate"
  >
    {{ usageShort(disk.usage, disk.membership?.poolName ?? null) }}
  </UBadge>

  <LifecycleBadge
    v-else-if="column.id === 'state'"
    :state="disk.state"
    :overridden="disk.stateOverride !== null"
    :as-of="disk.stateAsOf"
    size="sm"
  />

  <span
    v-else-if="column.id === 'status'"
    class="text-muted flex items-center gap-1.5"
    :title="status.label"
  >
    <TopologyStatusDot :colour="status.colour" :shape="status.shape" class="size-1.5!" />
    {{ disk.latestStatus }}
  </span>

  <span
    v-else-if="column.id === 'temp'"
    class="tabular-nums"
    :class="temperatureClass(disk)"
    data-testid="inventory-temp"
  >
    {{ formatCelsius(disk.latestTemp) }}
  </span>

  <span v-else-if="column.id === 'powerOn'" class="tabular-nums">
    {{ formatHours(disk.latestPowerOnHours) }}
  </span>

  <span v-else-if="column.id === 'age'" class="tabular-nums">
    {{ formatDays(disk.ageDays) }}
  </span>

  <span
    v-else-if="column.id === 'warranty'"
    class="tabular-nums"
    :class="warrantyClass(disk.warrantyDaysLeft)"
    :data-warranty-days="disk.warrantyDaysLeft"
  >
    {{ warrantyLabel(disk.warrantyDaysLeft) }}
  </span>

  <UIcon
    v-else-if="column.id === 'pin33'"
    name="i-lucide-check"
    class="text-muted size-4"
    aria-label="3.3 V pin taped"
  />

  <span v-else>{{ column.value(disk) }}</span>
</template>
