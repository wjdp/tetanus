<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import {
  ALERT_CHANNEL_LABELS,
  ALERT_RULES,
  type AlertChannel,
} from "#shared/alerts";
import { formatTimestamp } from "~/components/pool/timestamp";

export interface NotificationRow {
  id: number;
  at: string;
  channel: AlertChannel;
  rule: string;
  message: string;
  ok: boolean;
  error: string | null;
}

defineProps<{ notifications: NotificationRow[] }>();

const ruleLabel = (rule: string) =>
  ALERT_RULES[rule as keyof typeof ALERT_RULES]?.label ?? rule;

const columns: TableColumn<NotificationRow>[] = [
  { id: "at", header: "At" },
  { id: "channel", header: "Channel" },
  { id: "rule", header: "Rule" },
  { accessorKey: "message", header: "Message" },
  { id: "result", header: "Result" },
];
</script>

<template>
  <UTable
    :data="notifications"
    :columns="columns"
    empty="No alerts sent yet"
    data-testid="notifications"
  >
    <template #at-cell="{ row }">
      <span class="text-muted whitespace-nowrap font-mono text-xs">
        {{ formatTimestamp(row.original.at) }}
      </span>
    </template>

    <template #channel-cell="{ row }">
      {{ ALERT_CHANNEL_LABELS[row.original.channel] }}
    </template>

    <template #rule-cell="{ row }">
      {{ ruleLabel(row.original.rule) }}
    </template>

    <template #result-cell="{ row }">
      <UBadge v-if="row.original.ok" color="neutral" variant="subtle" size="sm">
        Sent
      </UBadge>
      <span v-else class="text-error text-sm">
        {{ row.original.error ?? "Failed" }}
      </span>
    </template>
  </UTable>
</template>
