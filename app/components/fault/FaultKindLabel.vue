<script setup lang="ts">
import { FAULT_KIND_DEFINITIONS, type FaultView } from "#shared/faults";

const props = defineProps<{
  fault: Pick<FaultView, "kind" | "severity">;
  columns?: boolean;
}>();

const definition = computed(() => FAULT_KIND_DEFINITIONS[props.fault.kind]);
</script>

<template>
  <UTooltip
    :delay-duration="300"
    :ui="{ content: 'h-auto max-w-sm p-3' }"
  >
    <span
      data-testid="fault-kind"
      :data-severity="fault.severity"
      class="text-muted relative z-10 inline-flex min-w-0 cursor-default items-baseline gap-1.5 text-xs"
      :class="columns ? 'w-40 shrink-0' : 'shrink-0'"
    >
      <TopologyStatusDot :colour="fault.severity" class="self-center" />
      <span class="whitespace-nowrap">{{ definition.label }}</span>
    </span>
    <template #content>
      <div class="flex flex-col gap-2 text-xs text-pretty">
        <p class="text-highlighted font-semibold">{{ definition.label }}</p>
        <p class="text-toned">{{ definition.trigger }}</p>
        <p class="text-muted">Clears: {{ definition.resolves }}</p>
      </div>
    </template>
  </UTooltip>
</template>
