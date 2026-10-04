<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import {
  columnLabel,
  DEFAULT_VISIBLE_COLUMNS,
  INVENTORY_COLUMNS,
  type InventoryColumn,
} from "./columns";
import { type DiskGroup, type GroupBy, groupDisks } from "./groupDisks";
import InventoryCell from "./InventoryCell.vue";
import InventoryGroupHeader from "./InventoryGroupHeader.vue";
import type { InventoryDisk, SortingState } from "./types";
import { useCollapsedGroups } from "./useCollapsedGroups";

const props = withDefaults(
  defineProps<{
    disks: InventoryDisk[];
    visibleColumns?: ReadonlySet<string>;
    diskLabels?: ReadonlyMap<number, string>;
    groupBy?: GroupBy | null;
  }>(),
  {
    visibleColumns: () => DEFAULT_VISIBLE_COLUMNS,
    diskLabels: () => new Map(),
    groupBy: null,
  },
);

interface GroupRow {
  groupHeader: DiskGroup;
}

type TableRow = InventoryDisk | GroupRow;

const isGroupRow = (row: TableRow): row is GroupRow => "groupHeader" in row;

const sorting = defineModel<SortingState>("sorting", {
  default: () => [{ id: "alias", desc: false }],
});

const currency = useCurrency();

const UButton = resolveComponent("UButton");

const sortableHeader =
  (inventoryColumn: InventoryColumn): TableColumn<TableRow>["header"] =>
  ({ column }) => {
    const direction = column.getIsSorted();
    const label = columnLabel(inventoryColumn, currency.value);
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

const { isCollapsed, toggle } = useCollapsedGroups(() => props.groupBy);

const groups = computed(() =>
  props.groupBy ? groupDisks(props.disks, props.groupBy, sorting.value) : null,
);

const rows = computed<TableRow[]>(
  () =>
    groups.value?.flatMap((group) => [
      { groupHeader: group },
      ...(isCollapsed(group.key) ? [] : group.disks),
    ]) ?? props.disks,
);

const visibleColumnCount = computed(
  () => Object.values(columnVisibility.value).filter(Boolean).length,
);

const [firstColumn] = INVENTORY_COLUMNS;

const groupCellMeta = (columnId: string) => ({
  colspan: {
    td: ({ row }: { row: { original: TableRow } }) =>
      isGroupRow(row.original) && columnId === firstColumn?.id
        ? String(visibleColumnCount.value)
        : "1",
  },
  class: {
    td: ({ row }: { row: { original: TableRow } }) =>
      isGroupRow(row.original) && columnId !== firstColumn?.id ? "hidden" : "",
  },
});

const columns: TableColumn<TableRow>[] = INVENTORY_COLUMNS.map((column) => ({
  id: column.id,
  accessorFn: (row) =>
    isGroupRow(row) ? undefined : (column.value(row) ?? undefined),
  header: sortableHeader(column),
  cell: ({ row }) => {
    const { original } = row;
    if (!isGroupRow(original)) {
      return h(InventoryCell, {
        column,
        disk: original,
        currency: currency.value,
        serialShown: columnVisibility.value.serial,
        diskLabels: props.diskLabels,
      });
    }
    return column.id === firstColumn?.id
      ? h(InventoryGroupHeader, {
          group: original.groupHeader,
          collapsed: isCollapsed(original.groupHeader.key),
          currency: currency.value,
        })
      : null;
  },
  meta: groupCellMeta(column.id),
  sortingFn: column.id === "alias" ? "alphanumeric" : "auto",
  sortUndefined: "last",
}));

const meta = {
  class: {
    tr: ({ original }: { original: TableRow }) => {
      if (isGroupRow(original)) return "bg-elevated/50";
      return original.disposal ? "opacity-60" : "";
    },
  },
};

const onSelectRow = (_event: Event, { original }: { original: TableRow }) => {
  if (isGroupRow(original)) toggle(original.groupHeader.key);
  else navigateTo(`/disks/${original.id}`);
};
</script>

<template>
  <UTable
    :key="groupBy ?? 'ungrouped'"
    v-model:sorting="sorting"
    :sorting-options="{ manualSorting: groupBy !== null }"
    :column-visibility="columnVisibility"
    :data="rows"
    :columns="columns"
    :meta="meta"
    empty="No disks match the filters."
    :on-select="onSelectRow"
    :ui="{ th: 'px-3', td: 'whitespace-nowrap px-3 py-2.5' }"
    data-testid="inventory-table"
  />
</template>
