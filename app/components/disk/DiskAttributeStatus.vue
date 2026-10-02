<script setup lang="ts">
import type { AttributeDisplayStatus } from "#shared/smart/status";
import { ATTRIBUTE_STATUS_DOT, ATTRIBUTE_STATUS_LABEL } from "./attributeRows";

const props = defineProps<{ status: AttributeDisplayStatus }>();

const dot = computed(() => ATTRIBUTE_STATUS_DOT[props.status]);
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5"
    :class="status === 'passed' ? 'text-dimmed' : 'text-default'"
    data-testid="attribute-status"
  >
    <TopologyStatusDot v-if="dot" :colour="dot.colour" :shape="dot.shape" />
    {{ ATTRIBUTE_STATUS_LABEL[status] }}
  </span>
</template>
