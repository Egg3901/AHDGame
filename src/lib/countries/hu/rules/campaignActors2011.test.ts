import { describe, expect, it } from "vitest";
import { coalesceHuModernCampaignActors, type HuModernCampaignActor } from "./campaignActors2011";
const actor = (
  id: string,
  overrides: Partial<HuModernCampaignActor> = {}
): HuModernCampaignActor => ({
  id,
  ownerId: "owner",
  partyId: "1",
  regionId: "HU_BUD",
  isNpc: false,
  status: "active",
  filingOrder: 1,
  votes: 0,
  ...overrides,
});
describe("Hungarian historical modern campaign re-entry", () => {
  it("retains all cast votes while a live re-entry owns the one person", () => {
    const original = actor("old", { status: "withdrawn", votes: 60 });
    const latest = actor("new", { filingOrder: 2, votes: 30 });
    const result = coalesceHuModernCampaignActors([original, latest]);
    expect(result.actors).toEqual([{ ...latest, votes: 90 }]);
    expect(result.aliases).toEqual({ old: "new" });
    expect(original.votes).toBe(60);
    expect(coalesceHuModernCampaignActors([latest, original])).toEqual(result);
  });
  it("ignores zero-mark older party or region filings without moving cast votes", () => {
    const latest = actor("new", { filingOrder: 2, votes: 30 });
    const result = coalesceHuModernCampaignActors([
      actor("old", { status: "withdrawn", partyId: "2", regionId: "HU_NOR" }),
      latest,
    ]);
    expect(result.actors).toEqual([latest]);
  });
  it.each(["partyId", "regionId"] as const)(
    "rejects a counted %s change instead of moving ballots",
    (key) => {
      expect(() =>
        coalesceHuModernCampaignActors([
          actor("old", { status: "withdrawn", votes: 1, [key]: "other" }),
          actor("new"),
        ])
      ).toThrow("cannot move cast votes");
    }
  );
  it("keeps an unavailable original person when all filings have withdrawn", () => {
    const first = actor("first", { status: "withdrawn", votes: 10 });
    const result = coalesceHuModernCampaignActors([
      first,
      actor("later", { status: "withdrawn", filingOrder: 2, votes: 20 }),
    ]);
    expect(result.actors).toEqual([{ ...first, votes: 30 }]);
  });
  it("keeps financial owners separate", () => {
    expect(
      coalesceHuModernCampaignActors([actor("a"), actor("b", { ownerId: "other" })]).actors
    ).toHaveLength(2);
  });
});
