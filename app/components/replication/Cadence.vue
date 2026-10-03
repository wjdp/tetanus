<script setup lang="ts">
import { formatCadence } from "~/utils/vocabulary";

defineProps<{ intervalSec: number | null; manual: boolean }>();
</script>

<template>
  <span
    class="inline-flex items-center gap-1"
    :class="intervalSec === null ? 'text-dimmed' : ''"
    :title="manual ? 'Interval set by hand' : undefined"
  >
    {{ formatCadence(intervalSec, manual) }}
    <UIcon
      v-if="manual"
      name="i-lucide-pencil"
      class="text-dimmed size-3.5 shrink-0"
      aria-label="set by hand"
      data-testid="cadence-manual"
    />
  </span>
</template>
