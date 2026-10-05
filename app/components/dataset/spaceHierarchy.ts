export interface SpaceGrowth {
  used: number;
  data: number | null;
  snapshots: number | null;
  sinceAt: string;
}

export interface SpaceDataset {
  id: number;
  name: string;
  parentId: number | null;
  present: boolean;
  used: number;
  available: number;
  usedByDataset: number | null;
  usedBySnapshots: number | null;
  usedByChildren: number | null;
  growth: SpaceGrowth | null;
}

export type SpaceTileKind = "data" | "snapshots" | "reserved" | "free";

export interface SpaceTile {
  kind: SpaceTileKind;
  key: string;
  dataset: SpaceDataset;
  bytes: number;
  growth: number | null;
}

export interface SpaceBox {
  kind: "dataset";
  key: string;
  dataset: SpaceDataset;
  children: SpaceNode[];
}

export type SpaceNode = SpaceBox | SpaceTile;

export interface SpaceSplit {
  data: number;
  snapshots: number;
  children: number;
  reserved: number;
}

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

export function spaceSplit(
  dataset: SpaceDataset,
  childrenUsed: number,
): SpaceSplit {
  const children = dataset.usedByChildren ?? childrenUsed;
  const snapshots = dataset.usedBySnapshots ?? 0;
  const data =
    dataset.usedByDataset ?? Math.max(0, dataset.used - children - snapshots);
  const reserved = Math.max(0, dataset.used - data - snapshots - children);
  return { data, snapshots, children, reserved };
}

export function buildSpaceHierarchy(
  datasets: SpaceDataset[],
  { free = false }: { free?: boolean } = {},
): SpaceBox | null {
  const present = datasets.filter((dataset) => dataset.present);
  const childrenOf = new Map<number | null, SpaceDataset[]>();
  for (const dataset of present) {
    const siblings = childrenOf.get(dataset.parentId) ?? [];
    siblings.push(dataset);
    childrenOf.set(dataset.parentId, siblings);
  }

  const box = (dataset: SpaceDataset): SpaceBox => {
    const children = childrenOf.get(dataset.id) ?? [];
    const split = spaceSplit(dataset, sum(children.map((child) => child.used)));
    const tile = (
      kind: SpaceTileKind,
      bytes: number,
      growth: number | null,
    ): SpaceTile => ({
      kind,
      key: `${dataset.id}:${kind}`,
      dataset,
      bytes,
      growth,
    });
    const tiles = [
      tile("data", split.data, dataset.growth?.data ?? null),
      tile("snapshots", split.snapshots, dataset.growth?.snapshots ?? null),
      tile("reserved", split.reserved, null),
    ].filter((entry) => entry.bytes > 0);
    return {
      kind: "dataset",
      key: String(dataset.id),
      dataset,
      children: [...tiles, ...children.map(box)],
    };
  };

  const root = childrenOf.get(null)?.[0];
  if (!root) return null;
  const tree = box(root);
  if (free && root.available > 0) {
    tree.children.push({
      kind: "free",
      key: `${root.id}:free`,
      dataset: root,
      bytes: root.available,
      growth: null,
    });
  }
  return tree;
}
