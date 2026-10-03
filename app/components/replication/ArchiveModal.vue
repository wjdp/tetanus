<script setup lang="ts">
import { patchReplication } from "./patch";

const props = defineProps<{ replicationId: number; label: string }>();

const emit = defineEmits<{ archived: [] }>();

const open = defineModel<boolean>("open", { default: false });

const toast = useToast();
const note = ref("");
const saving = ref(false);

watch(open, (isOpen) => {
  if (isOpen) note.value = "";
});

const submit = async () => {
  saving.value = true;
  try {
    await patchReplication(props.replicationId, {
      archived: true,
      archivedNote: note.value.trim(),
    });
    open.value = false;
    emit("archived");
  } catch {
    toast.add({ title: `Could not archive ${props.label}`, color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <UModal
    v-model:open="open"
    title="No longer replicated"
    :description="`${label} stops being checked: its faults resolve and no new ones open. Its syncs and diary stay. A new sync brings it back.`"
  >
    <template #body>
      <form
        id="replication-archive-form"
        class="flex flex-col gap-4 text-sm"
        aria-label="Archive replication"
        @submit.prevent="submit"
      >
        <UFormField label="Note" name="note">
          <UTextarea
            v-model="note"
            :rows="3"
            autoresize
            placeholder="Why it stopped (optional)"
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
          form="replication-archive-form"
          color="primary"
          icon="i-lucide-archive"
          label="Archive"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
