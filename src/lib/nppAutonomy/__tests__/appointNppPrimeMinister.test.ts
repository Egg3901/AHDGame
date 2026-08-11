import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// Stub the heavy seating side-effects (Discord / country history / cabinet
// clears) — we only assert the formation decision + the persisted formation
// fields. tallySeatsByParty / getLargestParty stay real. vi.hoisted keeps the
// mock fns available to the hoisted vi.mock factories.
const { appointPrimeMinisterMock, isActiveMock } = vi.hoisted(() => ({
  appointPrimeMinisterMock: vi.fn().mockResolvedValue(undefined),
  isActiveMock: vi.fn(),
}));
vi.mock("@/lib/turn/parliamentaryGovernment", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/turn/parliamentaryGovernment")>();
  return { ...actual, appointPrimeMinister: appointPrimeMinisterMock };
});
vi.mock("../featureFlag", () => ({
  isNppAutonomyActive: (...args: unknown[]) => isActiveMock(...args),
}));

import { appointNppPrimeMinister } from "../appointNppPrimeMinister";

let db: MockDb;
const now = new Date("2026-06-23T12:00:00Z");

function cursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function setup(opts: {
  gov: Record<string, unknown> | null;
  officials: Array<Record<string, unknown>>;
  npp?: Record<string, unknown> | null;
}) {
  db = createMockDb();
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(opts.gov),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["electedOfficials"] = {
    ...db.collection("electedOfficials"),
    find: vi.fn().mockReturnValue(cursor(opts.officials)),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["npps"] = {
    ...db.collection("npps"),
    findOne: vi.fn().mockResolvedValue(opts.npp ?? null),
  } as MockDb["collectionMocks"][string];
}

beforeEach(() => {
  appointPrimeMinisterMock.mockClear();
  isActiveMock.mockReset();
});

describe("appointNppPrimeMinister", () => {
  const nppId = new ObjectId();
  const seniorNpp = { _id: nppId, name: "PM Bot", party: "10" };
  const pendingGov = { _id: "UK", status: "pending", majorityThreshold: 326 };

  it("does nothing when autonomy is inactive (player-enabled country)", async () => {
    isActiveMock.mockResolvedValue(false);
    setup({ gov: pendingGov, officials: [] });
    const seated = await appointNppPrimeMinister(db as unknown as Db, "UK", 100, now);
    expect(seated).toBe(false);
    expect(appointPrimeMinisterMock).not.toHaveBeenCalled();
    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when a government is already formed", async () => {
    isActiveMock.mockResolvedValue(true);
    setup({ gov: { _id: "UK", status: "formed", majorityThreshold: 326 }, officials: [] });
    const seated = await appointNppPrimeMinister(db as unknown as Db, "UK", 100, now);
    expect(seated).toBe(false);
    expect(appointPrimeMinisterMock).not.toHaveBeenCalled();
  });

  it("does nothing when the largest party has no seated NPP MP", async () => {
    isActiveMock.mockResolvedValue(true);
    setup({ gov: pendingGov, officials: [] });
    const seated = await appointNppPrimeMinister(db as unknown as Db, "UK", 100, now);
    expect(seated).toBe(false);
    expect(db.collectionMocks["governmentFormations"].updateOne).not.toHaveBeenCalled();
  });

  it("seats the most-senior NPP of the largest party and forms a majority gov", async () => {
    isActiveMock.mockResolvedValue(true);
    const otherNppId = new ObjectId();
    setup({
      gov: pendingGov,
      // Party "10" holds 400 seats (majority over 326); the 400-seat MP is the leader.
      officials: [
        { countryId: "UK", officeType: "commons", party: "10", isNPP: true, nppId, seatsHeld: 400 },
        {
          countryId: "UK",
          officeType: "commons",
          party: "10",
          isNPP: true,
          nppId: otherNppId,
          seatsHeld: 50,
        },
      ],
      npp: seniorNpp,
    });

    const seated = await appointNppPrimeMinister(db as unknown as Db, "UK", 100, now);
    expect(seated).toBe(true);

    // Seated via the shared PM path with the NPP id (not a character id).
    expect(appointPrimeMinisterMock).toHaveBeenCalledWith(
      expect.anything(),
      "UK",
      null,
      nppId,
      "PM Bot",
      now
    );
    // npps.findOne resolved the senior (400-seat) MP.
    expect(db.collectionMocks["npps"].findOne).toHaveBeenCalledWith({ _id: nppId });

    const [, op] = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(op.$set).toMatchObject({
      status: "formed",
      formationType: "majority",
      pmCharacterId: null,
      pmNppId: nppId,
      pmName: "PM Bot",
      governingPartyId: "10",
      totalSeatsSupporting: 450,
      pmVacancyDeadlineTurn: null,
      formedTurn: 100,
    });
  });

  it("forms a minority government when the largest party is below threshold", async () => {
    isActiveMock.mockResolvedValue(true);
    setup({
      gov: pendingGov,
      officials: [
        { countryId: "UK", officeType: "commons", party: "10", isNPP: true, nppId, seatsHeld: 120 },
      ],
      npp: seniorNpp,
    });

    const seated = await appointNppPrimeMinister(db as unknown as Db, "UK", 100, now);
    expect(seated).toBe(true);
    const [, op] = (
      db.collectionMocks["governmentFormations"].updateOne as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(op.$set.formationType).toBe("minority");
  });
});
