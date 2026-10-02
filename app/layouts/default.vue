<script setup lang="ts">
const demo = useRuntimeConfig().public.demo;
</script>

<template>
  <UDashboardGroup>
    <AppSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <p
        v-if="demo"
        data-testid="demo-banner"
        class="bg-elevated border-default border-s-info text-muted flex items-center gap-3 border-b border-s-[3px] py-2.5 ps-4 pe-2 text-sm"
      >
        <UIcon
          name="i-lucide-flask-conical"
          class="text-info size-4 shrink-0"
        />
        Demo instance. Fake data, reset daily at 04:00 UTC. Edit anything.
      </p>
      <AppFaultBanners />
      <slot />
    </div>
    <AppCommandPalette />
  </UDashboardGroup>
</template>
