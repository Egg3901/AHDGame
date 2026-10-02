/**
 * A passed relocation vote must not carry a private corporation into a fully
 * command economy, even when the vote was opened before the proposal gate
 * existed or before the destination's economy closed (ticket 1378).
 */
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporationVote } from "@/lib/db/types/corporationVote";

const { commandEconomyRelocationBlock } = vi.hoisted(() => ({
  commandEconomyRelocationBlock: vi.fn(),
}));
vi.mock("@/lib/corporations/relocationCommandEconomyGate", () => ({
  commandEconomyRelocationBlock,
}));

import { applyPassedVoteEffects } from "./voteEffects";

function relocationVote(destinationCountryId: string, destinationStateCode: string) {
  return {
    _id: new ObjectId(),
    type: "relocation",
    status: "passed",
    payload: { destinationCountryId, destinationStateCode },
  } as unknown as CorporationVote;
}

const corporation = {
  _id: new ObjectId(),
  countryId: "UK",
  headquartersState: "EAE",
  isPrivate: false,
} as unknown as Corporation;

describe("applyPassedVoteEffects relocation", () => {
  it("leaves the corporation where it is when the destination is a command economy", async () => {
    const db = createMockDb();
    commandEconomyRelocationBlock.mockResolvedValue("East Germany has a state-run economy");
    await applyPassedVoteEffects({
      db: db as unknown as Db,
      vote: relocationVote("DD", "BY"),
      corporation,
      currentTurn: 1306,
    });
    expect(commandEconomyRelocationBlock).toHaveBeenCalledWith(db, corporation, "UK", "DD");
    expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
  });

  it("moves it when the destination permits private enterprise", async () => {
    const db = createMockDb();
    commandEconomyRelocationBlock.mockResolvedValue(null);
    await applyPassedVoteEffects({
      db: db as unknown as Db,
      vote: relocationVote("US", "TX"),
      corporation,
      currentTurn: 1306,
    });
    const update = db.collection("corporations").updateOne.mock.calls[0];
    expect(update?.[1]).toMatchObject({
      $set: { countryId: "US", headquartersState: "TX" },
    });
  });
});
