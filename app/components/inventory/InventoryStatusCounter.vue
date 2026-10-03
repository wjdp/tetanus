<script setup lang="ts">
import type { StatusCounter } from "#shared/smart/counters";
import {
  ATTRIBUTE_STATUS_DOT,
  ATTRIBUTE_STATUS_LABEL,
} from "~/components/disk/attributeRows";
import { STATUS_TEXT_CLASS } from "~/utils/vocabulary";

const props = withDefaults(
  defineProps<{ counter: StatusCounter; label?: string; suffix?: string }>(),
  { suffix: "" },
);

const text = computed(() => {
  const value = `${props.counter.value.toLocaleString("en-GB")}${props.suffix}`;
  return props.label ? `${props.label} ${value}` : value;
});

const dot = computed(() => ATTRIBUTE_STATUS_DOT[props.counter.status]);
</script>

<template>
  <span
    class="flex items-center gap-1.5 tabular-nums"
    :class="dot ? STATUS_TEXT_CLASS[dot.colour] : undefined"
    :title="ATTRIBUTE_STATUS_LABEL[counter.status]"
    :data-status="counter.status"
  >
    <TopologyStatusDot v-if="dot" :colour="dot.colour" :shape="dot.shape" class="size-1.5!" />
    {{ text }}
  </span>
</template>
