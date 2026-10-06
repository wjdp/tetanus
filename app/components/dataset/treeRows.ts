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

function visibleGroupRows<Dataset extends TreeDataset>(
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

  return datasets
    .filter((dataset) => !hiddenByAncestor(dataset))
    .map((dataset) => ({
      dataset,
      hasChildren: parentIds.has(dataset.id),
      collapsed: collapsedIds.has(dataset.id),
    }));
}

export function visibleTreeRows<Dataset extends TreeDataset>(
  datasets: Dataset[],
  collapsedIds: ReadonlySet<number>,
): TreeRow<Dataset>[] {
  return [
    ...visibleGroupRows(
      datasets.filter((dataset) => dataset.present),
      collapsedIds,
    ),
    ...visibleGroupRows(
      datasets.filter((dataset) => !dataset.present),
      collapsedIds,
    ),
  ];
}

/** Reorders siblings under each parent, keeping every dataset below its parent. */
export function sortSiblings<Dataset extends TreeDataset>(
  datasets: Dataset[],
  compare: (a: Dataset, b: Dataset) => number,
): Dataset[] {
  const ids = new Set(datasets.map((dataset) => dataset.id));
  const childrenOf = new Map<number | null, Dataset[]>();
  for (const dataset of datasets) {
    const parentId =
      dataset.parentId !== null && ids.has(dataset.parentId)
        ? dataset.parentId
        : null;
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), dataset]);
  }
  const subtree = (parentId: number | null): Dataset[] =>
    [...(childrenOf.get(parentId) ?? [])]
      .sort(compare)
      .flatMap((dataset) => [dataset, ...subtree(dataset.id)]);
  return subtree(null);
}
