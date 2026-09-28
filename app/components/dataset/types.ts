import type { InternalApi } from "nitropack/types";

export type DatasetTreeRow =
  InternalApi["/api/pools/:id/datasets"]["get"]["datasets"][number];
export type DatasetDetail = InternalApi["/api/datasets/:id"]["get"];
export type DatasetSnapshot = DatasetDetail["snapshots"][number];
export type DatasetSearchResult =
  InternalApi["/api/datasets"]["get"]["datasets"][number];
