import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
  };
}

describe("withdrawn tally healer", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);
  });

  it("detects and heals stale presidential unit votes even after summary votes were removed (#1306)", async () => {
    const electionId = new ObjectId();
    const activeId = new ObjectId();
    const withdrawnId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "president",
      state: "US",
      status: "active",
    };
    const tally = {
      electionId,
      totalVotes: { [activeId.toString()]: 4_000 },
      candidateNames: { [activeId.toString()]: "Active" },
      candidateParties: { [activeId.toString()]: "1" },
      totalVotesByUnit: {
        OR: { [activeId.toString()]: 1_000, [withdrawnId.toString()]: 1_100 },
        OR_CD1: { [withdrawnId.toString()]: 300 },
      },
    };

    db.collection("elections").find.mockReturnValue(cursor([election]) as never);
    db.collection("electionCandidates").find.mockReturnValue(
      cursor([{ _id: activeId, electionId, status: "active" }]) as never
    );
    db.collection("electionVoteTallies").find.mockReturnValue(cursor([tally]) as never);

    const { GET, POST } = await import("./route");
    const diagnostic = await GET();
    expect(await diagnostic.json()).toMatchObject({
      affectedTallies: 1,
      affected: [{ staleVotes: 1_400 }],
    });

    const response = await POST();
    expect(response.status).toBe(200);
    const [, update] = db.collection("electionVoteTallies").updateOne.mock.calls[0];
    const unset = update.$unset as Record<string, "">;
    expect(unset[`totalVotesByUnit.OR.${withdrawnId}`]).toBe("");
    expect(unset[`totalVotesByUnit.OR_CD1.${withdrawnId}`]).toBe("");
    expect(unset[`totalVotesByUnit.OR.${activeId}`]).toBeUndefined();
  });
});
