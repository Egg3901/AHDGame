import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { BargainingCampaign } from "@/lib/db/types";
import {
  BARGAINING_MEDIATION_DELAY_TURNS,
  BARGAINING_MEDIATION_MIN_LAW_SUPPORT,
  getBargainingMediationAvailability,
} from "./bargaining";

const DISPUTE_TURN = 100;

function offer(proposedBy: "union" | "employer", wageLevel: number) {
  return {
    revision: proposedBy === "union" ? 1 : 2,
    proposedBy,
    wageLevel,
    agreementDurationTurns: 24,
    noStrikeTurns: 0,
    proposedAtTurn: DISPUTE_TURN,
    proposedAt: new Date(),
  };
}

function campaign(over: Partial<BargainingCampaign> = {}): BargainingCampaign {
  const offers = [offer("union", 1.12), offer("employer", 1.03)];
  return {
    _id: new ObjectId(),
    unionId: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    employerCorporationId: new ObjectId(),
    sectorIds: [],
    status: "dispute",
    escalationLevel: "none",
    mandate: { lawSupport: BARGAINING_MEDIATION_MIN_LAW_SUPPORT } as never,
    currentOffer: offers[1],
    offers,
    startedAtTurn: DISPUTE_TURN - 5,
    deadlineTurn: DISPUTE_TURN + 20,
    disputeStartedAtTurn: DISPUTE_TURN,
    lastActionTurn: DISPUTE_TURN,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as BargainingCampaign;
}

describe("mediation: government intervention waives the cooling-off delay (#127)", () => {
  const tooEarly = DISPUTE_TURN + BARGAINING_MEDIATION_DELAY_TURNS - 1;

  it("still blocks a party requesting mediation inside the delay", () => {
    const res = getBargainingMediationAvailability(campaign(), tooEarly);
    expect(res.available).toBe(false);
    expect(res.reason).toContain("becomes available on turn");
  });

  it("allows a government intervention inside the delay", () => {
    const res = getBargainingMediationAvailability(campaign(), tooEarly, {
      governmentIntervention: true,
    });
    expect(res.available).toBe(true);
    expect(res.reason).toBeNull();
  });

  // The waiver is scoped to timing. A crisis must not be able to mediate
  // something that is not a real, legal, two-sided, unmediated dispute.
  it.each([
    ["a campaign that is not in dispute", { status: "negotiating" } as Partial<BargainingCampaign>],
    ["a campaign that already used mediation", { mediation: {} as never }],
    [
      "a country whose law does not permit mediation",
      { mandate: { lawSupport: BARGAINING_MEDIATION_MIN_LAW_SUPPORT - 1 } as never },
    ],
    ["a dispute with no employer package", { offers: [offer("union", 1.12)] }],
  ])("does not waive %s", (_label, over) => {
    const res = getBargainingMediationAvailability(campaign(over), tooEarly, {
      governmentIntervention: true,
    });
    expect(res.available).toBe(false);
  });

  it("is a no-op once the delay has elapsed anyway", () => {
    const later = DISPUTE_TURN + BARGAINING_MEDIATION_DELAY_TURNS;
    expect(getBargainingMediationAvailability(campaign(), later).available).toBe(true);
    expect(
      getBargainingMediationAvailability(campaign(), later, { governmentIntervention: true })
        .available
    ).toBe(true);
  });
});
