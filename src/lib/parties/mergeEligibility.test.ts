import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import type { CommitteeProposal } from "@/lib/db/types/committeeProposal";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { assertMergeEligibility, MergeEligibilityError } from "./mergeEligibility";
import { attemptResolution, processMergeProposal } from "./proposals";

const source = {
  _id: new ObjectId(),
  sequentialId: 1,
  countryId: "US",
  committeeIds: [],
  chairId: new ObjectId(),
} as unknown as PoliticalParty;
const target = { ...source, _id: new ObjectId(), sequentialId: 2, chairId: new ObjectId() };
let mock: ReturnType<typeof createMockDb>;
let db: Db;
const rows = (values: unknown[]) => ({ toArray: async () => values });
function expectOnlyTerritoryClaims() {
  const writes = mock.collection("politicalParties").updateOne.mock.calls as [
    unknown,
    { $set?: Record<string, unknown>; $unset?: Record<string, unknown>; $inc?: unknown },
  ][];
  expect(
    writes.every(
      ([, write]) =>
        !write.$inc &&
        ((write.$set && Object.keys(write.$set).every((key) => key === "territoryMutation")) ||
          (write.$unset && Object.keys(write.$unset).every((key) => key === "territoryMutation")))
    )
  ).toBe(true);
}
function presence(sourceRegion: string, targetRegion: string, collection = "characters") {
  mock.collection(collection).find.mockReturnValue(
    rows([
      { party: "1", homeState: sourceRegion, state: sourceRegion },
      { party: "2", homeState: targetRegion, state: targetRegion },
    ])
  );
}
beforeEach(() => {
  mock = createMockDb();
  db = mock as unknown as Db;
  mock.collection("states").find.mockReturnValue(rows(["CA", "OR", "WA"].map((_id) => ({ _id }))));
  mock
    .collection("politicalParties")
    .findOne.mockImplementation(({ _id }: { _id: ObjectId }) =>
      Promise.resolve(_id.equals(source._id) ? source : target)
    );
});
describe("live merger eligibility", () => {
  it("reloads party status after acquiring claims before merger effects", async () => {
    presence("CA", "OR");
    let reads = 0;
    mock.collection("politicalParties").findOne.mockImplementation(({ _id }: { _id: ObjectId }) => {
      reads++;
      const party = _id.equals(source._id) ? source : target;
      return Promise.resolve(reads > 2 ? { ...party, isDefunct: true } : party);
    });
    await expect(
      processMergeProposal(
        db,
        {
          partyId: source._id,
          merge: { targetPartyId: target._id },
        } as CommitteeProposal,
        10
      )
    ).rejects.toThrow("two active parties");
    expect(mock.collection("characters").updateMany).not.toHaveBeenCalled();
  });
  it.each(["characters", "electedOfficials", "npps"])(
    "accepts adjacency supplied by %s",
    async (collection) => {
      presence("CA", "OR", collection);
      await expect(assertMergeEligibility(db, source, target)).resolves.toBeUndefined();
      expect(mock.collection("states").find).toHaveBeenCalledTimes(1);
      for (const name of ["characters", "electedOfficials", "npps"])
        expect(mock.collection(name).find).toHaveBeenCalledTimes(1);
    }
  );
  it("scopes both parties and countries and excludes retired NPPs", async () => {
    presence("CA", "OR");
    await assertMergeEligibility(db, source, target);
    expect(mock.collection("npps").find).toHaveBeenCalledWith(
      {
        $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
        party: { $in: ["1", "2"] },
        homeState: { $in: ["CA", "OR", "WA"] },
        retiredAt: null,
      },
      { projection: { party: 1, homeState: 1 } }
    );
  });
  it.each([
    { ...target, countryId: "UK" },
    { ...target, isDefunct: true },
    source,
  ] as PoliticalParty[])(
    "rejects invalid party identity before reading presence",
    async (other) => {
      await expect(assertMergeEligibility(db, source, other)).rejects.toBeInstanceOf(
        MergeEligibilityError
      );
      expect(mock.collection("states").find).not.toHaveBeenCalled();
    }
  );
  it("does not use organization caches or an empty-footprint bypass", async () => {
    await expect(assertMergeEligibility(db, source, target)).rejects.toBeInstanceOf(
      MergeEligibilityError
    );
    expect(mock.collection("statePartyOrg").find).not.toHaveBeenCalled();
  });
  it("rechecks current presence instead of reusing proposal-time eligibility", async () => {
    presence("CA", "OR");
    await expect(assertMergeEligibility(db, source, target)).resolves.toBeUndefined();
    presence("CA", "WA");
    await expect(
      processMergeProposal(
        db,
        { partyId: source._id, merge: { targetPartyId: target._id } } as CommitteeProposal,
        10
      )
    ).rejects.toBeInstanceOf(MergeEligibilityError);
    expect(mock.collection("characters").updateMany).not.toHaveBeenCalled();
    expectOnlyTerritoryClaims();
  });
  it("stops a direct merge before any transfer", async () => {
    presence("CA", "WA");
    await expect(
      processMergeProposal(
        db,
        { partyId: source._id, merge: { targetPartyId: target._id } } as CommitteeProposal,
        10
      )
    ).rejects.toBeInstanceOf(MergeEligibilityError);
    expect(mock.collection("characters").updateMany).not.toHaveBeenCalled();
    expectOnlyTerritoryClaims();
  });
  it.each([false, true])(
    "rejects a disconnected fully approved merger cleanly (expiry %s)",
    async (expired) => {
      presence("CA", "WA");
      const proposal = {
        _id: new ObjectId(),
        type: "merge",
        status: "open",
        partyId: source._id,
        merge: { targetPartyId: target._id },
        proposingVotes: [{ voterId: source.chairId, vote: "yes" }],
        targetVotes: [{ voterId: target.chairId, vote: "yes" }],
      } as CommitteeProposal;
      await expect(attemptResolution(db, proposal, 10, { expired })).resolves.toBeUndefined();
      const updates = mock.collection("committeeProposals").updateOne.mock.calls as [
        unknown,
        { $set?: { status?: string; resolutionError?: string } },
      ][];
      expect(updates.some(([, u]) => u.$set?.status === "rejected")).toBe(true);
      expect(updates.some(([, u]) => u.$set?.resolutionError?.includes("adjacent"))).toBe(true);
      expect(mock.collection("characters").updateMany).not.toHaveBeenCalled();
      expectOnlyTerritoryClaims();
    }
  );
  it.each(["source", "target"])(
    "rejects cleanly when the %s party is dissolved during voting",
    async (side) => {
      presence("CA", "OR");
      mock
        .collection("politicalParties")
        .findOne.mockImplementation(({ _id }: { _id: ObjectId }) => {
          const isSource = _id.equals(source._id);
          return Promise.resolve({
            ...(isSource ? source : target),
            isDefunct: isSource === (side === "source"),
          });
        });
      const proposal = {
        _id: new ObjectId(),
        type: "merge",
        status: "open",
        partyId: source._id,
        merge: { targetPartyId: target._id },
        proposingVotes: [{ voterId: source.chairId, vote: "yes" }],
        targetVotes: [{ voterId: target.chairId, vote: "yes" }],
      } as CommitteeProposal;
      await expect(attemptResolution(db, proposal, 10)).resolves.toBeUndefined();
      expect(mock.collection("committeeProposals").updateOne).toHaveBeenCalledWith(
        { _id: proposal._id, status: "open" },
        {
          $set: {
            status: "rejected",
            resolvedAtTurn: 10,
            updatedAt: expect.any(Date),
          },
        }
      );
      expect(mock.collection("characters").updateMany).not.toHaveBeenCalled();
      expectOnlyTerritoryClaims();
      expect(mock.collection("states").find).not.toHaveBeenCalled();
    }
  );
  it("does not treat a database failure as an eligibility rejection", async () => {
    mock.collection("states").find.mockImplementation(() => {
      throw new Error("Read unavailable");
    });
    const proposal = {
      _id: new ObjectId(),
      type: "merge",
      status: "open",
      partyId: source._id,
      merge: { targetPartyId: target._id },
      proposingVotes: [{ voterId: source.chairId, vote: "yes" }],
      targetVotes: [{ voterId: target.chairId, vote: "yes" }],
    } as CommitteeProposal;
    await expect(attemptResolution(db, proposal, 10)).rejects.toThrow("Read unavailable");
    const updates = mock.collection("committeeProposals").updateOne.mock.calls as [
      unknown,
      { $set?: { status?: string; resolutionError?: string } },
    ][];
    expect(updates.some(([, u]) => u.$set?.status)).toBe(false);
    expect(updates.some(([, u]) => u.$set?.resolutionError === "Read unavailable")).toBe(true);
    expect(mock.collection("characters").updateMany).not.toHaveBeenCalled();
    expectOnlyTerritoryClaims();
  });
  it("keeps an unapplied merger retryable when another geographic writer is active", async () => {
    presence("CA", "OR");
    const cursor = { limit: () => cursor, toArray: async () => [{ _id: target._id }] };
    mock.collection("politicalParties").find.mockReturnValue(cursor);
    const proposal = {
      _id: new ObjectId(),
      type: "merge",
      status: "open",
      partyId: source._id,
      merge: { targetPartyId: target._id },
      proposingVotes: [{ voterId: source.chairId, vote: "yes" }],
      targetVotes: [{ voterId: target.chairId, vote: "yes" }],
    } as CommitteeProposal;
    await expect(attemptResolution(db, proposal, 10)).resolves.toBeUndefined();
    expect(mock.collection("committeeProposals").updateOne).toHaveBeenCalledWith(
      { _id: proposal._id, status: "open" },
      { $unset: { resolutionInProgressAt: "" } }
    );
    expect(mock.collection("characters").updateMany).not.toHaveBeenCalled();
  });
});
