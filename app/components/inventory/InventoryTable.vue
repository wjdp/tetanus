<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { EffectiveDiskState, StateOverride } from "#shared/disk";
import type { Inventory } from "#shared/inventory-fields";
import type { DeviceStatus } from "#shared/smart/status";

interface InventoryDisk {
  id: number;
  alias: string | null;
  model: string | null;
  serial: string | null;
  capacityBytes: number | null;
  hostName: string | null;
  state: EffectiveDiskState;
  stateOverride: StateOverride | null;
  latestStatus: DeviceStatus;
  latestTemp: number | null;
  latestPowerOnHours: number | null;
  ageDays: number | null;
  warrantyDaysLeft: number | null;
  inventory: Partial<Inventory>;
  membership: { poolId: number; poolName: string } | null;
}

defineProps<{ disks: InventoryDisk[] }>();

type SortingState = { id: string; desc: boolean }[];

const WARRANTY_WARNING_DAYS = 90;

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

const optional = <T,>(value: T | null) => value ?? undefined;

const columns: TableColumn<InventoryDisk>[] = [
  {
    id: "alias",
    accessorFn: (row) => optional(row.alias),
    header: sortableHeader("Alias"),
    sortingFn: "alphanumeric",
    sortUndefined: "last",
  },
  {
    id: "model",
    accessorFn: (row) => optional(row.model),
    header: sortableHeader("Model"),
    sortUndefined: "last",
  },
  {
    id: "serial",
    accessorFn: (row) => optional(row.serial),
    header: sortableHeader("Serial"),
    sortUndefined: "last",
  },
  {
    id: "capacity",
    accessorFn: (row) => optional(row.capacityBytes),
    header: sortableHeader("Capacity"),
    sortUndefined: "last",
  },
  {
    id: "host",
    accessorFn: (row) => optional(row.hostName),
    header: sortableHeader("Host"),
    sortUndefined: "last",
  },
  {
    id: "pool",
    accessorFn: (row) => optional(row.membership?.poolName ?? null),
    header: sortableHeader("Pool"),
    sortUndefined: "last",
  },
  { id: "state", accessorKey: "state", header: sortableHeader("State") },
  {
    id: "status",
    accessorKey: "latestStatus",
    header: sortableHeader("Status"),
  },
  {
    id: "temp",
    accessorFn: (row) => optional(row.latestTemp),
    header: sortableHeader("Temp"),
    sortUndefined: "last",
  },
  {
    id: "powerOn",
    accessorFn: (row) => optional(row.latestPowerOnHours),
    header: sortableHeader("Power-on"),
    sortUndefined: "last",
  },
  {
    id: "age",
    accessorFn: (row) => optional(row.ageDays),
    header: sortableHeader("Age"),
    sortUndefined: "last",
  },
  {
    id: "warranty",
    accessorFn: (row) => optional(row.warrantyDaysLeft),
    header: sortableHeader("Warranty"),
    sortUndefined: "last",
  },
  {
    id: "pin33",
    accessorFn: (row) => (row.inventory.pin33Taped ? 1 : 0),
    header: sortableHeader("3.3 V"),
  },
];

const warrantyClass = (days: number | null) => {
  if (days === null) return "text-dimmed";
  if (days < 0) return "text-dimmed";
  if (days < WARRANTY_WARNING_DAYS) return "text-warning";
  return "";
};

const onSelectRow = (_event: Event, row: { original: InventoryDisk }) =>
  navigateTo(`/disks/${row.original.id}`);
</script>

<template>
  <UTable
    v-model:sorting="sorting"
    :data="disks"
    :columns="columns"
    empty="No disks match the filters."
    :on-select="onSelectRow"
    :ui="{ td: 'whitespace-nowrap' }"
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
      {{ row.original.model ?? "—" }}
    </template>

    <template #serial-cell="{ row }">
      <span class="text-dimmed font-mono text-xs">
        {{ row.original.serial ?? "—" }}
      </span>
    </template>

    <template #capacity-cell="{ row }">
      <span class="tabular-nums">{{ formatBytes(row.original.capacityBytes) }}</span>
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
      <span v-else class="text-dimmed">—</span>
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
        {{
          row.original.warrantyDaysLeft !== null &&
          row.original.warrantyDaysLeft < 0
            ? "expired"
            : formatDays(row.original.warrantyDaysLeft)
        }}
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
