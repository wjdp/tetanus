<script setup lang="ts">
import type { BadgeProps } from "@nuxt/ui";
import type { EffectiveDiskState } from "#shared/disk";
import { LIFECYCLE_VOCABULARY } from "~/utils/vocabulary";

const props = defineProps<{
  state: EffectiveDiskState;
  overridden?: boolean;
  size?: BadgeProps["size"];
}>();

const vocabulary = computed(() => LIFECYCLE_VOCABULARY[props.state]);
</script>

<template>
  <UBadge
    :icon="vocabulary.icon"
    :label="vocabulary.label"
    :color="vocabulary.colour"
    :variant="overridden ? 'outline' : 'subtle'"
    :size="size"
    :title="overridden ? 'set by hand' : undefined"
    :data-state="state"
  />
</template>
