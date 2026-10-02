import type { DiaryEventType } from "#shared/diary";

export { DIARY_EVENT_TYPES, type DiaryEventType } from "#shared/diary";

import {
  DISK_STATES,
  type EffectiveDiskState,
  STATE_OVERRIDES,
} from "#shared/disk";
import { DEVICE_STATUSES, type DeviceStatus } from "#shared/smart/status";
import { ENTITY_ICON } from "./entity";
import { LIFECYCLE_VOCABULARY } from "./lifecycle";
import { vdevTypeVocabulary } from "./vdevType";

export type DiaryEventIcon = string | { dot: DeviceStatus };

export interface DiaryEventSource {
  eventType: string | null;
  data?: unknown;
  manual?: boolean;
}

export const MANUAL_ENTRY_ICON = "i-lucide-pencil";
export const UNKNOWN_EVENT_ICON = "i-lucide-circle";
const VDEV_FALLBACK_ICON = "i-lucide-layers";
const SCAN_ICON = "i-lucide-scan-line";

const LIFECYCLE_STATES: readonly string[] = [
  ...DISK_STATES,
  ...STATE_OVERRIDES,
];

const dataField = (data: unknown, key: string): unknown =>
  typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)[key]
    : undefined;

const isLifecycleState = (value: unknown): value is EffectiveDiskState =>
  typeof value === "string" && LIFECYCLE_STATES.includes(value);

const isDeviceStatus = (value: unknown): value is DeviceStatus =>
  typeof value === "string" &&
  (DEVICE_STATUSES as readonly string[]).includes(value);

const newLifecycleStateIcon = (data: unknown) => {
  const to = dataField(data, "to");
  return isLifecycleState(to)
    ? LIFECYCLE_VOCABULARY[to].icon
    : UNKNOWN_EVENT_ICON;
};

const newStatusDot = (data: unknown): DiaryEventIcon => {
  const to = dataField(data, "to");
  return { dot: isDeviceStatus(to) ? to : "unknown" };
};

const vdevIcon = (data: unknown) => {
  const type = dataField(data, "type");
  return (
    (typeof type === "string" ? vdevTypeVocabulary(type)?.icon : undefined) ??
    VDEV_FALLBACK_ICON
  );
};

const DIARY_EVENT_ICON: Record<
  DiaryEventType,
  (data: unknown) => DiaryEventIcon
> = {
  "state-changed": newLifecycleStateIcon,
  "override-set": newLifecycleStateIcon,
  "smart-status-changed": newStatusDot,
  "attribute-status-changed": newStatusDot,
  "fault-accepted": () => "i-lucide-shield-check",
  "acceptance-superseded": () => "i-lucide-shield-off",
  "acceptance-cleared": () => "i-lucide-shield-off",
  "fault-acknowledged": () => "i-lucide-eye",
  "acknowledgement-superseded": () => "i-lucide-eye-off",
  "acknowledgement-cleared": () => "i-lucide-eye-off",
  "disk-appeared": () => "i-lucide-plug-zap",
  "moved-host": () => "i-lucide-move-right",
  "pool-moved": () => "i-lucide-move-right",
  "pool-archived": () => "i-lucide-archive",
  "pool-unarchived": () => "i-lucide-archive-restore",
  "vdev-joined": vdevIcon,
  "vdev-left": vdevIcon,
  "vdev-state-changed": vdevIcon,
  "pool-state-changed": () => ENTITY_ICON.pool,
  "scrub-finished": () => SCAN_ICON,
  "resilver-finished": () => SCAN_ICON,
  "scan-finished": () => SCAN_ICON,
  "scrub-cancelled": () => SCAN_ICON,
  "leaf-errors-changed": () => ENTITY_ICON.disk,
  "pool-data-errors-changed": () => "i-lucide-file-warning",
  "alias-set": () => "i-lucide-tag",
  "alias-drift": () => "i-lucide-tag",
  "identity-conflict": () => "i-lucide-octagon-alert",
  "usage-changed": () => ENTITY_ICON.disk,
  "dataset-created": () => ENTITY_ICON.dataset,
  "dataset-destroyed": () => ENTITY_ICON.dataset,
  "collector-status-changed": () => ENTITY_ICON.host,
  "events-gap": () => "i-lucide-history",
  "events-reset": () => "i-lucide-history",
  "imported-from-scrutiny": () => "i-lucide-import",
  "fault-opened": () => ENTITY_ICON.fault,
  "fault-state-changed": () => ENTITY_ICON.fault,
  "fault-resolved": () => ENTITY_ICON.fault,
};

const isDiaryEventType = (value: string): value is DiaryEventType =>
  Object.hasOwn(DIARY_EVENT_ICON, value);

export function diaryEventIcon({
  eventType,
  data,
  manual = false,
}: DiaryEventSource): DiaryEventIcon {
  if (manual) return MANUAL_ENTRY_ICON;
  if (eventType === null || !isDiaryEventType(eventType)) {
    return UNKNOWN_EVENT_ICON;
  }
  return DIARY_EVENT_ICON[eventType](data);
}
