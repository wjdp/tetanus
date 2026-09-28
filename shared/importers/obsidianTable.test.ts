import { describe, expect, it } from "vitest";
import {
  coerceBoolean,
  coerceCapacity,
  coerceDate,
  coerceMoney,
  coerceStatus,
  mapColumns,
  parseTable,
  readRow,
} from "./obsidianTable";

describe("parseTable", () => {
  it("reads a markdown pipe table, skipping the separator", () => {
    const text = [
      "| Alias | Serial | Status |",
      "| --- | :---: | ---: |",
      "|  H1 | WD-WCC4E1234567 | REMOVED |",
      "| K2 | 1AQLP5ME | ONLINE |",
    ].join("\n");
    expect(parseTable(text)).toEqual({
      headers: ["Alias", "Serial", "Status"],
      rows: [
        ["H1", "WD-WCC4E1234567", "REMOVED"],
        ["K2", "1AQLP5ME", "ONLINE"],
      ],
    });
  });

  it("reads a markdown table without outer pipes", () => {
    const text = "Alias | Serial\n--- | ---\nK1 | ABC\n";
    expect(parseTable(text)).toEqual({
      headers: ["Alias", "Serial"],
      rows: [["K1", "ABC"]],
    });
  });

  it("unescapes pipes inside markdown cells", () => {
    const text = "| Alias | Notes |\n|---|---|\n| [[K1\\|K1 disk]] | a \\| b |";
    expect(parseTable(text).rows).toEqual([["[[K1|K1 disk]]", "a | b"]]);
  });

  it("reads CSV with RFC 4180 quoting", () => {
    const text =
      'alias,serial,supplier\r\nK1,ABC,"Scan, Ltd"\r\nK2,DEF,"He said ""hi""\nthen left"\r\n';
    expect(parseTable(text)).toEqual({
      headers: ["alias", "serial", "supplier"],
      rows: [
        ["K1", "ABC", "Scan, Ltd"],
        ["K2", "DEF", 'He said "hi"\nthen left'],
      ],
    });
  });

  it("detects tab-delimited text", () => {
    const text = "Alias\tSerial\tPrice\nK1\tABC\t£1,200.50\n\n";
    expect(parseTable(text)).toEqual({
      headers: ["Alias", "Serial", "Price"],
      rows: [["K1", "ABC", "£1,200.50"]],
    });
  });

  it("returns nothing for blank text", () => {
    expect(parseTable("  \n\n")).toEqual({ headers: [], rows: [] });
  });
});

describe("mapColumns", () => {
  it("matches synonyms, labels and keys case-insensitively", () => {
    const mapping = mapColumns([
      "Name",
      "Serial Number",
      "Size",
      "Bought",
      "3.3 V pin",
      "Cost",
      "warrantyExpiry",
      "Shop",
      "Condition",
      "State",
      "Pool",
      "Age",
    ]);
    expect(mapping).toEqual({
      alias: 0,
      model: null,
      serial: 1,
      capacity: 2,
      purchaseDate: 3,
      pin33Taped: 4,
      purchasePrice: 5,
      warrantyExpiry: 6,
      supplier: 7,
      purchaseCondition: 8,
      status: 9,
      pool: 10,
    });
  });

  it("keeps the first column when two headers map to one target", () => {
    expect(mapColumns(["alias", "name"]).alias).toBe(0);
  });
});

describe("coercion", () => {
  it("reads ISO, British and written dates", () => {
    expect(coerceDate("2018-03-04")).toBe("2018-03-04");
    expect(coerceDate("04/03/2018")).toBe("2018-03-04");
    expect(coerceDate("4 Mar 2018")).toBe("2018-03-04");
    expect(coerceDate("4 March 2018")).toBe("2018-03-04");
    expect(coerceDate("31/02/2018")).toBeNull();
    expect(coerceDate("last spring")).toBeNull();
  });

  it("reads money with pound signs and thousands separators", () => {
    expect(coerceMoney("£1,200.50")).toBe(1200.5);
    expect(coerceMoney("95")).toBe(95);
    expect(coerceMoney("free")).toBeNull();
  });

  it("reads booleans", () => {
    for (const value of ["yes", "True", "✓", "taped", "Y"]) {
      expect(coerceBoolean(value)).toBe(true);
    }
    for (const value of ["no", "FALSE", "x", "n"]) {
      expect(coerceBoolean(value)).toBe(false);
    }
    expect(coerceBoolean("maybe")).toBeNull();
  });

  it("reads decimal capacities", () => {
    expect(coerceCapacity("12TB")).toBe(12e12);
    expect(coerceCapacity("12 TB")).toBe(12e12);
    expect(coerceCapacity("4000GB")).toBe(4e12);
    expect(coerceCapacity("3.84 tb")).toBe(3.84e12);
    expect(coerceCapacity("big")).toBeNull();
  });

  it("maps statuses to state overrides", () => {
    expect(coerceStatus("ONLINE")).toBeNull();
    expect(coerceStatus("spare")).toBe("spare");
    expect(coerceStatus("Removed")).toBe("removed");
    expect(coerceStatus("DEGRADED")).toBeUndefined();
  });
});

describe("readRow", () => {
  const headers = [
    "Alias",
    "Model",
    "Serial",
    "Capacity",
    "Status",
    "Purchased",
    "3.3v",
    "Condition",
  ];
  const mapping = mapColumns(headers);

  it("coerces every mapped cell", () => {
    expect(
      readRow(
        [
          "[[H1]]",
          "WDC WD40EFRX",
          "WD-WCC4E1",
          "4TB",
          "REMOVED",
          "1 Jun 2018",
          "yes",
          "New",
        ],
        mapping,
      ),
    ).toEqual({
      alias: "H1",
      model: "WDC WD40EFRX",
      serial: "WD-WCC4E1",
      capacityBytes: 4e12,
      stateOverride: "removed",
      inventory: {
        purchaseDate: "2018-06-01",
        pin33Taped: true,
        purchaseCondition: "new",
      },
      warnings: [],
    });
  });

  it("drops empty cells and warns about unreadable ones", () => {
    expect(
      readRow(["K 1", "", "ABC", "huge", "DEGRADED", "soon", "", "—"], mapping),
    ).toEqual({
      serial: "ABC",
      inventory: {},
      warnings: [
        'alias "K 1" is not a valid alias',
        'capacity "huge" not read',
        'status "DEGRADED" ignored',
        'Purchased "soon" not read',
      ],
    });
  });
});
