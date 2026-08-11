import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb, assertSetFields } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";
import type { NppCorpCeoAffiliation } from "@/lib/admin/nppCorpCeoSelection";
import {
  validateCaretakerAppointment,
  pickCaretakerNpp,
  appointCaretakerCeo,
  dismissCaretakerCeo,
} from "../caretakerCeo";

const now = new Date("2026-06-24T12:00:00Z");

function corp(over: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    name: "Acme",
    type: "manufacturing",
    ceoId: new ObjectId(),
    ceoType: "character",
    userId: new ObjectId(),
    countryId: "US",
    headquartersState: "DC",
    liquidCapital: 5_000_000,
    ceoVacant: false,
    ...over,
  } as Corporation;
}

describe("validateCaretakerAppointment (pure)", () => {
  it("allows a sitting human CEO", () => {
    expect(validateCaretakerAppointment(corp())).toBeNull();
    expect(validateCaretakerAppointment(corp({ ceoType: undefined }))).toBeNull();
  });

  it("rejects a missing corp", () => {
    expect(validateCaretakerAppointment(null)).toBe("corp-not-found");
  });

  it("rejects a corp that already has a caretaker", () => {
    const c = corp({
      caretakerCeo: {
        underlyingCharacterId: new ObjectId(),
        underlyingUserId: new ObjectId(),
        appointedTurn: 1,
      },
    });
    expect(validateCaretakerAppointment(c)).toBe("already-caretaker");
  });

  it("rejects a vacant CEO seat", () => {
    expect(validateCaretakerAppointment(corp({ ceoVacant: true }))).toBe("ceo-vacant");
  });

  it("rejects a non-character (npp/imperial) CEO", () => {
    expect(validateCaretakerAppointment(corp({ ceoType: "npp" }))).toBe("ceo-not-character");
    expect(validateCaretakerAppointment(corp({ ceoType: "imperial" }))).toBe("ceo-not-character");
  });
});

describe("pickCaretakerNpp (pure)", () => {
  const freeId = new ObjectId().toString();
  const affiliations: NppCorpCeoAffiliation[] = [
    { party: "5", corpCount: 0, freeNpps: [{ id: freeId, influence: 50, seq: 1 }] },
    { party: "independent", corpCount: 0, freeNpps: [] },
  ];

  it("returns a balanced pick when no NPP is forced", () => {
    expect(pickCaretakerNpp(affiliations)).toBe(freeId);
  });

  it("honors a forced NPP that is free", () => {
    expect(pickCaretakerNpp(affiliations, freeId)).toBe(freeId);
  });

  it("rejects a forced NPP that is not in the free pool", () => {
    expect(pickCaretakerNpp(affiliations, new ObjectId().toString())).toBeNull();
  });

  it("returns null when no NPP is free at all", () => {
    expect(pickCaretakerNpp([{ party: "5", corpCount: 0, freeNpps: [] }])).toBeNull();
  });
});

describe("appointCaretakerCeo (I/O)", () => {
  let db: MockDb;
  const nppId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    // gatherCaretakerAffiliations reads politicalParties (participating set),
    // corporations (existing npp CEOs → none), then npps (active free pool).
    // Party "5" must be non-defunct or buildCeoAffiliations filters the NPP out.
    vi.mocked(db.collection("politicalParties").find).mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ sequentialId: 5 }]),
    } as never);
    // The active-NPP find returns our free NPP.
    vi.mocked(db.collection("npps").find).mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: nppId, party: "5", politicalInfluence: 50, sequentialId: 1 }]),
    } as never);
    vi.mocked(db.collection("npps").findOne).mockResolvedValue({
      _id: nppId,
      name: "Caretaker NPP",
    } as never);
  });

  it("installs the NPP, preserves owner userId, zeroes salary, stashes the human", async () => {
    const ceoId = new ObjectId();
    const userId = new ObjectId();
    const c = corp({ ceoId, userId, ceoSalary: 9999 });

    const result = await appointCaretakerCeo(db as unknown as Db, {
      corp: c,
      turn: 42,
      now,
    });

    expect(result.ok).toBe(true);
    expect(result.nppId).toBe(nppId.toString());

    const update = db.collectionMocks["corporations"]!.updateOne;
    assertSetFields(update, { ceoType: "npp", ceoVacant: false, ceoSalary: 0 });
    // ceoId now points at the NPP; userId stays the appointing owner.
    const call = update.mock.calls[0]![1] as { $set: Record<string, unknown> };
    expect((call.$set.ceoId as ObjectId).equals(nppId)).toBe(true);
    expect(call.$set.userId).toBeUndefined(); // userId untouched → owner retains control
    const caretaker = call.$set.caretakerCeo as {
      underlyingCharacterId: ObjectId;
      underlyingUserId: ObjectId;
      appointedTurn: number;
    };
    expect(caretaker.underlyingCharacterId.equals(ceoId)).toBe(true);
    expect(caretaker.underlyingUserId.equals(userId)).toBe(true);
    expect(caretaker.appointedTurn).toBe(42);
  });

  it("refuses when the corp already has a caretaker (no write)", async () => {
    const c = corp({
      caretakerCeo: {
        underlyingCharacterId: new ObjectId(),
        underlyingUserId: new ObjectId(),
        appointedTurn: 1,
      },
    });
    const result = await appointCaretakerCeo(db as unknown as Db, { corp: c, turn: 1, now });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("already-caretaker");
    expect(db.collectionMocks["corporations"]).toBeUndefined(); // never written
  });

  it("returns no-eligible-npp when the country pool is empty", async () => {
    vi.mocked(db.collection("npps").find).mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    const result = await appointCaretakerCeo(db as unknown as Db, { corp: corp(), turn: 1, now });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no-eligible-npp");
  });
});

describe("dismissCaretakerCeo (I/O)", () => {
  it("restores the displaced human CEO and clears caretakerCeo", async () => {
    const db = createMockDb();
    const underlyingCharacterId = new ObjectId();
    const underlyingUserId = new ObjectId();
    const c = corp({
      ceoId: new ObjectId(), // currently the NPP
      ceoType: "npp",
      caretakerCeo: { underlyingCharacterId, underlyingUserId, appointedTurn: 10 },
    });

    const result = await dismissCaretakerCeo(db as unknown as Db, { corp: c, turn: 20, now });
    expect(result.ok).toBe(true);
    expect(result.restoredCharacterId).toBe(underlyingCharacterId.toString());

    const update = db.collectionMocks["corporations"]!.updateOne;
    assertSetFields(update, { ceoType: "character", ceoVacant: false });
    const call = update.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
      $unset: Record<string, unknown>;
    };
    expect((call.$set.ceoId as ObjectId).equals(underlyingCharacterId)).toBe(true);
    expect((call.$set.userId as ObjectId).equals(underlyingUserId)).toBe(true);
    expect(call.$unset.caretakerCeo).toBe("");
  });

  it("returns an auto-installed caretaker (no underlying character) to a vacant seat", async () => {
    const db = createMockDb();
    const underlyingUserId = new ObjectId();
    const c = corp({
      ceoId: new ObjectId(), // currently the NPP
      ceoType: "npp",
      caretakerCeo: { underlyingUserId, appointedTurn: 10 }, // no underlyingCharacterId
    });

    const result = await dismissCaretakerCeo(db as unknown as Db, { corp: c, turn: 20, now });
    expect(result.ok).toBe(true);
    expect(result.restoredCharacterId).toBeUndefined();

    const call = db.collectionMocks["corporations"]!.updateOne.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
      $unset: Record<string, unknown>;
    };
    expect(call.$set).toMatchObject({ ceoType: "character", ceoVacant: true });
    expect((call.$set.userId as ObjectId).equals(underlyingUserId)).toBe(true);
    expect(call.$set).not.toHaveProperty("ceoId");
    expect(call.$unset.caretakerCeo).toBe("");
    expect(call.$unset.ceoId).toBe("");
  });

  it("is a no-op error when there is no caretaker", async () => {
    const db = createMockDb();
    const result = await dismissCaretakerCeo(db as unknown as Db, { corp: corp(), turn: 1, now });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not-caretaker");
    expect(db.collectionMocks["corporations"]).toBeUndefined(); // never written
  });
});
