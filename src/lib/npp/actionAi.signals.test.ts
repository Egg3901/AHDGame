import { describe, it, expect } from "vitest";
import {
  calculateActionPriorities,
  decideNppAction,
  actionTemperature,
  NPP_MAX_DONOR_BASE_LEVEL,
  type NppActionContext,
} from "./actionAi";
import { NEUTRAL_SIGNALS, type NppContextSignals } from "./actionSignals";
import { careerArchetypeModifiersContinuous } from "@/lib/nppAutonomy/v3/careerArchetype";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import type { NPPPersonality } from "@/lib/db/types/npp";

const personality = (ambition: number, stubbornness: number, loyalty = 50): NPPPersonality => ({
  ambition,
  stubbornness,
  loyalty,
});

const ctx = (overrides: Partial<NppActionContext> = {}): NppActionContext => ({
  hasOffice: false,
  personality: personality(50, 50),
  funds: 1_000_000,
  actionPoints: 100,
  donorBaseLevel: 0,
  favorability: 0,
  politicalInfluence: 0,
  ...overrides,
});

const signals = (overrides: Partial<NppContextSignals> = {}): NppContextSignals => ({
  ...NEUTRAL_SIGNALS,
  ...overrides,
});

describe("actionAi context signals", () => {
  describe("compatibility contract (v0-v2 path unchanged)", () => {
    // The whole staged plan rests on this: adding signals must not perturb the
    // pre-v3 decision path in any way. Table-driven over the dimensions that
    // actually feed the base priority table.
    const matrix: NppActionContext[] = [];
    for (const hasOffice of [true, false]) {
      for (const loyalty of [10, 50, 90]) {
        for (const ambition of [10, 50, 90]) {
          for (const donorBaseLevel of [0, 3, NPP_MAX_DONOR_BASE_LEVEL]) {
            matrix.push(
              ctx({
                hasOffice,
                personality: { loyalty, ambition, stubbornness: 50 },
                donorBaseLevel,
              })
            );
          }
        }
      }
    }

    it("reproduces the documented base priorities with no modifiers and no signals", () => {
      for (const context of matrix) {
        const expected = context.hasOffice
          ? { campaign: 40, advertise: 30, buildDonorBase: 20, partyDonation: 10 }
          : { buildDonorBase: 50, campaign: 25, advertise: 15, partyDonation: 10 };

        if (context.personality.loyalty > 70) expected.partyDonation += 20;
        if (context.personality.loyalty < 30) expected.partyDonation -= 15;
        if (context.personality.ambition > 70) {
          expected.buildDonorBase += 10;
          expected.campaign += 10;
        }
        for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
          expected[key] = Math.max(0, expected[key]);
        }

        expect(calculateActionPriorities(context)).toEqual(expected);
      }
    });

    it("consumes the same number of rng() calls with and without signals", () => {
      // Stream alignment, not just output equality: if the signal path drew an
      // extra random number, enabling the smarter brain would desynchronise every
      // downstream seeded decision in the same turn.
      const countCalls = (opts?: { signals: NppContextSignals }) => {
        let calls = 0;
        const rng = () => {
          calls++;
          return 0.5;
        };
        decideNppAction(
          ctx({ actionPoints: 4, funds: 20_000 }),
          rng,
          careerArchetypeModifiersContinuous(personality(50, 50)),
          opts
        );
        return calls;
      };

      expect(countCalls({ signals: signals() })).toBe(countCalls());
    });
  });

  describe("marginal-utility damping", () => {
    it("drops campaign entirely at saturated influence", () => {
      const priorities = calculateActionPriorities(
        ctx({ hasOffice: true, politicalInfluence: 100 }),
        careerArchetypeModifiersContinuous(personality(50, 50)),
        signals()
      );
      expect(priorities.campaign).toBe(0);
    });

    it("never returns campaign as a decision at saturated influence", () => {
      const rng = makeSeededRng("saturation-test");
      for (let i = 0; i < 200; i++) {
        const decision = decideNppAction(
          ctx({ hasOffice: true, politicalInfluence: 100 }),
          rng,
          careerArchetypeModifiersContinuous(personality(50, 50)),
          { signals: signals() }
        );
        expect(decision.action).not.toBe("campaign");
      }
    });

    it("drops advertise entirely at saturated favorability", () => {
      const priorities = calculateActionPriorities(
        ctx({ hasOffice: true, favorability: 100 }),
        careerArchetypeModifiersContinuous(personality(50, 50)),
        signals()
      );
      expect(priorities.advertise).toBe(0);
    });

    it("weights advertise lower as favorability climbs", () => {
      const at = (favorability: number) =>
        calculateActionPriorities(
          ctx({ hasOffice: true, favorability }),
          careerArchetypeModifiersContinuous(personality(50, 50)),
          signals()
        ).advertise;

      expect(at(0)).toBeGreaterThan(at(80));
      expect(at(80)).toBeGreaterThan(at(95));
    });
  });

  describe("election proximity", () => {
    it("raises campaign weight monotonically as the election approaches", () => {
      const at = (turnsToElection: number) =>
        calculateActionPriorities(
          ctx({ hasOffice: true }),
          careerArchetypeModifiersContinuous(personality(50, 50)),
          signals({ turnsToElection })
        ).campaign;

      expect(at(8)).toBeGreaterThan(at(48));
      expect(at(48)).toBeGreaterThan(at(200));
    });

    it("shifts weight toward war-chest building away from an election", () => {
      const near = calculateActionPriorities(
        ctx(),
        careerArchetypeModifiersContinuous(personality(50, 50)),
        signals({ turnsToElection: 4 })
      );
      const far = calculateActionPriorities(
        ctx(),
        careerArchetypeModifiersContinuous(personality(50, 50)),
        signals({ turnsToElection: 500 })
      );
      expect(far.buildDonorBase).toBeGreaterThan(near.buildDonorBase);
    });
  });

  describe("contest and party-finance signals", () => {
    it("campaigns harder when facing a challenger than when unopposed", () => {
      const mods = careerArchetypeModifiersContinuous(personality(50, 50));
      const contested = calculateActionPriorities(
        ctx({ hasOffice: true }),
        mods,
        signals({ isCandidate: true, facesChallenger: true })
      );
      const walkover = calculateActionPriorities(
        ctx({ hasOffice: true }),
        mods,
        signals({ isCandidate: true, facesChallenger: false })
      );
      expect(contested.campaign).toBeGreaterThan(walkover.campaign);
    });

    it("donates more when the party is poor relative to its rivals", () => {
      const mods = careerArchetypeModifiersContinuous(personality(50, 50));
      const poor = calculateActionPriorities(
        ctx({ hasOffice: true }),
        mods,
        signals({ partyTreasuryRatio: 0.2 })
      );
      const flush = calculateActionPriorities(
        ctx({ hasOffice: true }),
        mods,
        signals({ partyTreasuryRatio: 3 })
      );
      expect(poor.partyDonation).toBeGreaterThan(flush.partyDonation);
    });

    it("never leaves an NPP with no affordable action at all", () => {
      // Pathological combination: maxed out on both metrics, flush party, no race.
      const priorities = calculateActionPriorities(
        ctx({
          hasOffice: true,
          favorability: 100,
          politicalInfluence: 100,
          donorBaseLevel: NPP_MAX_DONOR_BASE_LEVEL,
          personality: personality(50, 50, 10),
        }),
        careerArchetypeModifiersContinuous(personality(50, 50, 10)),
        signals({ partyTreasuryRatio: 10 })
      );
      const total = Object.values(priorities).reduce((s, v) => s + v, 0);
      expect(total).toBeGreaterThan(0);
    });
  });

  describe("temperature", () => {
    it("makes stubborn NPPs more decisive than flexible ones", () => {
      expect(actionTemperature(personality(50, 100))).toBeLessThan(
        actionTemperature(personality(50, 0))
      );
    });

    it("stays inside its clamp under an extreme idiosyncrasy multiplier", () => {
      expect(actionTemperature(personality(50, 0), 99)).toBeLessThanOrEqual(2.0);
      expect(actionTemperature(personality(50, 100), 0.001)).toBeGreaterThanOrEqual(0.5);
    });

    it("produces a less varied action mix at low temperature than at high", () => {
      const entropyFor = (stubbornness: number) => {
        const counts = new Map<string, number>();
        const rng = makeSeededRng(`entropy:${stubbornness}`);
        for (let i = 0; i < 4000; i++) {
          const decision = decideNppAction(
            ctx({ hasOffice: true, personality: personality(50, stubbornness) }),
            rng,
            careerArchetypeModifiersContinuous(personality(50, stubbornness)),
            { signals: signals() }
          );
          counts.set(decision.action, (counts.get(decision.action) ?? 0) + 1);
        }
        const total = [...counts.values()].reduce((s, c) => s + c, 0);
        return -[...counts.values()].reduce((h, c) => {
          const p = c / total;
          return h + p * Math.log2(p);
        }, 0);
      };

      expect(entropyFor(100)).toBeLessThan(entropyFor(0));
    });
  });

  describe("commitment", () => {
    it("raises the chance of repeating the previous action", () => {
      const share = (lastAction?: "advertise") => {
        let advertised = 0;
        const rng = makeSeededRng("commitment");
        for (let i = 0; i < 2000; i++) {
          const decision = decideNppAction(
            ctx({ hasOffice: true }),
            rng,
            careerArchetypeModifiersContinuous(personality(50, 50)),
            { signals: signals(), lastAction }
          );
          if (decision.action === "advertise") advertised++;
        }
        return advertised;
      };

      expect(share("advertise")).toBeGreaterThan(share());
    });
  });
});
