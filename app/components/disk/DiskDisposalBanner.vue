<script setup lang="ts">
import type { Disposal } from "#shared/disk";
import { formatMoney } from "#shared/money";
import { DISPOSAL_VOCABULARY, disposalLabel } from "~/utils/vocabulary";
import type { DiskDetail } from "./types";

const props = withDefaults(
  defineProps<{
    disk: DiskDetail & { disposal: Disposal };
    label: string;
    replacedByLabel?: string | null;
  }>(),
  { replacedByLabel: null },
);

const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const toast = useToast();
const currency = useCurrency();
const editOpen = ref(false);
const saving = ref<"undo" | "confirm" | null>(null);

const vocabulary = computed(() => DISPOSAL_VOCABULARY[props.disk.disposal.kind]);

const replacedByDiskId = computed(() => props.disk.replacedByDiskId);

const headline = computed(() =>
  replacedByDiskId.value === null
    ? disposalLabel(props.disk.disposal, { replacedByDiskId: null })
    : `${vocabulary.value.label} · replaced by `,
);

const price = computed(() => {
  const { salePrice } = props.disk.disposal;
  return salePrice === undefined ? null : formatMoney(salePrice, currency.value);
});

const seen = computed(() => props.disk.seenSinceDisposal);

const patch = async (
  action: "undo" | "confirm",
  disposal: Disposal | null,
  failure: string,
) => {
  saving.value = action;
  try {
    const updated = await $fetch<DiskDetail>(`/api/disks/${props.disk.id}`, {
      method: "PATCH",
      body: { disposal },
    });
    emit("updated", updated);
  } catch (error) {
    toast.add({
      title: failure,
      description: fetchErrorMessage(error),
      color: "error",
    });
  } finally {
    saving.value = null;
  }
};

const undo = () => patch("undo", null, `Could not undo the disposal of ${props.label}`);

const reconfirm = () =>
  patch(
    "confirm",
    { ...props.disk.disposal },
    `Could not re-confirm the disposal of ${props.label}`,
  );
</script>

<template>
  <div
    data-testid="disk-disposal-banner"
    :data-colour="seen ? 'warning' : 'neutral'"
    class="bg-elevated border-default flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-s-[3px] py-1.5 ps-4 pe-2 text-sm"
    :class="seen ? 'border-s-warning' : 'border-s-accented text-muted'"
  >
    <UIcon :name="vocabulary.icon" class="size-4 shrink-0" />
    <div class="flex min-w-0 flex-1 flex-col">
      <span>
        <span class="text-highlighted font-medium">{{ headline }}<NuxtLink
          v-if="replacedByDiskId !== null"
          :to="`/disks/${replacedByDiskId}`"
          class="hover:text-primary underline"
          data-testid="disposal-replaced-by"
        >{{ replacedByLabel ?? `disk ${replacedByDiskId}` }}</NuxtLink></span>
        · {{ disk.disposal.on }}<template v-if="price"> · {{ price }}</template>
      </span>
      <span v-if="seen" class="text-warning" data-testid="disposal-seen">
        Seen again {{ formatDate(seen.at) }}: {{ seen.title }}
      </span>
    </div>
    <div class="flex items-center gap-1">
      <UButton
        v-if="seen"
        size="xs"
        color="warning"
        variant="soft"
        icon="i-lucide-check"
        label="Re-confirm"
        :loading="saving === 'confirm'"
        data-testid="disposal-reconfirm"
        @click="reconfirm"
      />
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-pencil"
        label="Edit…"
        data-testid="disposal-edit"
        @click="editOpen = true"
      />
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-lucide-undo-2"
        label="Undo disposal"
        :loading="saving === 'undo'"
        data-testid="disposal-undo"
        @click="undo"
      />
    </div>
    <DiskDisposeModal
      v-model:open="editOpen"
      :disk="disk"
      :label="label"
      @updated="emit('updated', $event)"
    />
  </div>
</template>
