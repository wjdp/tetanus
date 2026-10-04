<script setup lang="ts">
import {
  type HostTemperatureThresholds,
  TEMPERATURE_DEFAULTS,
  type TemperatureThresholds,
  type ThresholdMedia,
} from "#shared/temperature";

const props = defineProps<{
  host: {
    id: number;
    displayName: string | null;
    healthchecksUrl: string | null;
    intermittent: boolean;
    notes: string;
    temperatureThresholds: HostTemperatureThresholds | null;
  };
}>();

const emit = defineEmits<{ saved: [] }>();

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

const displayName = ref("");
const healthchecksUrl = ref("");
const intermittent = ref(false);
const notes = ref("");
const thresholds = reactive<ThresholdInputs>({
  hdd: { warning: "", error: "" },
  ssd: { warning: "", error: "" },
});

const reset = () => {
  displayName.value = props.host.displayName ?? "";
  healthchecksUrl.value = props.host.healthchecksUrl ?? "";
  intermittent.value = props.host.intermittent;
  notes.value = props.host.notes;
  for (const media of ["hdd", "ssd"] as const) {
    const saved = props.host.temperatureThresholds?.[media];
    thresholds[media].warning = saved?.warning ?? "";
    thresholds[media].error = saved?.error ?? "";
  }
};
watch(() => props.host, reset, { immediate: true });

const parseCelsius = (value: ThresholdInput) =>
  value === "" || value === undefined ? null : Number(value);

const thresholdsPatch = (): HostTemperatureThresholds | null => {
  const patch: HostTemperatureThresholds = {};
  for (const media of ["hdd", "ssd"] as const) {
    const warning = parseCelsius(thresholds[media].warning);
    const error = parseCelsius(thresholds[media].error);
    if (warning !== null && error !== null) {
      patch[media] = { warning, error };
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
};

const toast = useToast();
const saving = ref(false);

const save = async () => {
  saving.value = true;
  try {
    await $fetch(`/api/hosts/${props.host.id}`, {
      method: "PATCH",
      body: {
        displayName: displayName.value,
        intermittent: intermittent.value,
        healthchecksUrl: intermittent.value ? null : healthchecksUrl.value,
        notes: notes.value,
        temperatureThresholds: thresholdsPatch(),
      },
    });
    toast.add({ title: "Host updated", color: "success" });
    emit("saved");
  } catch {
    toast.add({ title: "Could not update the host", color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <form
    class="flex flex-col gap-4"
    data-testid="host-settings"
    @submit.prevent="save"
  >
    <UFormField label="Display name" name="displayName">
      <UInput v-model="displayName" class="w-full" />
    </UFormField>

    <UFormField
      label="Intermittent"
      name="intermittent"
      description="Expected to be off for long periods. No silent-collector fault; disks keep their state while it is off."
    >
      <USwitch v-model="intermittent" />
    </UFormField>

    <UFormField v-if="!intermittent" label="Healthchecks URL" name="healthchecksUrl">
      <UInput v-model="healthchecksUrl" class="w-full" />
    </UFormField>

    <UFormField label="Notes" name="notes">
      <UTextarea v-model="notes" class="w-full" :rows="6" autoresize />
    </UFormField>

    <UFormField
      label="Temperature thresholds (°C)"
      name="temperatureThresholds"
      description="Blank uses the default shown. A pair with only one value set uses the defaults for that media."
    >
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <UFormField
          v-for="field in THRESHOLD_FIELDS"
          :key="`${field.media}-${field.level}`"
          :label="field.label"
          :name="`temperatureThresholds.${field.media}.${field.level}`"
          size="sm"
        >
          <UInput
            v-model="thresholds[field.media][field.level]"
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
