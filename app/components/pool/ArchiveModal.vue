<script setup lang="ts">
const props = defineProps<{ poolId: number; poolName: string }>();

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
    await $fetch(`/api/pools/${props.poolId}/archive`, {
      method: "POST",
      body: { note: note.value.trim() },
    });
    open.value = false;
    emit("archived");
  } catch {
    toast.add({ title: `Could not archive ${props.poolName}`, color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Archive ${poolName}`"
    description="Hidden from lists, topology and search; its faults resolve and stop being raised. The pool page and its history stay."
  >
    <template #body>
      <form
        id="pool-archive-form"
        class="flex flex-col gap-4 text-sm"
        aria-label="Archive pool"
        @submit.prevent="submit"
      >
        <UFormField label="Note" name="note">
          <UTextarea
            v-model="note"
            :rows="3"
            autoresize
            placeholder="Why you no longer care about it (optional)"
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
          form="pool-archive-form"
          color="primary"
          icon="i-lucide-archive"
          label="Archive"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
