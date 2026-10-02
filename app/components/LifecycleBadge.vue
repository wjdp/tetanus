<script setup lang="ts">
import type { BadgeProps } from "@nuxt/ui";
import type { EffectiveDiskState } from "#shared/disk";
import { formatDuration } from "#shared/hostFreshness";
import { LIFECYCLE_VOCABULARY } from "~/utils/vocabulary";

const props = defineProps<{
  state: EffectiveDiskState;
  overridden?: boolean;
  asOf?: string | null;
  size?: BadgeProps["size"];
}>();

const vocabulary = computed(() => LIFECYCLE_VOCABULARY[props.state]);

const isStale = computed(() => !props.overridden && !!props.asOf);

const title = computed(() => {
  if (props.overridden) return "set by hand";
  if (props.asOf) {
    const ageMs = Date.now() - Date.parse(props.asOf);
    return `as of last scan ${formatDuration(ageMs)} ago`;
  }
  return undefined;
});
</script>

<template>
  <UBadge
    :icon="vocabulary.icon"
    :label="vocabulary.label"
    :color="vocabulary.colour"
    :variant="overridden ? 'outline' : 'subtle'"
    :size="size"
    :title="title"
    :class="{ 'opacity-60': isStale }"
    :data-state="state"
    :data-stale="isStale || undefined"
  />
</template>
