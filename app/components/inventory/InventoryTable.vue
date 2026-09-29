<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { interfaceLabel, sectorFormat } from "#shared/hardware";
import { displayModel } from "#shared/model";
import { usageColour, usageShort } from "#shared/usage";
import { SORT_FIELDS } from "./inventorySort";
import {
  type InventoryDisk,
  type SortingState,
  warrantyClass,
  warrantyLabel,
} from "./types";

defineProps<{ disks: InventoryDisk[] }>();

const sorting = defineModel<SortingState>("sorting", {
  default: () => [{ id: "alias", desc: false }],
});

const UButton = resolveComponent("UButton");

const sortableHeader =
  (label: string): TableColumn<InventoryDisk>["header"] =>
  ({ column }) => {
    const direction = column.getIsSorted();
    return h(UButton, {
      color: "neutral",
      variant: "ghost",
      size: "xs",
      label,
      class: "-mx-2",
      trailingIcon:
        direction === "asc"
          ? "i-lucide-arrow-up"
          : direction === "desc"
            ? "i-lucide-arrow-down"
            : "i-lucide-arrow-up-down",
      "aria-label": `Sort by ${label}`,
      onClick: () => column.toggleSorting(direction === "asc"),
    });
  };

const hideCell = (cls: string) => ({ class: { th: cls, td: cls } });

const COLUMN_META: Record<string, TableColumn<InventoryDisk>["meta"]> = {
  age: hideCell("hidden 2xl:table-cell"),
  pin33: hideCell("hidden 2xl:table-cell"),
  interface: hideCell("hidden lg:table-cell"),
  recording: hideCell("hidden xl:table-cell"),
  usage: hideCell("hidden lg:table-cell"),
  vendor: hideCell("hidden xl:table-cell"),
  warranty: hideCell("hidden xl:table-cell"),
};

const columnVisibility = ref({ sectors: false });

const columns: TableColumn<InventoryDisk>[] = SORT_FIELDS.map((field) => ({
  id: field.id,
  accessorFn: (row) => field.value(row) ?? undefined,
  header: sortableHeader(field.label),
  sortingFn: field.id === "alias" ? "alphanumeric" : "auto",
  sortUndefined: "last",
  meta: COLUMN_META[field.id],
}));

const onSelectRow = (_event: Event, row: { original: InventoryDisk }) =>
  navigateTo(`/disks/${row.original.id}`);
</script>

<template>
  <UTable
    v-model:sorting="sorting"
    v-model:column-visibility="columnVisibility"
    :data="disks"
    :columns="columns"
    empty="No disks match the filters."
    :on-select="onSelectRow"
    :ui="{ th: 'px-3', td: 'whitespace-nowrap px-3 py-2.5' }"
    data-testid="inventory-table"
  >
    <template #alias-cell="{ row }">
      <NuxtLink
        :to="`/disks/${row.original.id}`"
        class="text-highlighted hover:text-primary font-medium"
        @click.stop
      >
        {{ row.original.alias ?? "—" }}
      </NuxtLink>
    </template>

    <template #model-cell="{ row }">
      <div class="flex flex-col">
        <span>{{ displayModel(row.original.model, row.original.vendor) ?? "—" }}</span>
        <span class="text-dimmed font-mono text-xs">
          {{ row.original.serial ?? "—" }}
        </span>
      </div>
    </template>

    <template #capacity-cell="{ row }">
      <span class="tabular-nums">{{ formatBytes(row.original.capacityBytes) }}</span>
    </template>

    <template #vendor-cell="{ row }">
      {{ vendorLabel(row.original.vendor) ?? "—" }}
    </template>

    <template #media-cell="{ row }">
      <span
        v-if="mediaLabel(row.original.media, row.original.rotationRate)"
        class="flex items-center gap-1.5"
      >
        <UIcon :name="mediaIcon(row.original.media) ?? ''" class="text-muted size-4" />
        {{ mediaLabel(row.original.media, row.original.rotationRate) }}
      </span>
      <span v-else class="text-dimmed">—</span>
    </template>

    <template #interface-cell="{ row }">
      {{ interfaceLabel(row.original.interface, row.original.link) ?? "—" }}
    </template>

    <template #recording-cell="{ row }">
      <UBadge
        v-if="recordingBadge(row.original)"
        v-bind="recordingBadge(row.original)"
        size="xs"
      />
    </template>

    <template #sectors-cell="{ row }">
      <span class="tabular-nums">
        {{ sectorFormat(row.original.logicalBlockSize, row.original.physicalBlockSize) ?? "—" }}
      </span>
    </template>

    <template #host-cell="{ row }">
      {{ row.original.hostName ?? "—" }}
    </template>

    <template #pool-cell="{ row }">
      <NuxtLink
        v-if="row.original.membership"
        :to="`/zfs/${row.original.membership.poolId}`"
        class="text-default hover:text-primary"
        @click.stop
      >
        {{ row.original.membership.poolName }}
      </NuxtLink>
      <span
        v-else-if="row.original.purpose"
        :class="row.original.purposeInferred ? 'text-dimmed italic' : 'text-muted'"
        :title="row.original.purposeInferred ? 'Purpose inferred from usage' : undefined"
      >
        {{ row.original.purpose }}
      </span>
      <span v-else class="text-dimmed">—</span>
    </template>

    <template #usage-cell="{ row }">
      <UBadge
        size="xs"
        variant="subtle"
        :color="usageColour(row.original.usage.kind)"
        :class="{ 'opacity-60': row.original.usage.kind === 'empty' }"
      >
        {{ usageShort(row.original.usage, row.original.membership?.poolName ?? null) }}
      </UBadge>
    </template>

    <template #state-cell="{ row }">
      <div class="flex items-center gap-1.5">
        <UBadge
          :color="diskStateColour(row.original.state)"
          variant="subtle"
          size="sm"
        >
          {{ row.original.state }}
        </UBadge>
        <span
          v-if="row.original.stateOverride"
          class="text-dimmed text-xs"
          title="State set by hand"
        >
          override
        </span>
      </div>
    </template>

    <template #status-cell="{ row }">
      <UBadge
        :color="deviceStatusColour(row.original.latestStatus)"
        variant="subtle"
        size="sm"
      >
        {{ row.original.latestStatus }}
      </UBadge>
    </template>

    <template #temp-cell="{ row }">
      <span class="tabular-nums">{{ formatCelsius(row.original.latestTemp) }}</span>
    </template>

    <template #powerOn-cell="{ row }">
      <span class="tabular-nums">
        {{ formatHours(row.original.latestPowerOnHours) }}
      </span>
    </template>

    <template #age-cell="{ row }">
      <span class="tabular-nums">{{ formatDays(row.original.ageDays) }}</span>
    </template>

    <template #warranty-cell="{ row }">
      <span
        class="tabular-nums"
        :class="warrantyClass(row.original.warrantyDaysLeft)"
        :data-warranty-days="row.original.warrantyDaysLeft"
      >
        {{ warrantyLabel(row.original.warrantyDaysLeft) }}
      </span>
    </template>

    <template #pin33-cell="{ row }">
      <UIcon
        v-if="row.original.inventory.pin33Taped"
        name="i-lucide-check"
        class="text-muted size-4"
        aria-label="3.3 V pin taped"
      />
    </template>
  </UTable>
</template>
