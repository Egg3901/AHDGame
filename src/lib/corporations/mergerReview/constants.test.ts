import { describe, it, expect } from "vitest";
import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import {
  ANTITRUST_LAW_BY_COUNTRY,
  MERGER_AUTHORITY_SEAT_BY_COUNTRY,
  MERGER_REVIEW_BLOCK_MARGIN_PERCENT,
  MERGER_REVIEW_REMEDY_MARGIN_PERCENT,
  autoResolveDecision,
  thresholdForLevel,
} from "./constants";

describe("merger review wiring", () => {
  it("maps every law country to a real, program-kind antitrust law", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      const lawId = ANTITRUST_LAW_BY_COUNTRY[countryId];
      const law = getLaw(lawId);
      expect(law, `${countryId}: ${lawId} not in the catalog`).toBeTruthy();
      // `getEnactedLevel` returns 0 for tax-kind laws, which would silently
      // disable review everywhere. The mapping must point at a program law.
      expect(law!.kind).not.toBe("tax");
      expect(law!.levels).toHaveLength(5);
      expect(law!.countryId).toBe(countryId);
    }
  });

  it("maps every law country to a cabinet seat that exists in the 1953 era", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      const seatId = MERGER_AUTHORITY_SEAT_BY_COUNTRY[countryId];
      const position = getCabinetPositions(countryId).find((p) => p.id === seatId);
      expect(position, `${countryId}: seat ${seatId} not in the roster`).toBeTruthy();
      expect(isSeatActive(position!, 1953)).toBe(true);
    }
  });
});

describe("thresholdForLevel", () => {
  it("turns review off at level 0 rather than setting an unreachable bar", () => {
    expect(thresholdForLevel(0)).toBeNull();
  });

  it("tightens monotonically as enforcement rises", () => {
    const ladder = [1, 2, 3, 4].map((l) => thresholdForLevel(l)!);
    expect(ladder).toEqual([...ladder].sort((a, b) => b - a));
    expect(new Set(ladder).size).toBe(ladder.length);
  });

  it("clamps out-of-range and non-finite levels", () => {
    expect(thresholdForLevel(9)).toBe(thresholdForLevel(4));
    expect(thresholdForLevel(-3)).toBeNull();
    expect(thresholdForLevel(Number.NaN)).toBeNull();
  });
});

describe("autoResolveDecision", () => {
  it("clears a deal that only just trips the threshold", () => {
    expect(autoResolveDecision(60, 60)).toBe("cleared");
    expect(autoResolveDecision(60 + MERGER_REVIEW_REMEDY_MARGIN_PERCENT - 0.01, 60)).toBe(
      "cleared"
    );
  });

  it("orders a remedy in the middle band", () => {
    expect(autoResolveDecision(60 + MERGER_REVIEW_REMEDY_MARGIN_PERCENT, 60)).toBe(
      "clearedWithRemedy"
    );
    expect(autoResolveDecision(60 + MERGER_REVIEW_BLOCK_MARGIN_PERCENT - 0.01, 60)).toBe(
      "clearedWithRemedy"
    );
  });

  it("blocks a flagrant deal", () => {
    expect(autoResolveDecision(60 + MERGER_REVIEW_BLOCK_MARGIN_PERCENT, 60)).toBe("blocked");
    expect(autoResolveDecision(100, 40)).toBe("blocked");
  });

  it("is pure — the same inputs always give the same answer", () => {
    const runs = new Set(Array.from({ length: 20 }, () => autoResolveDecision(68, 60)));
    expect(runs.size).toBe(1);
  });
});
