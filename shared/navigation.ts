export interface StatusCounts {
  error: number;
  warning: number;
  neutral: number;
}

export interface NavigationCounts {
  faults: StatusCounts;
  disks: StatusCounts;
  pools: StatusCounts;
}
