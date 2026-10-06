import type { Scenario } from "../types";
import { DISK_SCENARIOS } from "./disk";
import { DISK_DEFECT_SCENARIOS } from "./diskDefects";
import { DISK_ERROR_LOG_SCENARIOS } from "./diskErrorLog";
import { DISK_INTERFACE_SCENARIOS } from "./diskInterface";
import { DISK_SELF_TEST_SCENARIOS } from "./diskSelfTest";
import { DISK_SMART_UNAVAILABLE_SCENARIOS } from "./diskSmartUnavailable";
import { HOST_SCENARIOS } from "./host";
import { POOL_SCENARIOS } from "./pool";
import { PRESENCE_SCENARIOS } from "./presence";
import { REPLICATION_SCENARIOS } from "./replication";

export const SCENARIOS = [
  ...DISK_SCENARIOS,
  ...DISK_SELF_TEST_SCENARIOS,
  ...DISK_SMART_UNAVAILABLE_SCENARIOS,
  ...DISK_ERROR_LOG_SCENARIOS,
  ...DISK_INTERFACE_SCENARIOS,
  ...DISK_DEFECT_SCENARIOS,
  ...PRESENCE_SCENARIOS,
  ...POOL_SCENARIOS,
  ...HOST_SCENARIOS,
  ...REPLICATION_SCENARIOS,
] as Scenario[];
