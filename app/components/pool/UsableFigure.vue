<script setup lang="ts">
defineProps<{
  usable: number | null | undefined;
  raw: number | null;
}>();

const { formatZfsBytes } = useZfsByteSystem();
</script>

<template>
  <span v-if="usable !== undefined && usable !== null" class="tabular">
    {{ formatZfsBytes(usable) }}
  </span>
  <span
    v-else
    class="text-muted tabular"
    title="No recent zfs list, so this is the raw zpool figure, including parity"
  >
    {{ formatZfsBytes(raw) }} <span class="text-dimmed text-xs">raw</span>
  </span>
</template>
