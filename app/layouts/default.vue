<script setup lang="ts">
const demo = useRuntimeConfig().public.demo;
</script>

<template>
  <UDashboardGroup>
    <AppSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <UAlert
        v-if="demo"
        color="info"
        variant="subtle"
        icon="i-lucide-flask-conical"
        title="Demo instance. Fake data, reset daily at 04:00 UTC. Edit anything."
        class="rounded-none"
        data-testid="demo-banner"
      />
      <AppFaultBanners />
      <slot />
    </div>
    <AppCommandPalette />
  </UDashboardGroup>
</template>
