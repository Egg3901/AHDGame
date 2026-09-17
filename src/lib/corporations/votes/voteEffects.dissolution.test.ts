import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/corporations/settlementLock", () => ({
  // Lock always acquired → run the dissolution.
  withCorporationSettlementLock: vi.fn((_db, _id, _field, _now, run: () => Promise<unknown>) =>
    run()
  ),
}));
vi.mock("@/lib/bonds/executeCorporationBondDefaultDissolution", () => ({
  executeCorporationBondDefaultDissolution: vi.fn().mockResolvedValue({ ok: true }),
  // Mirrors the production builder format (pinned by the executor's own key
  // tests); the assertions below use the literal key string.
  bondDissolutionKeyForVote: (voteId: { toHexString(): string }) =>
    `bond-dissolution:vote:${voteId.toHexString()}`,
}));

import { executeCorporationBondDefaultDissolution } from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import { applyPassedVoteEffects } from "./voteEffects";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporationVote } from "@/lib/db/types/corporationVote";

function makeDb(): Db {
  return {
    collection: () => {
      throw new Error("no collection reads on the dissolution vote path");
    },
  } as unknown as Db;
}

describe("applyPassedVoteEffects dissolution (issue #1672)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the deterministic per-vote key so a re-driven vote resumes instead of double-paying", async () => {
    const voteId = new ObjectId();
    const corpId = new ObjectId();
    const vote = {
      _id: voteId,
      corporationId: corpId,
      type: "dissolution",
    } as unknown as CorporationVote;
    const corporation = { _id: corpId, name: "Doomed Corp" } as unknown as Corporation;

    await applyPassedVoteEffects({ db: makeDb(), vote, corporation, currentTurn: 251 });

    // Votes apply once, so the vote id alone identifies the event: a retry
    // of the same vote (turn re-drive, route retry) resumes the stored plan.
    // Distinct votes never share a key.
    expect(executeCorporationBondDefaultDissolution).toHaveBeenCalledTimes(1);
    expect(executeCorporationBondDefaultDissolution).toHaveBeenCalledWith(
      expect.anything(),
      corporation,
      {
        requireDefaultedBonds: false,
        idempotencyKey: `bond-dissolution:vote:${voteId.toHexString()}`,
      }
    );
  });
});
