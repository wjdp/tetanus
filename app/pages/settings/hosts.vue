<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { moveArrayElement, useSortable } from "@vueuse/integrations/useSortable";
import type { SortableEvent } from "sortablejs";
import {
  COLLECTOR_VERSION,
  type CollectorStatus,
  collectorStatus,
  MIN_COLLECTOR_VERSION,
  upgradeCommand,
} from "#shared/collector";
import {
  type HostTemperatureThresholds,
  TEMPERATURE_DEFAULTS,
  type TemperatureThresholds,
  type ThresholdMedia,
} from "#shared/temperature";

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

const columns: TableColumn<Host>[] = [
  { id: "order", header: "" },
  { accessorKey: "name", header: "Host" },
  { accessorKey: "displayName", header: "Display name" },
  { id: "collector", header: "Collector" },
  { id: "versions", header: "Tool versions" },
  { id: "freshness", header: "Sources" },
  { id: "lastSeen", header: "Last seen" },
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

const selected = ref<Host | null>(null);
const editorOpen = ref(false);

const editDisplayName = ref("");
const editHealthchecksUrl = ref("");
const editIntermittent = ref(false);
const editNotes = ref("");
const saving = ref(false);

type ThresholdInput = number | string | undefined;
type ThresholdInputs = Record<
  ThresholdMedia,
  Record<keyof TemperatureThresholds, ThresholdInput>
>;

const THRESHOLD_FIELDS = (["hdd", "ssd"] as const).flatMap((media) =>
  (["warning", "error"] as const).map((level) => ({
    media,
    level,
    label: `${media.toUpperCase()} ${level}`,
    placeholder: String(TEMPERATURE_DEFAULTS[media][level]),
  })),
);

const editThresholds = reactive<ThresholdInputs>({
  hdd: { warning: "", error: "" },
  ssd: { warning: "", error: "" },
});

const parseCelsius = (value: ThresholdInput) =>
  value === "" || value === undefined ? null : Number(value);

const thresholdsPatch = (): HostTemperatureThresholds | null => {
  const thresholds: HostTemperatureThresholds = {};
  for (const media of ["hdd", "ssd"] as const) {
    const warning = parseCelsius(editThresholds[media].warning);
    const error = parseCelsius(editThresholds[media].error);
    if (warning !== null && error !== null) {
      thresholds[media] = { warning, error };
    }
  }
  return Object.keys(thresholds).length > 0 ? thresholds : null;
};

const openEditor = (row: Host) => {
  selected.value = row;
  editDisplayName.value = row.displayName ?? "";
  editHealthchecksUrl.value = row.healthchecksUrl ?? "";
  editIntermittent.value = row.intermittent;
  editNotes.value = row.notes;
  for (const media of ["hdd", "ssd"] as const) {
    const saved = row.temperatureThresholds?.[media];
    editThresholds[media].warning = saved?.warning ?? "";
    editThresholds[media].error = saved?.error ?? "";
  }
  editorOpen.value = true;
};

const isDragHandle = (event: Event) =>
  event.target instanceof Element &&
  event.target.closest("[data-drag-handle]") !== null;

const onSelectRow = (event: Event, row: { original: Host }) => {
  if (!isDragHandle(event)) openEditor(row.original);
};

const save = async () => {
  if (!selected.value) return;
  saving.value = true;
  try {
    await $fetch(`/api/hosts/${selected.value.id}`, {
      method: "PATCH",
      body: {
        displayName: editDisplayName.value,
        intermittent: editIntermittent.value,
        healthchecksUrl: editIntermittent.value
          ? null
          : editHealthchecksUrl.value,
        notes: editNotes.value,
        temperatureThresholds: thresholdsPatch(),
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
      ref="table"
      :data="hosts ?? []"
      :columns="columns"
      :empty="'No hosts have reported yet.'"
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
          <span>{{ row.original.name }}</span>
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

        <UFormField
          label="Intermittent"
          name="intermittent"
          description="Expected to be off for long periods. No silent-collector fault; disks keep their state while it is off."
        >
          <USwitch v-model="editIntermittent" />
        </UFormField>

        <UFormField
          v-if="!editIntermittent"
          label="Healthchecks URL"
          name="healthchecksUrl"
        >
          <UInput v-model="editHealthchecksUrl" class="w-full" />
        </UFormField>

        <UFormField label="Notes" name="notes">
          <UTextarea v-model="editNotes" class="w-full" :rows="6" />
        </UFormField>

        <UFormField
          label="Temperature thresholds (°C)"
          name="temperatureThresholds"
          description="Blank uses the default shown. A pair with only one value set uses the defaults for that media."
        >
          <div class="grid grid-cols-2 gap-2">
            <UFormField
              v-for="field in THRESHOLD_FIELDS"
              :key="`${field.media}-${field.level}`"
              :label="field.label"
              :name="`temperatureThresholds.${field.media}.${field.level}`"
              size="sm"
            >
              <UInput
                v-model="editThresholds[field.media][field.level]"
                type="number"
                :min="0"
                :max="120"
                :placeholder="field.placeholder"
                class="w-full"
              />
            </UFormField>
          </div>
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
