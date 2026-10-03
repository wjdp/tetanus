<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import {
  DEFAULT_VISIBLE_COLUMNS,
  INVENTORY_COLUMNS,
} from "./columns";
import InventoryCell from "./InventoryCell.vue";
import type { InventoryDisk, SortingState } from "./types";

const props = withDefaults(
  defineProps<{
    disks: InventoryDisk[];
    visibleColumns?: ReadonlySet<string>;
  }>(),
  { visibleColumns: () => DEFAULT_VISIBLE_COLUMNS },
);

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

const columnVisibility = computed(() =>
  Object.fromEntries(
    INVENTORY_COLUMNS.map(({ id, locked }) => [
      id,
      locked || props.visibleColumns.has(id),
    ]),
  ),
);

const columns: TableColumn<InventoryDisk>[] = INVENTORY_COLUMNS.map(
  (column) => ({
    id: column.id,
    accessorFn: (row) => column.value(row) ?? undefined,
    header: sortableHeader(column.label),
    cell: ({ row }) => h(InventoryCell, { column, disk: row.original }),
    sortingFn: column.id === "alias" ? "alphanumeric" : "auto",
    sortUndefined: "last",
  }),
);

const onSelectRow = (_event: Event, row: { original: InventoryDisk }) =>
  navigateTo(`/disks/${row.original.id}`);
</script>

<template>
  <UTable
    v-model:sorting="sorting"
    :column-visibility="columnVisibility"
    :data="disks"
    :columns="columns"
    empty="No disks match the filters."
    :on-select="onSelectRow"
    :ui="{ th: 'px-3', td: 'whitespace-nowrap px-3 py-2.5' }"
    data-testid="inventory-table"
  />
</template>
