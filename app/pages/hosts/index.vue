<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { moveArrayElement, useSortable } from "@vueuse/integrations/useSortable";
import type { SortableEvent } from "sortablejs";
import { getPageTitle } from "#shared/app";
import { upgradeCommand } from "#shared/collector";
import {
  collectorBadge,
  needsUpgrade,
  toolVersionLines,
} from "~/components/host/collector";

useSeoMeta({ title: getPageTitle("Hosts") });

const { data: hosts, refresh } = await useFetch("/api/hosts", {
  default: () => [],
});

type Host = NonNullable<typeof hosts.value>[number];

const demo = useRuntimeConfig().public.demo;

const now = ref(Date.now());
let pollHandle: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  pollHandle = setInterval(() => {
    now.value = Date.now();
    refresh();
  }, 30_000);
});

onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});

const hostsToUpgrade = computed(() =>
  (hosts.value ?? []).filter((host) => needsUpgrade(host.collectorVersion)),
);

const relativeTime = (date: Date | null) => {
  if (!date) return "never";
  return `${formatDuration(now.value - date.getTime())} ago`;
};

const columns: TableColumn<Host>[] = [
  { id: "order", header: "" },
  { accessorKey: "name", header: "Host" },
  { accessorKey: "displayName", header: "Display name" },
  { id: "collector", header: "Collector" },
  { id: "versions", header: "Tool versions" },
  { id: "freshness", header: "Sources" },
  { id: "lastSeen", header: "Last seen" },
  ...(useSimulator().enabled ? [{ id: "simulate", header: "" }] : []),
];

const toast = useToast();

const table = useTemplateRef("table");

const saveOrder = async (hostIds: number[]) => {
  try {
    hosts.value = await $fetch("/api/hosts/order", {
      method: "PUT",
      body: { hostIds },
    });
  } catch {
    toast.add({ title: "Could not reorder the hosts", color: "error" });
    await refresh();
  }
};

useSortable(() => table.value?.$el?.querySelector("tbody"), hosts, {
  handle: "[data-drag-handle]",
  animation: 150,
  watchElement: true,
  onUpdate: (event: SortableEvent) => {
    const { oldIndex, newIndex } = event;
    if (oldIndex === undefined || newIndex === undefined) return;
    const hostIds = (hosts.value ?? []).map((row) => row.id);
    const [moved] = hostIds.splice(oldIndex, 1);
    hostIds.splice(newIndex, 0, moved);
    moveArrayElement(hosts, oldIndex, newIndex, event);
    saveOrder(hostIds);
  },
});

const isRowControl = (event: Event) =>
  event.target instanceof Element &&
  event.target.closest("[data-drag-handle], [data-row-control]") !== null;

const onSelectRow = (event: Event, row: { original: Host }) => {
  if (!isRowControl(event)) navigateTo(`/hosts/${row.original.id}`);
};

const requestUrl = useRequestURL();
</script>

<template>
  <AppPanel title="Hosts" class="flex max-w-7xl flex-col gap-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
        Hosts
      </h1>
      <UButton
        v-if="!demo"
        to="/hosts/add"
        icon="i-lucide-plus"
        label="Add host"
        data-testid="add-host"
      />
    </div>

    <div
      v-if="hosts.length === 0"
      class="border-default flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-10 text-center"
      data-testid="hosts-empty"
    >
      <p class="text-highlighted font-medium">No hosts have reported yet</p>
      <p v-if="!demo" class="text-muted text-sm">
        <NuxtLink
          to="/hosts/add"
          class="text-highlighted hover:text-primary underline"
        >
          Install the collector
        </NuxtLink>
        on a NAS host to start.
      </p>
    </div>

    <UTable
      v-else
      ref="table"
      :data="hosts"
      :columns="columns"
      :on-select="onSelectRow"
    >
      <template #order-cell>
        <span
          data-drag-handle
          title="Drag to reorder"
          class="text-dimmed hover:text-default -m-2 inline-flex cursor-grab p-2 active:cursor-grabbing"
        >
          <UIcon name="i-lucide-grip-vertical" class="size-4" />
        </span>
      </template>

      <template #name-cell="{ row }">
        <div class="flex items-center gap-2">
          <NuxtLink
            :to="`/hosts/${row.original.id}`"
            data-row-control
            class="text-highlighted hover:text-primary"
          >
            {{ row.original.name }}
          </NuxtLink>
          <UBadge
            v-if="row.original.intermittent"
            color="neutral"
            variant="subtle"
            size="sm"
          >
            intermittent
          </UBadge>
        </div>
      </template>

      <template #displayName-cell="{ row }">
        {{ row.original.displayName ?? "—" }}
      </template>

      <template #collector-cell="{ row }">
        <div class="flex flex-wrap items-center gap-1">
          <span class="font-mono text-xs">
            {{ row.original.collectorVersion ?? "—" }}
          </span>
          <UBadge
            v-if="collectorBadge(row.original.collectorVersion)"
            :color="collectorBadge(row.original.collectorVersion)?.color"
            variant="subtle"
            size="sm"
          >
            {{ collectorBadge(row.original.collectorVersion)?.label }}
          </UBadge>
        </div>
      </template>

      <template #versions-cell="{ row }">
        <div
          v-if="toolVersionLines(row.original.toolVersions).length"
          class="text-dimmed flex flex-col font-mono text-xs"
        >
          <span
            v-for="line in toolVersionLines(row.original.toolVersions)"
            :key="line"
          >
            {{ line }}
          </span>
        </div>
        <span v-else class="text-dimmed">—</span>
      </template>

      <template #freshness-cell="{ row }">
        <div class="flex flex-wrap gap-1">
          <HostFreshnessChips :host="row.original" :now="now" />
        </div>
      </template>

      <template #lastSeen-cell="{ row }">
        {{ relativeTime(new Date(row.original.lastSeenAt)) }}
      </template>

      <template #simulate-cell="{ row }">
        <div class="flex justify-end" data-row-control>
          <SimulateFaultMenu
            subject-type="host"
            :subject-id="row.original.id"
            size="xs"
            compact
          />
        </div>
      </template>
    </UTable>

    <section v-if="!demo && hostsToUpgrade.length" class="flex flex-col gap-3">
      <h2 class="text-highlighted font-semibold">Upgrade the collector</h2>
      <p class="text-muted text-sm">
        Run this on
        {{ hostsToUpgrade.map((host) => host.name).join(", ") }}. It keeps the
        existing config.
      </p>
      <CommandBlock
        :command="upgradeCommand(requestUrl.origin)"
        label="Upgrade command"
      />
    </section>
  </AppPanel>
</template>
