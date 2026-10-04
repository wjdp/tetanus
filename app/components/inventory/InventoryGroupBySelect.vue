<script setup lang="ts">
import { GROUP_BY_OPTIONS, type GroupBy, groupByLabel } from "./groupDisks";

const groupBy = defineModel<GroupBy | null>({ default: null });

const UNGROUPED = "none";

const items = [
  { value: UNGROUPED, label: "No grouping" },
  ...GROUP_BY_OPTIONS.map((value) => ({ value, label: groupByLabel(value) })),
];

const selected = computed({
  get: () => groupBy.value ?? UNGROUPED,
  set: (value: string) => {
    groupBy.value = value === UNGROUPED ? null : (value as GroupBy);
  },
});
</script>

<template>
  <USelect
    v-model="selected"
    :items="items"
    size="sm"
    icon="i-lucide-group"
    class="w-40"
    aria-label="Group disks by"
    data-testid="inventory-group-by"
  />
</template>
