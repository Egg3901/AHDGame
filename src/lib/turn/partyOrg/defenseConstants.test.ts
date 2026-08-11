import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import {
  DEFENSE_ORG_FLOOR,
  DEFENSE_UNMANNED_CAPTURE_MULTIPLIER,
  deriveDefenseTier,
  isUnmannedDefault,
  resolveDefenseFloor,
  resolveHomeDefaultParty,
} from "./defenseConstants";

function makeParty(over: Partial<PoliticalParty>): PoliticalParty {
  return {
    _id: new ObjectId(),
    sequentialId: 1,
    countryId: "US",
    name: "Test",
    abbreviation: "T",
    color: "#000",
    economicPosition: 0,
    socialPosition: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    memberCount: 0,
    isDefault: false,
    createdBy: null,
    treasury: 0,
    nationalTaxRate: 0,
    politicalStrength: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeRow(partyId: string, organization: number): StatePartyOrg {
  return {
    _id: `state_${partyId}`,
    countryId: "US",
    stateId: "CA",
    partyId,
    organization,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    treasury: 0,
    stateTaxRate: 0,
    politicalStrength: 0,
    hasPresence: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("deriveDefenseTier", () => {
  it("classifies bands correctly at boundaries", () => {
    // Strong: ≥ 36
    expect(deriveDefenseTier(36)).toBe("strong");
    expect(deriveDefenseTier(40)).toBe("strong");
    expect(deriveDefenseTier(35.99)).toBe("solid");
    // Solid: 32 ≤ x < 36
    expect(deriveDefenseTier(32)).toBe("solid");
    expect(deriveDefenseTier(31.99)).toBe("lean");
    // Lean: 28 ≤ x < 32
    expect(deriveDefenseTier(28)).toBe("lean");
    expect(deriveDefenseTier(27.99)).toBe("competitive");
    // Competitive: < 28
    expect(deriveDefenseTier(0)).toBe("competitive");
  });
});

describe("DEFENSE_ORG_FLOOR", () => {
  it("matches plan-locked values", () => {
    expect(DEFENSE_ORG_FLOOR.strong).toBe(18);
    expect(DEFENSE_ORG_FLOOR.solid).toBe(14);
    expect(DEFENSE_ORG_FLOOR.lean).toBe(10);
    expect(DEFENSE_ORG_FLOOR.competitive).toBe(0);
  });

  it("each floor sits below its tier's seed Org", () => {
    // Strong seed Org is 36; floor is 18 → 50% of seed
    expect(DEFENSE_ORG_FLOOR.strong).toBeLessThan(36);
    // Solid seed 34; floor 14 → tighter than half
    expect(DEFENSE_ORG_FLOOR.solid).toBeLessThan(34);
    // Lean seed 31; floor 10 → tighter
    expect(DEFENSE_ORG_FLOOR.lean).toBeLessThan(31);
  });
});

describe("DEFENSE_UNMANNED_CAPTURE_MULTIPLIER", () => {
  it("is 0.5 (capture-rate halved against unmanned defaults)", () => {
    expect(DEFENSE_UNMANNED_CAPTURE_MULTIPLIER).toBe(0.5);
  });
});

describe("resolveHomeDefaultParty", () => {
  const dem = makeParty({ sequentialId: 1, abbreviation: "D", isDefault: true });
  const gop = makeParty({ sequentialId: 2, abbreviation: "R", isDefault: true });
  const green = makeParty({ sequentialId: 3, abbreviation: "G", isDefault: false });

  it("picks the highest-Org default party", () => {
    const rows = [makeRow("1", 35), makeRow("2", 28), makeRow("3", 50)];
    const result = resolveHomeDefaultParty([dem, gop, green], rows);
    expect(result).toEqual({ partyId: "1", orgPct: 35 });
  });

  it("ignores non-default parties even if they have higher Org", () => {
    const rows = [makeRow("3", 99)]; // green only, not default
    const result = resolveHomeDefaultParty([dem, gop, green], rows);
    expect(result).toBeNull();
  });

  it("ties break alphabetically by partyId", () => {
    const rows = [makeRow("2", 30), makeRow("1", 30)];
    const result = resolveHomeDefaultParty([dem, gop], rows);
    expect(result).toEqual({ partyId: "1", orgPct: 30 });
  });

  it("returns null when no default parties have rows", () => {
    expect(resolveHomeDefaultParty([dem, gop], [])).toBeNull();
  });

  it("uses sequentialId for the partyId match (not _id)", () => {
    // partyId on rows is the sequentialId-string; ObjectIds would never match.
    const dem2 = makeParty({ sequentialId: 7, isDefault: true });
    const rows = [makeRow("7", 40)];
    const result = resolveHomeDefaultParty([dem2], rows);
    expect(result).toEqual({ partyId: "7", orgPct: 40 });
  });
});

describe("resolveDefenseFloor", () => {
  const dem = makeParty({ sequentialId: 1, isDefault: true });
  const gop = makeParty({ sequentialId: 2, isDefault: true });

  it("returns the home default's tier + floor", () => {
    const rows = [makeRow("1", 36), makeRow("2", 12)];
    const result = resolveDefenseFloor([dem, gop], rows);
    expect(result).toEqual({ partyId: "1", tier: "strong", floor: 18 });
  });

  it("returns null when no default party has presence", () => {
    expect(resolveDefenseFloor([dem, gop], [])).toBeNull();
  });
});

describe("isUnmannedDefault", () => {
  it("returns false when party is not a default", () => {
    const np = makeParty({ isDefault: false });
    const result = isUnmannedDefault(np, async () => true);
    expect(result).resolves.toBe(false);
  });

  it("returns true when chair seat is not an active human", async () => {
    const dp = makeParty({ isDefault: true, chairId: null });
    expect(await isUnmannedDefault(dp, async () => false)).toBe(true);
  });

  it("returns false when chair seat IS an active human", async () => {
    const dp = makeParty({ isDefault: true, chairId: new ObjectId() });
    expect(await isUnmannedDefault(dp, async () => true)).toBe(false);
  });
});
