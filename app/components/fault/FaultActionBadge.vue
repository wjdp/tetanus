<script setup lang="ts">
import type { FaultAction } from "#shared/faults";
import { FAULT_ACTION_VOCABULARY } from "~/utils/vocabulary";

const props = defineProps<{ action: FaultAction }>();

const vocabulary = computed(() => FAULT_ACTION_VOCABULARY[props.action]);
</script>

<template>
  <UBadge
    :color="vocabulary.colour"
    :icon="vocabulary.icon"
    variant="subtle"
    size="sm"
    :data-action="action"
  >
    {{ vocabulary.label }}
  </UBadge>
</template>
