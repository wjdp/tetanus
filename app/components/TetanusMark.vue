<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), {
  size: 24,
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
    <path
      d="M12 6a6 6 0 0 1 6 6"
      class="stroke-primary"
      stroke-width="2.5"
    />
  </svg>
</template>
