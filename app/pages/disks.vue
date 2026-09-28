<script setup lang="ts">
import { getPageTitle } from "#shared/app";

useSeoMeta({ title: getPageTitle("Disks") });
</script>

<template>
  <AppPanel title="Disks" class="max-w-7xl">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Disks
    </h1>
  </AppPanel>
</template>
