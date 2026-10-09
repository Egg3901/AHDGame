import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { CampaignFieldOffice } from "@/lib/db/types";
import { buildFieldOfficeMultiplier } from "./engine";

function office(candidateId: ObjectId, regionId: string, share: number): CampaignFieldOffice {
  return {
    _id: new ObjectId(),
    campaignId: new ObjectId(),
    electionId: new ObjectId(),
    candidateId,
    countryId: "US",
    regionId,
    subdivisionId: "42101",
    label: "Philadelphia",
    electorateShare: share,
    yieldFactor: 1,
    openedTurn: 0,
    openCostLocal: 0,
    openedByCharacterId: null,
    createdAt: new Date(0),
  };
}

describe("buildFieldOfficeMultiplier", () => {
  it("returns null when the race has no offices or the country has none", () => {
    expect(buildFieldOfficeMultiplier([], "US", 5)).toBeNull();
    expect(buildFieldOfficeMultiplier([office(new ObjectId(), "PA", 0.1)], "DE", 5)).toBeNull();
  });

  it("boosts only the owning candidate in the office's region", () => {
    const a = new ObjectId();
    const mult = buildFieldOfficeMultiplier([office(a, "PA", 0.12)], "US", 10)!;
    expect(mult(a.toString(), "PA")).toBeGreaterThan(1);
    expect(mult(a.toString(), "pa")).toBe(mult(a.toString(), "PA"));
    expect(mult(a.toString(), "OH")).toBe(1);
    expect(mult(new ObjectId().toString(), "PA")).toBe(1);
  });
});
