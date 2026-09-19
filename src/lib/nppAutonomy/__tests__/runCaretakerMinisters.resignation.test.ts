import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const { atLeastMock } = vi.hoisted(() => ({ atLeastMock: vi.fn() }));
vi.mock("../featureFlag", () => ({
  nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a),
}));

import { runCaretakerMinisters } from "../ministerialGovernance";

const now = new Date("2026-06-24T12:00:00Z");
const LONG_AGO = new Date("2026-01-01T00:00:00Z");

const PERSONALITY = { loyalty: 50, ambition: 50, stubbornness: 50 };

function caretakerDoc(opts: {
  countryId: string;
  positionId: string;
  appointedAt?: Date;
  appointedByCharacterId?: ObjectId | null;
}) {
  const nppId = new ObjectId();
  return {
    nppId,
    doc: {
      _id: new ObjectId(),
      countryId: opts.countryId,
      positionId: opts.positionId,
      isNPP: true,
      nppId,
      appointedByCharacterId:
        opts.appointedByCharacterId === undefined ? new ObjectId() : opts.appointedByCharacterId,
      appointedAt: opts.appointedAt ?? LONG_AGO,
      ministerialActions: 0,
    },
  };
}

function seedCaretaker(
  db: MockDb,
  seat: Record<string, unknown>,
  nppDoc: Record<string, unknown> | null = {
    personality: PERSONALITY,
    policies: { economic: 0, social: 0 },
  }
) {
  db.collection("cabinetMembers");
  vi.mocked(db.collectionMocks.cabinetMembers.find).mockReturnValue({
    toArray: vi.fn().mockResolvedValue([seat]),
  } as never);
  db.collection("npps");
  vi.mocked(db.collectionMocks.npps.find).mockReturnValue({
    toArray: vi.fn().mockResolvedValue(nppDoc ? [{ _id: seat["nppId"], ...nppDoc }] : []),
  } as never);
}

describe("runCaretakerMinisters NPP resignation hook (issue #859)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    atLeastMock.mockReset();
    atLeastMock.mockResolvedValue(true);
  });

  // The mock Db creates collection mocks lazily: asserting "no gauge write"
  // must materialise the mock first, otherwise the lookup itself throws.
  function expectNoGaugeWrite() {
    db.collection("ukGovernment");
    expect(db.collectionMocks.ukGovernment.updateOne).not.toHaveBeenCalled();
  }

  it("a UK caretaker resigns on a failed roll: guarded vacate plus flat gauge hit", async () => {
    const { doc } = caretakerDoc({ countryId: "UK", positionId: "chancellor" });
    seedCaretaker(db, doc as unknown as Record<string, unknown>);

    const result = await runCaretakerMinisters(db as unknown as Db, "UK", 100, now, {
      rng: () => 0,
    });

    expect(result.ran).toBe(true);
    // Guarded by _id + isNPP so a concurrent dismissal wins the race instead
    // of double-vacating.
    expect(db.collectionMocks.cabinetMembers.deleteOne).toHaveBeenCalledWith({
      _id: doc._id,
      countryId: "UK",
      isNPP: true,
    });
    // Chancellor is a Great Office: the flat ministerResigned hit doubles
    // (100 -> 76), matching the player-resignation flow.
    const gaugeWrite = db.collectionMocks.ukGovernment.updateOne.mock.calls[0][1].$set;
    expect(gaugeWrite.confidenceGauge).toBe(76);
  });

  it("resignation is deterministic in the injected rng (pass keeps the seat)", async () => {
    const first = caretakerDoc({ countryId: "UK", positionId: "chancellor" });
    seedCaretaker(db, first.doc as unknown as Record<string, unknown>);

    const kept = await runCaretakerMinisters(db as unknown as Db, "UK", 100, now, {
      rng: () => 1,
    });
    expect(kept.ran).toBe(true);
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
    expectNoGaugeWrite();
  });

  it("fresh appointees inside grace never resign, even on rng 0", async () => {
    const { doc } = caretakerDoc({
      countryId: "UK",
      positionId: "chancellor",
      appointedAt: now,
    });
    seedCaretaker(db, doc as unknown as Record<string, unknown>);

    await runCaretakerMinisters(db as unknown as Db, "UK", 100, now, { rng: () => 0 });
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
    expectNoGaugeWrite();
  });

  it("non-UK caretakers never resign: the hook is UK-only", async () => {
    const { doc } = caretakerDoc({ countryId: "DE", positionId: "finance_minister" });
    seedCaretaker(db, doc as unknown as Record<string, unknown>);

    const result = await runCaretakerMinisters(db as unknown as Db, "DE", 100, now, {
      rng: () => 0,
    });

    expect(result.ran).toBe(true);
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
    expectNoGaugeWrite();
    // The resignation inputs are never even loaded outside the UK.
    expect(db.collectionMocks.governmentApprovals).toBeUndefined();
  });

  it("V1 NPP-government seats are excluded from resignation", async () => {
    // Appointed by an NPP head (null player head): a V1 government seat, not
    // a player-appointed caretaker.
    const { doc } = caretakerDoc({
      countryId: "UK",
      positionId: "chancellor",
      appointedByCharacterId: null,
    });
    seedCaretaker(db, doc as unknown as Record<string, unknown>);

    const result = await runCaretakerMinisters(db as unknown as Db, "UK", 100, now, {
      rng: () => 0,
    });

    expect(result.ran).toBe(true);
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
    expectNoGaugeWrite();
    expect(db.collectionMocks.governmentApprovals).toBeUndefined();
  });

  it("a lost resignation race writes no gauge event (no duplicate)", async () => {
    const { doc } = caretakerDoc({ countryId: "UK", positionId: "chancellor" });
    seedCaretaker(db, doc as unknown as Record<string, unknown>);
    // Another writer (dismissal, appointment) won the race first.
    db.collectionMocks.cabinetMembers.deleteOne.mockResolvedValue({ deletedCount: 0 });

    const result = await runCaretakerMinisters(db as unknown as Db, "UK", 100, now, {
      rng: () => 0,
    });

    expect(result.ran).toBe(true);
    expectNoGaugeWrite();
  });

  it("seats with no portfolio mechanics never resign (no invalid resignation)", async () => {
    const { doc } = caretakerDoc({ countryId: "UK", positionId: "not_a_seat" });
    seedCaretaker(db, doc as unknown as Record<string, unknown>);

    await runCaretakerMinisters(db as unknown as Db, "UK", 100, now, { rng: () => 0 });
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
    expectNoGaugeWrite();
    expect(db.collectionMocks.governmentApprovals).toBeUndefined();
  });

  it("caretakers with no backing NPP doc never resign (no invalid resignation)", async () => {
    const { doc } = caretakerDoc({ countryId: "UK", positionId: "chancellor" });
    seedCaretaker(db, doc as unknown as Record<string, unknown>, null);

    await runCaretakerMinisters(db as unknown as Db, "UK", 100, now, { rng: () => 0 });
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
    expectNoGaugeWrite();
  });
});
