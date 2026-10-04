<script setup lang="ts">
import { formatMoney } from "#shared/money";
import type { DiskGroup } from "./groupDisks";

const props = defineProps<{
  group: DiskGroup;
  collapsed: boolean;
  currency: string;
}>();

const summary = computed(() =>
  [
    `${props.group.disks.length} ${props.group.disks.length === 1 ? "disk" : "disks"}`,
    props.group.capacityBytes > 0 ? formatBytes(props.group.capacityBytes) : null,
    props.group.spend === null
      ? null
      : formatMoney(props.group.spend, props.currency),
  ]
    .filter(Boolean)
    .join(" · "),
);
</script>

<template>
  <span class="flex items-center gap-2" data-testid="inventory-group-header">
    <UIcon
      :name="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
      class="text-dimmed size-4 shrink-0"
    />
    <span class="text-highlighted font-semibold">{{ group.label }}</span>
    <span class="text-muted tabular-nums">{{ summary }}</span>
  </span>
</template>
