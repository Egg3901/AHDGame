import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE,
  FUNDRAISING_INCOME,
  GENERAL_PHASE_UPGRADE_MULTIPLIER,
  getCampaignFamilyScalar,
  getEffectiveUpgradeCost,
  getMaintenanceCost,
  getUpgradeCost,
} from "./upgradeCosts";
import { calculateCampaignIncome } from "./income";
import type { Campaign } from "@/lib/db/types";

describe("getCampaignFamilyScalar", () => {
  it("returns 1.0 for undefined / unknown election types (backward-compat)", () => {
    expect(getCampaignFamilyScalar(undefined)).toBe(1.0);
    expect(getCampaignFamilyScalar("")).toBe(1.0);
    expect(getCampaignFamilyScalar("unknown-type-xyz")).toBe(1.0);
  });

  it("returns the documented scalar for each defined family", () => {
    expect(getCampaignFamilyScalar("president")).toBe(1.0);
    expect(getCampaignFamilyScalar("senate")).toBe(0.5);
    expect(getCampaignFamilyScalar("governor")).toBe(0.5);
    expect(getCampaignFamilyScalar("house")).toBe(0.3);
    expect(getCampaignFamilyScalar("stateSenate")).toBe(0.2);
  });

  it("orders families from largest to smallest budget tier", () => {
    // Smoke-check: president must be the biggest budget, stateSenate the
    // smallest. Anything reorganising this table should reconsider that
    // invariant.
    const all = Object.values(CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE);
    expect(Math.max(...all)).toBe(CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE.president);
    expect(Math.min(...all)).toBe(CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE.stateSenate);
  });
});

describe("calculateCampaignIncome with scalar", () => {
  const campaign = { fundraisingLevel: 10 } as Campaign;

  it("returns FUNDRAISING_INCOME[10] when no electionType is passed (backward-compat)", () => {
    expect(calculateCampaignIncome(campaign)).toBe(FUNDRAISING_INCOME[10]);
  });

  it("scales L10 income to 30% for a House race (0.3×)", () => {
    expect(calculateCampaignIncome(campaign, "house")).toBe(
      Math.round(FUNDRAISING_INCOME[10] * 0.3)
    );
  });

  it("scales L10 income to 20% for a State Senate race (0.2×)", () => {
    expect(calculateCampaignIncome(campaign, "stateSenate")).toBe(
      Math.round(FUNDRAISING_INCOME[10] * 0.2)
    );
  });

  it("does not scale income for presidential races (1.0×)", () => {
    expect(calculateCampaignIncome(campaign, "president")).toBe(FUNDRAISING_INCOME[10]);
  });
});

describe("getUpgradeCost with scalar", () => {
  it("returns the base cost when no electionType is passed", () => {
    const cost = getUpgradeCost("fundraising", 10);
    expect(cost?.funds).toBe(10_000_000); // L10 from upgradeCosts.ts
  });

  it("scales the funds cost for non-presidential families", () => {
    const houseCost = getUpgradeCost("fundraising", 10, "house");
    expect(houseCost?.funds).toBe(Math.round(10_000_000 * 0.3));
    const stateSenateCost = getUpgradeCost("fundraising", 10, "stateSenate");
    expect(stateSenateCost?.funds).toBe(Math.round(10_000_000 * 0.2));
  });

  it("scales maintenance cost when present (groundGame / mediaSpending categories)", () => {
    const stateSenateGroundGame = getUpgradeCost("groundGame", 5, "stateSenate");
    // groundGame L5 maintenance = 170_500; × 0.2 = 34_100.
    expect(stateSenateGroundGame?.maintenance).toBe(Math.round(170_500 * 0.2));
  });

  it("returns null for an out-of-range level (preserves base behavior)", () => {
    expect(getUpgradeCost("fundraising", 99)).toBeNull();
    expect(getUpgradeCost("fundraising", 99, "stateSenate")).toBeNull();
  });
});

describe("getEffectiveUpgradeCost (family scalar × general-phase surcharge)", () => {
  it("returns the family-scaled cost unchanged in the primary phase (no surcharge)", () => {
    // Presidential ground-game L4: base $440k, 25 actions, $82.5k maintenance.
    const cost = getEffectiveUpgradeCost("groundGame", 4, "president", false);
    expect(cost?.funds).toBe(440_000);
    expect(cost?.actions).toBe(25);
    expect(cost?.maintenance).toBe(82_500);
  });

  it("applies the +50% general-phase surcharge to funds and actions", () => {
    const cost = getEffectiveUpgradeCost("groundGame", 4, "president", true);
    expect(cost?.funds).toBe(Math.ceil(440_000 * GENERAL_PHASE_UPGRADE_MULTIPLIER)); // 660_000
    expect(cost?.actions).toBe(Math.ceil(25 * GENERAL_PHASE_UPGRADE_MULTIPLIER)); // 38
  });

  it("does NOT apply the general-phase surcharge to recurring maintenance", () => {
    // Maintenance is an ongoing per-turn cost (getMaintenanceCost), not subject
    // to the one-time upgrade surcharge — display must match what's charged.
    const cost = getEffectiveUpgradeCost("groundGame", 4, "president", true);
    expect(cost?.maintenance).toBe(82_500);
  });

  it("composes the family scalar with the general surcharge", () => {
    // Senate ground-game L4: round(440k × 0.5) = 220k, then × 1.5 = 330k.
    const cost = getEffectiveUpgradeCost("groundGame", 4, "senate", true);
    expect(cost?.funds).toBe(
      Math.ceil(Math.round(440_000 * 0.5) * GENERAL_PHASE_UPGRADE_MULTIPLIER)
    );
  });

  it("matches the server gate's exact funds/actions arithmetic (SSOT invariant)", () => {
    // The campaign-upgrade gate charges Math.ceil(getUpgradeCost(...) × multiplier).
    // The displayed cost MUST equal that, or canAfford disagrees with the gate.
    for (const electionType of ["president", "senate", "house", "stateSenate"]) {
      for (const isGeneral of [false, true]) {
        const base = getUpgradeCost("groundGame", 4, electionType);
        const multiplier = isGeneral ? GENERAL_PHASE_UPGRADE_MULTIPLIER : 1.0;
        const effective = getEffectiveUpgradeCost("groundGame", 4, electionType, isGeneral);
        expect(effective?.funds).toBe(Math.ceil(base!.funds * multiplier));
        expect(effective?.actions).toBe(Math.ceil(base!.actions * multiplier));
      }
    }
  });

  it("returns null for an out-of-range level (preserves base behavior)", () => {
    expect(getEffectiveUpgradeCost("fundraising", 99, "president", false)).toBeNull();
    expect(getEffectiveUpgradeCost("fundraising", 99, "president", true)).toBeNull();
  });
});

describe("getMaintenanceCost with scalar", () => {
  it("returns base total when no electionType is passed", () => {
    // groundGame L5 cumulative maintenance: 5_500 + 16_500 + 38_500 + 82_500 + 170_500 = 313_500
    expect(getMaintenanceCost("groundGame", 5)).toBe(313_500);
  });

  it("scales the cumulative maintenance total to the race family's tier", () => {
    expect(getMaintenanceCost("groundGame", 5, "house")).toBe(Math.round(313_500 * 0.3));
    expect(getMaintenanceCost("groundGame", 5, "stateSenate")).toBe(Math.round(313_500 * 0.2));
  });

  it("returns 0 for level 0 regardless of family", () => {
    expect(getMaintenanceCost("groundGame", 0)).toBe(0);
    expect(getMaintenanceCost("groundGame", 0, "stateSenate")).toBe(0);
  });
});
