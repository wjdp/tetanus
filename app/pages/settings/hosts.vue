<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";

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

const toolVersionsSummary = (toolVersions: Record<string, string>) =>
  ["zfs", "smartctl"]
    .filter((key) => toolVersions[key])
    .map((key) => `${key} ${toolVersions[key]}`)
    .join(" · ") || "—";

const relativeTime = (date: Date | null) => {
  if (!date) return "never";
  return `${formatDuration(now.value - date.getTime())} ago`;
};

const chipColor = (status: ReturnType<typeof allGroupFreshness>[number]["status"]) =>
  status === "ok" ? "neutral" : status;

const columns: TableColumn<Host>[] = [
  { accessorKey: "name", header: "Host" },
  { accessorKey: "displayName", header: "Display name" },
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

      <template #versions-cell="{ row }">
        <span class="text-dimmed font-mono text-xs">
          {{ toolVersionsSummary(row.original.toolVersions) }}
        </span>
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
