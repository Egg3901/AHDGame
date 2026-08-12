import { describe, expect, it } from "vitest";
import type { BargainingOffer } from "@/lib/db/types";
import { validateBargainingTerms } from "@/lib/unions/bargaining";
import {
  calculateNppSettlementWage,
  decideNppBargainingAction,
  industrialActionPressure,
  type NppBargainingPolicyInput,
} from "./nppBargainingPolicy";

const START = new Date("2026-08-09T00:00:00.000Z");

function offer(
  revision: number,
  proposedBy: "union" | "employer",
  wageLevel: number,
  proposedAtTurn: number
): BargainingOffer {
  return {
    revision,
    proposedBy,
    wageLevel,
    agreementDurationTurns: 48,
    noStrikeTurns: 24,
    proposedAtTurn,
    proposedAt: START,
  };
}

function input(
  overrides: Partial<Omit<NppBargainingPolicyInput, "campaign">> & {
    offers?: BargainingOffer[];
    campaign?: Partial<NppBargainingPolicyInput["campaign"]>;
  } = {}
): NppBargainingPolicyInput {
  const offers = overrides.offers ?? [offer(1, "union", 1.2, 100)];
  const { campaign: campaignOverrides, offers: _offers, ...inputOverrides } = overrides;
  return {
    party: "employer",
    currentTurn: 101,
    employerWageLevel: 1,
    employerProfitMargin: 10,
    campaign: {
      status: "negotiating",
      currentOffer: offers[offers.length - 1],
      offers,
      mandate: {
        coverage: 60,
        grievance: 50,
        laborTightness: 50,
        lawSupport: 50,
        strikeFundRunway: 3,
        support: 60,
        leverage: 60,
        organizedLocalCount: 2,
        totalLocalCount: 2,
      },
      deadlineTurn: 108,
      lastActionTurn: 100,
      escalationLevel: "none",
      ...campaignOverrides,
    },
    ...inputOverrides,
  };
}

describe("NPP bargaining policy", () => {
  it("accepts an opposing offer that reaches the deterministic settlement wage", () => {
    const settlementWage = calculateNppSettlementWage({
      openingUnionWage: 1.2,
      employerWageLevel: 1,
      unionLeverage: 60,
      employerProfitMargin: 10,
    });
    const offers = [offer(1, "union", 1.2, 100), offer(2, "employer", settlementWage, 101)];

    expect(decideNppBargainingAction(input({ party: "union", currentTurn: 102, offers }))).toEqual({
      action: "accept",
    });
  });

  it("counters an unaffordable claim with valid terms between its last position and the claim", () => {
    const decision = decideNppBargainingAction(input());

    expect(decision.action).toBe("counter");
    if (decision.action !== "counter") throw new Error("expected an employer counter");
    expect(validateBargainingTerms(decision.terms).ok).toBe(true);
    expect(decision.terms.wageLevel).toBeGreaterThan(1);
    expect(decision.terms.wageLevel).toBeLessThan(1.2);
    expect(decision.terms.agreementDurationTurns).toBe(48);
    expect(decision.terms.noStrikeTurns).toBe(24);
  });

  it("makes monotonic counters and never bargains backward across alternating rounds", () => {
    const first = decideNppBargainingAction(input());
    if (first.action !== "counter") throw new Error("expected first employer counter");
    const offers = [
      offer(1, "union", 1.2, 100),
      offer(2, "employer", first.terms.wageLevel, 101),
      offer(3, "union", 1.18, 102),
    ];
    const second = decideNppBargainingAction(input({ currentTurn: 103, offers }));

    expect(second.action).toBe("counter");
    if (second.action !== "counter") throw new Error("expected second employer counter");
    expect(validateBargainingTerms(second.terms).ok).toBe(true);
    expect(second.terms.wageLevel).toBeGreaterThan(first.terms.wageLevel);
    expect(second.terms.wageLevel).toBeLessThan(1.18);
  });

  it("takes no action when the campaign already acted this turn or awaits the other party", () => {
    expect(
      decideNppBargainingAction(input({ currentTurn: 100, campaign: { lastActionTurn: 100 } }))
    ).toEqual({ action: "none", reason: "already-acted" });

    expect(
      decideNppBargainingAction(
        input({
          party: "union",
          currentTurn: 101,
          campaign: { lastActionTurn: 99 },
        })
      )
    ).toEqual({ action: "none", reason: "awaiting-other-party" });
  });

  it("keeps bargaining once the campaign is in dispute", () => {
    // An autonomous party that stops answering in dispute cannot be moved by
    // industrial action at all, which makes the whole escalation ladder
    // decorative against NPP-run employers.
    const decision = decideNppBargainingAction(
      input({ campaign: { status: "dispute", escalationLevel: "selective_strike" } })
    );

    expect(decision.action).toBe("counter");
  });

  it("concedes more the longer industrial action is held", () => {
    const base = {
      openingUnionWage: 1.4,
      employerWageLevel: 1,
      unionLeverage: 60,
      employerProfitMargin: 10,
    };
    const quiet = calculateNppSettlementWage(base);
    const fresh = calculateNppSettlementWage({
      ...base,
      actionPressure: industrialActionPressure({
        escalationLevel: "industry_strike",
        escalationStartedAtTurn: 110,
        currentTurn: 110,
      }),
    });
    const sustained = calculateNppSettlementWage({
      ...base,
      actionPressure: industrialActionPressure({
        escalationLevel: "industry_strike",
        escalationStartedAtTurn: 110,
        currentTurn: 118,
      }),
    });

    expect(fresh).toBeGreaterThan(quiet);
    expect(sustained).toBeGreaterThan(fresh);
  });

  it("weighs a strike above an overtime ban at the same duration", () => {
    const ban = industrialActionPressure({
      escalationLevel: "overtime_ban",
      escalationStartedAtTurn: 110,
      currentTurn: 114,
    });
    const strike = industrialActionPressure({
      escalationLevel: "industry_strike",
      escalationStartedAtTurn: 110,
      currentTurn: 114,
    });

    expect(ban).toBeGreaterThan(0);
    expect(strike).toBeGreaterThan(ban);
    expect(industrialActionPressure({ escalationLevel: "none", currentTurn: 114 })).toBe(0);
  });
});
