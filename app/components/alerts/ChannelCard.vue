<script setup lang="ts">
import { ALERT_CHANNEL_LABELS, type AlertChannel } from "#shared/alerts";

const props = defineProps<{
  channel: AlertChannel;
  description: string;
  dirty: boolean;
  save: () => Promise<boolean>;
}>();
const enabled = defineModel<boolean>("enabled", { required: true });

type TestResult = { ok: true; error: null } | { ok: false; error: string };

const saving = ref(false);
const testing = ref(false);
const testResult = ref<TestResult | null>(null);

const label = computed(() => ALERT_CHANNEL_LABELS[props.channel]);

const runSave = async () => {
  saving.value = true;
  try {
    return await props.save();
  } finally {
    saving.value = false;
  }
};

const onSubmit = async () => {
  testResult.value = null;
  await runSave();
};

const sendTest = async () => {
  testResult.value = null;
  testing.value = true;
  try {
    if (props.dirty && !(await runSave())) return;
    testResult.value = await $fetch<TestResult>("/api/alerts/test", {
      method: "POST",
      body: { channel: props.channel },
    });
  } catch {
    testResult.value = { ok: false, error: "Could not reach the server" };
  } finally {
    testing.value = false;
  }
};

watch(enabled, () => {
  testResult.value = null;
});
</script>

<template>
  <UCard as="form" :data-testid="`channel-${channel}`" @submit.prevent="onSubmit">
    <template #header>
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-highlighted font-semibold">{{ label }}</h3>
          <p class="text-muted text-sm">{{ description }}</p>
        </div>
        <USwitch v-model="enabled" :aria-label="`Enable ${label}`" />
      </div>
    </template>

    <div v-if="enabled" class="flex flex-col gap-4">
      <slot />
    </div>
    <p v-else-if="dirty" class="text-muted text-sm">
      Save to stop sending alerts to {{ label }}.
    </p>
    <p v-else class="text-dimmed text-sm">Disabled.</p>

    <template v-if="enabled || dirty" #footer>
      <div class="flex flex-wrap items-center gap-3">
        <UButton
          type="submit"
          color="primary"
          label="Save"
          :disabled="!dirty || testing"
          :loading="saving && !testing"
        />
        <UButton
          v-if="enabled"
          color="neutral"
          variant="outline"
          icon="i-lucide-send"
          :label="dirty ? 'Save and send test' : 'Send test'"
          :disabled="saving"
          :loading="testing"
          @click="sendTest"
        />
        <span
          v-if="testResult"
          :class="testResult.ok ? 'text-success' : 'text-error'"
          class="text-sm"
          data-testid="test-result"
        >
          {{ testResult.ok ? "Test sent" : testResult.error }}
        </span>
        <span v-else-if="dirty" class="text-dimmed text-sm">
          Unsaved changes
        </span>
      </div>
    </template>
  </UCard>
</template>
