<script setup lang="ts">
import { SECRET_MASK } from "#shared/schemas/settings";
import {
  type ChannelForms,
  channelFormsFrom,
  notificationsPatch,
} from "~/components/alerts/channelForms";

const NOTIFICATIONS_LIMIT = 100;
const POLL_INTERVAL_MS = 60_000;

const { data: settings } = await useFetch("/api/settings");
const { data: notifications, refresh: refreshNotifications } = await useFetch(
  "/api/alerts",
  { query: { limit: NOTIFICATIONS_LIMIT }, default: () => [] },
);

const forms = ref<ChannelForms>(
  channelFormsFrom({ pushover: null, webhook: null }),
);

watch(
  () => settings.value?.config.notifications,
  (notificationsConfig) => {
    if (notificationsConfig) forms.value = channelFormsFrom(notificationsConfig);
  },
  { immediate: true },
);

let pollHandle: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  pollHandle = setInterval(refreshNotifications, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});

const selectMask = (event: FocusEvent) => {
  const input = event.target as HTMLInputElement;
  if (input.value === SECRET_MASK) input.select();
};

const toast = useToast();
const saving = ref(false);

const save = async () => {
  saving.value = true;
  try {
    settings.value = await $fetch("/api/settings", {
      method: "PATCH",
      body: { config: { notifications: notificationsPatch(forms.value) } },
    });
    toast.add({ title: "Alert settings saved", color: "success" });
  } catch (error) {
    toast.add({
      title: "Could not save alert settings",
      description: (error as { data?: { message?: string } }).data?.message,
      color: "error",
    });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <section class="flex flex-col gap-6">
    <h2 class="text-highlighted text-lg font-semibold">Alerts</h2>

    <form class="flex flex-col gap-4" @submit.prevent="save">
      <AlertsChannelCard
        v-model:enabled="forms.pushover.enabled"
        channel="pushover"
        description="Push notifications through the Pushover API."
      >
        <UFormField label="Application token" name="pushoverToken" required>
          <UInput
            v-model="forms.pushover.token"
            type="password"
            autocomplete="off"
            class="w-full font-mono"
            @focus="selectMask"
          />
        </UFormField>
        <UFormField label="User key" name="pushoverUser" required>
          <UInput
            v-model="forms.pushover.user"
            type="password"
            autocomplete="off"
            class="w-full font-mono"
            @focus="selectMask"
          />
        </UFormField>
      </AlertsChannelCard>

      <AlertsChannelCard
        v-model:enabled="forms.webhook.enabled"
        channel="webhook"
        description="A JSON POST to your own endpoint for each alert."
      >
        <UFormField label="URL" name="webhookUrl" required>
          <UInput
            v-model="forms.webhook.url"
            type="url"
            placeholder="https://"
            class="w-full font-mono"
          />
        </UFormField>
        <UFormField
          label="Secret"
          name="webhookSecret"
          description="Signs each request with an HMAC-SHA256 signature header. Leave blank for none."
        >
          <UInput
            v-model="forms.webhook.secret"
            type="password"
            autocomplete="off"
            class="w-full font-mono"
            @focus="selectMask"
          />
        </UFormField>
      </AlertsChannelCard>

      <UButton
        type="submit"
        color="primary"
        label="Save"
        :loading="saving"
        class="self-start"
      />
    </form>

    <section class="flex flex-col gap-3">
      <h3 class="text-highlighted font-semibold">Recent notifications</h3>
      <AlertsNotificationsTable :notifications="notifications" />
    </section>
  </section>
</template>
