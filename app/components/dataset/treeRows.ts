export interface TreeDataset {
  id: number;
  name: string;
  parentId: number | null;
  present: boolean;
}

export interface TreeRow<Dataset extends TreeDataset> {
  dataset: Dataset;
  hasChildren: boolean;
  collapsed: boolean;
}

export const lastSegment = (name: string) => name.split("/").at(-1) ?? name;

export function visibleTreeRows<Dataset extends TreeDataset>(
  datasets: Dataset[],
  collapsedIds: ReadonlySet<number>,
): TreeRow<Dataset>[] {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const parentIds = new Set(datasets.map((dataset) => dataset.parentId));

  const hiddenByAncestor = (dataset: Dataset) => {
    let parent =
      dataset.parentId === null ? undefined : byId.get(dataset.parentId);
    while (parent) {
      if (collapsedIds.has(parent.id)) return true;
      parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
    }
    return false;
  };

  const ordered = [
    ...datasets.filter((dataset) => dataset.present),
    ...datasets.filter((dataset) => !dataset.present),
  ];

  return ordered
    .filter((dataset) => !hiddenByAncestor(dataset))
    .map((dataset) => ({
      dataset,
      hasChildren: parentIds.has(dataset.id),
      collapsed: collapsedIds.has(dataset.id),
    }));
}
