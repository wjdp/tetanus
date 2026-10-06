<script setup lang="ts">
import { type FaultView, faultTitle } from "#shared/faults";
import type { AcceptanceKind } from "#shared/smart/status";

const props = defineProps<{
  fault: FaultView;
  kind: AcceptanceKind;
  kinds: AcceptanceKind[];
  confirm: (kind: AcceptanceKind, note: string) => Promise<void>;
}>();

const open = defineModel<boolean>("open", { default: false });

const FAULT_KIND_VOCABULARY: Record<
  AcceptanceKind,
  {
    action: string;
    option: string;
    description: string;
    notePlaceholder: string;
  }
> = {
  acknowledge: {
    action: "Acknowledge",
    option: "Keep watching",
    description:
      "Still listed as a fault. Banner is dismissed while you investigate. Reopens automatically if it gets worse.",
    notePlaceholder: "What you are doing about it (optional)",
  },
  accept: {
    action: "Accept",
    option: "Accept as normal",
    description:
      "Treated as intended, fault moves to the accepted tab. Reopens automatically if it gets worse.",
    notePlaceholder: "Why this is fine (optional)",
  },
};

const kind = ref<AcceptanceKind>(props.kind);
const note = ref("");
const saving = ref(false);
const vocabulary = computed(() => FAULT_KIND_VOCABULARY[kind.value]);
const kindItems = computed(() =>
  props.kinds.map((value) => ({
    value,
    label: FAULT_KIND_VOCABULARY[value].option,
    description: FAULT_KIND_VOCABULARY[value].description,
  })),
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  kind.value = props.kind;
  note.value = "";
});

const submit = async () => {
  saving.value = true;
  try {
    await props.confirm(kind.value, note.value.trim());
    open.value = false;
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`${vocabulary.action} fault`"
    :description="faultTitle(fault)"
  >
    <template #body>
      <form
        id="fault-acknowledge-form"
        class="flex flex-col gap-4 text-sm"
        :aria-label="vocabulary.action"
        @submit.prevent="submit"
      >
        <URadioGroup
          v-if="kindItems.length > 1"
          v-model="kind"
          :items="kindItems"
          variant="table"
          size="sm"
          data-testid="fault-acknowledge-kind"
        />
        <p v-else class="text-muted">{{ vocabulary.description }}</p>
        <UFormField label="Note" name="note">
          <UTextarea
            v-model="note"
            :rows="3"
            autoresize
            :placeholder="vocabulary.notePlaceholder"
            class="w-full"
          />
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
          form="fault-acknowledge-form"
          color="primary"
          :label="vocabulary.action"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
