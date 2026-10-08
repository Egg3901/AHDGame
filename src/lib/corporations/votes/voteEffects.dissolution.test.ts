/**
 * A passed dissolution vote winds the corporation down through the shared
 * liquidation executor, tagged so its exit record names the shareholders as
 * the cause.
 */
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporationVote } from "@/lib/db/types/corporationVote";

const { executeDissolution } = vi.hoisted(() => ({
  executeDissolution: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/bonds/executeCorporationBondDefaultDissolution", () => ({
  executeCorporationBondDefaultDissolution: executeDissolution,
}));
vi.mock("@/lib/corporations/settlementLock", () => ({
  withCorporationSettlementLock: vi.fn((_db, _id, _field, _now, run: () => Promise<unknown>) =>
    run()
  ),
}));

import { applyPassedVoteEffects } from "./voteEffects";

describe("applyPassedVoteEffects dissolution", () => {
  it("dissolves with the shareholder_vote exit reason", async () => {
    const corporation = { _id: new ObjectId(), countryId: "US" } as unknown as Corporation;
    const vote = {
      _id: new ObjectId(),
      type: "dissolution",
      status: "passed",
      payload: {},
    } as unknown as CorporationVote;

    await applyPassedVoteEffects({
      db: createMockDb() as unknown as Db,
      vote,
      corporation,
      currentTurn: 10,
    });

    expect(executeDissolution).toHaveBeenCalledWith(expect.anything(), corporation, {
      requireDefaultedBonds: false,
      exitReason: "shareholder_vote",
    });
  });
});
