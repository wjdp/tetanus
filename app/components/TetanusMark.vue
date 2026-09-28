<script setup lang="ts">
withDefaults(defineProps<{ size?: number; arm?: boolean }>(), {
  size: 24,
  arm: true,
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
    <path v-if="arm" d="M20.5 20.5 15 15" />
    <circle
      cx="14.6"
      cy="14.6"
      :r="arm ? 1.6 : 2"
      class="fill-primary"
      stroke="none"
    />
  </svg>
</template>
