<script setup lang="ts">
import { DEVICE_STATUS_VOCABULARY, diaryEventIcon } from "~/utils/vocabulary";

const props = defineProps<{
  eventType: string | null;
  data?: unknown;
  manual?: boolean;
}>();

const icon = computed(() => diaryEventIcon(props));
const status = computed(() =>
  typeof icon.value === "string"
    ? null
    : DEVICE_STATUS_VOCABULARY[icon.value.dot],
);
</script>

<template>
  <TopologyStatusDot
    v-if="status"
    :colour="status.colour"
    :shape="status.shape"
    :title="status.label"
    :aria-label="status.label"
    role="img"
  />
  <UIcon
    v-else-if="typeof icon === 'string'"
    :name="icon"
    class="text-muted size-4"
    :data-icon="icon"
  />
</template>
