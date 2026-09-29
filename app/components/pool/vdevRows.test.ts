import { describe, expect, it } from "vitest";
import { flattenVdevs, isVdev } from "./vdevRows";

interface Named {
  name: string;
  children: Named[];
}

const node = (name: string, ...children: Named[]): Named => ({
  name,
  children,
});

describe("flattenVdevs", () => {
  it("lists the tree depth first with each node's depth", () => {
    const tree = node(
      "tank",
      node("raidz1-0", node("K1"), node("K2")),
      node("mirror-1", node("S1")),
    );
    expect(
      flattenVdevs(tree).map(({ node, depth }) => `${depth}:${node.name}`),
    ).toEqual(["0:tank", "1:raidz1-0", "2:K1", "2:K2", "1:mirror-1", "2:S1"]);
  });

  it("returns nothing without a tree", () => {
    expect(flattenVdevs(null)).toEqual([]);
  });
});

describe("isVdev", () => {
  it("marks top-level vdevs and nested groups, not the root or leaf disks", () => {
    const tree = node(
      "tank",
      node("raidz1-0", node("K1"), node("K2")),
      node("S1"),
    );
    expect(
      flattenVdevs(tree)
        .filter(isVdev)
        .map(({ node }) => node.name),
    ).toEqual(["raidz1-0", "S1"]);
  });
});
