import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getActiveCandidacySummary } from "./relocationCampaigns";

describe("getActiveCandidacySummary", () => {
  const characterId = new ObjectId();
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    db.collection("electionCandidates");
    db.collection("elections");
    db.collection("statePartyCandidates");
    db.collection("statePartyElections");
  });

  it("reports zero when no active candidacies exist", async () => {
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    db.collectionMocks.statePartyCandidates!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    await expect(getActiveCandidacySummary(db as never, characterId)).resolves.toEqual({
      generalElections: 0,
      statePartyElections: 0,
    });
  });

  it("counts open-election candidacies", async () => {
    const electionId = new ObjectId();
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([{ electionId }]) }),
    });
    db.collectionMocks.elections!.countDocuments.mockResolvedValue(1);
    db.collectionMocks.statePartyCandidates!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    await expect(getActiveCandidacySummary(db as never, characterId)).resolves.toEqual({
      generalElections: 1,
      statePartyElections: 0,
    });
  });

  it("counts state-party candidacies", async () => {
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    const electionId = new ObjectId();
    db.collectionMocks.statePartyCandidates!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([{ electionId }]) }),
    });
    db.collectionMocks.statePartyElections!.countDocuments.mockResolvedValue(2);
    await expect(getActiveCandidacySummary(db as never, characterId)).resolves.toEqual({
      generalElections: 0,
      statePartyElections: 2,
    });
  });

  it("ignores candidacies whose parent election is completed/cancelled", async () => {
    const electionId = new ObjectId();
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([{ electionId }]) }),
    });
    db.collectionMocks.elections!.countDocuments.mockResolvedValue(0);
    db.collectionMocks.statePartyCandidates!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    await expect(getActiveCandidacySummary(db as never, characterId)).resolves.toEqual({
      generalElections: 0,
      statePartyElections: 0,
    });
  });
});
