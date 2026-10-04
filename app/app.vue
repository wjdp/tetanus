<script setup lang="ts">
import { themeColourMeta } from "#shared/themeColours";

const colourMode = useColorMode();
useHead(() => ({
  meta: themeColourMeta(
    colourMode.preference === "light" || colourMode.preference === "dark"
      ? colourMode.preference
      : "system",
  ),
}));
</script>

<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <NuxtLoadingIndicator :height="3" :throttle="100" :duration="1000" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
