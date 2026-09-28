<script setup lang="ts">
import { STATE_OVERRIDES, type StateOverride } from "#shared/disk";
import type { DiskDetail } from "./types";

const props = defineProps<{ disk: DiskDetail }>();
const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const AUTOMATIC = "automatic";
type Choice = StateOverride | typeof AUTOMATIC;

const toast = useToast();
const saving = ref(false);

const items = computed(() => [
  { label: `Automatic (${props.disk.inferredState})`, value: AUTOMATIC },
  ...STATE_OVERRIDES.map((state) => ({ label: state, value: state })),
]);

const choice = computed<Choice>(() => props.disk.stateOverride ?? AUTOMATIC);

const isStateOverride = (value: string): value is StateOverride =>
  (STATE_OVERRIDES as readonly string[]).includes(value);

const setOverride = async (value: string) => {
  if (value === choice.value) return;
  saving.value = true;
  try {
    const updated = await $fetch<DiskDetail>(`/api/disks/${props.disk.id}`, {
      method: "PATCH",
      body: { stateOverride: isStateOverride(value) ? value : null },
    });
    emit("updated", updated);
  } catch {
    toast.add({ title: "Could not change the state", color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UBadge
      :color="diskStateColour(disk.state)"
      variant="subtle"
      :label="disk.state"
    />
    <span v-if="disk.stateOverride" class="text-dimmed text-xs">
      inferred {{ disk.inferredState }}
    </span>
    <USelect
      :model-value="choice"
      :items="items"
      :loading="saving"
      size="xs"
      color="neutral"
      variant="ghost"
      aria-label="State override"
      class="w-40"
      @update:model-value="setOverride"
    />
  </div>
</template>
