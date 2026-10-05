import {
  type HierarchyRectangularNode,
  hierarchy,
  treemap,
  treemapSquarify,
} from "d3-hierarchy";
import type { SpaceBox, SpaceNode } from "./spaceHierarchy";

export const HEADER_HEIGHT = 20;
const HEADER_MIN_WIDTH = 48;
const HEADER_MIN_HEIGHT = 40;
const HEADER_MAX_DEPTH = 2;
export const BRANCH_SLOTS = 7;

export type LaidOut = HierarchyRectangularNode<SpaceNode>;

const nodeBytes = (node: SpaceNode) =>
  node.kind === "dataset" ? 0 : node.bytes;

export const hasHeader = (node: LaidOut) =>
  node.data.kind === "dataset" &&
  node.depth > 0 &&
  node.depth <= HEADER_MAX_DEPTH &&
  node.y1 - node.y0 >= HEADER_MIN_HEIGHT &&
  node.x1 - node.x0 >= HEADER_MIN_WIDTH;

export function layoutSpace(
  root: SpaceBox,
  width: number,
  height: number,
): LaidOut {
  const nodes = hierarchy<SpaceNode>(root, (node) =>
    node.kind === "dataset" ? node.children : undefined,
  )
    .sum(nodeBytes)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return treemap<SpaceNode>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(1)
    .paddingOuter((node) => (node.depth === 0 ? 0 : 1))
    .paddingTop((node) =>
      hasHeader(node) ? HEADER_HEIGHT : node.depth === 0 ? 0 : 1,
    )
    .round(true)(nodes);
}

/** Categorical slot per first-level branch, biggest first; the rest fold into "other". */
export function branchSlots(root: SpaceBox): Map<number, number | null> {
  const slots = new Map<number, number | null>();
  const assign = (node: SpaceNode, slot: number | null) => {
    if (node.kind !== "dataset") return;
    slots.set(node.dataset.id, slot);
    for (const child of node.children) assign(child, slot);
  };
  slots.set(root.dataset.id, null);
  const branches = root.children
    .filter((child): child is SpaceBox => child.kind === "dataset")
    .sort((a, b) => b.dataset.used - a.dataset.used);
  for (const [index, branch] of branches.entries()) {
    assign(branch, index < BRANCH_SLOTS ? index : null);
  }
  return slots;
}

const CLAMP_PERCENTILE = 0.95;
const SYMLOG_DECADES = 100;

/**
 * Maps growth in bytes to -1…1 on a signed log scale, clamped at the 95th percentile
 * of |growth| so a few large datasets don't wash out the rest.
 */
export function growthScale(growths: (number | null)[]) {
  const magnitudes = growths
    .filter((growth): growth is number => growth !== null && growth !== 0)
    .map(Math.abs)
    .sort((a, b) => a - b);
  const clamp =
    magnitudes[Math.floor((magnitudes.length - 1) * CLAMP_PERCENTILE)] ?? 0;
  const constant = clamp / SYMLOG_DECADES;
  const symlog = (value: number) =>
    Math.sign(value) * Math.log1p(Math.abs(value) / constant);
  const extent = clamp > 0 ? symlog(clamp) : 1;
  return {
    clamp,
    position: (growth: number) =>
      clamp > 0 ? Math.max(-1, Math.min(1, symlog(growth) / extent)) : 0,
  };
}
