<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import { DATASET_COLUMNS, type DatasetColumn } from "./columns";

const props = defineProps<{
  visibleColumns: DatasetColumn[];
  customised: boolean;
}>();

const emit = defineEmits<{
  toggle: [id: string, visible: boolean];
  reset: [];
}>();

const keepMenuOpen = (event: Event) => event.preventDefault();

const items = computed<DropdownMenuItem[][]>(() => [
  DATASET_COLUMNS.filter((column) => !column.locked).map(
    (column): DropdownMenuItem => ({
      type: "checkbox",
      label: column.label,
      checked: props.visibleColumns.includes(column),
      onUpdateChecked: (checked) => emit("toggle", column.id, checked),
      onSelect: keepMenuOpen,
    }),
  ),
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
      variant="ghost"
      size="xs"
      icon="i-lucide-columns-3"
      title="Columns"
      aria-label="Columns"
      data-testid="dataset-column-picker"
    />
  </UDropdownMenu>
</template>
