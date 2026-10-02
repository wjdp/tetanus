<script setup lang="ts">
const props = defineProps<{ poolId: number; now: number }>();

const { faults, perform, refresh } = useFaults(() => ({
  subject: `pool:${props.poolId}`,
}));
</script>

<template>
  <FaultList
    v-if="faults.length"
    :faults="faults"
    :now="now"
    :perform="perform"
    data-testid="pool-faults"
    @changed="refresh"
  />
</template>
