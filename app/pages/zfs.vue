<script setup lang="ts">
import { getPageTitle } from "#shared/app";

useSeoMeta({ title: getPageTitle("ZFS") });
</script>

<template>
  <AppPanel title="ZFS" class="max-w-7xl">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      ZFS
    </h1>
  </AppPanel>
</template>
