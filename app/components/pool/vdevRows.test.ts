import { describe, expect, it } from "vitest";
import { type VdevTableRow, vdevTableRows } from "./vdevRows";

interface Named {
  name: string;
  role: string;
  children: Named[];
}

const node = (name: string, role: string, ...children: Named[]): Named => ({
  name,
  role,
  children,
});

const describeRow = (row: VdevTableRow<Named>) =>
  row.kind === "section"
    ? `[${row.label}]`
    : `${row.depth}:${row.node.name}${row.showsTypeIcon ? "*" : ""}`;

describe("vdevTableRows", () => {
  it("lists the tree depth first, marking top-level vdevs and nested groups", () => {
    const tree = node(
      "tank",
      "normal",
      node("raidz1-0", "normal", node("K1", "normal"), node("K2", "normal")),
      node("S1", "normal"),
    );
    expect(vdevTableRows(tree).map(describeRow)).toEqual([
      "0:tank",
      "1:raidz1-0*",
      "2:K1",
      "2:K2",
      "1:S1*",
    ]);
  });

  it("groups allocation classes under headings in zpool status order", () => {
    const tree = node(
      "tspare",
      "normal",
      node("C1", "cache"),
      node("mirror-0", "normal", node("F1", "normal"), node("F2", "normal")),
      node("P1", "spare"),
      node("L1", "log"),
      node("mirror-4", "special", node("S1", "special"), node("S2", "special")),
    );
    expect(vdevTableRows(tree).map(describeRow)).toEqual([
      "0:tspare",
      "1:mirror-0*",
      "2:F1",
      "2:F2",
      "[special]",
      "1:mirror-4*",
      "2:S1",
      "2:S2",
      "[logs]",
      "1:L1",
      "[cache]",
      "1:C1",
      "[spares]",
      "1:P1",
    ]);
  });

  it("returns nothing without a tree", () => {
    expect(vdevTableRows(null)).toEqual([]);
  });
});
