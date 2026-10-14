import { describe, expect, it } from "vitest";
import { CAPACITY_BUILD_TURNS } from "@/lib/constants/capacityEconomy";
import type { CorporateSector } from "@/lib/db/types";
import { allowsNppIndustryInvestment, isNppDivestmentProtected } from "./investmentProtection";

const sector = { sectorType: "manufacturing", plantsStartTurn: 100 } as CorporateSector;
describe("NPP investment maturation", () => {
  it("gives legacy-mode NPP births 24 turns without a nonexistent plant build window", () => {
    const legacy = { ...sector, plantsStartTurn: undefined, nppFoundedTurn: 100 };
    expect(isNppDivestmentProtected(legacy, 123)).toBe(true);
    expect(isNppDivestmentProtected(legacy, 124)).toBe(false);
  });
  it("protects a newborn through construction and 24 full operating turns", () => {
    const expires = 100 + CAPACITY_BUILD_TURNS("manufacturing", true) + 24;
    for (let turn = 100; turn < expires; turn++)
      expect(isNppDivestmentProtected(sector, turn)).toBe(true);
    expect(isNppDivestmentProtected(sector, expires)).toBe(false);
  });
  it("protects cash-funded, overdue and partially delivered orders even on old sectors", () => {
    const buildQueue = [{ unitsOrdered: 25, startTurn: 1, onlineTurn: 37 }];
    expect(isNppDivestmentProtected({ ...sector, buildQueue } as CorporateSector, 1000)).toBe(true);
    expect(isNppDivestmentProtected({ ...sector, constructionInProgressAnchor: 1 }, 1000)).toBe(
      true
    );
  });
  it("fails closed on malformed maturity or CIP data", () => {
    expect(isNppDivestmentProtected({ ...sector, plantsStartTurn: NaN }, 1000)).toBe(true);
    expect(isNppDivestmentProtected({ ...sector, constructionInProgressAnchor: NaN }, 1000)).toBe(
      true
    );
  });
  it("leaves mature legacy sectors unchanged and handles start turn zero", () => {
    expect(isNppDivestmentProtected({ ...sector, plantsStartTurn: undefined }, 1000)).toBe(false);
    expect(isNppDivestmentProtected({ ...sector, plantsStartTurn: 0 }, 1)).toBe(true);
    expect(isNppDivestmentProtected({ ...sector, constructionInProgressAnchor: 0 }, 1000)).toBe(
      false
    );
  });
  it("limits primary-only investment without changing unrestricted behavior", () => {
    expect(allowsNppIndustryInvestment("construction", "manufacturing", true)).toBe(false);
    expect(allowsNppIndustryInvestment("construction", "construction", true)).toBe(true);
    expect(allowsNppIndustryInvestment("construction", "manufacturing", false)).toBe(true);
  });
});
