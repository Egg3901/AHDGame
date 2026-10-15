import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { tenderView } from "./queries";
import type { GovernmentTender } from "./types";

describe("public tender response", () => {
  it.each(["awarding", "awarded"] as const)(
    "does not expose private preparation while %s",
    async (status) => {
      const t = {
        _id: "tender",
        countryId: "US",
        status,
        closesTurn: 2,
        awardDeadlineTurn: 8,
        terms: { type: "defence" },
        bids: {},
        bidHistory: [],
        publishedBy: "private-publisher",
        awardAttemptId: "private-attempt",
        awardLeaseKey: "private-lease",
        preparedDefenseLine: 123,
        preparedStateOwned: true,
        awardSelfDealing: { ministerCharacterId: "private-character" },
        preparedDefence: {
          selfDealing: {
            ministerCharacterId: "private-character",
            ministerName: "Public minister",
            favorabilityPenalty: 2,
          },
        },
      } as unknown as GovernmentTender;
      const view = await tenderView({} as Db, t, 3);
      const json = JSON.stringify(view);
      expect(json).not.toContain("private-");
      for (const key of [
        "preparedDefence",
        "preparedDefenseLine",
        "preparedStateOwned",
        "awardSelfDealing",
        "awardLeaseKey",
        "awardAttemptId",
      ])
        expect(view).not.toHaveProperty(key);
      expect(view.selfDealing).toEqual(
        status === "awarded"
          ? { ministerName: "Public minister", favorabilityPenalty: 2 }
          : undefined
      );
    }
  );
});
