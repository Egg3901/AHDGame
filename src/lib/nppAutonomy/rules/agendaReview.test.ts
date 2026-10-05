import { describe, expect, it } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { nppBehaviorPolicy } from "@/lib/singleplayerDifficulty/rules/behavior";
import {
  agendaReviewSnapshot,
  annualPerformanceReviewDue,
  shouldRecomputeGoverningAgenda,
  MATERIAL_DOMAIN_URGENCY_DELTA,
  MATERIAL_INFLATION_DELTA_PERCENT_POINTS,
} from "./agendaReview";
import type { CrisisAgendaIntake } from "./crisisAgendaSignals";
import type { GoverningAgenda } from "../governingAgenda";

const calm: CrisisAgendaIntake = {
  signals: {},
  latestStartTurn: 0,
  effectFingerprintByDomain: {},
};
const neutral = {
  weakDomains: { healthcare: 0.2 },
  strongDomains: {},
  inflationRate: 4,
};
const baselineAgenda: GoverningAgenda = {
  items: [],
  archetype: "reformer",
  computedTurn: 100,
  reviewSnapshot: agendaReviewSnapshot(neutral, calm),
  performanceReviewedTurn: 100,
};

function shouldRecompute(
  conditions = neutral,
  crisis = calm,
  agenda: GoverningAgenda | null | undefined = baselineAgenda,
  currentTurn = 101
) {
  return shouldRecomputeGoverningAgenda({
    agenda,
    currentTurn,
    intervalTurns: TURNS_PER_YEAR,
    conditions,
    crisis,
  });
}

describe("NPP agenda game-calendar review policy", () => {
  it("uses one game year for routine agenda and accountability review periods", () => {
    expect(TURNS_PER_YEAR).toBe(48);
    expect(TURNS_PER_YEAR / TURNS_PER_YEAR).toBe(1);
  });

  it("recomputes at the annual boundary but not before it", () => {
    expect(shouldRecompute(neutral, calm, baselineAgenda, 100 + TURNS_PER_YEAR - 1)).toBe(false);
    expect(shouldRecompute(neutral, calm, baselineAgenda, 100 + TURNS_PER_YEAR)).toBe(true);
  });

  it("keeps accountability annual across multiple early agenda replans", () => {
    const earlyReplan = { ...baselineAgenda, computedTurn: 100 + 6 };
    expect(annualPerformanceReviewDue(earlyReplan, 100 + 6, TURNS_PER_YEAR)).toBe(false);
    expect(annualPerformanceReviewDue(earlyReplan, 100 + TURNS_PER_YEAR - 1, TURNS_PER_YEAR)).toBe(
      false
    );
    expect(annualPerformanceReviewDue(earlyReplan, 100 + TURNS_PER_YEAR, TURNS_PER_YEAR)).toBe(
      true
    );
    const reviewed = {
      ...earlyReplan,
      performanceReviewedTurn: 100 + TURNS_PER_YEAR,
    };
    expect(annualPerformanceReviewDue(reviewed, 100 + TURNS_PER_YEAR + 6, TURNS_PER_YEAR)).toBe(
      false
    );
  });

  it("recomputes on a material normalized urgency shift, not smaller noise", () => {
    const threshold = MATERIAL_DOMAIN_URGENCY_DELTA;
    expect(
      shouldRecompute({
        ...neutral,
        weakDomains: { healthcare: 0.2 + threshold - 0.001 },
      })
    ).toBe(false);
    expect(
      shouldRecompute({
        ...neutral,
        weakDomains: { healthcare: 0.2 + threshold },
      })
    ).toBe(true);
    expect(
      shouldRecompute({ ...neutral, weakDomains: { healthcare: 0.2 + threshold } }, calm)
    ).toBe(true);
  });

  it("recomputes on material inflation change and ignores sub-threshold drift", () => {
    const threshold = MATERIAL_INFLATION_DELTA_PERCENT_POINTS;
    expect(shouldRecompute({ ...neutral, inflationRate: 4 + threshold - 0.01 })).toBe(false);
    expect(shouldRecompute({ ...neutral, inflationRate: 4 + threshold })).toBe(true);
  });

  it("recomputes when a crisis domain is added, removed, escalated, or its effects change", () => {
    expect(
      shouldRecompute(neutral, {
        signals: { healthcare: 1 },
        latestStartTurn: 0,
        effectFingerprintByDomain: {
          healthcare: '["",0,"tick","healthcare","access",-0.2]',
        },
      })
    ).toBe(true);
    const active: CrisisAgendaIntake = {
      signals: { healthcare: 1 },
      latestStartTurn: 0,
      effectFingerprintByDomain: {
        healthcare: '["",0,"tick","healthcare","access",-0.2]',
      },
    };
    const activeAgenda = {
      ...baselineAgenda,
      reviewSnapshot: agendaReviewSnapshot(neutral, active),
    };
    expect(shouldRecompute(neutral, calm, activeAgenda)).toBe(true);
    expect(
      shouldRecompute(
        neutral,
        {
          ...active,
          effectFingerprintByDomain: {
            healthcare: '["",0,"tick","healthcare","access",-0.35]',
          },
        },
        activeAgenda
      )
    ).toBe(true);
  });

  it("recomputes once for a legacy agenda without a comparison snapshot", () => {
    expect(
      shouldRecompute(neutral, calm, {
        ...baselineAgenda,
        reviewSnapshot: undefined,
      })
    ).toBe(true);
  });

  it("scales goal holds as provisional one, two, and three game-year commitments", () => {
    expect(nppBehaviorPolicy("easy").goalHoldTurns).toBe(TURNS_PER_YEAR);
    expect(nppBehaviorPolicy("normal").goalHoldTurns).toBe(2 * TURNS_PER_YEAR);
    expect(nppBehaviorPolicy("hard").goalHoldTurns).toBe(3 * TURNS_PER_YEAR);
  });
});
