import { createHmac } from "node:crypto";
import type {
  AlertChannel,
  NotificationRule,
  NotificationSeverity,
} from "#shared/alerts";
import type { DiarySubjectType } from "#shared/diary";
import type {
  NotificationsConfig,
  PushoverConfig,
  WebhookConfig,
} from "#shared/schemas/settings";

export const PUSHOVER_URL = "https://api.pushover.net/1/messages.json";
export const SIGNATURE_HEADER = "X-Tetanus-Signature";
const SEND_TIMEOUT_MS = 10_000;
const ERROR_BODY_LIMIT = 500;

export type Fetch = typeof globalThis.fetch;

export interface OutgoingNotification {
  rule: NotificationRule;
  severity: NotificationSeverity;
  subject: string;
  subjectType: DiarySubjectType | null;
  subjectId: number | null;
  host: string | null;
  title: string;
  message: string;
  at: Date;
  dedupeKey: string;
}

export type SendResult =
  | { ok: true; error: null }
  | { ok: false; error: string };

async function describeFailure(response: Response) {
  const body = (await response.text().catch(() => "")).slice(
    0,
    ERROR_BODY_LIMIT,
  );
  return `HTTP ${response.status}${body ? `: ${body}` : ""}`;
}

async function post(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
): Promise<SendResult> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      method: "POST",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok)
      return { ok: false, error: await describeFailure(response) };
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function pushoverPriority(severity: NotificationSeverity) {
  return severity === "alert" ? 1 : 0;
}

export function sendPushover(
  config: PushoverConfig,
  notification: OutgoingNotification,
  fetchImpl: Fetch = fetch,
) {
  return post(fetchImpl, PUSHOVER_URL, {
    body: new URLSearchParams({
      token: config.token,
      user: config.user,
      title: notification.title,
      message: notification.message,
      priority: String(pushoverPriority(notification.severity)),
      timestamp: String(Math.floor(notification.at.getTime() / 1000)),
    }),
  });
}

export function signWebhookBody(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function webhookBody(notification: OutgoingNotification) {
  return JSON.stringify({
    rule: notification.rule,
    severity: notification.severity,
    subject: notification.subject,
    subjectType: notification.subjectType,
    subjectId: notification.subjectId,
    host: notification.host,
    title: notification.title,
    message: notification.message,
    at: notification.at.toISOString(),
    dedupeKey: notification.dedupeKey,
  });
}

export function sendWebhook(
  config: WebhookConfig,
  notification: OutgoingNotification,
  fetchImpl: Fetch = fetch,
) {
  const body = webhookBody(notification);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.secret) {
    headers[SIGNATURE_HEADER] = signWebhookBody(config.secret, body);
  }
  return post(fetchImpl, config.url, { headers, body });
}

export function configuredChannels(
  notifications: NotificationsConfig,
): AlertChannel[] {
  const channels: AlertChannel[] = [];
  if (notifications.pushover) channels.push("pushover");
  if (notifications.webhook) channels.push("webhook");
  return channels;
}

export function sendToChannel(
  channel: AlertChannel,
  notifications: NotificationsConfig,
  notification: OutgoingNotification,
  fetchImpl: Fetch = fetch,
): Promise<SendResult> {
  const { pushover, webhook } = notifications;
  if (channel === "pushover" && pushover) {
    return sendPushover(pushover, notification, fetchImpl);
  }
  if (channel === "webhook" && webhook) {
    return sendWebhook(webhook, notification, fetchImpl);
  }
  return Promise.resolve({
    ok: false,
    error: `${channel} is not configured`,
  });
}
