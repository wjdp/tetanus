import type { InternalApi } from "nitropack/types";

export type DiskDetail = InternalApi["/api/disks/:id"]["get"];
export type SmartOverview = InternalApi["/api/disks/:id/smart"]["get"];
export type LatestAttribute = SmartOverview["attributes"][number];
export type DiaryEntry = DiskDetail["diary"][number];
