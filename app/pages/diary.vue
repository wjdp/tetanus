<script setup lang="ts">
import { getPageTitle } from "#shared/app";

useSeoMeta({ title: getPageTitle("Diary") });
</script>

<template>
  <AppPanel title="Diary" class="max-w-7xl">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Diary
    </h1>
  </AppPanel>
</template>
