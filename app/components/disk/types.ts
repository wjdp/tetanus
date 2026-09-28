import type { InternalApi } from "nitropack/types";

export type DiskDetail = InternalApi["/api/disks/:id"]["get"];
export type SmartOverview = InternalApi["/api/disks/:id/smart"]["get"];
export type LatestAttribute = SmartOverview["attributes"][number];
export type PoolSummary = InternalApi["/api/pools"]["get"][number];
export type VdevNode = NonNullable<PoolSummary["vdevs"]>;
export type DiaryEntry = DiskDetail["diary"][number];
