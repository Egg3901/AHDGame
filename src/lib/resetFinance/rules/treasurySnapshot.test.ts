import { describe, expect, it } from "vitest";
import {
  openingNationalTreasuryPayload,
  openingNationalTreasurySnapshots,
} from "./treasurySnapshot";

const books = {
  US: { debt: 100, debtCeiling: 150 },
  UK: { debt: 80, debtCeiling: 120 },
  JP: { debt: 500, debtCeiling: 800 },
} as const;

describe("v2 national treasury opening", () => {
  it("creates three empty world-bound cash books without erasing opening debt", () => {
    const rows = openingNationalTreasurySnapshots("world-a", 1, books);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.countryId === "JP")).toMatchObject({
      cash: 0,
      debt: 500,
      emergencyAdvance: 0,
      settledThroughTurn: 1,
    });
    expect(openingNationalTreasuryPayload(rows)).toBe(
      openingNationalTreasuryPayload([...rows].reverse())
    );
  });

  it("rejects cross-world and already-spent opening receipts", () => {
    const rows = openingNationalTreasurySnapshots("world-a", 1, books);
    expect(() => openingNationalTreasuryPayload([...rows, rows[0]!])).toThrow("three countries");
    expect(() =>
      openingNationalTreasuryPayload([{ ...rows[0]!, cash: 1 }, ...rows.slice(1)])
    ).toThrow("Invalid national treasury opening");
    expect(() =>
      openingNationalTreasuryPayload([{ ...rows[0]!, worldId: "world-b" }, ...rows.slice(1)])
    ).toThrow("Invalid national treasury opening");
  });
});
