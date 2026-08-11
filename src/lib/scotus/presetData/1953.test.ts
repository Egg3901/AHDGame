import { describe, expect, it } from "vitest";
import { SCOTUS_1953_SEED } from "./1953";
import { yearToTurn } from "@/lib/scotus/turnConversion";
import { decideCaseOutcome } from "@/lib/scotus/divergence";

const STARTING_YEAR = 1953;

/** Ladder baked by `projectLawToLegislationType` (politicalLegislation/project.ts). */
const LADDER_EFFECT_DIRECTION: Record<string, -1 | 0 | 1> = {
  l0: -1,
  l1: -1,
  l2: 0,
  l3: 1,
  l4: 1,
};

describe("SCOTUS_1953_SEED.docket — case catalogue", () => {
  const docket = SCOTUS_1953_SEED.docket;

  it("has 28 cases (21 original + 7 non-race/equality additions)", () => {
    expect(docket).toHaveLength(28);
  });

  it("every caseKey is unique", () => {
    const keys = docket.map((c) => c.caseKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every case has historicalSummary authored (drives the news/wire post for every decided case)", () => {
    for (const c of docket) {
      expect(c.historicalSummary, `${c.caseKey} missing historicalSummary`).toBeTruthy();
    }
  });

  it("every case EXCEPT the historicalOutcomeLocked race/equality cases has alternateSummary authored", () => {
    for (const c of docket) {
      if (c.historicalOutcomeLocked) continue;
      expect(c.alternateSummary, `${c.caseKey} missing alternateSummary`).toBeTruthy();
    }
  });

  describe("race/equal-protection cases are hardcoded to their historical outcome", () => {
    const locked = [
      "brown-v-board-1954",
      "loving-v-virginia-1967",
      "griggs-v-duke-power-1971",
      "bakke-v-regents-1978",
      "shelby-county-v-holder-2013",
    ];

    it.each(locked)(
      "%s is historicalOutcomeLocked with no effect and no alternateSummary",
      (caseKey) => {
        const c = docket.find((d) => d.caseKey === caseKey);
        expect(c, `${caseKey} not found in catalogue`).toBeDefined();
        expect(c!.historicalOutcomeLocked).toBe(true);
        expect(c!.effect).toBeUndefined();
        expect(c!.alternateSummary).toBeUndefined();
      }
    );

    it("no other case in the catalogue is historicalOutcomeLocked", () => {
      const lockedSet = new Set(locked);
      for (const c of docket) {
        if (lockedSet.has(c.caseKey)) continue;
        expect(c.historicalOutcomeLocked, `${c.caseKey} unexpectedly locked`).toBeFalsy();
      }
    });

    it("an adversarial Court composition still affirms Brown v. Board historically", () => {
      const brown = docket.find((d) => d.caseKey === "brown-v-board-1954")!;
      // A unanimously conservative bench — the opposite of the real 1953-54
      // Court's eventual unanimous liberal vote to desegregate.
      const adversarialCourt = [
        { economicLean: 4, socialLean: 4 },
        { economicLean: 3, socialLean: 3 },
        { economicLean: 5, socialLean: 5 },
      ];
      const decision = decideCaseOutcome(
        adversarialCourt,
        brown.axis,
        brown.historicalMajorityDirection,
        {
          historicalOutcomeLocked: brown.historicalOutcomeLocked === true,
        }
      );
      // Composition genuinely disagrees (majoritySide is honestly reported)...
      expect(decision.majoritySide).toBe(1);
      // ...but the ruling is pinned to history regardless.
      expect(decision.outcome).toBe("affirmed");
    });
  });

  it("a case's authored effect's policyOptionId ladder position matches its effectDirection", () => {
    for (const c of docket) {
      if (!c.effect) continue;
      const expected = LADDER_EFFECT_DIRECTION[c.effect.policyOptionId];
      expect(
        expected,
        `${c.caseKey} uses unrecognized policyOptionId "${c.effect.policyOptionId}"`
      ).toBeDefined();
      expect(c.effect.effectDirection, `${c.caseKey} effectDirection/ladder mismatch`).toBe(
        expected
      );
    }
  });

  it("no case authors both an effect and a demographicSignal", () => {
    for (const c of docket) {
      expect(Boolean(c.effect) && Boolean(c.demographicSignal)).toBe(false);
    }
  });

  describe("the reapportionment trio (Baker/Reynolds/Wesberry) — demographicSignal, no effect", () => {
    const trio = ["baker-v-carr-1962", "reynolds-v-sims-1964", "wesberry-v-sanders-1964"];

    it.each(trio)("%s has a demographicSignal and no policy effect", (caseKey) => {
      const c = docket.find((d) => d.caseKey === caseKey);
      expect(c, `${caseKey} not found in catalogue`).toBeDefined();
      expect(c!.effect).toBeUndefined();
      expect(c!.demographicSignal?.affirmedSignal).toBeTruthy();
      expect(c!.demographicSignal?.divergedSignal).toBeTruthy();
      expect(c!.demographicSignal?.affirmedSignal).not.toBe(c!.demographicSignal?.divergedSignal);
    });
  });

  describe("the four newly-added policy-mapped cases (Watkins/Engel/NYT Sullivan/Griswold)", () => {
    const mapped = [
      "watkins-v-us-1957",
      "engel-v-vitale-1962",
      "nyt-v-sullivan-1964",
      "griswold-v-connecticut-1965",
    ];

    it.each(mapped)("%s has an authored effect and no demographicSignal", (caseKey) => {
      const c = docket.find((d) => d.caseKey === caseKey);
      expect(c, `${caseKey} not found in catalogue`).toBeDefined();
      expect(c!.effect).toBeDefined();
      expect(c!.demographicSignal).toBeUndefined();
    });
  });

  it("all 7 newly-added cases fall inside the 1953-1973 window and are not about race/equal-protection doctrine", () => {
    const added = [
      "watkins-v-us-1957",
      "baker-v-carr-1962",
      "engel-v-vitale-1962",
      "reynolds-v-sims-1964",
      "wesberry-v-sanders-1964",
      "nyt-v-sullivan-1964",
      "griswold-v-connecticut-1965",
    ];
    for (const caseKey of added) {
      const c = docket.find((d) => d.caseKey === caseKey);
      expect(c, `${caseKey} not found`).toBeDefined();
      expect(c!.decisionYear).toBeGreaterThanOrEqual(1953);
      expect(c!.decisionYear).toBeLessThanOrEqual(1973);
    }
  });

  it("Youngstown Sheet & Tube and Roth v. United States were deliberately NOT added", () => {
    const keys = docket.map((c) => c.caseKey);
    expect(keys.some((k) => k.includes("youngstown"))).toBe(false);
    expect(keys.some((k) => k.includes("roth"))).toBe(false);
  });

  it("cases surface only once the game turn reaches their authored decisionYear (era-gating)", () => {
    // Mirrors scotusDocketTurn.ts's own due-case filter: `currentTurn >= yearToTurn(decisionYear, startingYear)`.
    const isDue = (decisionYear: number, currentTurn: number) =>
      currentTurn >= yearToTurn(decisionYear, STARTING_YEAR);

    const baker = docket.find((c) => c.caseKey === "baker-v-carr-1962")!;
    const bakerTurn = yearToTurn(baker.decisionYear, STARTING_YEAR);

    expect(isDue(baker.decisionYear, bakerTurn - 1)).toBe(false); // one turn early: not yet due
    expect(isDue(baker.decisionYear, bakerTurn)).toBe(true); // its own turn: due
    expect(isDue(baker.decisionYear, bakerTurn + 100)).toBe(true); // any later turn: still due

    // Cross-case ordering: Baker (1962) must resolve to an earlier turn than
    // Reynolds/Wesberry (1964), matching real chronology.
    const reynolds = docket.find((c) => c.caseKey === "reynolds-v-sims-1964")!;
    expect(yearToTurn(baker.decisionYear, STARTING_YEAR)).toBeLessThan(
      yearToTurn(reynolds.decisionYear, STARTING_YEAR)
    );
  });

  it("the branch that fires depends on the sitting Court's composition, not a coin flip (Reynolds v. Sims)", () => {
    const reynolds = docket.find((c) => c.caseKey === "reynolds-v-sims-1964")!;

    // A Court with a liberal (-1) social-axis majority affirms the real history.
    const liberalCourt = [
      { economicLean: 0, socialLean: -3 },
      { economicLean: 0, socialLean: -2 },
      { economicLean: 0, socialLean: 1 },
    ];
    const affirmDecision = decideCaseOutcome(
      liberalCourt,
      reynolds.axis,
      reynolds.historicalMajorityDirection
    );
    expect(affirmDecision.outcome).toBe("affirmed");

    // The identical case, with a conservative (+1) social-axis majority instead, diverges.
    const conservativeCourt = [
      { economicLean: 0, socialLean: 3 },
      { economicLean: 0, socialLean: 2 },
      { economicLean: 0, socialLean: -1 },
    ];
    const divergeDecision = decideCaseOutcome(
      conservativeCourt,
      reynolds.axis,
      reynolds.historicalMajorityDirection
    );
    expect(divergeDecision.outcome).toBe("diverged");
  });
});
