export interface VdevTreeNode {
  role: string;
  children: VdevTreeNode[];
}

export interface VdevRow<Node> {
  kind: "vdev";
  node: Node;
  depth: number;
  showsTypeIcon: boolean;
}

export interface VdevSectionRow {
  kind: "section";
  role: string;
  label: string;
}

export type VdevTableRow<Node> = VdevRow<Node> | VdevSectionRow;

// The order and headings `zpool status` prints its allocation classes in.
const SECTIONS = [
  { role: "dedup", label: "dedup" },
  { role: "special", label: "special" },
  { role: "log", label: "logs" },
  { role: "cache", label: "cache" },
  { role: "spare", label: "spares" },
] as const;

const SECTION_ROLES: ReadonlySet<string> = new Set(
  SECTIONS.map(({ role }) => role),
);

const TOP_LEVEL_DEPTH = 1;

export function vdevTableRows<Node extends VdevTreeNode>(
  root: Node | null,
): VdevTableRow<Node>[] {
  if (!root) return [];
  const rows: VdevTableRow<Node>[] = [];
  const visit = (node: Node, depth: number, inSection: boolean) => {
    rows.push({
      kind: "vdev",
      node,
      depth,
      showsTypeIcon:
        node.children.length > 0
          ? depth >= TOP_LEVEL_DEPTH
          : depth === TOP_LEVEL_DEPTH && !inSection,
    });
    for (const child of node.children) {
      visit(child as Node, depth + 1, inSection);
    }
  };
  rows.push({ kind: "vdev", node: root, depth: 0, showsTypeIcon: false });
  const topLevel = root.children as Node[];
  for (const child of topLevel) {
    if (!SECTION_ROLES.has(child.role)) visit(child, TOP_LEVEL_DEPTH, false);
  }
  for (const section of SECTIONS) {
    const members = topLevel.filter((child) => child.role === section.role);
    if (members.length === 0) continue;
    rows.push({ kind: "section", ...section });
    for (const member of members) visit(member, TOP_LEVEL_DEPTH, true);
  }
  return rows;
}
