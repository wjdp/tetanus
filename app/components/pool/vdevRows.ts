export interface VdevTreeNode {
  children: VdevTreeNode[];
}

export function flattenVdevs<Node extends VdevTreeNode>(
  root: Node | null,
): { node: Node; depth: number }[] {
  if (!root) return [];
  const rows: { node: Node; depth: number }[] = [];
  const visit = (node: Node, depth: number) => {
    rows.push({ node, depth });
    for (const child of node.children) visit(child as Node, depth + 1);
  };
  visit(root, 0);
  return rows;
}
