<script setup lang="ts">
import { type FaultView, faultTitle } from "#shared/faults";

const props = defineProps<{
  fault: FaultView;
  confirm: (note: string) => Promise<void>;
}>();

const open = defineModel<boolean>("open", { default: false });

const note = ref("");
const saving = ref(false);

watch(open, (isOpen) => {
  if (isOpen) note.value = "";
});

const submit = async () => {
  saving.value = true;
  try {
    await props.confirm(note.value.trim());
    open.value = false;
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <UModal
    v-model:open="open"
    title="Resolve fault"
    :description="faultTitle(fault)"
  >
    <template #body>
      <form
        id="fault-resolve-form"
        class="flex flex-col gap-4 text-sm"
        aria-label="Resolve"
        @submit.prevent="submit"
      >
        <p class="text-muted">
          Closes the fault and moves it to the Resolved tab. This can't be
          undone. It won't clear by itself, so resolve it once you've dealt
          with the cause or confirmed it is harmless. If it happens again, a
          new fault opens.
        </p>
        <UFormField label="Note" name="note">
          <UTextarea
            v-model="note"
            :rows="3"
            autoresize
            placeholder="What you did about it (optional)"
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
          form="fault-resolve-form"
          color="primary"
          label="Resolve"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
