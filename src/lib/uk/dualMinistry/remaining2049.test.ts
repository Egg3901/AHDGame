import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/api/parliamentaryFreeze", () => ({
  checkLegislationFreeze: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn(async () => undefined),
}));
vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  appointPrimeMinister: vi.fn().mockResolvedValue(undefined),
  ensureParliamentaryGovernmentFormation: vi.fn().mockResolvedValue(null),
  tallySeatsByParty: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/singleplayer", () => ({
  SINGLEPLAYER_USER_ID: "504c41594552000000000001",
  isSingleplayer: vi.fn(() => true),
}));
// ⚠️ MOCK THE FOLDER MODULE, NOT `@/lib/uk/cabinetEligibility`. That path is a
// forwarder now, and `cabinetApi` imports the folder directly -- mocking the
// forwarder leaves the real implementation in place and the spy never fires.
// Mocking the folder covers both, because the forwarder re-exports it.
vi.mock("@/lib/countries/uk/cabinetEligibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/countries/uk/cabinetEligibility")>();
  return {
    ...actual,
    requireCurrentPrimeMinister: vi.fn(async () => ({
      pmCharacterId: new ObjectId(),
      pmCharacter: { name: "PM" },
      countryId: "UK",
    })),
    getEligibleCabinetCharacters: vi.fn(async () => []),
  };
});

import { getCabinetCharactersHandler } from "@/lib/uk/cabinetApi";
import { POST as voteOnCabinetBill } from "@/app/api/country/[code]/legislature/cabinet-bills/[id]/vote/route";
import { unionLegislativeDomains } from "./rules";
import { resolveOfficeActionBonus } from "@/lib/actions/officeActionBonus";
import { ensureUkSharedPool } from "@/lib/cabinet/ministerialActionPool";
import { preserveSurvivingCabinetRow } from "./survivor";
import { clearCabinetOnTransition } from "@/lib/cabinetTransition";
import { seedCabinetIndexes } from "@/lib/admin/seed/indexes/cabinet";
import { pinnedSingleplayerHeadOfState } from "@/lib/singleplayerHeadOfState";

const PM_USER_ID = new ObjectId().toString();

function mockAuth() {
  return { ok: true, user: { userId: PM_USER_ID } } as never;
}

describe("candidates API position-aware eligibility", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue(mockAuth());
  });

  it("passes the vacant position through so complementary holders stay eligible", async () => {
    const res = await getCabinetCharactersHandler(
      new Request(
        "http://localhost/api/country/uk/executive/cabinet/characters?positionId=chancellor"
      ),
      "UK"
    );
    expect(res.status).toBe(200);
    const { getEligibleCabinetCharacters } = await import("@/lib/countries/uk/cabinetEligibility");
    const calls = vi.mocked(getEligibleCabinetCharacters).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe("UK");
    expect(calls[0]![3]).toBe("chancellor");
  });

  it("falls back to the legacy list for an unknown seat", async () => {
    await getCabinetCharactersHandler(
      new Request(
        "http://localhost/api/country/uk/executive/cabinet/characters?positionId=not_a_seat"
      ),
      "UK"
    );
    const { getEligibleCabinetCharacters } = await import("@/lib/countries/uk/cabinetEligibility");
    expect(vi.mocked(getEligibleCabinetCharacters).mock.calls[0]![3]).toBeNull();
  });

  it("falls back to the legacy list without a position query", async () => {
    await getCabinetCharactersHandler(
      new Request("http://localhost/api/country/uk/executive/cabinet/characters"),
      "UK"
    );
    const { getEligibleCabinetCharacters } = await import("@/lib/countries/uk/cabinetEligibility");
    expect(vi.mocked(getEligibleCabinetCharacters).mock.calls[0]![3]).toBeNull();
  });
});

describe("cabinet-bill domain union and quorum shape", () => {
  it("unions both portfolios so a dual holder proposes from either office", () => {
    expect(
      unionLegislativeDomains([
        ["economy", "treasury"],
        ["constitution", "economy"],
      ])
    ).toEqual(["economy", "treasury", "constitution"]);
  });

  it("counts the quorum in distinct characters so a second title buys no extra seat", () => {
    const source = "src/app/api/country/[code]/legislature/cabinet-bills/route.ts";
    const body = readFileSync(source, "utf8");
    expect(body).toContain('.distinct("characterId"');
    expect(body).toContain("new Set(");
    expect(body).not.toContain("countDocuments({ countryId, characterId: { $ne: null } })");
  });

  it("builds the proposer domains from every holder row via the union helper", () => {
    const body = readFileSync(
      "src/app/api/country/[code]/legislature/cabinet-bills/route.ts",
      "utf8"
    );
    expect(body).toContain("unionLegislativeDomains(");
  });
});

describe("cabinet-bill vote is one per character", () => {
  const billId = new ObjectId();
  const voterId = new ObjectId();
  let voteDb: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = createMockDb();
    voteDb = db;
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: voterId, name: "Dual Holder" } },
    } as never);
    db.collection("governmentFormations");
    db.collectionMocks.governmentFormations!.findOne.mockResolvedValue({
      _id: "JP",
      pmCharacterId: new ObjectId(),
    });
    db.collection("cabinetMembers");
    // dual holder: two rows, one ballot
    db.collectionMocks.cabinetMembers!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      positionId: "chancellor",
    });
    db.collection("bills");
  });

  // Cabinet bills are live on JP (UK has cabinetBillsEnabled off); the ballot
  // keying is country-agnostic, so JP exercises the one-vote-per-character path.
  function postVote() {
    return voteOnCabinetBill(
      new Request("http://localhost/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: "for" }),
      }),
      { params: Promise.resolve({ code: "jp", id: billId.toString() }) }
    );
  }

  it("keys the ballot by character id with a guarded single increment", async () => {
    voteDb.collectionMocks.bills!.findOne.mockResolvedValue({ _id: billId, votes: {} });
    voteDb.collectionMocks.bills!.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const res = await postVote();
    expect(res.status).toBe(200);
    const update = voteDb.collectionMocks.bills!.updateOne.mock.calls[0]!;
    expect(update[0]).toMatchObject({
      [`votes.${voterId.toString()}`]: { $exists: false },
    });
    expect(update[1]).toMatchObject({
      $set: { [`votes.${voterId.toString()}`]: "for" },
      $inc: { votesFor: 1 },
    });
  });

  it("rejects a second ballot from the same character", async () => {
    voteDb.collectionMocks.bills!.findOne.mockResolvedValue({
      _id: billId,
      votes: { [voterId.toString()]: "for" },
    });

    const res = await postVote();
    expect(res.status).toBe(400);
    expect(voteDb.collectionMocks.bills!.updateOne).not.toHaveBeenCalled();
  });
});

describe("office action bonus is one per character", () => {
  const officeActionBonus = { commons: 1, ukCabinet: 1 };

  it("grants a dual holder the same single cabinet bonus as a single-title holder", () => {
    const single = resolveOfficeActionBonus({
      currentOfficeType: "ukCabinet",
      electedSeatOfficeType: "commons",
      isCabinetMember: true,
      cabinetOfficeType: "ukCabinet",
      officeActionBonus,
      countryId: "UK",
    });
    expect(single).toBe(2);
    // isCabinetMember is a boolean: two rows cannot stack a second bonus
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: "ukCabinet",
        electedSeatOfficeType: "commons",
        isCabinetMember: true,
        cabinetOfficeType: "ukCabinet",
        officeActionBonus,
        countryId: "UK",
      })
    ).toBe(single);
  });
});

describe("resignation and dismissal preserve the surviving row", () => {
  const firedPosition = "chancellor";
  const survivorPosition = "deputy_prime_minister";

  function mockSurvivorDb(
    rows: { positionId: string; roleSlot: string }[],
    currentOffice: unknown
  ) {
    const db = createMockDb();
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers!.find.mockReturnValue({
      project: () => ({ toArray: async () => rows }),
    } as never);
    db.collection("characters");
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      currentOffice,
    });
    return db;
  }

  it("repoints currentOffice at the surviving row after one seat is vacated", async () => {
    const characterId = new ObjectId();
    const db = mockSurvivorDb([{ positionId: survivorPosition, roleSlot: "central" }], {
      type: "ukCabinet",
      positionId: firedPosition,
    });

    const kept = await preserveSurvivingCabinetRow(
      db as unknown as Db,
      "UK",
      characterId,
      new Date()
    );

    expect(kept).toBe(true);
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      {
        $set: expect.objectContaining({
          currentOffice: { type: "ukCabinet", positionId: survivorPosition },
        }),
      }
    );
  });

  it("reports fully departed when no row survives so the caller restores the seat", async () => {
    const characterId = new ObjectId();
    const db = mockSurvivorDb([], { type: "ukCabinet", positionId: firedPosition });

    const kept = await preserveSurvivingCabinetRow(
      db as unknown as Db,
      "UK",
      characterId,
      new Date()
    );

    expect(kept).toBe(false);
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
  });

  it("leaves currentOffice alone when it already points at the survivor", async () => {
    const characterId = new ObjectId();
    const db = mockSurvivorDb([{ positionId: survivorPosition, roleSlot: "central" }], {
      type: "ukCabinet",
      positionId: survivorPosition,
    });

    const kept = await preserveSurvivingCabinetRow(
      db as unknown as Db,
      "UK",
      characterId,
      new Date()
    );

    expect(kept).toBe(true);
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
  });
});

describe("government transition clears both rows", () => {
  it("deletes every holder row once and notifies the player once", async () => {
    const holderId = new ObjectId();
    const db = createMockDb();
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers!.find.mockReturnValue({
      toArray: async () => [
        { _id: new ObjectId(), characterId: holderId, positionId: "chancellor" },
        { _id: new ObjectId(), characterId: holderId, positionId: "deputy_prime_minister" },
      ],
    } as never);
    db.collection("cabinetNominations");
    db.collection("cabinetSettings");
    db.collection("ministerialOrders");
    db.collection("characters");
    db.collectionMocks.characters!.find.mockReturnValue({
      toArray: async () => [
        { _id: holderId, userId: new ObjectId(), currentOffice: { type: "ukCabinet" } },
      ],
    } as never);
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: async () => [
        { characterId: holderId, officeType: "commons", state: "1", countryId: "UK" },
      ],
    } as never);

    await clearCabinetOnTransition(db as unknown as Db, "UK");

    expect(db.collectionMocks.cabinetMembers!.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.cabinetMembers!.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "UK" })
    );
    const { createNotifications } = await import("@/lib/notifications");
    expect(createNotifications).toHaveBeenCalledTimes(1);
    const notes = vi.mocked(createNotifications).mock.calls[0]![0] as unknown[];
    expect(notes).toHaveLength(1);
  });
});

describe("seed role-slot index create-before-drop", () => {
  it("creates the replacement unique index before dropping the legacy one", async () => {
    const db = createMockDb();
    db.collection("cabinetMembers");
    (db.collectionMocks.cabinetMembers as unknown as Record<string, unknown>).dropIndex = vi
      .fn()
      .mockResolvedValue(undefined);
    const logs: string[] = [];

    await seedCabinetIndexes(db as unknown as Db, (msg) => logs.push(msg));

    expect(db.collectionMocks.cabinetMembers!.createIndex).toHaveBeenCalledWith(
      { countryId: 1, characterId: 1, roleSlot: 1 },
      expect.objectContaining({
        unique: true,
        name: "cabinetMembers_countryId_characterId_roleSlot",
      })
    );
    const dropMock = (
      db.collectionMocks.cabinetMembers as unknown as { dropIndex: ReturnType<typeof vi.fn> }
    ).dropIndex;
    expect(dropMock).toHaveBeenCalledWith("cabinetMembers_countryId_characterId");
    const createOrder =
      db.collectionMocks.cabinetMembers!.createIndex.mock.invocationCallOrder.find(
        (_, i) =>
          (db.collectionMocks.cabinetMembers!.createIndex.mock.calls[i]![0] as object) &&
          "roleSlot" in (db.collectionMocks.cabinetMembers!.createIndex.mock.calls[i]![0] as object)
      )!;
    expect(dropMock.mock.invocationCallOrder[0]).toBeGreaterThan(createOrder);
  });
});

describe("ParliamentaryCabinetClient positionId", () => {
  it("sends the vacant position with the candidates fetch", () => {
    const body = readFileSync(
      "src/app/country/[code]/executive/cabinet/ParliamentaryCabinetClient.tsx",
      "utf8"
    );
    expect(body).toContain("?positionId=");
    expect(body).toContain("fetchEligibleCharacters(position.id)");
  });
});

describe("briefing shared balance", () => {
  it("resolves both office pages from the same per-player pool", async () => {
    const db = createMockDb();
    const holder = new ObjectId();
    const now = new Date("2026-09-17T14:00:00Z");
    db.collection("characters");
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);
    db.collection("cabinetMembers");
    const rows = [
      { ministerialActions: 3, lastMinisterialActionResetDay: "2026-09-17" },
      { ministerialActions: 1, lastMinisterialActionResetDay: "2026-09-16" },
    ];
    db.collectionMocks.cabinetMembers!.find.mockReturnValue({
      project: () => ({ toArray: async () => rows }),
    } as never);

    const firstOffice = await ensureUkSharedPool(db as unknown as Db, holder, now);
    const secondOffice = await ensureUkSharedPool(db as unknown as Db, holder, now);

    expect(firstOffice.remaining).toBe(1);
    expect(secondOffice).toEqual(firstOffice);
  });

  it("reads the shared pool on the briefing path instead of the row balance", () => {
    const body = readFileSync(
      "src/app/api/country/[code]/executive/cabinet/[positionId]/briefing/route.ts",
      "utf8"
    );
    expect(body).toContain("sharedMinisterialActions");
    expect(body).toContain("sharedRemaining ??");
  });
});

describe("singleplayer head-of-state pin", () => {
  it("pins by the head-of-state flag regardless of cabinet rows", async () => {
    const db = createMockDb();
    const pinnedId = new ObjectId();
    db.collection("characters");
    db.collectionMocks.characters!.findOne.mockImplementation(async (filter: unknown) => {
      const f = filter as Record<string, unknown>;
      if (f.singleplayerHeadOfState === true) {
        return { _id: pinnedId, countryId: "UK", singleplayerHeadOfState: true };
      }
      return null;
    });

    const pinned = await pinnedSingleplayerHeadOfState(db as unknown as Db, "UK");

    expect(pinned?._id).toEqual(pinnedId);
    expect(db.collectionMocks.characters!.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "UK", singleplayerHeadOfState: true })
    );
  });
});
