/**
 * Player handoff (#3725): mid-world takeover preserves live state; exit leaves
 * claimable vacancies for constitutional refill; caretaker refuses strategy/sphere.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { PlayerOpenBlockedError } from "./countryReadinessContract";
import {
  CLAIMABLE_ROLE_KINDS,
  PRESERVED_HANDOFF_DOMAINS,
  SYSTEMIC_ROLE_KINDS,
  caretakerDecisionAllowed,
  claimableRolesForCountry,
  classifyHandoffRole,
  enterCountryForPlayers,
  exitCountryForPlayers,
  isClaimableOfficeKey,
  refillProcessForClaimableVacancy,
  systemicRolesRetained,
} from "./playerHandoff";

function cursorOf<T>(docs: T[]) {
  return {
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  };
}

describe("claimable vs systemic role taxonomy", () => {
  it("classifies elected and executive offices as claimable", () => {
    expect(classifyHandoffRole("UK", "commons")).toEqual({
      kind: "claimable",
      role: "elected-office",
    });
    expect(classifyHandoffRole("UK", "primeMinister").kind).toBe("claimable");
    expect(classifyHandoffRole("US", "president")).toEqual({
      kind: "claimable",
      role: "head-of-government",
    });
    expect(isClaimableOfficeKey("US", "house")).toBe(true);
  });

  it("keeps central-bank chair and imperial head of state systemic", () => {
    expect(classifyHandoffRole("UK", "centralBankChair")).toEqual({
      kind: "systemic",
      role: "central-bank-chair",
    });
    // UK monarch is imperial — head-of-state office is not a claimable elected seat.
    expect(SYSTEMIC_ROLE_KINDS).toContain("imperial-monarch");
    expect(SYSTEMIC_ROLE_KINDS).toContain("sphere-sponsorship");
    expect(systemicRolesRetained()).toEqual([...SYSTEMIC_ROLE_KINDS]);
  });

  it("lists claimable roles for a parliamentary country without transferring systemic ones", () => {
    const roles = claimableRolesForCountry("UK");
    expect(roles).toContain("elected-office");
    expect(roles).toContain("cabinet-minister");
    expect(roles).toContain("head-of-government");
    for (const role of roles) {
      expect(CLAIMABLE_ROLE_KINDS).toContain(role);
    }
  });
});

describe("constitutional refill mapping", () => {
  it("maps vacancies to election / appointment / succession / formation", () => {
    expect(refillProcessForClaimableVacancy("elected-office", "parliamentaryMonarchy")).toBe(
      "election"
    );
    expect(refillProcessForClaimableVacancy("cabinet-minister", "presidential")).toBe(
      "appointment"
    );
    expect(refillProcessForClaimableVacancy("head-of-government", "presidential")).toBe(
      "succession"
    );
    expect(refillProcessForClaimableVacancy("head-of-government", "parliamentaryRepublic")).toBe(
      "government-formation"
    );
  });
});

describe("caretaker decision contract", () => {
  it("allows technical continuity and refuses strategic / sphere choices", () => {
    expect(caretakerDecisionAllowed("technical")).toBe(true);
    expect(caretakerDecisionAllowed("strategic")).toBe(false);
    expect(caretakerDecisionAllowed("sphere")).toBe(false);
  });
});

describe("enterCountryForPlayers", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("gameState");
    db.collection("countryGameStates");
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });
    db.collectionMocks["countryGameStates"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });
  });

  it("opens a player-ready country without touching preserved domains", async () => {
    const result = await enterCountryForPlayers(db as unknown as Db, "UK");

    expect(result.countryId).toBe("UK");
    expect(result.presetId).toBe("1953-default");
    expect(result.readiness.player).toBe("ready");
    expect(result.preservedDomains).toEqual([...PRESERVED_HANDOFF_DOMAINS]);
    expect(result.claimableRolesTransferred.length).toBeGreaterThan(0);
    expect(result.systemicRolesRetained).toContain("central-bank-chair");
    expect(result.systemicRolesRetained).toContain("sphere-sponsorship");

    // Only countryGameStates was written — no economy / gov / diplomacy wipe.
    expect(db.collectionMocks["countryGameStates"]!.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      {
        $set: expect.objectContaining({
          enabledForPlayers: true,
          status: "active",
        }),
      },
      { upsert: true }
    );
    expect(db.collectionMocks["stateMetrics"]).toBeUndefined();
    expect(db.collectionMocks["electedOfficials"]).toBeUndefined();
    expect(db.collectionMocks["governmentFormations"]).toBeUndefined();
    expect(db.collectionMocks["corporations"]).toBeUndefined();
  });

  it("rejects readiness-blocked entry with named hard blockers", async () => {
    await expect(enterCountryForPlayers(db as unknown as Db, "JP")).rejects.toBeInstanceOf(
      PlayerOpenBlockedError
    );

    try {
      await enterCountryForPlayers(db as unknown as Db, "JP");
    } catch (err) {
      expect(err).toBeInstanceOf(PlayerOpenBlockedError);
      const blocked = err as PlayerOpenBlockedError;
      expect(blocked.report.player).toBe("blocked");
      expect(blocked.report.hardBlockers.map((b) => b.capabilityId)).toContain("adminDiagnostics");
    }

    expect(db.collectionMocks["countryGameStates"]!.updateOne).not.toHaveBeenCalled();
  });
});

describe("exitCountryForPlayers", () => {
  let db: MockDb;
  const playerId = new ObjectId();
  const playerOfficialId = new ObjectId();
  const cabinetId = new ObjectId();
  const now = new Date("1953-06-01T00:00:00Z");

  beforeEach(() => {
    db = createMockDb();
    db.collection("gameState");
    db.collection("countryGameStates");
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("cabinetMembers");
    db.collection("governmentFormations");

    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 40,
      preset: "1953-default",
    });
    db.collectionMocks["countryGameStates"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks["characters"]!.find.mockReturnValue(cursorOf([{ _id: playerId }]));
    db.collectionMocks["characters"]!.updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursorOf([
        {
          _id: playerOfficialId,
          countryId: "UK",
          officeType: "commons",
          characterId: playerId,
          isNPP: false,
        },
      ])
    );
    db.collectionMocks["electedOfficials"]!.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks["electedOfficials"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks["cabinetMembers"]!.find.mockReturnValue(
      cursorOf([
        {
          _id: cabinetId,
          countryId: "UK",
          positionId: "uk-chancellor",
          characterId: playerId,
        },
      ])
    );
    db.collectionMocks["cabinetMembers"]!.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "UK",
      status: "formed",
      pmCharacterId: playerId,
      pmName: "Player PM",
    });
    db.collectionMocks["governmentFormations"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("vacates only claimable player roles and leaves no instant NPP replacement", async () => {
    const result = await exitCountryForPlayers(db as unknown as Db, "UK", { now });

    expect(result.instantNppReplacement).toBe(false);
    expect(result.caretakerMode).toBe(true);
    expect(result.preservedDomains).toEqual([...PRESERVED_HANDOFF_DOMAINS]);
    expect(result.vacatedOffices.map((v) => v.officeKey)).toEqual(
      expect.arrayContaining(["commons", "uk-chancellor"])
    );
    expect(result.refillProcesses).toEqual(
      expect.arrayContaining(["election", "appointment", "government-formation"])
    );

    // Player legislative seat deleted; find query scopes to non-NPP player holders.
    expect(db.collectionMocks["electedOfficials"]!.find).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "UK",
        characterId: { $in: [playerId] },
        isNPP: { $ne: true },
      })
    );
    expect(db.collectionMocks["electedOfficials"]!.deleteOne).toHaveBeenCalledWith({
      _id: playerOfficialId,
    });
    expect(db.collectionMocks["electedOfficials"]!.deleteOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["cabinetMembers"]!.deleteOne).toHaveBeenCalledWith({
      _id: cabinetId,
    });

    // Player PM cleared → pending formation with vacancy clock (no NPP seated).
    expect(db.collectionMocks["governmentFormations"]!.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      {
        $set: expect.objectContaining({
          status: "pending",
          pmCharacterId: null,
          pmNppId: null,
          pmVacancyDeadlineTurn: 40 + 96,
        }),
      }
    );

    expect(db.collectionMocks["countryGameStates"]!.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      { $set: expect.objectContaining({ enabledForPlayers: false }) },
      { upsert: true }
    );

    // Exit must not invent NPP appointments (no npps collection writes).
    expect(db.collectionMocks["npps"]).toBeUndefined();
  });

  it("preserves economy/diplomacy/sphere collections on exit", async () => {
    await exitCountryForPlayers(db as unknown as Db, "UK", { now });
    expect(db.collectionMocks["stateMetrics"]).toBeUndefined();
    expect(db.collectionMocks["corporations"]).toBeUndefined();
    expect(db.collectionMocks["diplomaticRelations"]).toBeUndefined();
    expect(db.collectionMocks["sphereRelationships"]).toBeUndefined();
  });
});
