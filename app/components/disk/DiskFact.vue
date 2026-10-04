<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{ label: string; value?: string | null; mono?: boolean }>(),
  { value: null, mono: false },
);

const slots = defineSlots<{ default?(): unknown }>();
</script>

<template>
  <dt class="text-dimmed">{{ label }}</dt>
  <dd
    v-bind="$attrs"
    class="tabular min-w-0 break-words"
    :class="{ 'font-mono text-xs leading-5': mono }"
  >
    <slot v-if="slots.default" />
    <template v-else-if="value !== null">{{ value }}</template>
    <span v-else class="text-dimmed">—</span>
  </dd>
</template>
