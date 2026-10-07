<script setup lang="ts">
import { formatDuration } from "#shared/hostFreshness";
import { INTERVAL_SYNCS, MIN_INTERVAL_SYNCS } from "#shared/replications";
import { formatTimestamp } from "../pool/timestamp";
import { patchReplication } from "./patch";
import { dueText, lastSyncText } from "./timing";
import type { ReplicationDetail } from "./types";

const HOUR_SEC = 3600;

const props = defineProps<{ replication: ReplicationDetail; now: number }>();
const emit = defineEmits<{ saved: [] }>();

const toast = useToast();
const saving = ref(false);
// `v-model.number` leaves an empty input as "".
const hours = ref<number | "">("");

const fillDraft = () => {
  const { intervalManual, intervalSec } = props.replication;
  hours.value =
    intervalManual && intervalSec !== null
      ? Number((intervalSec / HOUR_SEC).toFixed(4))
      : "";
};
watch(
  () => [props.replication.intervalSec, props.replication.intervalManual],
  fillDraft,
  { immediate: true },
);

const intervalNote = computed(() => {
  const { intervalManual, intervalSec, syncCount } = props.replication;
  if (intervalManual) return "set by hand";
  if (intervalSec === null) {
    return `learning: needs ${MIN_INTERVAL_SYNCS} syncs, has ${syncCount}`;
  }
  return `median gap of the last ${INTERVAL_SYNCS} syncs`;
});

const save = async (manualIntervalSec: number | null) => {
  saving.value = true;
  try {
    await patchReplication(props.replication.id, { manualIntervalSec });
    emit("saved");
  } catch (error) {
    toast.add({
      title: "Could not save the interval",
      description: (error as { data?: { message?: string } }).data?.message,
      color: "error",
    });
  } finally {
    saving.value = false;
  }
};

const submit = () =>
  save(hours.value === "" ? null : Math.round(hours.value * HOUR_SEC));
</script>

<template>
  <section
    class="border-default flex flex-col gap-3 rounded-lg border p-4"
    data-testid="cadence-panel"
  >
    <h2 class="text-highlighted font-semibold">Cadence</h2>
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt class="text-muted">Cadence</dt>
      <dd class="text-highlighted">
        <ReplicationCadence
          :interval-sec="replication.intervalSec"
          :manual="replication.intervalManual"
        />
      </dd>
      <dt class="text-muted">Interval</dt>
      <dd class="text-highlighted tabular flex flex-col">
        <span v-if="replication.intervalSec !== null">
          {{ formatDuration(replication.intervalSec * 1000) }}
        </span>
        <span class="text-muted">{{ intervalNote }}</span>
      </dd>
      <dt class="text-muted">Last sync</dt>
      <dd class="text-highlighted tabular flex flex-col">
        <span>{{ formatTimestamp(replication.lastSyncAt) }}</span>
        <span v-if="replication.lastSyncAt" class="text-muted">
          {{ lastSyncText(replication, now) }}
        </span>
      </dd>
      <dt class="text-muted">Next due</dt>
      <dd class="text-highlighted tabular">{{ dueText(replication, now) }}</dd>
      <dt class="text-muted">Syncs</dt>
      <dd class="text-highlighted tabular">{{ replication.syncCount }}</dd>
    </dl>
    <form
      class="flex flex-wrap items-end gap-2"
      data-testid="interval-form"
      @submit.prevent="submit"
    >
      <UFormField
        label="Interval override (hours)"
        name="manualIntervalHours"
        description="Blank uses the learnt interval."
      >
        <UInput
          v-model.number="hours"
          type="number"
          min="0.0167"
          step="any"
          placeholder="Learnt"
          class="w-40"
        />
      </UFormField>
      <UButton
        type="submit"
        color="neutral"
        variant="soft"
        label="Save"
        :loading="saving"
      />
      <UButton
        v-if="replication.intervalManual"
        color="neutral"
        variant="ghost"
        icon="i-lucide-rotate-ccw"
        label="Use learnt"
        data-testid="interval-clear"
        :disabled="saving"
        @click="save(null)"
      />
    </form>
  </section>
</template>
