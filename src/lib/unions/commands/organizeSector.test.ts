import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, CorporateSector, Union } from "@/lib/db/types";
import {
  ORGANIZE_SECTOR_ACTION_COST,
  ORGANIZE_SECTOR_TREASURY_COST,
  RAID_APPROVAL_EDGE_REQUIRED,
  SECTOR_RECOGNITION_THRESHOLD,
  SECTOR_UNIONIZATION_GAIN_PER_DRIVE,
  organizeSector,
  raidSucceeds,
  resolveOrganizeSectorDrive,
} from "./organizeSector";

describe("raidSucceeds (contest rule)", () => {
  it("requires the attacker to out-poll the incumbent by RAID_APPROVAL_EDGE_REQUIRED", () => {
    expect(raidSucceeds({ attackerApproval: 60, incumbentApproval: 60 - RAID_APPROVAL_EDGE_REQUIRED })).toBe(
      true
    );
    expect(
      raidSucceeds({ attackerApproval: 60, incumbentApproval: 60 - RAID_APPROVAL_EDGE_REQUIRED + 1 })
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

describe("resolveOrganizeSectorDrive", () => {
  it("organizes an unrepresented sector without granting recognition below threshold", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: 10,
      currentRepresentingUnionId: null,
      attackerUnionId: "attacker",
      attackerApproval: 60,
      incumbentApproval: null,
    });
    expect(outcome.applied).toBe(true);
    expect(outcome.newUnionization).toBe(10 + SECTOR_UNIONIZATION_GAIN_PER_DRIVE);
    expect(outcome.newRepresentingUnionId).toBeNull();
    expect(outcome.won).toBe(false);
    expect(outcome.wasRaid).toBe(false);
  });

  it("grants recognition once the drive crosses SECTOR_RECOGNITION_THRESHOLD", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: SECTOR_RECOGNITION_THRESHOLD - SECTOR_UNIONIZATION_GAIN_PER_DRIVE,
      currentRepresentingUnionId: null,
      attackerUnionId: "attacker",
      attackerApproval: 60,
      incumbentApproval: null,
    });
    expect(outcome.newUnionization).toBe(SECTOR_RECOGNITION_THRESHOLD);
    expect(outcome.newRepresentingUnionId).toBe("attacker");
    expect(outcome.won).toBe(true);
  });

  it("clamps unionization at 100", () => {
    const outcome = resolveOrganizeSectorDrive({
      currentUnionization: 95,
      currentRepresentingUnionId: "attacker",
      attackerUnionId: "attacker",
      attackerApproval: 60,
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
    expect(outcome.newUnionization).toBe(80 + SECTOR_UNIONIZATION_GAIN_PER_DRIVE);
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
    // Below recognition threshold: cleaned to null, not left pointing at the ghost.
    expect(outcome.newRepresentingUnionId).toBeNull();
  });
});

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return { _id: new ObjectId(), name: "TestChar", actions: 100, ...overrides } as unknown as Character;
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
        if (name === "federalBudget") return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
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

    const characterUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const unionUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const sectorUpdate = vi.fn();

    const db = {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection();
        if (name === "unions") {
          return {
            findOne: vi.fn().mockImplementation(({ _id }: { _id: ObjectId }) =>
              _id.equals(union._id) ? union : _id.equals(rivalUnion._id) ? rivalUnion : null
            ),
            updateOne: unionUpdate,
          };
        }
        if (name === "corporateSectors") {
          return { findOne: vi.fn().mockResolvedValue(sector), updateOne: sectorUpdate };
        }
        if (name === "characters") return { updateOne: characterUpdate };
        if (name === "federalBudget") return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await organizeSector(db, character, union._id.toString(), sector._id.toString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.won).toBe(false);
    expect(result.wasRaid).toBe(true);
    expect(result.cashSpent).toBe(ORGANIZE_SECTOR_TREASURY_COST);
    expect(result.actionsSpent).toBe(ORGANIZE_SECTOR_ACTION_COST);
    // The sector document is never touched on a losing raid.
    expect(sectorUpdate).not.toHaveBeenCalled();
    // But the spend did happen.
    expect(characterUpdate).toHaveBeenCalled();
    expect(unionUpdate).toHaveBeenCalled();
  });
});
