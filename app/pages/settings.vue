<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";
import { getPageTitle } from "#shared/app";

useSeoMeta({ title: getPageTitle("Settings") });

const subNavItems: NavigationMenuItem[] = SETTINGS_NAVIGATION.map(
  ({ label, icon, to }) => ({ label, icon, to, exact: true }),
);
</script>

<template>
  <AppPanel title="Settings" class="flex max-w-4xl flex-col gap-6">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Settings
    </h1>

    <UNavigationMenu
      :items="subNavItems"
      orientation="horizontal"
      class="border-default border-b"
    />

    <NuxtPage />
  </AppPanel>
</template>
