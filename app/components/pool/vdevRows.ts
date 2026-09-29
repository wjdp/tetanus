export interface VdevTreeNode {
  children: VdevTreeNode[];
}

export interface VdevRow<Node> {
  node: Node;
  depth: number;
}

export function flattenVdevs<Node extends VdevTreeNode>(
  root: Node | null,
): VdevRow<Node>[] {
  if (!root) return [];
  const rows: VdevRow<Node>[] = [];
  const visit = (node: Node, depth: number) => {
    rows.push({ node, depth });
    for (const child of node.children) visit(child as Node, depth + 1);
  };
  visit(root, 0);
  return rows;
}

const TOP_LEVEL_DEPTH = 1;

export const isVdev = ({ node, depth }: VdevRow<VdevTreeNode>) =>
  depth === TOP_LEVEL_DEPTH ||
  (depth > TOP_LEVEL_DEPTH && node.children.length > 0);
