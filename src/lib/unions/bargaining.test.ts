import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { UNION_STRIKE_CALL_COOLDOWN_TURNS } from "./unionEconomy";
import type { BargainingCampaign, Union } from "@/lib/db/types";
import {
  BARGAINING_DEADLINE_TURNS,
  buildBargainingEscalationPlan,
  buildBargainingMandate,
  BARGAINING_DISPUTE_MAX_TURNS,
  counterBargainingOffer,
  disputeLapseTurn,
  escalateBargainingCampaign,
  escalationUpkeepPerTurn,
  OVERTIME_BAN_UPKEEP_PER_LOCAL,
  getBargainingMediationAvailability,
  moveCampaignToDispute,
  openBargainingCampaign,
  proposeBargainingMediation,
  respondToBargainingMediation,
  settleBargainingCampaign,
  settleMediatedBargainingCampaign,
  validateBargainingTerms,
  activeCollectiveAgreementFilter,
  isCollectiveAgreementActive,
} from "./bargaining";

const NOW = new Date("2026-08-09T00:00:00.000Z");

function union(): Pick<Union, "_id" | "countryId" | "sectorType"> {
  return { _id: new ObjectId(), countryId: "US", sectorType: "manufacturing" };
}

function mandate() {
  return buildBargainingMandate({
    locals: [
      { workers: 800, unionization: 60, wageLevel: 1, workerExpectationIndex: 1.15 },
      { workers: 200, unionization: 20, wageLevel: 0.9, workerExpectationIndex: 1.05 },
    ],
    laborTightness: 70,
    lawSupport: 60,
    treasury: 2400,
    strikeCost: 400,
  });
}

function campaign(): BargainingCampaign {
  const opened = openBargainingCampaign({
    union: union(),
    employerCorporationId: new ObjectId(),
    sectors: [{ _id: new ObjectId() }, { _id: new ObjectId() }],
    mandate: mandate(),
    terms: { wageLevel: 1.15, agreementDurationTurns: 48, noStrikeTurns: 24 },
    currentTurn: 100,
    now: NOW,
  });
  if ("ok" in opened) throw new Error(opened.error);
  return opened;
}

describe("industrial-relations bargaining domain", () => {
  it("builds a worker-weighted mandate with visible support and leverage inputs", () => {
    const value = mandate();

    expect(value.coverage).toBe(52);
    expect(value.organizedLocalCount).toBe(1);
    expect(value.totalLocalCount).toBe(2);
    expect(value.strikeFundRunway).toBe(6);
    expect(value.support).toBeGreaterThan(40);
    expect(value.leverage).toBeGreaterThan(value.support);
  });

  it("reads grievance against the same cost-of-living index the strike model uses", () => {
    const shared = {
      laborTightness: 60,
      lawSupport: 50,
      treasury: 1600,
      strikeCost: 400,
    };
    // A local paid 1.0 in a state where living costs run 12% above baseline:
    // the real wage is 0.89, so an expectation of 1.0 is a real grievance.
    const expensive = buildBargainingMandate({
      ...shared,
      locals: [
        {
          workers: 1000,
          unionization: 60,
          wageLevel: 1,
          workerExpectationIndex: 1,
          costOfLivingIndex: 112,
        },
      ],
    });
    const cheap = buildBargainingMandate({
      ...shared,
      locals: [
        {
          workers: 1000,
          unionization: 60,
          wageLevel: 1,
          workerExpectationIndex: 1,
          costOfLivingIndex: 90,
        },
      ],
    });

    expect(expensive.grievance).toBeGreaterThan(0);
    expect(cheap.grievance).toBe(0);
    expect(expensive.support).toBeGreaterThan(cheap.support);
  });

  it("rejects out-of-model wages and labor-peace terms longer than the agreement", () => {
    expect(
      validateBargainingTerms({
        wageLevel: 1.51,
        agreementDurationTurns: 48,
        noStrikeTurns: 24,
      }).ok
    ).toBe(false);
    expect(
      validateBargainingTerms({
        wageLevel: 1.1,
        agreementDurationTurns: 48,
        noStrikeTurns: 49,
      }).ok
    ).toBe(false);
  });

  it("opens with a snapshotted local scope and a turn-backed deadline", () => {
    const value = campaign();

    expect(value.status).toBe("negotiating");
    expect(value.currentOffer.proposedBy).toBe("union");
    expect(value.currentOffer.revision).toBe(1);
    expect(value.sectorIds).toHaveLength(2);
    expect(value.deadlineTurn).toBe(100 + BARGAINING_DEADLINE_TURNS);
  });

  it("requires alternating offers and preserves the negotiation record", () => {
    const opened = campaign();
    const selfCounter = counterBargainingOffer({
      campaign: opened,
      proposedBy: "union",
      terms: { wageLevel: 1.2, agreementDurationTurns: 48, noStrikeTurns: 24 },
      currentTurn: 101,
      now: NOW,
    });
    expect("ok" in selfCounter && selfCounter.ok).toBe(false);

    const employerCounter = counterBargainingOffer({
      campaign: opened,
      proposedBy: "employer",
      terms: { wageLevel: 1.08, agreementDurationTurns: 72, noStrikeTurns: 48 },
      currentTurn: 101,
      now: NOW,
    });
    if ("ok" in employerCounter) throw new Error(employerCounter.error);
    expect(employerCounter.offers.map((offer) => offer.revision)).toEqual([1, 2]);
    expect(employerCounter.currentOffer.wageLevel).toBe(1.08);
  });

  it("settles only when the other party accepts and creates an enforceable agreement", () => {
    const opened = campaign();
    const invalid = settleBargainingCampaign({
      campaign: opened,
      acceptedBy: "union",
      currentTurn: 102,
      now: NOW,
    });
    expect(invalid.ok).toBe(false);

    const settled = settleBargainingCampaign({
      campaign: opened,
      acceptedBy: "employer",
      currentTurn: 102,
      now: NOW,
    });
    if (!settled.ok) throw new Error(settled.error);
    expect(settled.campaign.status).toBe("settled");
    expect(settled.agreement.wageLevel).toBe(1.15);
    expect(settled.agreement.expiresAtTurn).toBe(150);
  });

  it("escalates a dispute one supported step per turn", () => {
    const opened = campaign();
    opened.mandate.support = 70;
    const disputed = moveCampaignToDispute(opened, 101, NOW);
    if ("ok" in disputed) throw new Error(disputed.error);

    const sameTurn = escalateBargainingCampaign(disputed, 101, NOW);
    expect("ok" in sameTurn && sameTurn.ok).toBe(false);

    const overtimeBan = escalateBargainingCampaign(disputed, 102, NOW);
    if ("ok" in overtimeBan) throw new Error(overtimeBan.error);
    expect(overtimeBan.escalationLevel).toBe("overtime_ban");

    const selectiveStrike = escalateBargainingCampaign(overtimeBan, 103, NOW);
    if ("ok" in selectiveStrike) throw new Error(selectiveStrike.error);
    expect(selectiveStrike.escalationLevel).toBe("selective_strike");

    const industryStrike = escalateBargainingCampaign(selectiveStrike, 104, NOW);
    if ("ok" in industryStrike) throw new Error(industryStrike.error);
    expect(industryStrike.escalationLevel).toBe("industry_strike");
  });

  it("builds a leverage-weighted mediation package that both parties must accept", () => {
    const opened = campaign();
    const countered = counterBargainingOffer({
      campaign: opened,
      proposedBy: "employer",
      terms: { wageLevel: 1.05, agreementDurationTurns: 72, noStrikeTurns: 36 },
      currentTurn: 101,
      now: NOW,
    });
    if ("ok" in countered) throw new Error(countered.error);
    const disputed = moveCampaignToDispute(countered, 102, NOW);
    if ("ok" in disputed) throw new Error(disputed.error);

    const proposed = proposeBargainingMediation({
      campaign: disputed,
      requestedBy: "union",
      currentTurn: 104,
      now: NOW,
    });
    if ("ok" in proposed) throw new Error(proposed.error);
    expect(proposed.mediation?.unionAccepted).toBe(true);
    expect(proposed.mediation?.employerAccepted).toBe(false);
    expect(proposed.mediation?.wageLevel).toBeGreaterThan(1.05);
    expect(proposed.mediation?.wageLevel).toBeLessThan(1.15);

    const accepted = respondToBargainingMediation({
      campaign: proposed,
      party: "employer",
      accept: true,
      currentTurn: 105,
      now: NOW,
    });
    if ("ok" in accepted) throw new Error(accepted.error);
    const settled = settleMediatedBargainingCampaign({
      campaign: accepted,
      currentTurn: 105,
      now: NOW,
    });
    if (!settled.ok) throw new Error(settled.error);
    expect(settled.campaign.status).toBe("settled");
    expect(settled.agreement.wageLevel).toBe(accepted.mediation?.wageLevel);
  });

  it("reports mediation unavailable after a direct rejection with no employer package", () => {
    const disputed = moveCampaignToDispute(campaign(), 101, NOW);
    if ("ok" in disputed) throw new Error(disputed.error);

    expect(getBargainingMediationAvailability(disputed, 104)).toEqual(
      expect.objectContaining({
        available: false,
        reason: expect.stringMatching(/package from both parties/i),
      })
    );
  });

  it("previews exact escalation targets and treasury cost", () => {
    const first = new ObjectId("64b000000000000000000001");
    const second = new ObjectId("64b000000000000000000002");
    const third = new ObjectId("64b000000000000000000003");
    const value = campaign();
    value.escalationLevel = "overtime_ban";
    value.sectorIds = [first, second, third];
    const plan = buildBargainingEscalationPlan(
      value,
      [
        { _id: first, unionization: 80, strikeStartedAtTurn: null, strikeCooldownUntilTurn: null },
        { _id: second, unionization: 60, strikeStartedAtTurn: null, strikeCooldownUntilTurn: null },
        { _id: third, unionization: 20, strikeStartedAtTurn: null, strikeCooldownUntilTurn: null },
      ],
      102
    );

    expect(plan.nextLevel).toBe("selective_strike");
    expect(plan.newStrikeLocals.map((local) => local._id)).toEqual([first]);
    expect(plan.cashCost).toBe(400);
  });

  it("blocks a preview the escalate command would refuse", () => {
    const first = new ObjectId("64b000000000000000000001");
    const locals = [
      { _id: first, unionization: 80, strikeStartedAtTurn: null, strikeCooldownUntilTurn: null },
    ];
    const value = campaign();
    value.escalationLevel = "overtime_ban";
    value.sectorIds = [first];

    // The union struck two turns ago, so the union-wide cooldown is still on.
    const held = buildBargainingEscalationPlan(value, locals, 102, {
      lastCalledStrikeTurn: 100,
      treasury: 100_000,
    });
    expect(held.strikeCooldownUntilTurn).toBe(100 + UNION_STRIKE_CALL_COOLDOWN_TURNS);
    expect(held.blockedCode).toBe("strike_cooldown");
    expect(held.blockedReason).toBe(
      `This union can call another strike on turn ${100 + UNION_STRIKE_CALL_COOLDOWN_TURNS}.`
    );

    const clear = buildBargainingEscalationPlan(
      value,
      locals,
      100 + UNION_STRIKE_CALL_COOLDOWN_TURNS,
      { lastCalledStrikeTurn: 100, treasury: 100_000 }
    );
    expect(clear.blockedReason).toBeNull();

    const broke = buildBargainingEscalationPlan(value, locals, 200, {
      lastCalledStrikeTurn: 100,
      treasury: 1,
    });
    expect(broke.blockedCode).toBe("insufficient_funds");

    // No union supplied means preview only, with nothing to judge against.
    expect(buildBargainingEscalationPlan(value, locals, 102).blockedReason).toBeNull();
  });

  it("prices the upkeep of the level an escalation lands on", () => {
    const first = new ObjectId("64b000000000000000000001");
    const value = campaign();
    value.sectorIds = [first];
    const plan = buildBargainingEscalationPlan(
      value,
      [{ _id: first, unionization: 80, strikeStartedAtTurn: null, strikeCooldownUntilTurn: null }],
      102
    );

    expect(plan.nextLevel).toBe("overtime_ban");
    expect(plan.upkeepPerTurn).toBe(OVERTIME_BAN_UPKEEP_PER_LOCAL);
  });

  it("keeps a dispute answerable so industrial action has a package to move", () => {
    const disputed = moveCampaignToDispute(campaign(), 108, NOW);
    if ("ok" in disputed) throw new Error(disputed.error);

    const employerCounter = counterBargainingOffer({
      campaign: disputed,
      proposedBy: "employer",
      terms: { wageLevel: 1.1, agreementDurationTurns: 48, noStrikeTurns: 24 },
      currentTurn: 112,
      now: NOW,
    });

    if ("ok" in employerCounter) throw new Error(employerCounter.error);
    expect(employerCounter.status).toBe("dispute");
    expect(employerCounter.currentOffer.wageLevel).toBe(1.1);
  });

  it("gives an unresolved dispute a deadline of its own", () => {
    const disputed = moveCampaignToDispute(campaign(), 108, NOW);
    if ("ok" in disputed) throw new Error(disputed.error);

    expect(disputeLapseTurn(disputed)).toBe(108 + BARGAINING_DISPUTE_MAX_TURNS);
  });

  it("prices holding each escalation level per turn", () => {
    // Only the ban is a standing charge; strike calls are paid once, up front.
    expect(escalationUpkeepPerTurn("overtime_ban", 3)).toBe(3 * OVERTIME_BAN_UPKEEP_PER_LOCAL);
    expect(escalationUpkeepPerTurn("none", 3)).toBe(0);
    expect(escalationUpkeepPerTurn("selective_strike", 3)).toBe(0);
    expect(escalationUpkeepPerTurn("industry_strike", 3)).toBe(0);
    expect(escalationUpkeepPerTurn("overtime_ban", -1)).toBe(0);
  });
});

describe("one definition of an agreement in force", () => {
  const agreement = {
    status: "active" as const,
    startsAtTurn: 10,
    expiresAtTurn: 100,
  };

  it("agrees with the Mongo filter at every boundary", () => {
    // The two shapes exist because some callers hold rows and some have to
    // select in the database. They must never disagree about a turn boundary.
    const matchesFilter = (turn: number, a: typeof agreement) => {
      const f = activeCollectiveAgreementFilter(turn);
      return (
        a.status === f.status &&
        a.startsAtTurn <= f.startsAtTurn.$lte &&
        a.expiresAtTurn > f.expiresAtTurn.$gt
      );
    };
    for (const turn of [0, 9, 10, 11, 50, 99, 100, 101]) {
      expect(matchesFilter(turn, agreement)).toBe(isCollectiveAgreementActive(agreement, turn));
    }
  });

  it("treats the start as inclusive and the expiry as EXCLUSIVE", () => {
    // The asymmetry is the thing that gets lost when the rule is copied.
    expect(isCollectiveAgreementActive(agreement, 10)).toBe(true);
    expect(isCollectiveAgreementActive(agreement, 99)).toBe(true);
    expect(isCollectiveAgreementActive(agreement, 100)).toBe(false);
    expect(isCollectiveAgreementActive(agreement, 9)).toBe(false);
  });

  it("is false for an agreement that is not active whatever the turn", () => {
    const expired = { ...agreement, status: "expired" as const };
    expect(isCollectiveAgreementActive(expired, 50)).toBe(false);
    expect(activeCollectiveAgreementFilter(50).status).toBe("active");
  });
});
