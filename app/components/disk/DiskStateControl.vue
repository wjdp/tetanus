<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import { STATE_OVERRIDES, type StateOverride } from "#shared/disk";
import { usageDetail } from "#shared/usage";
import type { DiskDetail } from "./types";

const props = defineProps<{ disk: DiskDetail }>();
const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const toast = useToast();
const saving = ref(false);

const isDisposed = computed(() => !!props.disk.disposal);

const SYSTEM_MOUNT_PATHS = ["/", "/boot"];

const usageLabel = computed(() =>
  usageDetail(
    props.disk.usage,
    props.disk.membership?.poolName ?? null,
    props.disk.poolsKnown,
  ),
);

const inferredFromPath = computed(() => {
  const paths = props.disk.usage.mounts.map((mount) => mount.path);
  return SYSTEM_MOUNT_PATHS.find((path) => paths.includes(path)) ?? "/";
});

const setOverride = async (stateOverride: StateOverride | null) => {
  if (stateOverride === props.disk.stateOverride) return;
  saving.value = true;
  try {
    const updated = await $fetch<DiskDetail>(`/api/disks/${props.disk.id}`, {
      method: "PATCH",
      body: { stateOverride },
    });
    emit("updated", updated);
  } catch {
    toast.add({ title: "Could not change the state", color: "error" });
  } finally {
    saving.value = false;
  }
};

const items = computed<DropdownMenuItem[]>(() => [
  {
    label: `Automatic (${props.disk.inferredState})`,
    type: "checkbox",
    checked: props.disk.stateOverride === null,
    onSelect: () => setOverride(null),
  },
  ...STATE_OVERRIDES.map((state) => ({
    label: state,
    type: "checkbox" as const,
    checked: props.disk.stateOverride === state,
    onSelect: () => setOverride(state),
  })),
]);
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-2">
    <UDropdownMenu :items="items" :disabled="isDisposed">
        <button
          type="button"
          class="inline-flex items-center gap-0.5 rounded-md disabled:cursor-not-allowed"
          :disabled="isDisposed"
          :title="isDisposed ? 'Undo the disposal to change the state' : undefined"
          aria-label="State override"
          data-testid="lifecycle-menu"
        >
          <LifecycleBadge
            :state="disk.state"
            :overridden="!!disk.stateOverride"
            :as-of="disk.stateAsOf"
          />
          <UIcon
            :name="saving ? 'i-lucide-loader-circle' : 'i-lucide-chevron-down'"
            class="text-dimmed size-4"
            :class="{ 'animate-spin': saving }"
          />
        </button>
    </UDropdownMenu>
    <span v-if="disk.stateOverride" class="text-dimmed text-xs">
      inferred {{ disk.inferredState }}
    </span>
    <span
      v-if="!disk.membership"
      class="text-sm"
      :class="{ 'text-dimmed': disk.usage.kind === 'empty' }"
      data-testid="disk-usage"
    >
      {{ usageLabel }}
    </span>
    <UTooltip
      v-if="disk.purpose && disk.purposeInferred"
      :text="`inferred from mount at ${inferredFromPath}`"
    >
      <UBadge color="neutral" variant="outline" :label="disk.purpose" />
    </UTooltip>
    <UBadge
      v-else-if="disk.purpose"
      color="neutral"
      variant="subtle"
      :label="disk.purpose"
    />
  </span>
</template>
