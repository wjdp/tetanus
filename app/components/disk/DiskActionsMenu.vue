<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import type { DiskDetail } from "./types";

const props = defineProps<{ disk: DiskDetail; label: string }>();
const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const toast = useToast();
const disposeOpen = ref(false);

const downloadDiagnostics = () => {
  const link = document.createElement("a");
  link.href = `/api/disks/${props.disk.id}/diagnostics`;
  link.download = "";
  link.click();
};

const undoDisposal = async () => {
  try {
    emit(
      "updated",
      await $fetch<DiskDetail>(`/api/disks/${props.disk.id}`, {
        method: "PATCH",
        body: { disposal: null },
      }),
    );
  } catch (error) {
    toast.add({
      title: `Could not undo the disposal of ${props.label}`,
      description: fetchErrorMessage(error),
      color: "error",
    });
  }
};

const items = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: "Download diagnostics",
      icon: "i-lucide-file-archive",
      description:
        "Includes serials, hostnames and mount paths. Check before posting publicly.",
      onSelect: downloadDiagnostics,
    },
  ],
  props.disk.disposal
    ? [
        {
          label: "Edit disposal…",
          icon: "i-lucide-pencil",
          onSelect: () => {
            disposeOpen.value = true;
          },
        },
        {
          label: "Undo disposal",
          icon: "i-lucide-undo-2",
          onSelect: undoDisposal,
        },
      ]
    : [
        {
          label: "Dispose…",
          icon: "i-lucide-package-x",
          onSelect: () => {
            disposeOpen.value = true;
          },
        },
      ],
]);
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'end' }"
    :ui="{ content: 'w-72' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-ellipsis"
      aria-label="Disk actions"
      data-testid="disk-actions"
    />
  </UDropdownMenu>
  <DiskDisposeModal
    v-model:open="disposeOpen"
    :disk="disk"
    :label="label"
    @updated="emit('updated', $event)"
  />
</template>
