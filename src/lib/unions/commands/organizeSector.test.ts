import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

// The drive spend runs standalone here: no replica set in unit tests.
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_inside: unknown, fallback: () => Promise<unknown>) => fallback()),
}));
import type { Character, CorporateSector, Union } from "@/lib/db/types";
import {
  ORGANIZE_SECTOR_ACTION_COST,
  RAID_APPROVAL_EDGE_REQUIRED,
  organizeSector,
  organizeSectorTreasuryCost,
  raidSucceeds,
  resolveOrganizeSectorDrive,
  sectorUnionizationGain,
} from "./organizeSector";

describe("raidSucceeds (contest rule)", () => {
  it("requires the attacker to out-poll the incumbent by RAID_APPROVAL_EDGE_REQUIRED", () => {
    expect(
      raidSucceeds({ attackerApproval: 60, incumbentApproval: 60 - RAID_APPROVAL_EDGE_REQUIRED })
    ).toBe(true);
    expect(
      raidSucceeds({
        attackerApproval: 60,
        incumbentApproval: 60 - RAID_APPROVAL_EDGE_REQUIRED + 1,
      })
    ).toBe(false);
  });

  it("a tie goes to the incumbent", () => {
    expect(raidSucceeds({ attackerApproval: 55, incumbentApproval: 55 })).toBe(false);
  });

  it("a well-run incumbent (high approval) beats a mediocre attacker", () => {
    expect(raidSucceeds({ attackerApproval: 50, incumbentApproval: 90 })).toBe(false);
  });

  it("a mismanaged incumbent (low approval) is winnable", () => {
    expect(raidSucceeds({ attackerApproval: 40, incumbentApproval: 10 })).toBe(true);
  });
});

describe("sectorUnionizationGain", () => {
  it("is 5 points at full approval and scales linearly", () => {
    expect(sectorUnionizationGain(100)).toBe(5);
    expect(sectorUnionizationGain(60)).toBe(3);
    expect(sectorUnionizationGain(0)).toBe(0);
  });
});

describe("resolveOrganizeSectorDrive", () => {
  it("claims an unrepresented sector on the first drive so its workers count as members", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: 10,
      currentRepresentingUnionId: null,
      attackerUnionId: "attacker",
      attackerApproval: 60,
      incumbentApproval: null,
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.newUnionization).toBe(13);
    expect(outcome.newRepresentingUnionId).toBe("attacker");
    expect(outcome.won).toBe(true);
    expect(outcome.wasRaid).toBe(false);
  });

  it("clamps unionization at 100", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: 95,
      currentRepresentingUnionId: "attacker",
      attackerUnionId: "attacker",
      attackerApproval: 100,
      incumbentApproval: null,
    });
    expect(outcome.newUnionization).toBe(100);
  });

  it("reinforces the union's own sector without changing representation", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: 70,
      currentRepresentingUnionId: "attacker",
      attackerUnionId: "attacker",
      attackerApproval: 60,
      incumbentApproval: null,
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.newRepresentingUnionId).toBe("attacker");
    expect(outcome.won).toBe(true); // stays represented by attacker
  });

  it("a winning raid flips representation and bumps unionization regardless of prior recognition threshold", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: 80,
      currentRepresentingUnionId: "rival",
      attackerUnionId: "attacker",
      attackerApproval: 70,
      incumbentApproval: 20,
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.won).toBe(true);
    expect(outcome.wasRaid).toBe(true);
    expect(outcome.newRepresentingUnionId).toBe("attacker");
    expect(outcome.newUnionization).toBe(83.5);
  });

  it("a losing raid leaves the sector untouched", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: 80,
      currentRepresentingUnionId: "rival",
      attackerUnionId: "attacker",
      attackerApproval: 30,
      incumbentApproval: 90,
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.won).toBe(false);
    expect(outcome.newRepresentingUnionId).toBe("rival");
    expect(outcome.newUnionization).toBe(80);
  });

  it("a dangling incumbent reference (union no longer exists) is treated as an organizing push, not a raid", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: 10,
      currentRepresentingUnionId: "ghost-union",
      attackerUnionId: "attacker",
      attackerApproval: 60,
      incumbentApproval: null, // caller couldn't find the recorded union
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.wasRaid).toBe(false);
    expect(outcome.newRepresentingUnionId).toBe("attacker");
    expect(outcome.won).toBe(true);
  });
});

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    name: "TestChar",
    actions: 100,
    ...overrides,
  } as unknown as Character;
}

function makeUnion(ownerId: ObjectId, overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "Attacker Union",
    ownerId,
    treasury: 10_000,
    approval: 60,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Union;
}

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    unionization: 10,
    workers: 500,
    representingUnionId: null,
    ...overrides,
  } as unknown as CorporateSector;
}

describe("organizeSector (command)", () => {
  function gameStateCollection() {
    return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
  }

  it("rejects a sector outside the union's own country + industry", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sector = makeSector({ sectorType: "agriculture" }); // different industry

    const db = {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection();
        if (name === "unions") return { findOne: vi.fn().mockResolvedValue(union) };
        if (name === "corporateSectors") return { findOne: vi.fn().mockResolvedValue(sector) };
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/own country and industry/i);
    }
  });

  it("a failed raid still spends treasury and action points", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { approval: 20 }); // weak attacker
    const rivalUnion = makeUnion(new ObjectId(), { approval: 90 }); // strong incumbent
    const sector = makeSector({ representingUnionId: rivalUnion._id, unionization: 80 });

    const characterUpdate = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const unionUpdate = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const sectorUpdate = vi.fn();

    const db = {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection();
        if (name === "unions") {
          return {
            findOne: vi
              .fn()
              .mockImplementation(({ _id }: { _id: ObjectId }) =>
                _id.equals(union._id) ? union : _id.equals(rivalUnion._id) ? rivalUnion : null
              ),
            updateOne: unionUpdate,
          };
        }
        if (name === "corporateSectors") {
          return { findOne: vi.fn().mockResolvedValue(sector), updateOne: sectorUpdate };
        }
        if (name === "characters") {
          return { findOne: vi.fn().mockResolvedValue(null), updateOne: characterUpdate };
        }
        if (name === "nonAtomicMoneyFlowReceipts") {
          return {
            insertOne: vi.fn().mockResolvedValue({ insertedId: "key" }),
            findOne: vi.fn().mockResolvedValue(null),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
          };
        }
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.won).toBe(false);
    expect(result.wasRaid).toBe(true);
    expect(result.cashSpent).toBe(
      organizeSectorTreasuryCost({
        workers: sector.workers,
        unionization: sector.unionization,
        isOwnSector: false,
      })
    );
    expect(result.actionsSpent).toBe(ORGANIZE_SECTOR_ACTION_COST);
    // The sector document is never touched on a losing raid.
    expect(sectorUpdate).not.toHaveBeenCalled();
    // But the spend did happen.
    expect(characterUpdate).toHaveBeenCalled();
    expect(unionUpdate).toHaveBeenCalled();
  });

  function driveDb(
    union: Union,
    sector: CorporateSector,
    overrides: {
      unionUpdate?: ReturnType<typeof vi.fn>;
      sectorUpdate?: ReturnType<typeof vi.fn>;
      receiptsInsertOne?: ReturnType<typeof vi.fn>;
      receiptsFindOne?: ReturnType<typeof vi.fn>;
    } = {}
  ) {
    const characterUpdate = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const unionUpdate =
      overrides.unionUpdate ??
      vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const sectorUpdate =
      overrides.sectorUpdate ??
      vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const db = {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection();
        if (name === "unions") {
          return { findOne: vi.fn().mockResolvedValue(union), updateOne: unionUpdate };
        }
        if (name === "corporateSectors") {
          return { findOne: vi.fn().mockResolvedValue(sector), updateOne: sectorUpdate };
        }
        if (name === "characters") {
          return { findOne: vi.fn().mockResolvedValue(null), updateOne: characterUpdate };
        }
        if (name === "nonAtomicMoneyFlowReceipts") {
          return {
            insertOne:
              overrides.receiptsInsertOne ?? vi.fn().mockResolvedValue({ insertedId: "key" }),
            findOne: overrides.receiptsFindOne ?? vi.fn().mockResolvedValue(null),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
          };
        }
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;
    return { db, characterUpdate, unionUpdate, sectorUpdate };
  }

  function duplicateKeyError(): Error {
    return Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
  }

  it("charges both debits then applies the sector snapshot-guarded transition", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sector = makeSector();
    const { db, characterUpdate, unionUpdate, sectorUpdate } = driveDb(union, sector);

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.won).toBe(true);
    expect(result.wasRaid).toBe(false);
    // Both debits are guarded single-document legs: concurrent drives cannot
    // both pass on a stale pool.
    expect(characterUpdate.mock.calls[0][0]).toMatchObject({
      _id: character._id,
      actions: { $gte: ORGANIZE_SECTOR_ACTION_COST },
    });
    expect(unionUpdate.mock.calls[0][0]).toMatchObject({ _id: union._id });
    // The sector write still guards the pre-drive snapshot.
    expect(sectorUpdate.mock.calls[0][0]).toMatchObject({
      _id: sector._id,
      unionization: sector.unionization,
    });
    expect(result.unionization).toBeGreaterThan(sector.unionization);
    expect(result.representingUnionId).toBe(union._id.toString());
  });

  it("compensates the actions debit when the treasury loses its race", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sector = makeSector();
    const { db, characterUpdate, sectorUpdate } = driveDb(union, sector, {
      unionUpdate: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    });

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/treasury changed/i);
    // The applied actions prefix is reversed; the sector is never touched.
    expect(characterUpdate).toHaveBeenCalledTimes(2);
    expect(sectorUpdate).not.toHaveBeenCalled();
  });

  it("reverses both debits when the sector moved under the drive", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sector = makeSector();
    const { db, characterUpdate, unionUpdate } = driveDb(union, sector, {
      sectorUpdate: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    });

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/sector state changed/i);
    expect(characterUpdate).toHaveBeenCalledTimes(2);
    expect(unionUpdate).toHaveBeenCalledTimes(2);
  });

  it("replays a same-key retry without charging again", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sector = makeSector();
    const fingerprint = `organize-sector:${union._id.toHexString()}:${sector._id.toHexString()}`;
    const { db, characterUpdate } = driveDb(union, sector, {
      receiptsInsertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
      receiptsFindOne: vi.fn().mockResolvedValue({ _id: "k", status: "completed", fingerprint }),
    });

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString(), {
      idempotencyKey: "k",
    });

    expect(result.ok).toBe(true);
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("rejects a key reused for a different drive", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sector = makeSector();
    const { db, characterUpdate } = driveDb(union, sector, {
      receiptsInsertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
      receiptsFindOne: vi
        .fn()
        .mockResolvedValue({ _id: "k", status: "completed", fingerprint: "organize-sector:other" }),
    });

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString(), {
      idempotencyKey: "k",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/different drive/i);
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("fails closed when the key already settled without completing", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sector = makeSector();
    const fingerprint = `organize-sector:${union._id.toHexString()}:${sector._id.toHexString()}`;
    const { db, characterUpdate } = driveDb(union, sector, {
      receiptsInsertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
      receiptsFindOne: vi.fn().mockResolvedValue({ _id: "k", status: "failed", fingerprint }),
    });

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString(), {
      idempotencyKey: "k",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/already settled/i);
    expect(characterUpdate).not.toHaveBeenCalled();
  });
});
