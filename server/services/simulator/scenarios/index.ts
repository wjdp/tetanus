import type { Scenario } from "../types";
import { DISK_SCENARIOS } from "./disk";
import { HOST_SCENARIOS } from "./host";
import { POOL_SCENARIOS } from "./pool";
import { PRESENCE_SCENARIOS } from "./presence";

export const SCENARIOS = [
  ...DISK_SCENARIOS,
  ...PRESENCE_SCENARIOS,
  ...POOL_SCENARIOS,
  ...HOST_SCENARIOS,
] as Scenario[];
