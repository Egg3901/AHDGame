import { describe, expect, it } from "vitest";
import { buildOpeningLawBoards1991 } from "./openingBoards1991";
import { buildResetLawOpeningBoard } from "./rules/openingBoard";
import { openingLawReference } from "./openingLaw";

describe("1991 current-law boards", () => {
  it("builds four national and 79 regional boards with all 60 law and tax types", () => {
    const boards = buildOpeningLawBoards1991("world-test", 1);
    expect(boards).toHaveLength(83);
    expect(boards.filter((board) => board.scope === "national")).toHaveLength(4);
    expect(new Set(boards.map((board) => board._id)).size).toBe(83);
    for (const board of boards) {
      expect(Object.keys(board.references)).toHaveLength(60);
      expect(board.references.L19?.currentLaw).toBeTruthy();
      expect(board.references.T01?.currentLaw).toBeTruthy();
      if (board.countryId === "UK" && board.scope === "regional") {
        expect(board.ukTerritorialTax?.regionId).toBe(board.regionId);
        expect(board.ukTerritorialTax?.domestic).toBe(
          board.regionId === "NIR" ? "domestic_rates" : "community_charge"
        );
      } else {
        expect(board.ukTerritorialTax).toBeUndefined();
      }
    }
  });

  it("keeps historical exclusions distinct from an enacted current statute", () => {
    const uk = buildOpeningLawBoards1991("world-test", 1).find(
      (board) => board._id === "UK:national"
    )!;
    expect(uk.references.L01?.sourceComponents).toContainEqual(
      expect.objectContaining({
        sourceId: "uk_universal_credit",
        historicalDisposition: "not-adopted-as-1991-law",
      })
    );
  });

  it("allocates every pooled source cost once across regions rather than repeating it on every board", () => {
    const boards = buildOpeningLawBoards1991("world-test", 1);
    for (const country of ["US", "UK", "JP", "IE"] as const) {
      const regions = boards.filter(
        (board) => board.countryId === country && board.scope === "regional"
      );
      const referenceIds = Object.keys(regions[0]!.references);
      for (const familyId of referenceIds) {
        const pooled = openingLawReference(country, "regional", familyId)!;
        for (const source of pooled.sourceComponents) {
          const total = regions.reduce(
            (sum, board) =>
              sum +
              board.references[familyId]!.sourceComponents.find(
                (component) => component.sourceId === source.sourceId
              )!.annualBooked,
            0
          );
          expect(total, `${country}:${familyId}:${source.sourceId}`).toBeCloseTo(
            source.annualBooked,
            2
          );
        }
      }
      const source = openingLawReference(country, "regional", "L19")!.sourceComponents[0]!;
      if (!source) continue;
      expect(
        regions.every(
          (board) => board.references.L19!.sourceComponents[0]!.annualBooked < source.annualBooked
        )
      ).toBe(true);
      if (country !== "US") {
        for (const board of regions) {
          expect(board.references.L19!.sourceComponents[0]!.fiscalRole).toBe("legal-lineage-only");
          expect(board.references.L19!.sourceComponents[0]!.annualBooked).toBe(
            board.references.L16!.sourceComponents[0]!.annualBooked
          );
        }
      }
    }
  });

  it("rejects an incomplete or cross-country crosswalk", () => {
    const board = buildOpeningLawBoards1991("world-test", 1)[0]!;
    const references = Object.values(board.references);
    expect(() =>
      buildResetLawOpeningBoard({
        worldId: "world-test",
        countryId: "US",
        sourceTurn: 1,
        references: references.slice(1),
      })
    ).toThrow("Incomplete");
    expect(() =>
      buildResetLawOpeningBoard({
        worldId: "world-test",
        countryId: "UK",
        sourceTurn: 1,
        references,
      })
    ).toThrow("Invalid");
  });
});
