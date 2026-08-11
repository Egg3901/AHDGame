import { describe, expect, it } from "vitest";
import { deriveCountryBoard } from "./deriveFamilies";

const EMPTY = { countryId: "JP", legacy: {}, macro: {} };

describe("deriveCountryBoard", () => {
  it("derives a tier-1 family from its ADAPTER_TIER1 legacy source", () => {
    const board = deriveCountryBoard({
      ...EMPTY,
      legacy: { "education.literacyRate": 99 },
    });
    const fam = board.values["education.universalSchooling"];
    expect(fam).toBeDefined();
    expect(fam.tier).toBe(1);
    expect(fam.sources).toContain("education.literacyRate");
    expect(fam.value).toBeGreaterThan(50);
  });

  it("averages a family that has several legacy sources", () => {
    // education.attainment draws from highSchoolGradRate + gcseAttainment +
    // universityEnrollment; a single strong source must not read as the whole.
    const one = deriveCountryBoard({
      ...EMPTY,
      legacy: { "education.highSchoolGradRate": 95 },
    }).values["education.attainment"];
    const both = deriveCountryBoard({
      ...EMPTY,
      legacy: { "education.highSchoolGradRate": 95, "education.universityEnrollment": 20 },
    }).values["education.attainment"];
    expect(one.sources).toHaveLength(1);
    expect(both.sources).toHaveLength(2);
    expect(both.value).toBeLessThan(one.value);
  });

  it("derives the economy block from macroMetrics (tier 2)", () => {
    const board = deriveCountryBoard({
      ...EMPTY,
      macro: { "economic.unemploymentRate": 3, "economic.medianIncome": 40_000 },
    });
    expect(board.values["economy.stability"]?.tier).toBe(2);
    expect(board.values["economy.householdIncome"]?.tier).toBe(2);
  });

  it("falls back to the legacy CATEGORY score for tier-3 families", () => {
    const board = deriveCountryBoard({
      ...EMPTY,
      legacy: { "publicSafety.crimeRate": 200, "publicSafety.recidivismRate": 20 },
    });
    const courts = board.values["order.courts"];
    expect(courts?.tier).toBe(3);
    expect(courts?.value).toBeGreaterThan(0);
  });

  it("leaves tier 3 undifferentiated when no lean is supplied", () => {
    // The pre-lean behaviour, kept as the explicit fallback for any era whose
    // party roster cannot produce a lean.
    const board = deriveCountryBoard({
      ...EMPTY,
      legacy: { "publicSafety.crimeRate": 200, "publicSafety.recidivismRate": 20 },
    });
    expect(board.values["order.dueProcess"].value).toBe(board.values["order.deterrence"].value);
    expect(board.values["order.dueProcess"].sources).not.toContain("countryLean");
  });

  it("separates opposed tier-3 families once a lean is supplied", () => {
    // The defect tier 3 had: dueProcess (-5) and deterrence (+5) scored
    // identically for every country. A socially authoritarian regime must not
    // read as investing equally in both.
    // A mid-board fixture on purpose: the low-crime seed used above scores 95,
    // where the upper clamp truncates the tilt and symmetry is untestable.
    const legacy = { "publicSafety.crimeRate": 4000, "publicSafety.recidivismRate": 55 };
    const flat = deriveCountryBoard({ ...EMPTY, legacy });
    const tilted = deriveCountryBoard({
      ...EMPTY,
      legacy,
      lean: { economic: -4, social: 3 },
    });
    const due = tilted.values["order.dueProcess"];
    const deter = tilted.values["order.deterrence"];
    expect(deter.value).toBeGreaterThan(due.value);
    expect(deter.tier).toBe(3);
    expect(deter.sources).toContain("countryLean");
    // And the tilt is symmetric about the untilted category average.
    const base = flat.values["order.courts"].value;
    expect(deter.value - base).toBeCloseTo(base - due.value, 6);
  });

  it("tilts a category only on its own axis", () => {
    // An economically hard-left but socially centrist country must move the
    // education block and leave the order block untouched.
    const legacy = {
      "publicSafety.crimeRate": 200,
      "education.literacyRate": 90,
      "education.studentTeacherRatio": 18,
    };
    const flat = deriveCountryBoard({ ...EMPTY, legacy });
    const tilted = deriveCountryBoard({ ...EMPTY, legacy, lean: { economic: -5, social: 0 } });
    expect(tilted.values["education.choice"].value).toBeLessThan(
      flat.values["education.choice"].value
    );
    expect(tilted.values["order.deterrence"].value).toBe(flat.values["order.deterrence"].value);
  });

  it("never DERIVES a defense family from legacy data — only authors it", () => {
    // The invariant: no tier 1-3 path reaches defense.*, because legacy
    // stateMetrics has no defense layer to invert. A country in the authored
    // table gets tier 4; one outside it gets nothing. "XX" is deliberately not
    // a real country, so it exercises the un-authored branch.
    const RICH_LEGACY = {
      "publicSafety.crimeRate": 200,
      "education.literacyRate": 95,
      "healthcare.lifeExpectancy": 80,
      "infrastructure.roadCondition": 70,
      "environment.airQuality": 30,
      "social.socialCohesion": 60,
      "social.socialMobility": 55,
      "governance.corruptionIndex": 25,
      "governance.budgetBalance": -2,
      "governance.debtToGdp": 60,
      "mediaInformation.pressFreedom": 75,
    };
    const RICH_MACRO = {
      "economic.medianIncome": 40_000,
      "economic.unemploymentRate": 4,
      "economic.productivityGrowth": 2,
      "economic.smallBusinessFormation": 55,
      "economic.laborParticipation": 63,
      "population.birthRate": 55,
    };
    // "XX" is deliberately not a real country, so it exercises the branch where
    // no authored board exists: defense — and ONLY defense — stays unresolved.
    const unknown = deriveCountryBoard({
      countryId: "XX",
      legacy: RICH_LEGACY,
      macro: RICH_MACRO,
    });
    for (const f of unknown.unauthored) expect(f.startsWith("defense."), f).toBe(true);
    expect(unknown.unauthored).toHaveLength(7);

    // An authored country resolves the same families at tier 4 instead.
    const authored = deriveCountryBoard({
      countryId: "JP",
      legacy: RICH_LEGACY,
      macro: RICH_MACRO,
    });
    expect(authored.unauthored.some((f) => f.startsWith("defense."))).toBe(false);
    expect(authored.values["defense.armedForces"]?.tier).toBe(4);
  });

  it("fills every non-defense family a rich seed can support", () => {
    const rich = deriveCountryBoard({
      ...EMPTY,
      legacy: {
        "publicSafety.crimeRate": 200,
        "education.literacyRate": 95,
        "healthcare.lifeExpectancy": 80,
        "infrastructure.roadCondition": 70,
        "environment.airQuality": 30,
        "social.socialCohesion": 60,
        "governance.corruptionIndex": 25,
        "governance.budgetBalance": -2,
        "governance.debtToGdp": 60,
        "mediaInformation.pressFreedom": 75,
      },
      macro: {
        "economic.medianIncome": 40_000,
        "economic.unemploymentRate": 4,
        "economic.productivityGrowth": 2,
        "economic.smallBusinessFormation": 55,
        "economic.laborParticipation": 63,
        "population.birthRate": 55,
      },
    });
    // JP is in the authored defense table, so a rich seed leaves nothing at all
    // unresolved — every family lands on one of the four tiers.
    expect(rich.unauthored).toEqual([]);
    expect(Object.keys(rich.values)).toHaveLength(63);
  });

  it("reports every family it could not derive rather than silently filling it", () => {
    // A thin seed must NOT quietly produce neutral values — the unauthored list
    // is the worklist, so under-reporting it would ship characterless boards.
    const thin = deriveCountryBoard({ ...EMPTY, legacy: { "publicSafety.crimeRate": 200 } });
    expect(thin.unauthored.length).toBeGreaterThan(7);
    for (const id of thin.unauthored) expect(thin.values[id]).toBeUndefined();
  });

  it("never emits a value outside 0-100 or a NaN", () => {
    const board = deriveCountryBoard({
      ...EMPTY,
      legacy: { "publicSafety.crimeRate": 1e9, "education.literacyRate": -50 },
    });
    for (const [id, fam] of Object.entries(board.values)) {
      expect(Number.isFinite(fam.value), id).toBe(true);
      expect(fam.value, id).toBeGreaterThanOrEqual(0);
      expect(fam.value, id).toBeLessThanOrEqual(100);
    }
  });
});
