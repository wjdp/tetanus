<script setup lang="ts">
import type { BadgeProps } from "@nuxt/ui";
import type { SseTask } from "#shared/sse";

defineProps<{
  state: SseTask["state"];
}>();

const Labels: Record<SseTask["state"], string> = {
  pending: "Pending",
  in_progress: "Running",
  done: "Done",
  failed: "Failed",
};

const Colours: Record<SseTask["state"], BadgeProps["color"]> = {
  pending: "neutral",
  in_progress: "info",
  done: "success",
  failed: "error",
};

const Icons: Record<SseTask["state"], string> = {
  pending: "i-lucide-clock",
  in_progress: "i-lucide-loader",
  done: "i-lucide-check",
  failed: "i-lucide-triangle-alert",
};
</script>

<template>
  <UBadge
    variant="soft"
    :color="Colours[state]"
    :icon="Icons[state]"
    :label="Labels[state]"
  />
</template>
