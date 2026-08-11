import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Bill, NPP } from "@/lib/db/types";
import { UK_LAWS } from "@/lib/politicalLegislation/laws/ukLaws";
import { US_LAWS } from "@/lib/politicalLegislation/laws/usLaws";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import { computeIdeologyForce } from "./crossPressure";

function makeNPP(economic: number, social: number): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "OH",
    party: "1",
    politicalInfluence: 50,
    favorability: 50,
    policies: { economic, social, domainPositions: {} },
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    donorBaseLevel: 0,
  } as NPP;
}

function makeBill(
  legislationTypeId: string,
  policyOptionId: string,
  effectDirection: number
): Bill {
  return {
    _id: new ObjectId(),
    title: "Test Bill",
    summary: "",
    status: "active",
    originChamber: "house",
    currentChamber: "house",
    sponsorId: null,
    sponsorName: "Sponsor",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    provisions: [{ type: "policy", legislationTypeId, policyOptionId, effectDirection }],
  } as unknown as Bill;
}

describe("computeIdeologyForce — §6 generation guard", () => {
  it("lean-0 new-generation bills carry NO ideological force for any bloc", () => {
    // us.economy.stability.primary: lean 0 → every option's axes are 0/0.
    const doc = projectLawToLegislationType(
      US_LAWS.find((l) => l.id === "us.economy.stability.primary")!
    );
    const bill = makeBill(doc._id, "l3", 1);
    // Without the guard, the legacy fallback gives a right-bloc NPP
    // (-economic/5)×effectDirection = -0.8 → −80: full-strength inverted force.
    expect(computeIdeologyForce(makeNPP(4, 0), bill, doc)).toBe(0);
    expect(computeIdeologyForce(makeNPP(-4, 0), bill, doc)).toBe(0);
  });

  it("nonzero-lean new-generation bills keep their real vector force", () => {
    const doc = projectLawToLegislationType(
      UK_LAWS.find((l) => l.id === "uk.health.universalCare.primary")!
    );
    const bill = makeBill(doc._id, "l4", 1); // economic −5 at l4
    const leftForce = computeIdeologyForce(makeNPP(-4, 0), bill, doc);
    const rightForce = computeIdeologyForce(makeNPP(4, 0), bill, doc);
    expect(leftForce).toBeGreaterThan(50);
    expect(rightForce).toBeLessThan(-50);
  });

  it("OLD-generation zero-vector bills still reach the legacy fallback", () => {
    const legacyDoc = {
      _id: "old_law",
      name: "Old",
      description: "",
      policyDomain: "economic",
      subCategory: "x",
      positions: [],
      policyOptions: [
        {
          id: "opt",
          name: "Opt",
          stance: "center" as const,
          effectDirection: 1 as const,
          economic: 0,
          social: 0,
        },
      ],
    };
    const bill = makeBill("old_law", "opt", 1);
    // Legacy fallback: (-economic/5) × direction — nonzero for an ideological NPP.
    expect(computeIdeologyForce(makeNPP(4, 0), bill, legacyDoc)).toBeLessThan(0);
  });
});
