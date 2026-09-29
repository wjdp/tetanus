<script setup lang="ts">
import type { AlertChannel } from "#shared/alerts";
import { APP_NAME } from "#shared/app";
import type { NotificationsConfig } from "#shared/schemas/settings";
import {
  type ChannelForms,
  channelFormsFrom,
  channelPatch,
  isChannelDirty,
} from "~/components/alerts/channelForms";

const demo = useRuntimeConfig().public.demo;

const NOTIFICATIONS_LIMIT = 100;
const POLL_INTERVAL_MS = 60_000;
const UNCONFIGURED: NotificationsConfig = { pushover: null, webhook: null };

const { data: settings } = await useFetch("/api/settings");
const { data: notifications, refresh: refreshNotifications } = await useFetch(
  "/api/alerts",
  { query: { limit: NOTIFICATIONS_LIMIT }, default: () => [] },
);

const storedForms = () =>
  channelFormsFrom(settings.value?.config.notifications ?? UNCONFIGURED);

const saved = ref<ChannelForms>(storedForms());
const forms = ref<ChannelForms>(storedForms());

const dirty = (channel: AlertChannel) =>
  isChannelDirty(forms.value, saved.value, channel);

let pollHandle: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  pollHandle = setInterval(refreshNotifications, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});

const toast = useToast();

const saveChannel = async (channel: AlertChannel) => {
  try {
    settings.value = await $fetch("/api/settings", {
      method: "PATCH",
      body: { config: { notifications: channelPatch(forms.value, channel) } },
    });
    saved.value = { ...saved.value, [channel]: storedForms()[channel] };
    forms.value = { ...forms.value, [channel]: storedForms()[channel] };
    return true;
  } catch (error) {
    toast.add({
      title: "Could not save alert settings",
      description: (error as { data?: { message?: string } }).data?.message,
      color: "error",
    });
    return false;
  }
};
</script>

<template>
  <section class="flex flex-col gap-6">
    <h2 class="text-highlighted text-lg font-semibold">Alerts</h2>

    <UAlert
      v-if="demo"
      color="neutral"
      variant="subtle"
      icon="i-lucide-bell-off"
      title="Notification channels are disabled in the demo."
      data-testid="demo-disabled-note"
    />
    <div v-else class="flex flex-col gap-4">
      <AlertsChannelCard
        v-model:enabled="forms.pushover.enabled"
        channel="pushover"
        description="Push notifications through the Pushover API."
        :dirty="dirty('pushover')"
        :save="() => saveChannel('pushover')"
      >
        <div class="flex items-center gap-3">
          <img
            src="/pushover-icon.png"
            alt=""
            width="48"
            height="48"
            class="size-12 shrink-0"
          />
          <p class="text-muted text-sm">
            <ULink
              to="https://pushover.net/apps/build"
              external
              target="_blank"
              class="text-primary"
            >
              Create a Pushover application</ULink
            >
            and upload this icon for it.
            <ULink
              to="/pushover-icon.png"
              :download="`${APP_NAME}-pushover.png`"
              external
              class="text-primary"
            >
              Download icon
            </ULink>
          </p>
        </div>
        <UFormField
          label="API token"
          name="pushoverToken"
          description="Shown on the application's page once created."
          required
        >
          <UInput
            v-model="forms.pushover.token"
            autocomplete="off"
            spellcheck="false"
            class="w-full font-mono"
          />
        </UFormField>
        <UFormField label="User key" name="pushoverUser" required>
          <template #description>
            Shown on your
            <ULink
              to="https://pushover.net/"
              external
              target="_blank"
              class="text-primary"
            >
              Pushover dashboard</ULink
            >.
          </template>
          <UInput
            v-model="forms.pushover.user"
            autocomplete="off"
            spellcheck="false"
            class="w-full font-mono"
          />
        </UFormField>
      </AlertsChannelCard>

      <AlertsChannelCard
        v-model:enabled="forms.webhook.enabled"
        channel="webhook"
        description="A JSON POST to your own endpoint for each alert."
        :dirty="dirty('webhook')"
        :save="() => saveChannel('webhook')"
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
            autocomplete="off"
            spellcheck="false"
            class="w-full font-mono"
          />
        </UFormField>
      </AlertsChannelCard>
    </div>

    <section class="flex flex-col gap-3">
      <h3 class="text-highlighted font-semibold">Recent notifications</h3>
      <AlertsNotificationsTable :notifications="notifications" />
    </section>
  </section>
</template>
