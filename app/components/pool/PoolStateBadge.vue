<script setup lang="ts">
import type { BadgeProps } from "@nuxt/ui";
import { zfsStateColour } from "~/utils/vocabulary";

const props = defineProps<{
  pool: { state: string; displayState: string };
  size?: BadgeProps["size"];
}>();

const lastSeen = computed(() =>
  props.pool.displayState === props.pool.state
    ? undefined
    : `Last seen ${props.pool.state}`,
);
</script>

<template>
  <UBadge
    :color="zfsStateColour(pool.displayState)"
    variant="subtle"
    :size="size"
    :title="lastSeen"
    data-testid="pool-state"
  >
    {{ pool.displayState }}
  </UBadge>
</template>
