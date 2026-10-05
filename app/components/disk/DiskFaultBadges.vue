<script setup lang="ts">
import type { DiskFaultCounts } from "#shared/faults";

const props = defineProps<{ diskId: number; counts: DiskFaultCounts }>();

const statusCounts = computed(() => ({
  error: props.counts.error,
  warning: props.counts.warning,
  neutral: props.counts.acknowledged,
}));

const total = computed(
  () => props.counts.error + props.counts.warning + props.counts.acknowledged,
);
</script>

<template>
  <NuxtLink
    v-if="total > 0"
    :to="{ path: `/disks/${diskId}`, query: { tab: 'faults' } }"
    class="inline-flex items-center gap-1.5 text-sm hover:underline"
    :title="`${total} live ${total === 1 ? 'fault' : 'faults'}`"
    data-testid="disk-fault-badges"
  >
    <span class="text-muted">Faults</span>
    <AppNavCounts :counts="statusCounts" />
  </NuxtLink>
</template>
