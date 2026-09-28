<template>
  <UDashboardGroup>
    <AppSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <AppFaultBanners />
      <slot />
    </div>
    <AppCommandPalette />
  </UDashboardGroup>
</template>
