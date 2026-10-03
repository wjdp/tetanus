<script setup lang="ts">
const props = defineProps<{ replicationId: number; now: number }>();

const { faults, perform, refresh } = useFaults(() => ({
  subject: `replication:${props.replicationId}`,
}));
</script>

<template>
  <FaultList
    v-if="faults.length"
    :faults="faults"
    :now="now"
    :perform="perform"
    data-testid="replication-faults"
    @changed="refresh"
  />
</template>
