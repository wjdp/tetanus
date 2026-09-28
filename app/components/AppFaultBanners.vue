<script setup lang="ts">
const { faults, dismiss } = useFaults();
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
      close
      class="rounded-none"
      @update:open="dismiss(fault.id)"
    />
  </div>
</template>
