<script setup lang="ts">
import type { DotShape, StatusColour } from "~/utils/vocabulary";
import { STATUS_DOT_CLASS, STATUS_RING_CLASS } from "./statusClasses";

withDefaults(defineProps<{ colour: StatusColour; shape?: DotShape }>(), {
  shape: "filled",
});
</script>

<template>
  <span
    class="inline-block size-2 shrink-0 rounded-full"
    :class="
      shape === 'hollow'
        ? ['border-2 bg-transparent', STATUS_RING_CLASS[colour]]
        : STATUS_DOT_CLASS[colour]
    "
    :data-colour="colour"
    :data-shape="shape"
  />
</template>
