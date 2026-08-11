import { describe, it, expect } from "vitest";
import { buildResolutionFeed } from "./resolutionFeed";
import type { OrgSummary } from "../orgTypes";

const orgs = [
  {
    id: "EU",
    def: { name: "European Union", shortName: "EU" },
    pendingLegislation: [
      { _id: "p1", type: "sanctions", title: "Sanctions: BR", closesOnTurn: 210 },
    ],
    activeLegislation: [
      { _id: "a1", type: "free_trade_agreement", title: "EU FTA", enactedOnTurn: 100 },
    ],
  },
] as unknown as OrgSummary[];

describe("buildResolutionFeed", () => {
  it("flattens pending + active across orgs, pending first", () => {
    const feed = buildResolutionFeed(orgs);
    expect(feed.map((f) => f._id)).toEqual(["p1", "a1"]);
    expect(feed[0]).toMatchObject({ orgId: "EU", status: "pending", title: "Sanctions: BR" });
    expect(feed[1]).toMatchObject({ status: "active", title: "EU FTA" });
  });

  it("orders pending by soonest close, active by most-recent enactment", () => {
    const many = [
      {
        id: "X",
        def: { name: "X", shortName: "X" },
        pendingLegislation: [
          { _id: "late", type: "directive", title: "late", closesOnTurn: 300 },
          { _id: "soon", type: "directive", title: "soon", closesOnTurn: 205 },
        ],
        activeLegislation: [
          { _id: "old", type: "set_dues", title: "old", enactedOnTurn: 50 },
          { _id: "new", type: "set_dues", title: "new", enactedOnTurn: 120 },
        ],
      },
    ] as unknown as OrgSummary[];
    expect(buildResolutionFeed(many).map((f) => f._id)).toEqual(["soon", "late", "new", "old"]);
  });
});
