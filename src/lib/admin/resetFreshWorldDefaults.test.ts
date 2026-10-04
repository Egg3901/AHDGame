/**
 * Why the keys `resetGameWorld` and `runSeed` clear are `$unset` rather than
 * `$set` to a default: for each one the reader treats ABSENCE as the fresh-world
 * state, and treats a stored value as the new world's own. These pin both halves,
 * so the list cannot grow a key whose reader would misread the cleared field.
 *
 * The reset tests (`resetGameWorld.test.ts`, `seed/runCoreSeedReset.test.ts`)
 * prove the keys are cleared; this proves clearing them is the right handling.
 */
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resolveVotingAgeEligible } from "@/lib/constants/votingAge";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import { resolveCommodityNominalIndices } from "@/lib/market/commodityNominalIndex";
import {
  retailCapacityExpansionPaused,
  retailLegacyDemandFactor,
} from "@/lib/market/retailDemandTransition";
import { euroConsentedCountries, euroMemberCurrencies } from "@/lib/currency/euro/rules";
import { ensureEuropeanIntegrationState } from "@/lib/internationalOrganizations/europeanIntegration/service";
import { withEuropeanInstitution } from "@/lib/internationalOrganizations/europeanIntegration/definition";
import { resolveSeedRoster } from "@/lib/internationalOrganizations/founding";
import { getManuallyEnabledSeats } from "@/lib/cabinet/liveGameYear";
import { shouldEvaluateStatehood } from "@/lib/turn/statehood";

describe("franchise law", () => {
  it("falls back to the era default when no law is stored", () => {
    expect(resolveVotingAgeEligible({}, 1991, "US")).toBe(18);
    expect(resolveVotingAgeEligible({}, 1953, "US")).toBe(21);
    expect(resolveVotingAgeEligible(undefined, 1991, "UK")).toBe(18);
  });

  it("lets a stored law from another world decide the new electorate", () => {
    const carried = { votingAgeEligibleByCountry: { US: 25, UK: 16 } };
    expect(resolveVotingAgeEligible(carried, 1991, "US")).toBe(25);
    expect(resolveVotingAgeEligible(carried, 1991, "UK")).toBe(16);
  });
});

describe("commodity price level", () => {
  const rates: number[] = [];

  it("starts at 1 and advances one turn when nothing is stored", () => {
    expect(
      resolveCommodityNominalIndices({
        index: undefined,
        lastTurn: undefined,
        currentTurn: 1,
        countryInflationRates: rates,
      })
    ).toEqual({ lagged: 1, current: 1 });
  });

  it("multiplies the new world's prices by the old level when one is stored", () => {
    const carried = resolveCommodityNominalIndices({
      index: 1.9569,
      lastTurn: 1329,
      currentTurn: 1,
      countryInflationRates: rates,
    });
    expect(carried.lagged).toBeCloseTo(1.9569, 4);
    expect(carried.current).toBeCloseTo(1.9569, 4);
  });
});

describe("Retail demand unwind", () => {
  it("is not started, and does not pause Retail capacity, when nothing is stored", () => {
    expect(retailLegacyDemandFactor({}, 1)).toBe(1);
    expect(retailCapacityExpansionPaused({}, 1)).toBe(false);
    expect(retailCapacityExpansionPaused(undefined, 1)).toBe(false);
  });

  it("pauses new Retail capacity on the new world's clock when a start turn is stored", () => {
    const carried = { retailDemandTransitionStartTurn: 514, retailDemandTransitionTurns: 192 };
    expect(retailCapacityExpansionPaused(carried, 1)).toBe(true);
    expect(retailCapacityExpansionPaused(carried, 705)).toBe(true);
    expect(retailCapacityExpansionPaused(carried, 706)).toBe(false);
  });
});

describe("statehood admission guard", () => {
  it("evaluates the first year when no year is stored", () => {
    expect(shouldEvaluateStatehood(1953, undefined)).toBe(true);
    expect(shouldEvaluateStatehood(1991, undefined)).toBe(true);
  });

  it("skips every year up to a stored one, which on an earlier era is most of the game", () => {
    expect(shouldEvaluateStatehood(1953, 1979)).toBe(false);
    expect(shouldEvaluateStatehood(1979, 1979)).toBe(false);
    expect(shouldEvaluateStatehood(1980, 1979)).toBe(true);
  });
});

describe("euro state", () => {
  it("has no members and no currencies when nothing is stored", () => {
    expect(euroConsentedCountries({})).toEqual([]);
    expect(euroMemberCurrencies({})).toEqual([]);
  });

  it("carries a stored accession into the new world", () => {
    expect(euroConsentedCountries({ euroAdoptedCountries: ["DE", "IE"] })).toEqual(["DE", "IE"]);
    expect(euroMemberCurrencies({ eurozoneEnabled: true }).length).toBeGreaterThan(0);
  });
});

describe("cabinet seats opened by legislation", () => {
  const seatsFor = async (doc: Record<string, unknown>) => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue(doc);
    return [...(await getManuallyEnabledSeats(db as unknown as Db))];
  };

  it("is empty when nothing is stored", async () => {
    expect(await seatsFor({ _id: "current" })).toEqual([]);
  });

  it("opens a seat the new world never legislated when one is stored", async () => {
    expect(await seatsFor({ manuallyEnabledSeats: ["secretary_of_education"] })).toEqual([
      "secretary_of_education",
    ]);
  });
});

describe("European Community", () => {
  const settlement = {
    stage: "community",
    source: "legacy-settlement",
    establishedTurn: 1262,
    ratifications: {},
  };

  async function communityRoster(stored: Record<string, unknown> | undefined) {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      currentTurn: 1,
      ...(stored ? { europeanIntegration: stored } : {}),
    });
    const state = await ensureEuropeanIntegrationState(db as unknown as Db, "1991-default", false);
    return {
      state,
      roster: resolveSeedRoster(
        withEuropeanInstitution(INTERNATIONAL_ORGANIZATIONS.EU, state),
        "1991-default"
      ),
    };
  }

  it("is derived from the new era when nothing is stored", async () => {
    const { state, roster } = await communityRoster(undefined);
    expect(state).toMatchObject({ stage: "community", source: "historical-seed" });
    expect(roster).toHaveLength(12);
    expect(roster).toContain("UK");
  });

  it("seats nobody when a settlement from another world is stored", async () => {
    // `ensureEuropeanIntegrationState` returns whatever is stored, so a settlement
    // reached by a world that was already past its founding wins over the era.
    const { state, roster } = await communityRoster(settlement);
    expect(state).toBe(settlement);
    expect(roster).toEqual([]);
  });
});
