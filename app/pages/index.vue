<script setup lang="ts">
import { getPageTitle } from "#shared/app";

useSeoMeta({ title: getPageTitle("Topology") });

const { data: hosts } = await useFetch("/api/hosts");
const { data: settings } = await useFetch("/api/settings");
const requestUrl = useRequestURL();
</script>

<template>
  <AppPanel title="Topology" class="max-w-7xl">
    <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
      Topology
    </h1>

    <div
      v-if="hosts && hosts.length === 0"
      class="border-default mt-6 flex flex-col gap-4 rounded-lg border border-dashed p-8"
    >
      <div class="flex items-center gap-3">
        <TetanusMark :size="28" class="text-dimmed shrink-0" />
        <p class="text-highlighted font-semibold">
          No hosts have reported yet.
        </p>
      </div>

      <InstallCommand
        v-if="settings"
        :url="requestUrl.origin"
        :token="settings.enrolToken"
      />

      <div>
        <UButton
          to="/settings/hosts"
          color="neutral"
          variant="soft"
          icon="i-lucide-server"
          label="Go to Hosts settings"
        />
      </div>
    </div>
  </AppPanel>
</template>
