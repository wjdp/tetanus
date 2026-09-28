import type {
  NotificationsConfig,
  PushoverConfig,
  WebhookConfig,
} from "#shared/schemas/settings";

export interface PushoverForm {
  enabled: boolean;
  token: string;
  user: string;
}

export interface WebhookForm {
  enabled: boolean;
  url: string;
  secret: string;
}

export interface ChannelForms {
  pushover: PushoverForm;
  webhook: WebhookForm;
}

export const channelFormsFrom = ({
  pushover,
  webhook,
}: NotificationsConfig): ChannelForms => ({
  pushover: {
    enabled: pushover !== null,
    token: pushover?.token ?? "",
    user: pushover?.user ?? "",
  },
  webhook: {
    enabled: webhook !== null,
    url: webhook?.url ?? "",
    secret: webhook?.secret ?? "",
  },
});

const pushoverPatch = ({
  enabled,
  token,
  user,
}: PushoverForm): PushoverConfig | null =>
  enabled ? { token: token.trim(), user: user.trim() } : null;

const webhookPatch = ({
  enabled,
  url,
  secret,
}: WebhookForm): WebhookConfig | null =>
  enabled ? { url: url.trim(), secret: secret.trim() } : null;

export const notificationsPatch = (
  forms: ChannelForms,
): NotificationsConfig => ({
  pushover: pushoverPatch(forms.pushover),
  webhook: webhookPatch(forms.webhook),
});
