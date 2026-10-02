<script setup lang="ts">
import { allowedActions, type FaultAction, type FaultView } from "#shared/faults";
import type { AcceptanceKind } from "#shared/smart/status";
import { ACCEPTANCE_KIND_VOCABULARY } from "~/components/disk/attributeRows";
import type { LatestAttribute, SmartOverview } from "~/components/disk/types";

const props = defineProps<{
  fault: FaultView;
  perform: (action: FaultAction, note?: string) => Promise<void>;
}>();

const emit = defineEmits<{ changed: [] }>();

const toast = useToast();

const kinds = computed(() =>
  allowedActions(props.fault).filter(
    (action): action is AcceptanceKind => action !== "clear",
  ),
);
const primary = computed(() => kinds.value[0]);
const canClear = computed(() =>
  allowedActions(props.fault).includes("clear"),
);
const isSmartAttribute = computed(
  () => props.fault.kind === "smart-attribute",
);

const dialogOpen = ref(false);
const smartAttribute = ref<LatestAttribute | null>(null);

const loadSmartAttribute = async () => {
  const attrId = String(props.fault.data.attrId);
  const smart = await $fetch<SmartOverview>(
    `/api/disks/${props.fault.subject.id}/smart`,
    { query: { range: "7d" } },
  );
  const attribute = smart.attributes.find((row) => row.attrId === attrId);
  if (!attribute) throw new Error(`No attribute ${attrId}`);
  smartAttribute.value = attribute;
};

const openDialog = async () => {
  if (!primary.value) return;
  if (isSmartAttribute.value) {
    try {
      await loadSmartAttribute();
    } catch {
      toast.add({
        title: `Could not load the attribute to ${ACCEPTANCE_KIND_VOCABULARY[primary.value].action.toLowerCase()}`,
        color: "error",
      });
      return;
    }
  }
  dialogOpen.value = true;
};
</script>

<template>
  <div
    v-if="primary || canClear"
    class="relative z-10 flex shrink-0 justify-end gap-1"
  >
    <UButton
      v-if="primary"
      color="neutral"
      variant="soft"
      size="xs"
      :label="ACCEPTANCE_KIND_VOCABULARY[primary].action"
      @click="openDialog"
    />
    <UButton
      v-if="canClear"
      color="neutral"
      variant="ghost"
      size="xs"
      label="Clear"
      @click="perform('clear')"
    />
    <template v-if="primary">
      <DiskAcceptFaultModal
        v-if="isSmartAttribute"
        :key="primary"
        v-model:open="dialogOpen"
        :disk-id="fault.subject.id"
        :attribute="smartAttribute"
        :kind="primary"
        @accepted="emit('changed')"
      />
      <FaultAcknowledgeModal
        v-else
        v-model:open="dialogOpen"
        :fault="fault"
        :kind="primary"
        :kinds="kinds"
        :confirm="(kind, note) => perform(kind, note)"
      />
    </template>
  </div>
</template>
