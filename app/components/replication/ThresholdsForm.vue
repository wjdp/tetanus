<script setup lang="ts">
import type { Settings } from "#shared/schemas/settings";

const props = defineProps<{ config: Settings["config"] | undefined }>();
const emit = defineEmits<{ saved: [settings: Settings] }>();

const FIELDS = [
  { key: "replicationLateFloorHours", label: "Late after (hours)" },
  { key: "replicationLateFactor", label: "Late factor (× interval)" },
  { key: "replicationStalledFloorHours", label: "Stalled after (hours)" },
  { key: "replicationStalledFactor", label: "Stalled factor (× interval)" },
] as const;

type ThresholdKey = (typeof FIELDS)[number]["key"];

const draft = reactive<Record<ThresholdKey, number | "">>({
  replicationLateFloorHours: "",
  replicationLateFactor: "",
  replicationStalledFloorHours: "",
  replicationStalledFactor: "",
});

watch(
  () => props.config,
  (config) => {
    if (!config) return;
    for (const { key } of FIELDS) draft[key] = config[key];
  },
  { immediate: true },
);

const toast = useToast();
const saving = ref(false);

const save = async () => {
  saving.value = true;
  try {
    const config = Object.fromEntries(
      FIELDS.map(({ key }) => [key, Number(draft[key])]),
    );
    emit("saved", await $fetch("/api/settings", {
      method: "PATCH",
      body: { config },
    }));
    toast.add({ title: "Replication thresholds saved", color: "neutral" });
  } catch (error) {
    toast.add({
      title: "Could not save the replication thresholds",
      description: (error as { data?: { message?: string } }).data?.message,
      color: "error",
    });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <form
    class="flex flex-col gap-4"
    data-testid="replication-thresholds"
    @submit.prevent="save"
  >
    <p class="text-muted text-sm">
      A replication is late once it is overdue by more than the larger of the
      hours and the factor times its interval, and stalled likewise. An hourly
      replication with the defaults is late after 3 h overdue and stalled after
      2 d; a daily one late after 12 h and stalled after 2 d.
    </p>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <UFormField
        v-for="field in FIELDS"
        :key="field.key"
        :label="field.label"
        :name="field.key"
      >
        <UInput
          v-model.number="draft[field.key]"
          type="number"
          min="0"
          step="any"
          required
          class="w-full sm:w-40"
        />
      </UFormField>
    </div>
    <UButton
      type="submit"
      color="neutral"
      variant="soft"
      label="Save"
      :loading="saving"
      class="self-start"
    />
  </form>
</template>
