<script setup lang="ts">
import { datasetPath } from "#shared/entityPaths";
import { REPLICATION_ROLE_VOCABULARY } from "~/utils/vocabulary";
import { hostLabel } from "./groups";
import type { ReplicationDetail } from "./types";

defineProps<{ replication: ReplicationDetail; now: number }>();
</script>

<template>
  <section
    class="border-default relative flex flex-col gap-3 rounded-lg border p-4"
    data-testid="target-panel"
  >
    <span
      aria-hidden="true"
      class="bg-default border-default text-dimmed absolute start-1/2 -top-5 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border md:top-1/2 md:-start-5 md:translate-x-0 md:-translate-y-1/2"
    >
      <UIcon name="i-lucide-arrow-down" class="size-3.5 md:hidden" />
      <UIcon name="i-lucide-arrow-right" class="hidden size-3.5 md:block" />
    </span>
    <h2 class="text-highlighted flex items-center gap-2 font-semibold">
      <UIcon
        :name="REPLICATION_ROLE_VOCABULARY.target.icon"
        class="text-dimmed size-4"
      />
      Target
    </h2>
    <p class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-muted">{{ hostLabel(replication.target) }}</span>
      <NuxtLink
        :to="datasetPath(replication.target.pool.path, replication.target.dataset.name)"
        class="text-highlighted font-mono hover:underline"
      >
        {{ replication.target.dataset.name }}
      </NuxtLink>
      <UBadge
        v-if="!replication.target.dataset.present"
        color="neutral"
        variant="subtle"
        size="sm"
      >
        destroyed
      </UBadge>
    </p>
    <ReplicationEndpointFacts :facts="replication.ends.target" :now="now" />
  </section>
</template>
