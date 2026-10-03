<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import { COLUMN_GROUPS, columnLabel, INVENTORY_COLUMNS } from "./columns";

const props = defineProps<{
  visibleColumns: ReadonlySet<string>;
  customised: boolean;
}>();

const emit = defineEmits<{
  toggle: [id: string, visible: boolean];
  reset: [];
}>();

const currency = useCurrency();

const keepMenuOpen = (event: Event) => event.preventDefault();

const columnGroups = computed<DropdownMenuItem[][]>(() =>
  COLUMN_GROUPS.flatMap((group) => {
    const columns = INVENTORY_COLUMNS.filter(
      (column) => column.group === group && !column.locked,
    );
    if (columns.length === 0) return [];
    return [
      [
        { type: "label", label: group },
        ...columns.map(
          (column): DropdownMenuItem => ({
            type: "checkbox",
            label: columnLabel(column, currency.value),
            checked: props.visibleColumns.has(column.id),
            onUpdateChecked: (checked) => emit("toggle", column.id, checked),
            onSelect: keepMenuOpen,
          }),
        ),
      ],
    ];
  }),
);

const items = computed<DropdownMenuItem[][]>(() => [
  ...columnGroups.value,
  [
    {
      label: "Reset to default",
      icon: "i-lucide-rotate-ccw",
      disabled: !props.customised,
      onSelect: () => emit("reset"),
    },
  ],
]);
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-columns-3"
      label="Columns"
      data-testid="column-picker"
    />
  </UDropdownMenu>
</template>
