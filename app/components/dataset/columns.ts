import { lastSegment } from "./treeRows";
import type { DatasetTreeRow } from "./types";

type SortValue = string | number | null;

export interface DatasetColumn {
  id: string;
  label: string;
  sortValue?: (dataset: DatasetTreeRow) => SortValue;
  sortsDescendingFirst?: boolean;
  cellClass?: string;
}

export interface DatasetSorting {
  id: string;
  desc: boolean;
}

const HIDDEN_WHEN_NARROW = "hidden @3xl:table-cell";

export const firstLimit = (dataset: DatasetTreeRow) =>
  dataset.quota || dataset.refQuota || dataset.reservation || null;

export const DATASET_COLUMNS: DatasetColumn[] = [
  {
    id: "name",
    label: "Name",
    sortValue: (dataset) => lastSegment(dataset.name),
  },
  {
    id: "used",
    label: "Used",
    sortValue: (dataset) => dataset.used,
    sortsDescendingFirst: true,
  },
  {
    id: "growth",
    label: "Growth",
    sortValue: (dataset) => dataset.growth?.used ?? null,
    sortsDescendingFirst: true,
  },
  {
    id: "compression",
    label: "Compression",
    sortValue: (dataset) => dataset.compressRatio,
    sortsDescendingFirst: true,
    cellClass: HIDDEN_WHEN_NARROW,
  },
  {
    id: "limits",
    label: "Limits",
    sortValue: firstLimit,
    sortsDescendingFirst: true,
    cellClass: HIDDEN_WHEN_NARROW,
  },
  {
    id: "snapshots",
    label: "Snapshots",
    sortValue: (dataset) => dataset.snapshotCount,
    sortsDescendingFirst: true,
  },
  { id: "replication", label: "Replication" },
];

export const findDatasetColumn = (id: string) =>
  DATASET_COLUMNS.find((column) => column.id === id);

const byText = new Intl.Collator("en-GB", { numeric: true }).compare;

/** Orders by the sorted column; datasets without a value go last either way. */
export function datasetComparator(sorting: DatasetSorting) {
  const sortValue = findDatasetColumn(sorting.id)?.sortValue;
  if (!sortValue) return () => 0;
  const direction = sorting.desc ? -1 : 1;
  return (a: DatasetTreeRow, b: DatasetTreeRow) => {
    const left = sortValue(a);
    const right = sortValue(b);
    if (left === null || right === null) {
      return Number(left === null) - Number(right === null);
    }
    const order =
      typeof left === "string" || typeof right === "string"
        ? byText(String(left), String(right))
        : left - right;
    return order * direction;
  };
}

/** Unsorted, then the column's first direction, then the other, then unsorted. */
export function nextSorting(
  current: DatasetSorting | null,
  column: DatasetColumn,
): DatasetSorting | null {
  const first = column.sortsDescendingFirst ?? false;
  if (current?.id !== column.id) return { id: column.id, desc: first };
  return current.desc === first ? { id: column.id, desc: !first } : null;
}
