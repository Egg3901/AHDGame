import { describe, expect, it } from "vitest";
import { CLAIMS, DEFECT_ID, defect, totalClaimAnchor } from "./AHD-tinky-stale-vote-excess";

describe("AHD Tinky stale-vote excess plan", () => {
  it("pins the owner-approved direct-loss heal to the seven material claims", () => {
    expect(CLAIMS).toHaveLength(7);
    expect(totalClaimAnchor()).toBe(1_541_456_779.26);

    const directRestitution = CLAIMS.filter((claim) => claim.destination === "character").reduce(
      (sum, claim) => sum + claim.anchorAmount,
      0
    );
    const participantExcess = CLAIMS.filter(
      (claim) => claim.reason === "participant_excess"
    ).reduce((sum, claim) => sum + claim.anchorAmount, 0);
    const unclaimed = CLAIMS.filter((claim) => claim.reason === "deleted_claimant").reduce(
      (sum, claim) => sum + claim.anchorAmount,
      0
    );

    expect(directRestitution).toBeCloseTo(2_969_972.56, 2);
    expect(participantExcess).toBeCloseTo(184_445_778.75, 2);
    expect(unclaimed).toBeCloseTo(1_354_041_027.95, 2);
    expect(directRestitution + participantExcess + unclaimed).toBeCloseTo(totalClaimAnchor(), 2);
  });

  it("is a money-conserving, production-only, idempotent heal", () => {
    expect(defect.id).toBe(DEFECT_ID);
    expect(defect.envs).toEqual(["prod"]);
    expect(defect.idempotent).toBe(true);
    expect(defect.mintsMoney).not.toBe(true);
    expect(defect.guards).toContain("money-conserving");
    expect(defect.guards).toContain("turn-lock-free");
  });
});
