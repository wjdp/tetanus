<script setup lang="ts">
import {
  INVENTORY_FIELDS,
  type InventoryKey,
  isFieldVisible,
} from "#shared/inventory-fields";
import {
  draftFromInventory,
  type InventoryDraft,
  inventoryFromDraft,
} from "./inventoryDraft";
import type { DiskDetail } from "./types";

const props = defineProps<{ disk: DiskDetail }>();
const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const UNSET = "unset";

const toast = useToast();
const saving = ref(false);
const alias = ref("");
const notes = ref("");
const draft = ref<InventoryDraft>(draftFromInventory({}));

const reset = (disk: DiskDetail) => {
  alias.value = disk.alias ?? "";
  notes.value = disk.notes;
  draft.value = draftFromInventory(disk.inventory);
};

watch(() => props.disk, reset, { immediate: true });

const fields = computed(() =>
  INVENTORY_FIELDS.filter((field) => isFieldVisible(field, props.disk)),
);

const unsetLabel = (key: InventoryKey) =>
  key === "purpose" && props.disk.purposeInferred && props.disk.purpose
    ? `— (inferred: ${props.disk.purpose})`
    : "—";

const enumItems = (key: InventoryKey, values: readonly string[]) => [
  { label: unsetLabel(key), value: UNSET },
  ...values.map((value) => ({ label: value, value })),
];

const dateHint = computed<Partial<Record<string, string>>>(() => ({
  purchaseDate:
    props.disk.ageDays === null ? undefined : `${formatDays(props.disk.ageDays)} old`,
  warrantyExpiry:
    props.disk.warrantyDaysLeft === null
      ? undefined
      : props.disk.warrantyDaysLeft < 0
        ? `expired ${formatDays(-props.disk.warrantyDaysLeft)} ago`
        : `${formatDays(props.disk.warrantyDaysLeft)} left`,
}));

interface FetchFailure {
  statusCode?: number;
  data?: { message?: string };
}

const asFetchFailure = (error: unknown): FetchFailure =>
  typeof error === "object" && error !== null ? error : {};

const setField = (key: InventoryKey, value: InventoryDraft[InventoryKey]) => {
  draft.value[key] = value;
};

const textValue = (key: InventoryKey) => {
  const value = draft.value[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
};

const save = async () => {
  saving.value = true;
  try {
    const updated = await $fetch<DiskDetail>(`/api/disks/${props.disk.id}`, {
      method: "PATCH",
      body: {
        alias: alias.value,
        notes: notes.value,
        inventory: inventoryFromDraft(draft.value),
      },
    });
    emit("updated", updated);
    toast.add({ title: "Disk saved", color: "success" });
  } catch (error) {
    const { statusCode, data } = asFetchFailure(error);
    toast.add({
      title:
        statusCode === 409 ? "Alias already in use" : "Could not save the disk",
      description: data?.message,
      color: "error",
    });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="save">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UFormField label="Alias" name="alias">
        <UInput v-model="alias" class="w-full font-mono" placeholder="unnamed" />
      </UFormField>

      <UFormField
        v-for="field in fields"
        :key="field.key"
        :label="field.label"
        :name="field.key"
        :hint="dateHint[field.key]"
      >
        <UInput
          v-if="field.type === 'date'"
          :model-value="textValue(field.key)"
          type="date"
          class="w-full"
          @update:model-value="(value) => setField(field.key, String(value))"
        />
        <UInput
          v-else-if="field.type === 'money'"
          :model-value="textValue(field.key)"
          type="number"
          min="0"
          step="0.01"
          class="w-full"
          :ui="{ leading: 'pointer-events-none' }"
          @update:model-value="(value) => setField(field.key, String(value))"
        >
          <template #leading>
            <span class="text-muted text-sm">£</span>
          </template>
        </UInput>
        <USelect
          v-else-if="field.type === 'enum'"
          :model-value="textValue(field.key) || UNSET"
          :items="enumItems(field.key, field.values)"
          class="w-full"
          @update:model-value="
            (value) => setField(field.key, value === UNSET ? null : String(value))
          "
        />
        <USwitch
          v-else-if="field.type === 'boolean'"
          :model-value="draft[field.key] === true"
          :label="draft[field.key] === null ? 'Not recorded' : undefined"
          @update:model-value="(value) => setField(field.key, value)"
        />
        <UInput
          v-else
          :model-value="textValue(field.key)"
          class="w-full"
          @update:model-value="(value) => setField(field.key, String(value))"
        />
      </UFormField>
    </div>

    <UFormField label="Notes" name="notes">
      <UTextarea v-model="notes" class="w-full" :rows="4" autoresize />
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
