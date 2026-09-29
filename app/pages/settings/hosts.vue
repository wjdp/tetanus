<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import {
  COLLECTOR_VERSION,
  type CollectorStatus,
  collectorStatus,
  MIN_COLLECTOR_VERSION,
  upgradeCommand,
} from "#shared/collector";

const { data: hosts, refresh } = await useFetch("/api/hosts");

type Host = NonNullable<typeof hosts.value>[number];

const demo = useRuntimeConfig().public.demo;
const cadences = demo ? DEMO_CADENCES : undefined;

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

const SUMMARISED_TOOLS = ["zfs", "smartctl"];

const shortToolVersion = (tool: string, version: string) =>
  version.replace(new RegExp(`^${tool}[- ]`), "").split(/\s+/)[0];

const toolVersionLines = (toolVersions: Record<string, string>) =>
  SUMMARISED_TOOLS.filter((tool) => toolVersions[tool]).map(
    (tool) => `${tool} ${shortToolVersion(tool, toolVersions[tool])}`,
  );

const COLLECTOR_BADGES: Record<
  Exclude<CollectorStatus, "current">,
  { label: string; color: "warning" | "error" | "neutral" }
> = {
  outdated: { label: `${COLLECTOR_VERSION} available`, color: "warning" },
  incompatible: {
    label: `needs ${MIN_COLLECTOR_VERSION}+`,
    color: "error",
  },
  unknown: { label: "unknown", color: "neutral" },
};

const collectorBadge = (version: string | null) => {
  const status = collectorStatus(version);
  return status === "current" ? null : COLLECTOR_BADGES[status];
};

const needsUpgrade = (host: Host) =>
  ["outdated", "incompatible"].includes(collectorStatus(host.collectorVersion));

const hostsToUpgrade = computed(() => (hosts.value ?? []).filter(needsUpgrade));

const relativeTime = (date: Date | null) => {
  if (!date) return "never";
  return `${formatDuration(now.value - date.getTime())} ago`;
};

const chipColor = (status: ReturnType<typeof allGroupFreshness>[number]["status"]) =>
  status === "ok" ? "neutral" : status;

const columns: TableColumn<Host>[] = [
  { accessorKey: "name", header: "Host" },
  { accessorKey: "displayName", header: "Display name" },
  { id: "collector", header: "Collector" },
  { id: "versions", header: "Tool versions" },
  { id: "freshness", header: "Sources" },
  { id: "lastSeen", header: "Last seen" },
];

const toast = useToast();
const selected = ref<Host | null>(null);
const editorOpen = ref(false);

const editDisplayName = ref("");
const editHealthchecksUrl = ref("");
const editNotes = ref("");
const saving = ref(false);

const openEditor = (row: Host) => {
  selected.value = row;
  editDisplayName.value = row.displayName ?? "";
  editHealthchecksUrl.value = row.healthchecksUrl ?? "";
  editNotes.value = row.notes;
  editorOpen.value = true;
};

const onSelectRow = (_event: Event, row: { original: Host }) =>
  openEditor(row.original);

const save = async () => {
  if (!selected.value) return;
  saving.value = true;
  try {
    await $fetch(`/api/hosts/${selected.value.id}`, {
      method: "PATCH",
      body: {
        displayName: editDisplayName.value,
        healthchecksUrl: editHealthchecksUrl.value,
        notes: editNotes.value,
      },
    });
    await refresh();
    toast.add({ title: "Host updated", color: "success" });
    editorOpen.value = false;
  } catch {
    toast.add({ title: "Could not update the host", color: "error" });
  } finally {
    saving.value = false;
  }
};

const requestUrl = useRequestURL();
const { data: settings } = await useFetch("/api/settings");
</script>

<template>
  <section class="flex flex-col gap-6">
    <h2 class="text-highlighted text-lg font-semibold">Hosts</h2>

    <UTable
      :data="hosts ?? []"
      :columns="columns"
      :empty="'No hosts have reported yet.'"
      :on-select="onSelectRow"
    >
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
          <UBadge
            v-for="group in allGroupFreshness(row.original.lastRuns, now, cadences)"
            :key="group.name"
            :color="chipColor(group.status)"
            variant="subtle"
            size="sm"
          >
            {{ group.name }}: {{ relativeTime(group.lastSeenAt) }}
          </UBadge>
        </div>
      </template>

      <template #lastSeen-cell="{ row }">
        {{ relativeTime(new Date(row.original.lastSeenAt)) }}
      </template>
    </UTable>

    <section v-if="!demo && hostsToUpgrade.length" class="flex flex-col gap-3">
      <h3 class="text-highlighted font-semibold">Upgrade the collector</h3>
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

    <section v-if="!demo" class="flex flex-col gap-3">
      <h3 class="text-highlighted font-semibold">Add a host</h3>
      <p class="text-muted text-sm">
        Run this on the NAS host with the enrol token below.
      </p>
      <InstallCommand
        v-if="settings"
        :url="requestUrl.origin"
        :token="settings.enrolToken"
      />
    </section>
  </section>

  <USlideover
    v-model:open="editorOpen"
    :title="selected?.displayName || selected?.name"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="save">
        <UFormField label="Display name" name="displayName">
          <UInput v-model="editDisplayName" class="w-full" />
        </UFormField>

        <UFormField label="Healthchecks URL" name="healthchecksUrl">
          <UInput v-model="editHealthchecksUrl" class="w-full" />
        </UFormField>

        <UFormField label="Notes" name="notes">
          <UTextarea v-model="editNotes" class="w-full" :rows="6" />
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          :loading="saving"
          label="Save"
          class="self-start"
        />
      </form>
    </template>
  </USlideover>
</template>
