interface MemberNode {
  name: string;
  type: string;
  disk: { id: number } | null;
  children: MemberNode[];
}

interface MemberPool<Node extends MemberNode> {
  vdevs: Node | null;
}

export interface Membership<Pool, Node> {
  pool: Pool;
  ancestors: Node[];
  leaf: Node;
}

function pathTo<Node extends MemberNode>(
  node: Node,
  diskId: number,
): Node[] | null {
  if (node.disk?.id === diskId) return [node];
  for (const child of node.children as Node[]) {
    const path = pathTo(child, diskId);
    if (path) return [node, ...path];
  }
  return null;
}

export function findMembership<
  Node extends MemberNode,
  Pool extends MemberPool<Node>,
>(pools: Pool[], diskId: number): Membership<Pool, Node> | null {
  for (const pool of pools) {
    const path = pool.vdevs ? pathTo(pool.vdevs, diskId) : null;
    if (!path) continue;
    const leaf = path[path.length - 1];
    const ancestors = path.slice(0, -1).filter((node) => node.type !== "root");
    return { pool, ancestors, leaf };
  }
  return null;
}
