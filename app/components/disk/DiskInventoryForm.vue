<script setup lang="ts">
import type { Disposal } from "#shared/disk";
import {
  INVENTORY_FIELDS,
  type Inventory,
  type InventoryKey,
  isFieldVisible,
} from "#shared/inventory-fields";
import { currencyStep, currencySymbol } from "#shared/money";
import { diskLabel } from "./displayName";
import {
  draftFromInventory,
  type InventoryDraft,
  inventoryFromDraft,
  warrantySuggestion,
} from "./inventoryDraft";
import type { DiskDetail } from "./types";

export interface ReplacementCandidate {
  id: number;
  alias: string | null;
  serial: string | null;
  hostName: string | null;
  purpose: DiskDetail["purpose"];
  disposal: Disposal | null;
  replacedByDiskId: number | null;
  inventory: Partial<Inventory>;
}

const props = withDefaults(
  defineProps<{ disk: DiskDetail; disks?: ReplacementCandidate[] }>(),
  { disks: () => [] },
);
const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const UNSET = "unset";

const toast = useToast();
const currency = useCurrency();
const saving = ref(false);
const alias = ref("");
const notes = ref("");
const draft = ref<InventoryDraft>(draftFromInventory({}));
const replacesDiskId = ref<number | null>(null);

const reset = (disk: DiskDetail) => {
  alias.value = disk.alias ?? "";
  notes.value = disk.notes;
  draft.value = draftFromInventory(disk.inventory);
  replacesDiskId.value = disk.replacesDiskId;
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

const replacementCandidates = computed(() =>
  props.disks.filter(
    (candidate) =>
      candidate.id !== props.disk.id &&
      (candidate.id === props.disk.replacesDiskId ||
        (candidate.disposal?.kind === "rma" &&
          (candidate.replacedByDiskId === null ||
            candidate.replacedByDiskId === props.disk.id))),
  ),
);

const replacesItems = computed(() => [
  { label: "—", value: UNSET },
  ...replacementCandidates.value.map((candidate) => ({
    label: diskLabel(candidate),
    value: String(candidate.id),
  })),
]);

const setReplaces = (value: unknown) => {
  replacesDiskId.value = value === UNSET ? null : Number(value);
};

const replaced = computed(() =>
  replacementCandidates.value.find(
    (candidate) => candidate.id === replacesDiskId.value,
  ),
);

const copyableWarranty = computed(() => {
  const expiry = replaced.value?.inventory.warrantyExpiry;
  return expiry && !draft.value.warrantyExpiry ? expiry : null;
});

const suggestedWarranty = computed(() =>
  warrantySuggestion(draft.value, props.disk.specs?.line),
);

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
        replacesDiskId: replacesDiskId.value,
      },
    });
    emit("updated", updated);
    toast.add({ title: "Disk saved", color: "success" });
  } catch (error) {
    toast.add({
      title: "Could not save the disk",
      description: fetchErrorMessage(error),
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
        v-if="replacementCandidates.length > 0"
        label="Replaces"
        name="replacesDiskId"
        hint="An RMA'd disk"
      >
        <template v-if="copyableWarranty && replaced" #hint>
          <span data-testid="warranty-copy">
            <UButton
              size="xs"
              color="neutral"
              variant="link"
              :label="`Copy warranty from ${diskLabel(replaced)}`"
              :title="`Warranty until ${copyableWarranty}`"
              @click="setField('warrantyExpiry', copyableWarranty)"
            />
          </span>
        </template>
        <USelect
          :model-value="replacesDiskId === null ? UNSET : String(replacesDiskId)"
          :items="replacesItems"
          class="w-full"
          aria-label="Replaces"
          @update:model-value="setReplaces"
        />
      </UFormField>

      <UFormField
        v-for="field in fields"
        :key="field.key"
        :label="field.label"
        :name="field.key"
        :hint="dateHint[field.key]"
      >
        <template
          v-if="field.key === 'warrantyExpiry' && suggestedWarranty"
          #hint
        >
          <span data-testid="warranty-suggestion">
            {{ suggestedWarranty.text }}
            <UButton
              size="xs"
              color="neutral"
              variant="link"
              label="Apply"
              @click="setField('warrantyExpiry', suggestedWarranty.date)"
            />
          </span>
        </template>
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
          :step="currencyStep(currency)"
          class="w-full"
          :ui="{ leading: 'pointer-events-none' }"
          @update:model-value="(value) => setField(field.key, String(value))"
        >
          <template #leading>
            <span class="text-muted text-sm" data-testid="currency-symbol">{{
              currencySymbol(currency)
            }}</span>
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
