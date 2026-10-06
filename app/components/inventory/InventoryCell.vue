<script setup lang="ts">
import { interfaceLabel, sectorFormat } from "#shared/hardware";
import { formatDuration } from "#shared/hostFreshness";
import { displayModel } from "#shared/model";
import { DEFAULT_CURRENCY, formatMoney, formatMoneyPerTb } from "#shared/money";
import { effectiveWarranty } from "#shared/warranty";
import { markdownToPlainText } from "~/utils/markdown";
import {
  DEVICE_STATUS_VOCABULARY,
  PURPOSE_BADGE,
  zfsStateColour,
} from "~/utils/vocabulary";
import { type InventoryColumn, vdevPlacement } from "./columns";
import InventoryStatusCounter from "./InventoryStatusCounter.vue";
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
    currency?: string;
    serialShown?: boolean;
    diskLabels?: ReadonlyMap<number, string>;
  }>(),
  {
    linked: true,
    currency: DEFAULT_CURRENCY,
    serialShown: false,
    diskLabels: () => new Map(),
  },
);

const isEmpty = computed(() => props.column.value(props.disk) === null);

const status = computed(() => DEVICE_STATUS_VOCABULARY[props.disk.latestStatus]);

const vdev = computed(() => vdevPlacement(props.disk.membership));

const FAULT_BADGES = [
  { bucket: "error", color: "error", variant: "solid", title: "open errors" },
  { bucket: "warning", color: "warning", variant: "solid", title: "open warnings" },
  { bucket: "acknowledged", color: "warning", variant: "subtle", title: "acknowledged" },
] as const;

const faultBadges = computed(() =>
  FAULT_BADGES.filter(({ bucket }) => props.disk.faultCounts[bucket] > 0),
);

const replacedByLabel = computed(() =>
  props.disk.replacedByDiskId === null
    ? null
    : props.diskLabels.get(props.disk.replacedByDiskId),
);

const notesText = computed(() => markdownToPlainText(props.disk.notes));

const sellerWarranty = computed(
  () => effectiveWarranty(props.disk.inventory)?.source === "seller",
);

const timeAgo = (value: string) =>
  `${formatDuration(Date.now() - Date.parse(value))} ago`;

const INFERRED_WRITTEN_TITLE =
  "Estimated: LBAs written × logical block size, the drive does not say its unit";
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
    <span v-if="!serialShown" class="text-dimmed font-mono text-xs">
      {{ disk.serial ?? "—" }}
    </span>
  </div>

  <span
    v-else-if="column.id === 'modelShort'"
    :class="{ 'text-dimmed': !disk.inventory.modelShort }"
    :title="disk.inventory.modelShort ? undefined : 'Not set: from the spec line or model'"
  >
    {{ disk.modelShort }}
  </span>

  <span v-else-if="column.id === 'serial'" class="font-mono text-xs">
    {{ disk.serial }}
  </span>

  <span v-else-if="column.id === 'capacity'" class="tabular-nums">
    {{ formatBytes(disk.capacityBytes) }}
  </span>

  <span v-else-if="column.id === 'vendor'">{{ vendorLabel(disk.vendor) }}</span>

  <span v-else-if="column.id === 'firmware'" class="font-mono text-xs">
    {{ disk.firmware }}
  </span>

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

  <span v-else-if="column.id === 'formFactor'">{{ disk.formFactor }}</span>

  <UIcon
    v-else-if="column.id === 'trim' && disk.trimSupported"
    name="i-lucide-check"
    class="text-muted size-4"
    aria-label="TRIM supported"
  />

  <span v-else-if="column.id === 'trim'" class="text-muted">no</span>

  <span v-else-if="column.id === 'host'">{{ disk.hostName }}</span>

  <span
    v-else-if="column.id === 'device'"
    class="font-mono text-xs"
    :class="{ 'text-dimmed': !disk.present }"
    :title="disk.present ? undefined : 'Last seen here; the disk is not present now'"
    :data-present="disk.present"
  >
    {{ disk.lastDevicePath }}
  </span>

  <span
    v-else-if="column.id === 'bay' && disk.bay"
    :class="{ 'text-dimmed': !disk.present || !disk.bay.label }"
    :title="disk.present ? disk.bay.locationKey : 'Last known bay; the disk is not present now'"
  >
    {{ column.value(disk) }}
  </span>

  <NuxtLink
    v-else-if="column.id === 'pool' && disk.membership && linked"
    :to="disk.membership.poolPath"
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
    v-else-if="column.id === 'purpose' && disk.purpose"
    v-bind="PURPOSE_BADGE[disk.purpose]"
    :class="{ italic: disk.purposeInferred }"
    :title="disk.purposeInferred ? 'Purpose inferred from usage' : undefined"
  />

  <span
    v-else-if="column.id === 'usage'"
    class="block max-w-full truncate"
    :class="{ 'text-dimmed': disk.usage.kind === 'empty' }"
    :data-usage="disk.usage.kind"
  >
    {{ column.value(disk) }}
  </span>

  <span v-else-if="column.id === 'vdev' && vdev" class="flex items-center gap-1.5">
    <VdevTypeIcon :type="vdev.type" />
    {{ vdev.label }}
  </span>

  <UBadge
    v-else-if="column.id === 'vdevState' && disk.membership"
    :color="zfsStateColour(disk.membership.vdevState)"
    variant="subtle"
    size="sm"
    :label="disk.membership.vdevState"
    data-testid="inventory-vdev-state"
  />

  <DisposalBadge
    v-else-if="column.id === 'state' && disk.disposal"
    :disposal="disk.disposal"
    :replaced-by-disk-id="disk.replacedByDiskId"
    :replaced-by-label="replacedByLabel"
    size="sm"
  />

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

  <span v-else-if="column.id === 'faults'" class="flex items-center gap-1">
    <UBadge
      v-for="{ bucket, color, variant, title } in faultBadges"
      :key="bucket"
      :color="color"
      :variant="variant"
      size="sm"
      :title="`${disk.faultCounts[bucket]} ${title}`"
      :data-bucket="bucket"
    >
      {{ disk.faultCounts[bucket] }}
    </UBadge>
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

  <span v-else-if="column.id === 'powerCycles'" class="tabular-nums">
    {{ disk.latestPowerCycles?.toLocaleString("en-GB") }}
  </span>

  <span
    v-else-if="column.id === 'lastReading' && disk.latestReadingAt"
    class="tabular-nums"
    :title="disk.latestReadingAt"
  >
    {{ timeAgo(disk.latestReadingAt) }}
  </span>

  <InventoryStatusCounter
    v-else-if="column.id === 'reallocated' && disk.counters.reallocated"
    :counter="disk.counters.reallocated"
  />

  <InventoryStatusCounter
    v-else-if="column.id === 'pending' && disk.counters.pending"
    :counter="disk.counters.pending"
  />

  <InventoryStatusCounter
    v-else-if="column.id === 'uncorrectable' && disk.counters.uncorrectable"
    :counter="disk.counters.uncorrectable"
  />

  <InventoryStatusCounter
    v-else-if="column.id === 'wear' && disk.counters.wearPercent"
    :counter="disk.counters.wearPercent"
    suffix=" %"
  />

  <span
    v-else-if="column.id === 'written'"
    class="tabular-nums"
    :title="disk.counters.bytesWrittenInferred ? INFERRED_WRITTEN_TITLE : undefined"
    :data-inferred="disk.counters.bytesWrittenInferred"
  >
    {{ disk.counters.bytesWrittenInferred ? "~" : "" }}{{ formatBytes(disk.counters.bytesWritten) }}
  </span>

  <span v-else-if="column.id === 'firstSeen'" class="tabular-nums">
    {{ formatDate(disk.firstSeenAt) }}
  </span>

  <span v-else-if="column.id === 'age'" class="tabular-nums">
    {{ formatDays(disk.ageDays) }}
  </span>

  <span
    v-else-if="column.id === 'warranty'"
    class="tabular-nums"
    :class="warrantyClass(disk.warrantyDaysLeft)"
    :data-warranty-days="disk.warrantyDaysLeft"
    :title="sellerWarranty ? 'Seller warranty: ends after the manufacturer warranty' : undefined"
  >
    {{ warrantyLabel(disk.warrantyDaysLeft) }}{{ sellerWarranty ? " (seller)" : "" }}
  </span>

  <span v-else-if="column.id === 'purchased'" class="tabular-nums">
    {{ disk.inventory.purchaseDate }}
  </span>

  <span
    v-else-if="column.id === 'price' && disk.inventory.purchasePrice != null"
    class="tabular-nums"
  >
    {{ formatMoney(disk.inventory.purchasePrice, currency) }}
  </span>

  <span v-else-if="column.id === 'pricePerTb'" class="tabular-nums">
    {{
      formatMoneyPerTb(
        disk.inventory.purchasePrice ?? null,
        disk.capacityBytes,
        currency,
      )
    }}
  </span>

  <span v-else-if="column.id === 'supplier'">{{ disk.inventory.supplier }}</span>

  <span v-else-if="column.id === 'tags'" class="flex flex-wrap gap-1">
    <UBadge
      v-for="tag in disk.inventory.tags"
      :key="tag"
      :label="tag"
      color="neutral"
      variant="subtle"
      size="sm"
    />
  </span>

  <span v-else-if="column.id === 'bpid'" class="font-mono text-xs">
    {{ disk.inventory.seagateBpid }}
  </span>

  <span v-else-if="column.id === 'condition'">
    {{ disk.inventory.purchaseCondition }}
  </span>

  <span
    v-else-if="column.id === 'notes'"
    class="block max-w-64 truncate"
    :title="notesText"
  >
    {{ notesText }}
  </span>

  <UIcon
    v-else-if="column.id === 'pin33'"
    name="i-lucide-check"
    class="text-muted size-4"
    aria-label="3.3 V pin taped"
  />

  <span v-else>{{ column.value(disk) }}</span>
</template>
