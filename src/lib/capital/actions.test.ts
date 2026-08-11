import { describe, expect, it } from "vitest";
import {
  CAPITAL_ACTIONS,
  buildCapitalActionPlan,
  validateCapitalAction,
  type CapitalActionContext,
} from "./actions";

function ctx(overrides: Partial<CapitalActionContext> = {}): CapitalActionContext {
  return {
    currentActions: 30,
    currentFunds: 250000,
    currentRelationship: 0,
    isRetired: false,
    targetFavorability: 50,
    targetPoliticalInfluence: 50,
    context: {},
    ...overrides,
  };
}

describe("validateCapitalAction", () => {
  it("rejects unknown actions", () => {
    // @ts-expect-error — exercise the runtime guard with a bogus action id
    const result = validateCapitalAction("totally_not_real", ctx());
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("unknown_action");
  });

  it("rejects when the NPP is retired", () => {
    const result = validateCapitalAction("private_meeting", ctx({ isRetired: true }));
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("npp_retired");
  });

  it("rejects when actions are below cost", () => {
    const result = validateCapitalAction("boost_influence", ctx({ currentActions: 5 }));
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("insufficient_capital");
  });

  it("allows boost actions even when relationship is below zero", () => {
    const favorability = validateCapitalAction(
      "boost_favorability",
      ctx({ currentRelationship: -25, currentActions: 5 })
    );
    const influence = validateCapitalAction(
      "boost_influence",
      ctx({ currentRelationship: -25, currentActions: 6 })
    );

    expect(favorability.ok).toBe(true);
    expect(influence.ok).toBe(true);
  });

  it("rejects when campaign funds are below the action's cost", () => {
    const result = validateCapitalAction("boost_influence", ctx({ currentFunds: 10000 }));
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("insufficient_funds");
  });

  it("requires a candidacy for request_endorsement", () => {
    const result = validateCapitalAction("request_endorsement", ctx({ currentRelationship: 50 }));
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("missing_candidacy_context");
  });

  it("accepts request_endorsement with a candidacy even below the hidden endorsement gate", () => {
    const result = validateCapitalAction(
      "request_endorsement",
      ctx({ currentRelationship: 0, context: { candidacyId: "c1" } })
    );
    expect(result.ok).toBe(true);
  });

  it("accepts valid boost actions at neutral relationship", () => {
    const favorability = validateCapitalAction(
      "boost_favorability",
      ctx({ currentRelationship: 0, currentActions: 5 })
    );
    const influence = validateCapitalAction(
      "boost_influence",
      ctx({ currentRelationship: 0, currentActions: 6 })
    );

    expect(favorability.ok).toBe(true);
    expect(influence.ok).toBe(true);
  });

  it("accepts valid private_meeting at the relationship floor", () => {
    const result = validateCapitalAction("private_meeting", ctx({ currentRelationship: -50 }));
    expect(result.ok).toBe(true);
    expect(result.config?.actionCost).toBe(3);
  });

  it("rejects boost_favorability when target NPP is at the favorability ceiling", () => {
    const result = validateCapitalAction("boost_favorability", ctx({ targetFavorability: 100 }));
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("target_at_cap");
  });

  it("rejects boost_influence when target NPP is at the influence ceiling", () => {
    const result = validateCapitalAction("boost_influence", ctx({ targetPoliticalInfluence: 100 }));
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("target_at_cap");
  });

  it("rejects reduce_favorability when target NPP is already at the floor", () => {
    const result = validateCapitalAction(
      "reduce_favorability",
      ctx({ targetFavorability: 0, currentRelationship: 0 })
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("target_at_floor");
  });

  it("rejects reduce_influence when target NPP is already at the floor", () => {
    const result = validateCapitalAction(
      "reduce_influence",
      ctx({ targetPoliticalInfluence: 0, currentRelationship: 0 })
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("target_at_floor");
  });

  it("still allows boost when target is one below cap (room to grow)", () => {
    const fav = validateCapitalAction("boost_favorability", ctx({ targetFavorability: 99 }));
    const inf = validateCapitalAction("boost_influence", ctx({ targetPoliticalInfluence: 99 }));
    expect(fav.ok).toBe(true);
    expect(inf.ok).toBe(true);
  });

  it("does not block private_meeting or request_endorsement based on stat caps", () => {
    const meeting = validateCapitalAction(
      "private_meeting",
      ctx({ targetFavorability: 100, targetPoliticalInfluence: 100, currentRelationship: 0 })
    );
    expect(meeting.ok).toBe(true);
    const endorse = validateCapitalAction(
      "request_endorsement",
      ctx({
        targetFavorability: 100,
        targetPoliticalInfluence: 100,
        context: { candidacyId: "c1" },
      })
    );
    expect(endorse.ok).toBe(true);
  });
});

describe("buildCapitalActionPlan", () => {
  it("produces the configured deltas for each action", () => {
    const endorse = buildCapitalActionPlan(
      "request_endorsement",
      ctx({ currentRelationship: 30, context: { candidacyId: "c1" } })
    );
    expect(endorse.relationshipDelta).toBe(0);
    expect(endorse.actionCost).toBe(CAPITAL_ACTIONS.request_endorsement.actionCost);
    expect(endorse.sideEffects.createEndorsement?.candidacyId).toBe("c1");

    const meet = buildCapitalActionPlan("private_meeting", ctx());
    expect(meet.relationshipDelta).toBe(5);
    expect(meet.sideEffects).toEqual({});

    const boostFavorability = buildCapitalActionPlan("boost_favorability", ctx());
    expect(boostFavorability.relationshipDelta).toBe(2);
    expect(boostFavorability.sideEffects.favorabilityDelta).toBe(3);

    const boostInfluence = buildCapitalActionPlan("boost_influence", ctx());
    expect(boostInfluence.relationshipDelta).toBe(2);
    expect(boostInfluence.sideEffects.politicalInfluenceDelta).toBe(2);

    const reduceFavorability = buildCapitalActionPlan("reduce_favorability", ctx());
    expect(reduceFavorability.relationshipDelta).toBe(-2);
    expect(reduceFavorability.sideEffects.favorabilityDelta).toBe(-3);

    const reduceInfluence = buildCapitalActionPlan("reduce_influence", ctx());
    expect(reduceInfluence.relationshipDelta).toBe(-2);
    expect(reduceInfluence.sideEffects.politicalInfluenceDelta).toBe(-2);
  });
});
