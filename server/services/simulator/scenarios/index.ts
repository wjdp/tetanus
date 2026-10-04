import type { Scenario } from "../types";
import { DISK_SCENARIOS } from "./disk";
import { HOST_SCENARIOS } from "./host";
import { POOL_SCENARIOS } from "./pool";
import { PRESENCE_SCENARIOS } from "./presence";
import { REPLICATION_SCENARIOS } from "./replication";

export const SCENARIOS = [
  ...DISK_SCENARIOS,
  ...PRESENCE_SCENARIOS,
  ...POOL_SCENARIOS,
  ...HOST_SCENARIOS,
  ...REPLICATION_SCENARIOS,
] as Scenario[];
