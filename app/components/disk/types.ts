import type { InternalApi } from "nitropack/types";
import type { Disposal } from "#shared/disk";
import type { Inventory } from "#shared/inventory-fields";

export type DiskDetail = InternalApi["/api/disks/:id"]["get"];
export type SmartOverview = InternalApi["/api/disks/:id/smart"]["get"];
export type DiskStatisticsView =
  InternalApi["/api/disks/:id/statistics"]["get"];
export type LatestAttribute = SmartOverview["attributes"][number];
export type DiaryEntry = InternalApi["/api/diary"]["get"][number];

export interface ReplacementCandidate {
  id: number;
  alias: string | null;
  serial: string | null;
  hostName: string | null;
  purpose: DiskDetail["purpose"];
  disposal: Disposal | null;
  replacedByDiskId: number | null;
  inventory: Partial<Inventory>;
}
