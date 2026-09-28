<script setup lang="ts">
import { ALERT_CHANNEL_LABELS, type AlertChannel } from "#shared/alerts";

const props = defineProps<{ channel: AlertChannel; description: string }>();
const enabled = defineModel<boolean>("enabled", { required: true });

type TestResult = { ok: true; error: null } | { ok: false; error: string };

const testing = ref(false);
const testResult = ref<TestResult | null>(null);

const sendTest = async () => {
  testing.value = true;
  testResult.value = null;
  try {
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
</script>

<template>
  <UCard :data-testid="`channel-${channel}`">
    <template #header>
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-highlighted font-semibold">
            {{ ALERT_CHANNEL_LABELS[channel] }}
          </h3>
          <p class="text-muted text-sm">{{ description }}</p>
        </div>
        <USwitch
          v-model="enabled"
          :aria-label="`Enable ${ALERT_CHANNEL_LABELS[channel]}`"
        />
      </div>
    </template>

    <div v-if="enabled" class="flex flex-col gap-4">
      <slot />
    </div>
    <p v-else class="text-dimmed text-sm">Disabled.</p>

    <template #footer>
      <div class="flex flex-wrap items-center gap-3">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-send"
          label="Send test"
          :loading="testing"
          @click="sendTest"
        />
        <span
          v-if="testResult"
          :class="testResult.ok ? 'text-muted' : 'text-error'"
          class="text-sm"
          data-testid="test-result"
        >
          {{ testResult.ok ? "Sent" : testResult.error }}
        </span>
        <span v-else class="text-dimmed text-sm">Tests use the saved settings.</span>
      </div>
    </template>
  </UCard>
</template>
