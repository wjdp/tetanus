<script setup lang="ts">
import {
  capacityColour,
  STATUS_TEXT_CLASS,
  zfsStateColour,
} from "~/utils/vocabulary";

const props = defineProps<{
  kicker?: string | null;
  label: string;
  type?: string;
  icon?: string;
  state?: string | null;
  sizeBytes?: number | null;
  allocBytes?: number | null;
}>();

const usage = computed(() => {
  const { sizeBytes, allocBytes } = props;
  if (!sizeBytes || allocBytes === null || allocBytes === undefined) {
    return null;
  }
  const percent = Math.round((allocBytes / sizeBytes) * 100);
  return {
    percent,
    colour: capacityColour(percent),
    text: `${formatBytes(allocBytes)} of ${formatBytes(sizeBytes)} · ${percent} %`,
  };
});
</script>

<template>
  <div
    class="flex flex-col gap-2 sm:flex-row sm:items-start"
    data-testid="vdev-group"
  >
    <div class="flex w-40 shrink-0 flex-col gap-0.5 sm:pt-1">
      <span
        v-if="kicker"
        class="text-dimmed font-mono text-xs"
        data-testid="vdev-kicker"
      >
        {{ kicker }}
      </span>
      <span class="flex min-w-0 items-center gap-1.5">
        <VdevTypeIcon v-if="type" :type="type" />
        <UIcon v-else-if="icon" :name="icon" class="text-muted size-4 shrink-0" />
        <span class="text-toned truncate font-mono text-sm">{{ label }}</span>
      </span>
      <span
        v-if="state"
        class="text-xs"
        :class="STATUS_TEXT_CLASS[zfsStateColour(state)]"
      >
        {{ state }}
      </span>
      <template v-if="usage">
        <UProgress
          :model-value="usage.percent"
          :color="usage.colour"
          size="2xs"
          class="mt-1"
        />
        <span class="text-dimmed tabular text-xs" data-testid="vdev-usage">
          {{ usage.text }}
        </span>
      </template>
    </div>
    <div class="flex flex-wrap gap-2">
      <slot />
    </div>
  </div>
</template>
