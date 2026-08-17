import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { BargainingCampaign, Union } from "@/lib/db/types";
import {
  LABOUR_DISPUTE_DECAY,
  LABOUR_POLITICAL_CAPS,
  LABOUR_SETTLEMENT_DECAY,
  LABOUR_SETTLEMENT_EFFECT_TURNS,
  buildLabourRelationsPoliticalNudges,
  loadLabourRelationsPoliticalNudgesByCountry,
} from "./labourRelationsPoliticalProvider";

function union(
  over: Partial<Union> & Pick<Union, "countryId">
): Pick<Union, "countryId" | "activeServices" | "suspended"> {
  return { activeServices: [], ...over };
}

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

  it("loads only live disputes and recent settlements, and unions with a non-empty active slate", async () => {
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
    expect(collection).toHaveBeenCalledWith("unions");
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
    expect(find).toHaveBeenCalledWith(
      { suspended: { $ne: true }, activeServices: { $exists: true, $not: { $size: 0 } } },
      expect.objectContaining({ projection: expect.objectContaining({ activeServices: 1 }) })
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

describe("union dues v1: running services nudge economy.workerSecurity", () => {
  it("shares the SAME capped channel as bargaining outcomes, not a second uncapped one", () => {
    const withServiceOnly = buildLabourRelationsPoliticalNudges([], 100, [
      union({ countryId: "US", activeServices: ["healthFund"] }),
    ]).get("US")!;
    expect(withServiceOnly.get("economy.workerSecurity")).toBeGreaterThan(0);
    expect(withServiceOnly.get("economy.workerSecurity")!).toBeLessThanOrEqual(
      LABOUR_POLITICAL_CAPS["economy.workerSecurity"]
    );

    // Three settled campaigns (1.875 raw each, per the settlement test above)
    // already sum past the cap on their own (5.625 > 5). Adding a service's
    // positive contribution on top raises the RAW sum further (6.825), but if
    // this were a second, separately-capped channel the combined total could
    // read as high as cap + serviceNudge (6.2). It must not: both channels
    // land in the same map entry and get clamped ONCE, together.
    const settlement = campaign({
      countryId: "US",
      status: "settled",
      escalationLevel: "none",
      endedAtTurn: 100,
      mandate: { leverage: 100 } as BargainingCampaign["mandate"],
    });
    const withBoth = buildLabourRelationsPoliticalNudges(
      [settlement, settlement, settlement],
      100,
      [union({ countryId: "US", activeServices: ["healthFund"] })]
    ).get("US")!;
    expect(withBoth.get("economy.workerSecurity")).toBe(
      LABOUR_POLITICAL_CAPS["economy.workerSecurity"]
    );
  });

  it("a suspended union contributes nothing even with services active", () => {
    const nudges = buildLabourRelationsPoliticalNudges([], 100, [
      union({ countryId: "US", activeServices: ["healthFund"], suspended: true }),
    ]);
    expect(nudges.size).toBe(0);
  });

  it("a union with no active services contributes nothing", () => {
    const nudges = buildLabourRelationsPoliticalNudges([], 100, [
      union({ countryId: "US", activeServices: [] }),
    ]);
    expect(nudges.size).toBe(0);
  });

  it("is recomputed fresh from the CURRENT active slate, not accumulated across calls", () => {
    const first = buildLabourRelationsPoliticalNudges([], 100, [
      union({ countryId: "US", activeServices: ["healthFund"] }),
    ])
      .get("US")!
      .get("economy.workerSecurity");
    const second = buildLabourRelationsPoliticalNudges([], 101, [
      union({ countryId: "US", activeServices: ["healthFund"] }),
    ])
      .get("US")!
      .get("economy.workerSecurity");
    // Same slate, same result each call, nothing persists or compounds turn
    // to turn inside this function.
    expect(second).toBe(first);
  });
});
