import { describe, expect, it } from "vitest";
import { sqlite } from "~~/server/database/client";
import { databaseSize, optimiseDatabase } from "./database";

describe("optimiseDatabase", () => {
  it("reclaims the space freed by deleted rows", () => {
    sqlite.exec(`
      CREATE TABLE Filler (blob TEXT);
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
      INSERT INTO Filler SELECT hex(randomblob(1000)) FROM n;
      DELETE FROM Filler;
    `);
    expect(databaseSize().reclaimableBytes).toBeGreaterThan(0);

    const { before, after } = optimiseDatabase();

    expect(after.reclaimableBytes).toBe(0);
    expect(after.bytes).toBeLessThan(before.bytes);
    sqlite.exec("DROP TABLE Filler");
  });
});
