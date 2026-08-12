import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { BargainingCampaign } from "@/lib/db/types";
import {
  LABOUR_DISPUTE_DECAY,
  LABOUR_POLITICAL_CAPS,
  LABOUR_SETTLEMENT_DECAY,
  LABOUR_SETTLEMENT_EFFECT_TURNS,
  buildLabourRelationsPoliticalNudges,
  loadLabourRelationsPoliticalNudgesByCountry,
} from "./labourRelationsPoliticalProvider";

function campaign(
  over: Partial<BargainingCampaign> &
    Pick<BargainingCampaign, "countryId" | "status" | "escalationLevel">
): BargainingCampaign {
  return {
    mandate: { leverage: 50 },
    ...over,
  } as BargainingCampaign;
}

describe("labour relations political provider", () => {
  it("makes escalation more salient without duplicating economic damage", () => {
    const nudges = buildLabourRelationsPoliticalNudges(
      [
        campaign({
          countryId: "US",
          status: "dispute",
          escalationLevel: "industry_strike",
          disputeStartedAtTurn: 90,
          escalationStartedAtTurn: 100,
        }),
      ],
      100
    ).get("US");

    expect(nudges?.get("economy.workerSecurity")).toBe(-2.25);
    expect(nudges?.get("society.civicLife")).toBe(-1.2);
    expect([...nudges!.keys()].sort()).toEqual(["economy.workerSecurity", "society.civicLife"]);
  });

  it("decays dispute attention from the latest escalation turn", () => {
    const now = buildLabourRelationsPoliticalNudges(
      [
        campaign({
          countryId: "UK",
          status: "dispute",
          escalationLevel: "selective_strike",
          escalationStartedAtTurn: 100,
        }),
      ],
      100
    ).get("UK")!;
    const later = buildLabourRelationsPoliticalNudges(
      [
        campaign({
          countryId: "UK",
          status: "dispute",
          escalationLevel: "selective_strike",
          escalationStartedAtTurn: 100,
        }),
      ],
      101
    ).get("UK")!;

    expect(later.get("economy.workerSecurity")).toBeCloseTo(
      now.get("economy.workerSecurity")! * LABOUR_DISPUTE_DECAY,
      3
    );
  });

  it("adds a leverage-scaled settlement benefit that fades and expires", () => {
    const row = campaign({
      countryId: "US",
      status: "settled",
      escalationLevel: "selective_strike",
      endedAtTurn: 200,
      mandate: { leverage: 100 } as BargainingCampaign["mandate"],
    });
    const settled = buildLabourRelationsPoliticalNudges([row], 200).get("US")!;
    const nextTurn = buildLabourRelationsPoliticalNudges([row], 201).get("US")!;

    expect(settled.get("economy.workerSecurity")).toBe(1.875);
    expect(settled.get("society.civicLife")).toBe(0.9375);
    expect(nextTurn.get("economy.workerSecurity")).toBeCloseTo(
      settled.get("economy.workerSecurity")! * LABOUR_SETTLEMENT_DECAY,
      3
    );
    expect(
      buildLabourRelationsPoliticalNudges([row], 201 + LABOUR_SETTLEMENT_EFFECT_TURNS).size
    ).toBe(0);
  });

  it("caps stacked campaigns by country and family", () => {
    const rows = Array.from({ length: 10 }, () =>
      campaign({
        countryId: "US",
        status: "dispute",
        escalationLevel: "industry_strike",
        escalationStartedAtTurn: 100,
      })
    );
    const nudges = buildLabourRelationsPoliticalNudges(rows, 100).get("US")!;

    expect(nudges.get("economy.workerSecurity")).toBe(
      -LABOUR_POLITICAL_CAPS["economy.workerSecurity"]
    );
    expect(nudges.get("society.civicLife")).toBe(-LABOUR_POLITICAL_CAPS["society.civicLife"]);
  });

  it("aggregates opposite signals before capping, independent of row order", () => {
    const dispute = campaign({
      countryId: "US",
      status: "dispute",
      escalationLevel: "industry_strike",
      escalationStartedAtTurn: 100,
    });
    const settlement = campaign({
      countryId: "US",
      status: "settled",
      escalationLevel: "none",
      endedAtTurn: 100,
      mandate: { leverage: 100 } as BargainingCampaign["mandate"],
    });
    const rows = [...Array.from({ length: 4 }, () => dispute), settlement];

    const forward = buildLabourRelationsPoliticalNudges(rows, 100).get("US");
    const reverse = buildLabourRelationsPoliticalNudges([...rows].reverse(), 100).get("US");

    expect(forward).toEqual(reverse);
    expect(forward?.get("economy.workerSecurity")).toBe(
      -LABOUR_POLITICAL_CAPS["economy.workerSecurity"]
    );
  });

  it("loads only live disputes and recent settlements", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const collection = vi
      .fn()
      .mockImplementation((name: string) =>
        name === "gameConfig"
          ? { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "full" }) }
          : { find }
      );

    await loadLabourRelationsPoliticalNudgesByCountry({ collection } as unknown as Db, 300);

    expect(collection).toHaveBeenCalledWith("bargainingCampaigns");
    expect(find).toHaveBeenCalledWith(
      {
        $or: [
          { status: "dispute" },
          {
            status: "settled",
            endedAtTurn: { $gte: 300 - LABOUR_SETTLEMENT_EFFECT_TURNS },
          },
        ],
      },
      expect.objectContaining({ projection: expect.objectContaining({ countryId: 1 }) })
    );
  });

  it("is inert when the full labor system is disabled", async () => {
    const campaignFind = vi.fn();
    const db = {
      collection: (name: string) =>
        name === "gameConfig"
          ? { findOne: vi.fn().mockResolvedValue({ labourSystemMode: "unions" }) }
          : { find: campaignFind },
    } as unknown as Db;

    const nudges = await loadLabourRelationsPoliticalNudgesByCountry(db, 300);

    expect(nudges.size).toBe(0);
    expect(campaignFind).not.toHaveBeenCalled();
  });
});
