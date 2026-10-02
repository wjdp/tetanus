<script setup lang="ts">
const { enabled, simulations, refresh, restore } = useSimulator();
const toast = useToast();
const restoring = ref(false);

if (enabled) {
  await refresh().catch(() => {});
  useSseClient().onMessage("faults", () => refresh().catch(() => {}));
}

const onRestore = async () => {
  restoring.value = true;
  try {
    await restore();
  } catch {
    toast.add({ title: "Could not restore", color: "error" });
  } finally {
    restoring.value = false;
  }
};

const count = computed(() => simulations.value.length);
</script>

<template>
  <div
    v-if="count"
    data-testid="simulation-banner"
    class="bg-elevated border-default border-s-warning text-muted flex items-center gap-3 border-b border-s-[3px] py-1.5 ps-4 pe-2 text-sm"
  >
    <UIcon name="i-lucide-flask-conical" class="text-warning size-4 shrink-0" />
    <span class="flex-1">
      {{ count }} simulated {{ count === 1 ? "fault" : "faults" }} active.
      Restore removes them and everything changed since.
    </span>
    <UButton
      size="xs"
      color="warning"
      variant="soft"
      icon="i-lucide-undo-2"
      label="Restore"
      :loading="restoring"
      @click="onRestore"
    />
  </div>
</template>
