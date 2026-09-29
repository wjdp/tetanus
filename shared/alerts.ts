export const ALERT_SEVERITIES = ["alert", "recovery"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_RULES = {
  "attribute-failed": { label: "Attribute failed", severity: "alert" },
  "acceptance-superseded": {
    label: "Accepted fault worsened",
    severity: "alert",
  },
  "disk-failed": { label: "Disk failed", severity: "alert" },
  "disk-recovered": { label: "Disk recovered", severity: "recovery" },
  "disk-missing": { label: "Disk missing", severity: "alert" },
  "disk-reappeared": { label: "Disk reappeared", severity: "recovery" },
  "pool-degraded": { label: "Pool degraded", severity: "alert" },
  "pool-recovered": { label: "Pool recovered", severity: "recovery" },
  "scan-errors": { label: "Scan found errors", severity: "alert" },
  "identity-conflict": { label: "Disk identity conflict", severity: "alert" },
  "collector-incompatible": {
    label: "Collector incompatible",
    severity: "alert",
  },
  "collector-compatible": {
    label: "Collector compatible again",
    severity: "recovery",
  },
} as const satisfies Record<string, { label: string; severity: AlertSeverity }>;

export type AlertRule = keyof typeof ALERT_RULES;

export const TEST_RULE = "test";
export type NotificationRule = AlertRule | typeof TEST_RULE;
export type NotificationSeverity = AlertSeverity | typeof TEST_RULE;

export const ALERT_CHANNELS = ["pushover", "webhook"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_CHANNEL_LABELS: Record<AlertChannel, string> = {
  pushover: "Pushover",
  webhook: "Webhook",
};
