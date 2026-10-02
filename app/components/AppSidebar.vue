<script setup lang="ts">
import type { BadgeProps, NavigationMenuItem } from "@nuxt/ui";
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

const { badge: faultBadge } = useFaults(OPEN_ERRORS_QUERY);

const badgeCounts = computed<Record<NavigationBadge, number>>(() => ({
  faults: faultBadge.value,
}));

const toBadge = (name: NavigationBadge | undefined): BadgeProps | undefined => {
  const count = name ? badgeCounts.value[name] : 0;
  return count > 0
    ? { label: String(count), color: "error", variant: "solid", size: "sm" }
    : undefined;
};

const mainLinks = computed<NavigationMenuItem[]>(() =>
  NAVIGATION.map(({ badge, ...entry }) => ({
    ...entry,
    badge: toBadge(badge),
    exact: entry.to === "/",
  })),
);

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
        :items="mainLinks"
        :collapsed="collapsed"
        orientation="vertical"
        tooltip
        :ui="navLinkUi"
      />

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
