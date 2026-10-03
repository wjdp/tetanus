<script setup lang="ts">
import { DISPOSAL_KINDS, type Disposal, type DisposalKind } from "#shared/disk";
import { currencyStep, currencySymbol } from "#shared/money";
import { DISPOSAL_VOCABULARY } from "~/utils/vocabulary";
import { localToday } from "./disposal";
import type { DiskDetail } from "./types";

const props = defineProps<{
  disk: Pick<DiskDetail, "id" | "disposal">;
  label: string;
}>();

const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const open = defineModel<boolean>("open", { default: false });

const toast = useToast();
const currency = useCurrency();
const saving = ref(false);
const kind = ref<DisposalKind>("sold");
const on = ref(localToday());
const salePrice = ref("");

const kindItems = DISPOSAL_KINDS.map((value) => ({
  value,
  label: DISPOSAL_VOCABULARY[value].label,
  icon: DISPOSAL_VOCABULARY[value].icon,
}));

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    const current = props.disk.disposal;
    kind.value = current?.kind ?? "sold";
    on.value = current?.on ?? localToday();
    salePrice.value = current?.salePrice?.toString() ?? "";
  },
  { immediate: true },
);

const disposal = computed<Disposal>(() => {
  const raw = salePrice.value.trim();
  const price = Number(raw);
  return kind.value === "sold" && raw !== "" && price > 0
    ? { kind: kind.value, on: on.value, salePrice: price }
    : { kind: kind.value, on: on.value };
});

const submit = async () => {
  saving.value = true;
  try {
    const updated = await $fetch<DiskDetail>(`/api/disks/${props.disk.id}`, {
      method: "PATCH",
      body: { disposal: disposal.value },
    });
    open.value = false;
    emit("updated", updated);
  } catch (error) {
    toast.add({
      title: `Could not dispose of ${props.label}`,
      description: fetchErrorMessage(error),
      color: "error",
    });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <UModal
    v-model:open="open"
    :title="disk.disposal ? `Edit disposal of ${label}` : `Dispose of ${label}`"
    description="Hidden from lists and topology. The disk page, SMART history and diary stay."
  >
    <template #body>
      <form
        id="disk-dispose-form"
        class="flex flex-col gap-4 text-sm"
        aria-label="Dispose of disk"
        @submit.prevent="submit"
      >
        <UFormField label="How it left" name="kind">
          <USelect v-model="kind" :items="kindItems" class="w-full" />
        </UFormField>
        <UFormField label="Date" name="on">
          <UInput v-model="on" type="date" required class="w-full" />
        </UFormField>
        <UFormField
          v-if="kind === 'sold'"
          label="Sale price"
          name="salePrice"
          hint="Optional"
        >
          <UInput
            :model-value="salePrice"
            type="number"
            min="0"
            :step="currencyStep(currency)"
            class="w-full"
            :ui="{ leading: 'pointer-events-none' }"
            @update:model-value="(value) => (salePrice = String(value ?? ''))"
          >
            <template #leading>
              <span class="text-muted text-sm" data-testid="currency-symbol">{{
                currencySymbol(currency)
              }}</span>
            </template>
          </UInput>
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          type="submit"
          form="disk-dispose-form"
          color="primary"
          :icon="DISPOSAL_VOCABULARY[kind].icon"
          :label="disk.disposal ? 'Save' : 'Dispose'"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
