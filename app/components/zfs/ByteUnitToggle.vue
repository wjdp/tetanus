<script setup lang="ts">
import type { ByteSystem } from "~/utils/format";

const OPTIONS: { system: ByteSystem; label: string; title: string }[] = [
  {
    system: "binary",
    label: "TiB",
    title: "Binary units (1 TiB = 2⁴⁰ bytes), as zfs and zpool print them",
  },
  {
    system: "decimal",
    label: "TB",
    title: "Decimal units (1 TB = 10¹² bytes), as drives are sold",
  },
];

const { system } = useZfsByteSystem();
</script>

<template>
  <UFieldGroup size="sm" aria-label="Size units">
    <UButton
      v-for="option in OPTIONS"
      :key="option.system"
      color="neutral"
      :variant="system === option.system ? 'subtle' : 'outline'"
      :aria-pressed="system === option.system"
      :label="option.label"
      :title="option.title"
      @click="system = option.system"
    />
  </UFieldGroup>
</template>
