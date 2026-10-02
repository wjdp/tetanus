import type { Scenario } from "../types";
import { DISK_SCENARIOS } from "./disk";

export const SCENARIOS: Scenario[] = [...DISK_SCENARIOS] as Scenario[];
