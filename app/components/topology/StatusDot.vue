<script setup lang="ts">
import type { StatusColour } from "~/utils/statusColour";
import { STATUS_DOT_CLASS } from "./statusClasses";

defineProps<{ colour: StatusColour }>();
</script>

<template>
  <span
    class="inline-block size-2 shrink-0 rounded-full"
    :class="STATUS_DOT_CLASS[colour]"
    :data-colour="colour"
  />
</template>
