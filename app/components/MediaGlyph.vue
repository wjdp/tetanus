<script setup lang="ts">
import type { Media } from "#shared/hardware";
import { mediaGlyph } from "~/utils/vocabulary";

const props = withDefaults(
  defineProps<{ media: Media | null; size?: number }>(),
  { size: 16 },
);

const glyph = computed(() => mediaGlyph(props.media));
</script>

<template>
  <svg
    v-if="glyph?.kind === 'platter'"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    data-media="hdd"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
  <UIcon
    v-else-if="glyph?.kind === 'icon'"
    :name="glyph.name"
    :style="{ width: `${size}px`, height: `${size}px` }"
    class="shrink-0"
    data-media="ssd"
  />
</template>
