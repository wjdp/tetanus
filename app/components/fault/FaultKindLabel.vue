<script setup lang="ts">
import { FAULT_KIND_DEFINITIONS, type FaultView } from "#shared/faults";

const props = defineProps<{
  fault: Pick<FaultView, "kind" | "severity">;
  columns?: boolean;
}>();

const label = computed(() => FAULT_KIND_DEFINITIONS[props.fault.kind].label);
</script>

<template>
  <span
    data-testid="fault-kind"
    :data-severity="fault.severity"
    class="text-muted inline-flex min-w-0 items-baseline gap-1.5 text-xs"
    :class="columns ? 'w-40 shrink-0' : 'shrink-0'"
  >
    <TopologyStatusDot :colour="fault.severity" class="self-center" />
    <span class="whitespace-nowrap">{{ label }}</span>
  </span>
</template>
