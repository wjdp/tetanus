<script setup lang="ts">
import { upgradeCommand } from "#shared/collector";
import { collectorBadge, needsUpgrade } from "./collector";

const props = defineProps<{
  collectorVersion: string | null;
  toolVersions: Record<string, string>;
}>();

const demo = useRuntimeConfig().public.demo;
const requestUrl = useRequestURL();

const badge = computed(() => collectorBadge(props.collectorVersion));
const tools = computed(() =>
  Object.entries(props.toolVersions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, version]) => ({ tool, version })),
);
</script>

<template>
  <section
    class="border-default flex flex-col gap-3 rounded-lg border p-4"
    data-testid="collector-panel"
  >
    <h2 class="text-highlighted font-semibold">Collector</h2>
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      <dt class="text-muted">tetanus-collect</dt>
      <dd class="flex flex-wrap items-center gap-1">
        <span class="font-mono text-xs leading-5">
          {{ collectorVersion ?? "—" }}
        </span>
        <UBadge v-if="badge" :color="badge.color" variant="subtle" size="sm">
          {{ badge.label }}
        </UBadge>
      </dd>
      <template v-for="{ tool, version } in tools" :key="tool">
        <dt class="text-muted">{{ tool }}</dt>
        <dd class="truncate font-mono text-xs leading-5" :title="version">
          {{ version }}
        </dd>
      </template>
    </dl>
    <template v-if="!demo && needsUpgrade(collectorVersion)">
      <p class="text-muted text-sm">
        Run this on the host to upgrade. It keeps the existing config.
      </p>
      <CommandBlock
        :command="upgradeCommand(requestUrl.origin)"
        label="Upgrade command"
      />
    </template>
  </section>
</template>
