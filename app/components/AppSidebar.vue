<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";
import { APP_NAME } from "#shared/app";
import type { NavigationBadge } from "~/utils/navigation";

const { version } = useRuntimeConfig().public;

const { open: openCommandPalette } = useCommandPalette();

const searchLinks: NavigationMenuItem[] = [
  {
    label: "Search",
    icon: "i-lucide-search",
    slot: "search",
    onSelect: openCommandPalette,
  },
];

const route = useRoute();

const navigationCounts = useNavigationCounts();

const countsFor = (item: NavigationMenuItem) =>
  navigationCounts.value[item.countsKey as NavigationBadge];

const mainLinks = (collapsed: boolean): NavigationMenuItem[] =>
  NAVIGATION.map((entry) => {
    const { label, icon, to, badge } = entry;
    const colour = badge && navigationChipColour(navigationCounts.value[badge]);
    return {
      label,
      icon,
      to,
      countsKey: collapsed ? undefined : badge,
      chip: collapsed && colour ? { color: colour } : undefined,
      active: isNavigationActive(entry, route.path),
    };
  });

const navLinkUi = {
  link: "px-2 data-[active]:text-highlighted data-[active]:before:bg-accented",
};
</script>

<template>
  <UDashboardSidebar
    collapsible
    resizable
    :ui="{
      root: 'bg-elevated border-e border-default',
      header: 'px-3.5 sm:px-3.5 lg:px-6',
      body: 'sm:px-4',
      footer: 'border-t border-default px-3.5 sm:px-3.5',
      content: 'bg-elevated',
    }"
  >
    <template #header="{ collapsed }">
      <NuxtLink to="/" class="flex min-w-0 items-center gap-2">
        <TetanusMark :size="24" class="text-highlighted shrink-0" />
        <span
          v-if="!collapsed"
          class="text-highlighted truncate text-lg font-semibold tracking-tight"
        >
          {{ APP_NAME }}
        </span>
      </NuxtLink>
    </template>

    <template #default="{ collapsed }">
      <UNavigationMenu
        :items="searchLinks"
        :collapsed="collapsed"
        orientation="vertical"
        tooltip
        :ui="navLinkUi"
      >
        <template #search-trailing>
          <span v-if="!collapsed" class="ms-auto flex items-center gap-0.5">
            <UKbd value="meta" />
            <UKbd value="k" />
          </span>
        </template>
      </UNavigationMenu>
      <UNavigationMenu
        :items="mainLinks(collapsed)"
        :collapsed="collapsed"
        orientation="vertical"
        tooltip
        :ui="navLinkUi"
      >
        <template #item-trailing="{ item }">
          <AppNavCounts v-if="item.countsKey" :counts="countsFor(item)" />
        </template>
      </UNavigationMenu>

      <AppTaskIndicator :collapsed="collapsed" class="mt-auto" />
    </template>

    <template #footer="{ collapsed }">
      <UColorModeButton />
      <span v-if="!collapsed" class="text-dimmed font-mono text-xs">
        v{{ version }}
      </span>
      <UDashboardSidebarCollapse class="ms-auto" />
    </template>
  </UDashboardSidebar>
</template>
