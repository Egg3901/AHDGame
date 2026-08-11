import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { finalizeResetGameWorld } from "@/lib/admin/finalizeResetGameWorld";
import type { ResetGameWorldResult } from "@/lib/admin/resetGameWorld";
import { getPresetById } from "@/lib/constants/historicalSeats";

/**
 * These behaviours used to live in `resetGameWorld` and are tested here because
 * that is where they moved, not because they changed.
 *
 * `resetGameWorld` could only run them because it seeded the world itself first
 * — and that seed was the double-seed: `resetAndBootstrapGameWorld` runs
 * `bootstrapGameWorld` straight afterwards, which seeds the identical world a
 * second time. Removing the redundant pass meant these steps had to move behind
 * bootstrap, since every one of them needs a fully-seeded world to operate on.
 */

vi.mock("@/lib/constants/historicalSeats", () => ({
  getPresetById: vi.fn().mockReturnValue({ deleteDefaultParties: true }),
}));

vi.mock("@/lib/seeds/ensureDefaultParties", () => ({
  ensureDefaultParties: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db/sequentialId", () => ({
  resetPartyCounters: vi.fn().mockResolvedValue(undefined),
  realignPartyCountersToExisting: vi.fn().mockResolvedValue(undefined),
  // ensureImfInstitutionPlaceholder calls getNextSequentialId.
  getNextSequentialId: vi.fn().mockResolvedValue(1),
}));

/** Teardown counts as `resetGameWorld` would hand them over. */
const TEARDOWN: ResetGameWorldResult["details"] = {
  officialsDeleted: 0,
  officialsSeeded: 0,
  electionsDeleted: 0,
  candidatesDeleted: 0,
  nppsDeleted: 0,
  nppsSeeded: 0,
  statePartyElectionsDeleted: 0,
  billsDeleted: 0,
  stateBillsDeleted: 0,
  actionLogsCleared: 0,
  demographicsReset: 0,
  customPartiesDeleted: 0,
  partyOrgRecordsDeleted: 0,
  budgetSeedLog: [],
};

describe("finalizeResetGameWorld", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(getPresetById).mockReturnValue({ deleteDefaultParties: true } as never);
  });

  it("seeds an IMF Corp placeholder after corp wipe", async () => {
    // Pre-condition: corporations.findOne returns null (no IMF after wipe).
    db.collection("corporations"); // instantiate the lazy mock
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const result = await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: true,
    });

    // ensureImfInstitutionPlaceholder calls insertOne on the corporations
    // collection with imfInstitution: true.
    const inserts = db.collectionMocks.corporations.insertOne.mock.calls;
    const imfInsert = inserts.find(
      (call) => (call[0] as { imfInstitution?: boolean })?.imfInstitution === true
    );
    expect(imfInsert).toBeDefined();
    const doc = imfInsert![0] as Record<string, unknown>;
    expect(doc.name).toBe("International Monetary Fund");
    expect(doc.shareholders).toEqual([]);
    expect(doc.ceoVacant).toBe(true);
    expect(doc.imfInstitution).toBe(true);
    // budgetSeedLog should mention the placeholder so admin sees the hint.
    expect(result.finalizeLog.some((m) => m.includes("IMF Corp"))).toBe(true);
  });

  it("does not duplicate IMF Corp when one already exists", async () => {
    // Pre-condition: corporations.findOne returns an existing IMF doc.
    db.collection("corporations"); // instantiate the lazy mock
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: "existing-imf-id",
      imfInstitution: true,
      sequentialId: 42,
    });

    const result = await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: true,
    });

    // No new IMF insert should have happened. Filter to verify the IMF doc
    // wasn't re-inserted.
    const inserts = db.collectionMocks.corporations.insertOne.mock.calls;
    const imfInsert = inserts.find(
      (call) => (call[0] as { imfInstitution?: boolean })?.imfInstitution === true
    );
    expect(imfInsert).toBeUndefined();
    // Log should reflect "already present" path.
    expect(result.finalizeLog.some((m) => m.includes("already present"))).toBe(true);
  });

  it("clears coalition links from surviving default parties when preserving parties", async () => {
    db.collection("politicalParties"); // instantiate the lazy mock
    vi.mocked(getPresetById).mockReturnValue({ deleteDefaultParties: false } as never);

    await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: true,
    });

    // The `coalitions` drop itself is teardown — see resetGameWorld's sweep
    // contract. What moved here is clearing the dangling link off the parties
    // that survive, which can only be done once the new roster exists.
    expect(db.collectionMocks["politicalParties"]?.updateMany).toHaveBeenCalledWith(
      { isDefault: true },
      expect.objectContaining({
        $unset: expect.objectContaining({
          coalitionId: "",
        }),
      })
    );
  });

  it("clears stale per-game cooldowns from surviving default parties + orgs + users", async () => {
    db.collection("politicalParties"); // instantiate the lazy mocks
    db.collection("statePartyOrg");
    // Preserve default parties so the in-place reset path runs.
    vi.mocked(getPresetById).mockReturnValue({ deleteDefaultParties: false } as never);

    await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: false,
    });

    expect(db.collectionMocks.politicalParties?.updateMany).toHaveBeenCalledWith(
      { isDefault: true },
      expect.objectContaining({
        $unset: expect.objectContaining({
          nppRecruitmentCooldownUntil: "",
          nppRecruitmentCooldownUntilTurn: "",
          positionShiftCooldowns: "",
          proposalCooldowns: "",
        }),
      })
    );
    expect(db.collectionMocks.statePartyOrg?.updateMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $unset: expect.objectContaining({
          nppRecruitmentCooldownUntil: "",
          nppRecruitmentCooldownUntilTurn: "",
        }),
      })
    );
    // The matching `users.lastCorporationFoundedTurn` clear is teardown and
    // stayed in resetGameWorld, which has its own assertion for it.
  });

  it("clears proposal-voted governance settings from surviving default parties", async () => {
    // Preserve default parties so the in-place reset path runs.
    vi.mocked(getPresetById).mockReturnValue({ deleteDefaultParties: false } as never);

    await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: false,
    });

    expect(db.collectionMocks.politicalParties?.updateMany).toHaveBeenCalledWith(
      { isDefault: true },
      expect.objectContaining({
        $unset: expect.objectContaining({
          customElectionDurationTurns: "",
          leadershipElectionMethod: "",
          transactionApprovalMode: "",
        }),
      })
    );
  });

  it("purges orphan region-keyed rows left by the outgoing region scheme", async () => {
    // Seeded roster for the new world. `BY_BEL` / `DD_BER` are NOT in it — they
    // are 1979-era region ids stranded by the preset switch (`BY` is not even a
    // CountryId; it is Bavaria, a DE state id — the #3523 crash shape).
    db.collection("states");
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA" }, { _id: "WY" }, { _id: "DD_BLN" }]),
    });

    await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: true,
    });

    // unownedSectors keys on `stateId`; regionDemographics `_id` IS the region id.
    expect(db.collectionMocks.unownedSectors?.deleteMany).toHaveBeenCalledWith({
      stateId: { $nin: ["CA", "WY", "DD_BLN"] },
    });
    expect(db.collectionMocks.regionDemographics?.deleteMany).toHaveBeenCalledWith({
      _id: { $nin: ["CA", "WY", "DD_BLN"] },
    });
  });

  it("never purges region rows when the seeded roster came back empty", async () => {
    // Default mock: states.find(...).toArray() → []. A half-failed seed must not
    // be allowed to empty unownedSectors/regionDemographics for the whole world.
    db.collection("unownedSectors"); // instantiate the lazy mocks so the
    db.collection("regionDemographics"); // assertions below are non-vacuous

    await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: true,
    });

    expect(db.collectionMocks.unownedSectors?.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.regionDemographics?.deleteMany).not.toHaveBeenCalled();
  });

  it("routes preset-mismatched party removal to the sink, not only to stdout", async () => {
    // Was a bare console.log carrying a hand-written "[reset]" prefix, so it
    // reached the container's stdout but never the admin's stream.
    vi.mocked(getPresetById).mockReturnValue({ deleteDefaultParties: false } as never);
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.deleteMany.mockResolvedValue({ deletedCount: 3 });
    const lines: string[] = [];

    await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: false,
      log: (msg) => lines.push(msg),
    });

    expect(lines.some((l) => /Removed 3 preset-mismatched/.test(l))).toBe(true);
  });

  it("tags its output so the finalize phase is distinguishable in the stream", async () => {
    // All three phases pipe into one transcript. `[reset]` marks teardown,
    // untagged lines are bootstrap, `[finalize]` is this.
    const lines: string[] = [];
    await finalizeResetGameWorld(db as never, {
      preset: "2019-default",
      teardown: TEARDOWN,
      deleteProfiles: true,
      log: (msg) => lines.push(msg),
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.startsWith("[finalize] "))).toBe(true);
  });
});
