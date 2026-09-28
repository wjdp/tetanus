<script setup lang="ts">
const faults = useFaults();
</script>

<template>
  <div v-if="faults.length" class="flex flex-col gap-px">
    <UAlert
      v-for="fault in faults"
      :key="fault.id"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="fault.title"
      :description="fault.description"
      class="rounded-none"
    />
  </div>
</template>
