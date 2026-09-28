<script setup lang="ts">
import {
  SPARKLINE_HEIGHT,
  SPARKLINE_WIDTH,
  sparklinePoints,
} from "./sparklinePath";

const props = defineProps<{ values: number[] }>();

const points = computed(() => sparklinePoints(props.values));
</script>

<template>
  <svg
    :width="SPARKLINE_WIDTH"
    :height="SPARKLINE_HEIGHT"
    :viewBox="`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`"
    fill="none"
    aria-hidden="true"
    class="overflow-visible"
  >
    <polyline
      v-if="points"
      :points="points"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
