import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { triggerSystemNoConfidence } from "../triggerSystemNoConfidence";

function makeDb(opts: { formation: Record<string, unknown> | null }) {
  const inserted: Array<Record<string, unknown>> = [];
  const formationUpdates: Array<Record<string, unknown>> = [];
  return {
    inserted,
    formationUpdates,
    db: {
      collection: vi.fn((name: string) => {
        if (name === "governmentFormations") {
          return {
            findOne: vi.fn().mockResolvedValue(opts.formation),
            updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
              formationUpdates.push(u.$set as Record<string, unknown>);
              return { acknowledged: true, modifiedCount: 1 };
            }),
          };
        }
        if (name === "noConfidenceVotes") {
          return {
            insertOne: vi.fn(async (doc: Record<string, unknown>) => {
              inserted.push(doc);
              return { acknowledged: true, insertedId: doc._id };
            }),
          };
        }
        throw new Error(`unexpected: ${name}`);
      }),
    } as never,
  };
}

describe("triggerSystemNoConfidence", () => {
  it("skips for presidential country (US)", async () => {
    const { db, inserted } = makeDb({ formation: null });
    const r = await triggerSystemNoConfidence(db, "US", "default", 100);
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe("not-parliamentary");
    expect(inserted).toHaveLength(0);
  });

  it("skips parliamentary country with confidenceVoteMechanism disabled (CN)", async () => {
    const { db, inserted } = makeDb({
      formation: {
        status: "formed",
        pmCharacterId: new ObjectId(),
        pmName: "PM Smith",
        activeVoteId: null,
      },
    });
    const r = await triggerSystemNoConfidence(db, "CN", "default", 100);
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe("no-confidence-mechanism");
    expect(inserted).toHaveLength(0);
  });

  it("skips parliamentary country with no PM", async () => {
    const { db, inserted } = makeDb({ formation: { status: "vacant", pmCharacterId: null } });
    const r = await triggerSystemNoConfidence(db, "UK", "default", 100);
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe("no-pm");
    expect(inserted).toHaveLength(0);
  });

  it("skips when active no-confidence vote already exists", async () => {
    const { db, inserted } = makeDb({
      formation: {
        status: "formed",
        pmCharacterId: new ObjectId(),
        pmName: "PM Smith",
        activeVoteId: new ObjectId(),
      },
    });
    const r = await triggerSystemNoConfidence(db, "UK", "default", 100);
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe("vote-already-active");
    expect(inserted).toHaveLength(0);
  });

  it("inserts a no-confidence vote with system-proposer fields when prerequisites met", async () => {
    const pmId = new ObjectId();
    const { db, inserted, formationUpdates } = makeDb({
      formation: {
        status: "formed",
        pmCharacterId: pmId,
        pmName: "PM Smith",
        activeVoteId: null,
      },
    });
    const r = await triggerSystemNoConfidence(db, "UK", "Sovereign-debt repudiation", 100);
    expect(r.triggered).toBe(true);
    expect(r.voteId).toBeDefined();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].proposedByCharacterId).toBeNull();
    expect(inserted[0].proposedByName).toContain("System");
    expect(inserted[0].proposedByName).toContain("Sovereign-debt repudiation");
    expect(inserted[0].targetPmCharacterId).toEqual(pmId);
    expect(inserted[0].status).toBe("active");
    expect(inserted[0].turnProposed).toBe(100);
    // Formation row updated with the activeVoteId
    expect(formationUpdates).toHaveLength(1);
    expect(formationUpdates[0].activeVoteId).toBeDefined();
  });
});
