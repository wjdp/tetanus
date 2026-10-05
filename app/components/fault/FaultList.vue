<script setup lang="ts">
import { upgradeCommand } from "#shared/collector";
import type { FaultAction, FaultView } from "#shared/faults";

const props = defineProps<{
  faults: FaultView[];
  now: number;
  perform: (id: number, action: FaultAction, note?: string) => Promise<void>;
  hideSubject?: boolean;
}>();

const emit = defineEmits<{ changed: [] }>();

const command = upgradeCommand(useRequestURL().origin);
const toast = useToast();

const ACTION_DONE: Record<FaultAction, string> = {
  acknowledge: "Acknowledged",
  accept: "Accepted",
  clear: "Cleared",
  resolve: "Resolved",
};
const ACTION_FAILED: Record<FaultAction, string> = {
  acknowledge: "Could not acknowledge the fault",
  accept: "Could not accept the fault",
  clear: "Could not clear the fault",
  resolve: "Could not resolve the fault",
};

const performFor =
  (fault: FaultView) => async (action: FaultAction, note?: string) => {
    try {
      await props.perform(fault.id, action, note);
      toast.add({ title: ACTION_DONE[action], color: "neutral" });
    } catch {
      toast.add({ title: ACTION_FAILED[action], color: "error" });
    }
  };
</script>

<template>
  <div
    class="border-default divide-default divide-y overflow-hidden rounded-md border"
    data-testid="fault-list"
  >
    <FaultRow
      v-for="fault in faults"
      :key="fault.id"
      :fault="fault"
      :now="now"
      :upgrade-command="command"
      :perform="performFor(fault)"
      :hide-subject="hideSubject"
      @changed="emit('changed')"
    />
  </div>
</template>
