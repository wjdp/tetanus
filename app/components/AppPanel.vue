<script setup lang="ts">
import { APP_NAME } from "#shared/app";

defineOptions({ inheritAttrs: false });

defineProps<{ title?: string }>();

const attrs = useAttrs();

const { open: openCommandPalette } = useCommandPalette();
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar
        :title="title"
        class="bg-elevated border-default border-b lg:hidden"
      >
        <template #toggle="{ toggleSidebar }">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-menu"
            aria-label="Open navigation"
            @click="toggleSidebar"
          >
            <span class="text-highlighted truncate text-lg font-semibold">
              {{ APP_NAME }}
            </span>
          </UButton>
        </template>

        <template #right>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-search"
            aria-label="Search"
            @click="openCommandPalette"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full" :class="attrs.class">
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
