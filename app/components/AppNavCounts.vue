<script setup lang="ts">
import type { StatusCounts } from "#shared/navigation";

const props = defineProps<{ counts: StatusCounts }>();

const BADGES = [
  { bucket: "error", color: "error", variant: "solid" },
  { bucket: "warning", color: "warning", variant: "solid" },
  { bucket: "neutral", color: "neutral", variant: "subtle" },
] as const;

const shown = computed(() =>
  BADGES.filter(({ bucket }) => props.counts[bucket] > 0),
);
</script>

<template>
  <span class="flex items-center gap-1">
    <UBadge
      v-for="{ bucket, color, variant } in shown"
      :key="bucket"
      :color="color"
      :variant="variant"
      size="sm"
      :data-bucket="bucket"
    >
      {{ counts[bucket] }}
    </UBadge>
  </span>
</template>
