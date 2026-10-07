<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { APP_NAME } from "#shared/app";
import type {
  ScrutinyDeviceImport,
  ScrutinyImportResult,
  ScrutinyMatch,
} from "#shared/schemas/import";
import type { SseTask } from "#shared/sse";

type ImportResult = ScrutinyImportResult<string>;
type DeviceRow = ScrutinyDeviceImport<string>;

const MATCH_LABELS: Record<ScrutinyMatch, string> = {
  wwn: "WWN",
  uuid: "Scrutiny UUID",
  serial: "Model and serial",
  created: "New disk",
};

const demo = useRuntimeConfig().public.demo;

const { data: hosts } = await useFetch("/api/hosts", { default: () => [] });

const hostItems = computed(() =>
  hosts.value.map((host) => ({
    label: host.displayName ?? host.name,
    value: host.id,
  })),
);

const url = ref("");
const hostId = ref<number | undefined>(hosts.value[0]?.id);
const result = ref<ImportResult | null>(null);
const previewing = ref(false);
const importTask = ref<SseTask | null>(null);

const importing = computed(
  () =>
    importTask.value?.state === "pending" ||
    importTask.value?.state === "in_progress",
);

watch([url, hostId], () => {
  if (!importing.value) result.value = null;
});

const toast = useToast();

const errorMessage = (error: unknown) =>
  (error as { data?: { message?: string } }).data?.message ??
  (error as Error).message;

const request = (dryRun: boolean) =>
  $fetch<ImportResult | { taskId: number }>("/api/import/scrutiny", {
    method: "POST",
    body: { url: url.value, hostId: hostId.value, dryRun },
  });

const preview = async () => {
  previewing.value = true;
  try {
    result.value = (await request(true)) as ImportResult;
  } catch (error) {
    toast.add({
      title: "Could not preview the import",
      description: errorMessage(error),
      color: "error",
    });
  } finally {
    previewing.value = false;
  }
};

const loadSummary = async (taskId: number) => {
  try {
    const summaryUrl: string = `/api/import/scrutiny/${taskId}`;
    result.value = await $fetch<ImportResult>(summaryUrl);
    toast.add({ title: "Scrutiny import finished", color: "success" });
  } catch (error) {
    toast.add({
      title: "Could not load the import summary",
      description: errorMessage(error),
      color: "error",
    });
  }
};

const { onMessage } = useSseClient();
onMessage("task", (event) => {
  if (event.id !== importTask.value?.id) return;
  importTask.value = { ...importTask.value, ...event };
  if (event.state === "done") loadSummary(event.id);
  if (event.state === "failed") {
    toast.add({
      title: "Scrutiny import failed",
      description: event.message,
      color: "error",
    });
  }
});

const runImport = async () => {
  try {
    const { taskId } = (await request(false)) as { taskId: number };
    importTask.value = { id: taskId, name: "import:scrutiny", state: "pending" };
  } catch (error) {
    toast.add({
      title: "Could not start the import",
      description: errorMessage(error),
      color: "error",
    });
  }
};

const columns: TableColumn<DeviceRow>[] = [
  { accessorKey: "model", header: "Model" },
  { accessorKey: "serial", header: "Serial" },
  { id: "match", header: "Match" },
  { id: "disk", header: "Disk" },
  { accessorKey: "readings", header: "SMART points" },
  { accessorKey: "temperatures", header: "Temperatures" },
  { id: "cutoff", header: "Before" },
  { id: "error", header: "Error" },
];

const totals = computed(() =>
  (result.value?.devices ?? []).reduce(
    (sum, device) => ({
      readings: sum.readings + device.readings,
      temperatures: sum.temperatures + device.temperatures,
    }),
    { readings: 0, temperatures: 0 },
  ),
);
</script>

<template>
  <section class="flex flex-col gap-6">
    <h2 class="text-highlighted text-lg font-semibold">Import</h2>

    <UAlert
      v-if="demo"
      color="neutral"
      variant="subtle"
      icon="i-lucide-import"
      title="Importing is disabled in the demo."
      data-testid="demo-disabled-note"
    />
    <UCard v-else data-testid="scrutiny-import">
      <template #header>
        <h3 class="text-highlighted font-semibold">Scrutiny</h3>
        <p class="text-muted text-sm">
          Only readings from before the day of {{ APP_NAME }}'s first reading for
          each disk are imported, at scrutiny's daily resolution.
        </p>
      </template>

      <form class="flex flex-col gap-4" @submit.prevent="preview">
        <UFormField label="URL" name="scrutinyUrl" required>
          <UInput
            v-model="url"
            type="url"
            placeholder="https://"
            class="w-full font-mono"
          />
        </UFormField>
        <UFormField
          label="Target host"
          name="hostId"
          description="Imported readings and new inventory disks are attributed to this host."
          required
        >
          <USelect
            v-model="hostId"
            :items="hostItems"
            placeholder="Choose a host"
            class="w-64"
            aria-label="Target host"
          />
        </UFormField>

        <div class="flex flex-wrap items-center gap-3">
          <UButton
            type="submit"
            color="neutral"
            variant="outline"
            icon="i-lucide-eye"
            label="Preview"
            :loading="previewing"
            :disabled="!url || !hostId || importing"
          />
          <UButton
            color="primary"
            icon="i-lucide-import"
            label="Import"
            :loading="importing"
            :disabled="!result?.dryRun"
            @click="runImport"
          />
          <span
            v-if="importing"
            class="text-muted text-sm"
            data-testid="import-progress"
          >
            {{ importTask?.message ?? "Queued" }}
          </span>
        </div>
      </form>

      <template v-if="result" #footer>
        <div class="flex flex-col gap-3" data-testid="scrutiny-devices">
          <p class="text-muted text-sm">
            {{ result.dryRun ? "Would import" : "Imported" }}
            {{ totals.readings }} SMART points and
            {{ totals.temperatures }} temperatures across
            {{ result.devices.length }} devices.
          </p>
          <UTable
            :data="result.devices"
            :columns="columns"
            empty="Scrutiny has no devices"
          >
            <template #match-cell="{ row }">
              <UBadge
                :color="row.original.matched === 'created' ? 'info' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ MATCH_LABELS[row.original.matched] }}
              </UBadge>
            </template>

            <template #disk-cell="{ row }">
              <NuxtLink
                v-if="row.original.diskId !== null"
                :to="`/disks/${row.original.diskId}`"
                class="text-primary hover:underline"
              >
                View disk
              </NuxtLink>
              <span v-else class="text-dimmed">—</span>
            </template>

            <template #cutoff-cell="{ row }">
              <span class="whitespace-nowrap font-mono text-xs">
                {{ row.original.cutoff ? formatDate(row.original.cutoff) : "all" }}
              </span>
            </template>

            <template #error-cell="{ row }">
              <span v-if="row.original.error" class="text-error text-sm">
                {{ row.original.error }}
              </span>
            </template>
          </UTable>
        </div>
      </template>
    </UCard>
  </section>
</template>
