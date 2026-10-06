import { formatBytes, formatDate } from "~/utils/format";
import { lastSegment } from "./treeRows";
import type { DatasetTreeRow } from "./types";

type SortValue = string | number | null;

export interface DatasetColumn {
  id: string;
  label: string;
  defaultVisible: boolean;
  locked?: boolean;
  sortValue?: (dataset: DatasetTreeRow) => SortValue;
  sortsDescendingFirst?: boolean;
  cellClass?: string;
  /** Columns with no cell of their own render one of these. */
  bytes?: (dataset: DatasetTreeRow) => number | null;
  text?: (dataset: DatasetTreeRow) => string | null;
}

export interface DatasetSorting {
  id: string;
  desc: boolean;
}

const HIDDEN_WHEN_NARROW = "hidden @3xl:table-cell";

export const firstLimit = (dataset: DatasetTreeRow) =>
  dataset.quota || dataset.refQuota || dataset.reservation || null;

const bytesColumn = (
  id: string,
  label: string,
  bytes: (dataset: DatasetTreeRow) => number | null,
): DatasetColumn => ({
  id,
  label,
  defaultVisible: false,
  bytes,
  sortValue: bytes,
  sortsDescendingFirst: true,
});

const textColumn = (
  id: string,
  label: string,
  text: (dataset: DatasetTreeRow) => string | null,
): DatasetColumn => ({
  id,
  label,
  defaultVisible: false,
  text,
  sortValue: text,
});

export const DATASET_COLUMNS: DatasetColumn[] = [
  {
    id: "name",
    label: "Name",
    defaultVisible: true,
    locked: true,
    sortValue: (dataset) => lastSegment(dataset.name),
  },
  textColumn("type", "Type", (dataset) => dataset.type),
  {
    id: "used",
    label: "Used",
    defaultVisible: true,
    sortValue: (dataset) => dataset.used,
    sortsDescendingFirst: true,
  },
  {
    id: "growth",
    label: "Growth",
    defaultVisible: true,
    sortValue: (dataset) => dataset.growth?.used ?? null,
    sortsDescendingFirst: true,
  },
  bytesColumn("referenced", "Referenced", (dataset) => dataset.referenced),
  bytesColumn(
    "snapshotSpace",
    "Snapshot space",
    (dataset) => dataset.usedBySnapshots,
  ),
  bytesColumn("logicalUsed", "Logical used", (dataset) => dataset.logicalUsed),
  bytesColumn("available", "Available", (dataset) => dataset.available),
  {
    id: "compression",
    label: "Compression",
    defaultVisible: true,
    sortValue: (dataset) => dataset.compressRatio,
    sortsDescendingFirst: true,
    cellClass: HIDDEN_WHEN_NARROW,
  },
  {
    id: "recordSize",
    label: "Record size",
    defaultVisible: false,
    sortValue: (dataset) => dataset.recordSize,
    sortsDescendingFirst: true,
    text: (dataset) =>
      dataset.recordSize === null
        ? null
        : formatBytes(dataset.recordSize, "binary"),
  },
  textColumn("encryption", "Encryption", (dataset) => dataset.encryption),
  {
    id: "limits",
    label: "Limits",
    defaultVisible: true,
    sortValue: firstLimit,
    sortsDescendingFirst: true,
    cellClass: HIDDEN_WHEN_NARROW,
  },
  {
    id: "snapshots",
    label: "Snapshots",
    defaultVisible: true,
    sortValue: (dataset) => dataset.snapshotCount,
    sortsDescendingFirst: true,
  },
  { id: "replication", label: "Replication", defaultVisible: true },
  textColumn("mountpoint", "Mountpoint", (dataset) => dataset.mountpoint),
  {
    id: "created",
    label: "Created",
    defaultVisible: false,
    sortValue: (dataset) => dataset.creation,
    sortsDescendingFirst: true,
    text: (dataset) => formatDate(dataset.creation),
  },
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
