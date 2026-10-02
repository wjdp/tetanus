import type { TopologyVdev } from "../topology/groupDisks";

export interface PoolVdev extends TopologyVdev {
  spareState: string | null;
  devid: string | null;
  physPath: string | null;
  frag: number | null;
  children: PoolVdev[];
}

export interface PoolRemoval {
  state: string;
  removingVdev: number;
  startTime: number;
  endTime?: number;
  toCopy: number;
  copied: number;
  mappingMemory: number;
}

export interface VdevReading {
  at: string;
  readErrors: number;
  writeErrors: number;
  checksumErrors: number;
  slowIos: number | null;
  state: string;
}
