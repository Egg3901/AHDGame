import { describe, it, expect } from "vitest";
import {
  commitGoverningGoals,
  committedGoalDomains,
  goalAttainment,
  goalFeedback,
  ministerialCommitmentHolds,
  reviewGoverningGoals,
  GOAL_SLOT_CAP,
  type GoverningGoalRecord,
} from "./governingGoals";
import { nppBehaviorPolicy } from "@/lib/singleplayerDifficulty/rules/behavior";
import { GOVERNING_ARCHETYPE_CLAMP } from "../../governingArchetype";
import type { GoverningAgendaItem } from "../../governingAgenda";

const normal = nppBehaviorPolicy("normal");
const easy = nppBehaviorPolicy("easy");
const hard = nppBehaviorPolicy("hard");

function goal(overrides: Partial<GoverningGoalRecord> = {}): GoverningGoalRecord {
  return {
    domain: "healthcare",
    direction: "raise",
    target: 65,
    priority: 1,
    status: "active",
    openedTurn: 0,
    reviewedTurn: 0,
    openingAttainment: 0.5,
    attainment: 0.5,
    strikes: 0,
    ...overrides,
  };
}

function item(overrides: Partial<GoverningAgendaItem> = {}): GoverningAgendaItem {
  return { domain: "healthcare", target: 65, direction: "raise", priority: 1, ...overrides };
}

describe("goalAttainment", () => {
  it("scores a raise goal as progress toward its target", () => {
    expect(
      goalAttainment({ direction: "raise", target: 60 }, { healthcare: 30 }, "healthcare")
    ).toBe(0.5);
  });

  it("clamps a met goal to 1 and never above", () => {
    expect(
      goalAttainment({ direction: "raise", target: 60 }, { healthcare: 200 }, "healthcare")
    ).toBe(1);
  });

  it("mirrors the maths for a lower goal", () => {
    expect(goalAttainment({ direction: "lower", target: 45 }, { fiscal: 90 }, "fiscal")).toBe(0.5);
    expect(goalAttainment({ direction: "lower", target: 45 }, { fiscal: 40 }, "fiscal")).toBe(1);
  });

  it("returns null for unmeasurable health rather than scoring zero", () => {
    expect(goalAttainment({ direction: "raise", target: 60 }, {}, "healthcare")).toBeNull();
    expect(
      goalAttainment({ direction: "raise", target: 60 }, { healthcare: Number.NaN }, "healthcare")
    ).toBeNull();
  });
});

describe("reviewGoverningGoals", () => {
  it("marks a goal achieved when its domain reaches target, and clears strikes", () => {
    const review = reviewGoverningGoals({
      goals: [goal({ strikes: 2 })],
      domainHealth: { healthcare: 70 },
      policy: normal,
      currentTurn: 100,
    });
    expect(review.goals[0].status).toBe("achieved");
    expect(review.goals[0].strikes).toBe(0);
    expect(review.verdicts.achieved).toBe(1);
  });

  /** The anti-oscillation rule: inside the hold, the government stays on it. */
  it("holds an unmet goal inside its hold window", () => {
    const review = reviewGoverningGoals({
      goals: [goal({ openedTurn: 0 })],
      domainHealth: { healthcare: 10 },
      policy: normal,
      currentTurn: normal.goalHoldTurns - 1,
    });
    expect(review.goals[0].status).toBe("active");
    expect(review.verdicts.active).toBe(1);
  });

  it("revises a goal that made real progress once the hold expires", () => {
    const review = reviewGoverningGoals({
      goals: [goal({ openedTurn: 0, openingAttainment: 0.3 })],
      // 0.3 -> 0.6 attainment: progress, but not finished.
      domainHealth: { healthcare: 39 },
      policy: normal,
      currentTurn: normal.goalHoldTurns,
    });
    expect(review.goals[0].status).toBe("revised");
    expect(review.goals[0].strikes).toBe(0);
  });

  it("fails a goal that went nowhere across its hold, and counts the strike", () => {
    const review = reviewGoverningGoals({
      goals: [goal({ openedTurn: 0, openingAttainment: 0.5, strikes: 1 })],
      domainHealth: { healthcare: 32.5 }, // still 0.5 attainment
      policy: normal,
      currentTurn: normal.goalHoldTurns,
    });
    expect(review.goals[0].status).toBe("failed");
    expect(review.goals[0].strikes).toBe(2);
  });

  it("holds rather than fails a goal whose domain reports no health", () => {
    const review = reviewGoverningGoals({
      goals: [goal({ openedTurn: 0 })],
      domainHealth: {},
      policy: normal,
      currentTurn: 10_000,
    });
    expect(review.goals[0].status).toBe("active");
    expect(review.goals[0].strikes).toBe(0);
  });

  /**
   * Idempotence. A Tier-1 slot that is retried, or a phase replayed after a
   * crash, must not turn one failure into two strikes.
   */
  it("re-grading an already-terminal record is a no-op", () => {
    const failed = goal({ status: "failed", strikes: 1, openedTurn: 0 });
    const review = reviewGoverningGoals({
      goals: [failed],
      domainHealth: { healthcare: 5 },
      policy: normal,
      currentTurn: 10_000,
    });
    expect(review.goals[0]).toEqual(failed);
    expect(review.goals[0].strikes).toBe(1);
  });

  it("does not mutate the records it is given", () => {
    const original = goal({ openedTurn: 0 });
    const snapshot = { ...original };
    reviewGoverningGoals({
      goals: [original],
      domainHealth: { healthcare: 70 },
      policy: normal,
      currentTurn: 500,
    });
    expect(original).toEqual(snapshot);
  });

  it("holds longer on hard than on easy for the same world state", () => {
    const args = {
      goals: [goal({ openedTurn: 0, openingAttainment: 0.5 })],
      domainHealth: { healthcare: 32.5 },
      currentTurn: easy.goalHoldTurns,
    };
    expect(reviewGoverningGoals({ ...args, policy: easy }).goals[0].status).toBe("failed");
    expect(reviewGoverningGoals({ ...args, policy: hard }).goals[0].status).toBe("active");
  });
});

describe("goalFeedback", () => {
  it("deprioritises a repeatedly failed domain, further each time", () => {
    const once = goalFeedback([goal({ status: "failed", strikes: 1 })]).healthcare;
    const twice = goalFeedback([goal({ status: "failed", strikes: 2 })]).healthcare;
    expect(once).toBeLessThan(1);
    expect(twice).toBeLessThan(once);
  });

  it("stays inside its bounds however many strikes accumulate", () => {
    for (const strikes of [0, 1, 5, 50, 5_000]) {
      const weight = goalFeedback([goal({ status: "failed", strikes })]).healthcare;
      expect(weight).toBeGreaterThanOrEqual(0.5);
      expect(weight).toBeLessThanOrEqual(1.15);
    }
  });

  it("eases off a won domain and presses on one showing progress", () => {
    expect(goalFeedback([goal({ status: "achieved" })]).healthcare).toBeLessThan(1);
    expect(goalFeedback([goal({ status: "revised" })]).healthcare).toBeGreaterThan(1);
  });

  it("takes the worst multiplier when a domain somehow appears twice", () => {
    const feedback = goalFeedback([
      goal({ status: "revised" }),
      goal({ status: "failed", strikes: 2 }),
    ]);
    expect(feedback.healthcare).toBeLessThan(1);
  });
});

describe("commitGoverningGoals", () => {
  const health = { healthcare: 30, education: 30, poverty: 30, employment: 30, public_safety: 30 };

  it("opens goals from the fresh agenda when there are none", () => {
    const result = commitGoverningGoals({
      reviewed: [],
      agenda: [item({ domain: "healthcare" }), item({ domain: "education", priority: 0.5 })],
      domainHealth: health,
      policy: normal,
      currentTurn: 10,
    });
    expect(result.goals.map((g) => g.domain)).toEqual(["healthcare", "education"]);
    expect(result.goals.every((g) => g.status === "active")).toBe(true);
    expect(result.goals.every((g) => g.openedTurn === 10)).toBe(true);
  });

  it("never exceeds the difficulty's slots or the hard cap", () => {
    const agenda = ["a", "b", "c", "d", "e", "f", "g"].map((domain, index) =>
      item({ domain, priority: 1 - index * 0.1 })
    );
    for (const policy of [easy, normal, hard]) {
      const result = commitGoverningGoals({
        reviewed: [],
        agenda,
        domainHealth: {},
        policy,
        currentTurn: 10,
      });
      expect(result.goals.length).toBeLessThanOrEqual(policy.goalSlots);
      expect(result.goals.length).toBeLessThanOrEqual(GOAL_SLOT_CAP);
    }
  });

  /** The persistence claim, made observable: a held goal survives a recompute
   *  that no longer lists its domain, and reaches the executing agenda. */
  it("keeps a held goal that the fresh agenda dropped, and pins it onto the agenda", () => {
    const held = goal({ domain: "healthcare", openedTurn: 5 });
    const result = commitGoverningGoals({
      reviewed: [held],
      agenda: [item({ domain: "education" }), item({ domain: "poverty", priority: 0.4 })],
      domainHealth: health,
      policy: normal,
      currentTurn: 50,
    });
    expect(result.goals.map((g) => g.domain)).toContain("healthcare");
    expect(result.goals[0].openedTurn).toBe(5); // hold not restarted
    expect(result.agenda.map((i) => i.domain)).toContain("healthcare");
    expect(result.agenda[0].domain).toBe("healthcare");
  });

  it("drops achieved and failed goals so the set can never grow", () => {
    const result = commitGoverningGoals({
      reviewed: [
        goal({ domain: "healthcare", status: "achieved" }),
        goal({ domain: "education", status: "failed", strikes: 3 }),
      ],
      agenda: [item({ domain: "poverty" })],
      domainHealth: health,
      policy: normal,
      currentTurn: 50,
    });
    expect(result.goals.map((g) => g.domain)).toEqual(["poverty"]);
  });

  it("re-opens a revised goal in place with a fresh hold and its strikes intact", () => {
    const result = commitGoverningGoals({
      reviewed: [goal({ domain: "healthcare", status: "revised", strikes: 2, openedTurn: 5 })],
      agenda: [item({ domain: "healthcare" })],
      domainHealth: health,
      policy: normal,
      currentTurn: 60,
    });
    expect(result.goals[0]).toMatchObject({
      domain: "healthcare",
      status: "active",
      openedTurn: 60,
      strikes: 2,
    });
  });

  it("carries strikes forward when a failed domain is re-opened later", () => {
    const result = commitGoverningGoals({
      reviewed: [goal({ domain: "healthcare", status: "failed", strikes: 2 })],
      agenda: [item({ domain: "healthcare" })],
      domainHealth: health,
      policy: normal,
      currentTurn: 60,
    });
    expect(result.goals[0].strikes).toBe(2);
  });

  it("gives a crisis a slot ahead of any standing commitment", () => {
    const held = ["a", "b", "c"].map((domain) => goal({ domain, openedTurn: 5 }));
    const result = commitGoverningGoals({
      reviewed: held,
      agenda: [item({ domain: "disaster", crisis: true, priority: 1 })],
      domainHealth: {},
      policy: normal, // 3 slots, all currently held
      currentTurn: 50,
    });
    expect(result.goals[0].domain).toBe("disaster");
    expect(result.goals[0].crisis).toBe(true);
    expect(result.goals).toHaveLength(normal.goalSlots);
    expect(result.agenda[0].domain).toBe("disaster");
  });

  it("refreshes a held goal's target when the fresh agenda moved it", () => {
    const result = commitGoverningGoals({
      reviewed: [goal({ domain: "healthcare", target: 65, priority: 0.4, openedTurn: 5 })],
      agenda: [item({ domain: "healthcare", target: 80, priority: 0.9 })],
      domainHealth: health,
      policy: normal,
      currentTurn: 50,
    });
    expect(result.goals[0]).toMatchObject({ target: 80, priority: 0.9, openedTurn: 5 });
  });

  it("never widens the agenda past the V1 breadth clamp", () => {
    const held = ["a", "b", "c", "d", "e"].map((domain) => goal({ domain, openedTurn: 5 }));
    const result = commitGoverningGoals({
      reviewed: held,
      agenda: ["p", "q", "r", "s", "t", "u"].map((domain) => item({ domain })),
      domainHealth: {},
      policy: hard,
      currentTurn: 50,
    });
    expect(result.agenda.length).toBeLessThanOrEqual(GOVERNING_ARCHETYPE_CLAMP.maxAgendaBreadth);
  });

  it("ignores hold-direction agenda items — a goal is always actionable", () => {
    const result = commitGoverningGoals({
      reviewed: [],
      agenda: [item({ domain: "healthcare", direction: "hold" })],
      domainHealth: health,
      policy: normal,
      currentTurn: 10,
    });
    expect(result.goals).toHaveLength(0);
  });

  it("survives an empty agenda and empty history", () => {
    const result = commitGoverningGoals({
      reviewed: [],
      agenda: [],
      domainHealth: {},
      policy: normal,
      currentTurn: 1,
    });
    expect(result.goals).toEqual([]);
    expect(result.agenda).toEqual([]);
  });

  it("round-trips through JSON, as persistence requires", () => {
    const result = commitGoverningGoals({
      reviewed: [],
      agenda: [item({ domain: "healthcare" })],
      domainHealth: health,
      policy: normal,
      currentTurn: 10,
    });
    const reloaded = JSON.parse(JSON.stringify(result.goals)) as GoverningGoalRecord[];
    expect(reloaded).toEqual(result.goals);
    const review = reviewGoverningGoals({
      goals: reloaded,
      domainHealth: health,
      policy: normal,
      currentTurn: 20,
    });
    expect(review.goals[0].status).toBe("active");
  });
});

describe("committedGoalDomains", () => {
  it("reports only the domains still being pursued", () => {
    const domains = committedGoalDomains([
      goal({ domain: "healthcare", status: "active" }),
      goal({ domain: "education", status: "achieved" }),
      goal({ domain: "poverty", status: "failed" }),
    ]);
    expect([...domains]).toEqual(["healthcare"]);
  });
});

describe("ministerialCommitmentHolds", () => {
  const base = {
    currentTier: "standard",
    bestTier: "expanded",
    currentScore: 5,
    shortfall: 0.1,
    crisis: false,
    policy: normal,
  };

  it("holds a working commitment against a marginally better option", () => {
    expect(ministerialCommitmentHolds(base)).toBe(true);
  });

  it("does not hold when nothing is committed yet", () => {
    expect(ministerialCommitmentHolds({ ...base, currentTier: null })).toBe(false);
  });

  it("does not hold when there is nothing to switch to", () => {
    expect(ministerialCommitmentHolds({ ...base, bestTier: null })).toBe(false);
    expect(ministerialCommitmentHolds({ ...base, bestTier: "standard" })).toBe(false);
  });

  it("breaks the commitment for a crisis", () => {
    expect(ministerialCommitmentHolds({ ...base, crisis: true })).toBe(false);
  });

  it("breaks the commitment once the standing tier stops helping", () => {
    expect(ministerialCommitmentHolds({ ...base, currentScore: 0 })).toBe(false);
    expect(ministerialCommitmentHolds({ ...base, currentScore: -3 })).toBe(false);
  });

  it("breaks the commitment when the brief is materially failing", () => {
    expect(
      ministerialCommitmentHolds({ ...base, shortfall: normal.replanShortfallThreshold })
    ).toBe(false);
  });

  it("reacts sooner on hard than on easy at the same shortfall", () => {
    const shortfall = 0.4; // between hard's 0.3 and easy's 0.6
    expect(ministerialCommitmentHolds({ ...base, shortfall, policy: hard })).toBe(false);
    expect(ministerialCommitmentHolds({ ...base, shortfall, policy: easy })).toBe(true);
  });
});
