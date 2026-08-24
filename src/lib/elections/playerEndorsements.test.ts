import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { PlayerEndorsement } from "@/lib/db/types";
import {
  isPrimaryPhaseOpen,
  sweepPartyMismatchedPlayerEndorsements,
  withdrawPlayerEndorsementsOnPartyChange,
} from "./playerEndorsements";

/**
 * Ticket #1179: a member who endorsed their party's presidential candidate
 * must not keep that endorsement active after defecting — it keeps counting in
 * the standings and keeps granting the endorsed campaign per-turn actions.
 */

const NOW = new Date("2026-08-24T00:00:00Z");
const PRIMARY_OPEN_TURN = 50;
const PRIMARY_END_TURN = 100;

function seedScenario(
  db: InMemoryDb,
  opts: {
    electionStatus?: string;
    primaryEndTurn?: number;
    candidateParty?: string;
    candidateStatus?: string;
    isNPP?: boolean;
    support?: number;
  } = {}
) {
  const electionId = new ObjectId();
  const candidateRowId = new ObjectId();
  const candidateCharacterId = new ObjectId();
  const endorserId = new ObjectId();

  db.seed("elections", [
    {
      _id: electionId,
      electionType: "president",
      countryId: "US",
      status: opts.electionStatus ?? "active",
      primaryEndTurn: opts.primaryEndTurn ?? PRIMARY_END_TURN,
    } as unknown as Record<string, unknown>,
  ]);
  db.seed("electionCandidates", [
    {
      _id: candidateRowId,
      electionId,
      characterId: opts.isNPP ? undefined : candidateCharacterId,
      characterName: "Lyndon B. Johnson",
      party: opts.candidateParty ?? "1",
      status: opts.candidateStatus ?? "active",
      isNPP: opts.isNPP ?? false,
      support: opts.support ?? 55,
    } as unknown as Record<string, unknown>,
  ]);
  return { electionId, candidateRowId, candidateCharacterId, endorserId };
}

function seedEndorsement(
  db: InMemoryDb,
  ids: {
    electionId: ObjectId;
    candidateRowId: ObjectId;
    endorserId: ObjectId;
  },
  overrides: Partial<PlayerEndorsement> = {}
): ObjectId {
  const endorsementId = new ObjectId();
  db.seed("playerEndorsements", [
    {
      _id: endorsementId,
      characterId: ids.endorserId,
      characterName: "Vladimir Iskra",
      electionId: ids.electionId,
      candidateId: ids.candidateRowId,
      candidateName: "Lyndon B. Johnson",
      isActive: true,
      createdAt: NOW,
      ...overrides,
    },
  ]);
  return endorsementId;
}

function seededEndorser(db: InMemoryDb, id: ObjectId, party: string) {
  db.seed("characters", [{ _id: id, party }] as unknown as Record<string, unknown>[]);
}

async function loadEndorsement(db: InMemoryDb, id: ObjectId) {
  return db.collection("playerEndorsements").findOne({ _id: id });
}

describe("isPrimaryPhaseOpen", () => {
  it("prefers the turn bound when a turn counter is available", () => {
    const election = { primaryEndTurn: PRIMARY_END_TURN };
    expect(isPrimaryPhaseOpen(election, { currentTurn: 50, now: NOW })).toBe(true);
    expect(isPrimaryPhaseOpen(election, { currentTurn: 100, now: NOW })).toBe(false);
  });

  it("falls back to the Date bound when no turn counter is available", () => {
    const election = { primaryEndTime: new Date("2026-09-01T00:00:00Z") };
    expect(isPrimaryPhaseOpen(election, { now: NOW })).toBe(true);
    expect(isPrimaryPhaseOpen(election, { now: new Date("2026-09-02T00:00:00Z") })).toBe(false);
  });

  it("treats a race with no primary boundary as general phase", () => {
    expect(isPrimaryPhaseOpen({}, { currentTurn: 50, now: NOW })).toBe(false);
  });
});

describe("withdrawPlayerEndorsementsOnPartyChange", () => {
  it("uses the caller-supplied newParty over the stored document", async () => {
    const db = createInMemoryDb();
    const ids = seedScenario(db);
    const endorsementId = seedEndorsement(db, ids);

    const withdrawn = await withdrawPlayerEndorsementsOnPartyChange(
      db as never,
      ids.endorserId,
      "4",
      { currentTurn: PRIMARY_OPEN_TURN, now: NOW }
    );

    expect(withdrawn).toBe(1);
    const row = await loadEndorsement(db, endorsementId);
    expect(row?.isActive).toBe(false);
    expect(row?.withdrawnAt).toEqual(NOW);
    const candidate = db.collection("electionCandidates").findOne({
      _id: ids.candidateRowId,
    });
    await expect(candidate).resolves.toMatchObject({ support: 52 }); // 55 - SUPPORT_ENDORSEMENT_BUMP(3)
  });

  it("keeps a same-party endorsement untouched", async () => {
    const db = createInMemoryDb();
    const ids = seedScenario(db);
    const endorsementId = seedEndorsement(db, ids);

    const withdrawn = await withdrawPlayerEndorsementsOnPartyChange(
      db as never,
      ids.endorserId,
      "1",
      { currentTurn: PRIMARY_OPEN_TURN, now: NOW }
    );

    expect(withdrawn).toBe(0);
    const row = await loadEndorsement(db, endorsementId);
    expect(row?.isActive).toBe(true);
    await expect(
      db.collection("electionCandidates").findOne({ _id: ids.candidateRowId })
    ).resolves.toMatchObject({ support: 55 });
  });

  it("keeps a cross-party endorsement once the race is in its general phase", async () => {
    const db = createInMemoryDb();
    const ids = seedScenario(db);
    const endorsementId = seedEndorsement(db, ids);

    const withdrawn = await withdrawPlayerEndorsementsOnPartyChange(
      db as never,
      ids.endorserId,
      "4",
      { currentTurn: PRIMARY_END_TURN + 5, now: NOW }
    );

    expect(withdrawn).toBe(0);
    expect((await loadEndorsement(db, endorsementId))?.isActive).toBe(true);
  });

  it("leaves ended elections alone", async () => {
    const db = createInMemoryDb();
    const ids = seedScenario(db, { electionStatus: "completed" });
    const endorsementId = seedEndorsement(db, ids);

    const withdrawn = await withdrawPlayerEndorsementsOnPartyChange(
      db as never,
      ids.endorserId,
      "4",
      { currentTurn: PRIMARY_OPEN_TURN, now: NOW }
    );

    expect(withdrawn).toBe(0);
    expect((await loadEndorsement(db, endorsementId))?.isActive).toBe(true);
  });

  it("withdraws misaligned NPP endorsements without reversing a Support bump", async () => {
    const db = createInMemoryDb();
    const ids = seedScenario(db, { isNPP: true });
    const endorsementId = seedEndorsement(db, ids);

    const withdrawn = await withdrawPlayerEndorsementsOnPartyChange(
      db as never,
      ids.endorserId,
      "4",
      { currentTurn: PRIMARY_OPEN_TURN, now: NOW }
    );

    expect(withdrawn).toBe(1);
    expect((await loadEndorsement(db, endorsementId))?.isActive).toBe(false);
    await expect(
      db.collection("electionCandidates").findOne({ _id: ids.candidateRowId })
    ).resolves.toMatchObject({ support: 55 });
  });

  it("falls back to the Date bound when the caller has no turn counter", async () => {
    const db = createInMemoryDb();
    // Only a Date boundary on this election.
    const electionId = new ObjectId();
    const candidateRowId = new ObjectId();
    const endorserId = new ObjectId();
    db.seed("elections", [
      {
        _id: electionId,
        electionType: "president",
        countryId: "US",
        status: "active",
        primaryEndTime: new Date("2026-09-01T00:00:00Z"),
      } as unknown as Record<string, unknown>,
    ]);
    db.seed("electionCandidates", [
      {
        _id: candidateRowId,
        electionId,
        characterId: new ObjectId(),
        party: "1",
        status: "active",
        support: 50,
      } as unknown as Record<string, unknown>,
    ]);
    seedEndorsement(db, { electionId, candidateRowId, endorserId });

    const before = await withdrawPlayerEndorsementsOnPartyChange(db as never, endorserId, "4", {
      now: NOW,
    });
    expect(before).toBe(1);
  });
});

describe("sweepPartyMismatchedPlayerEndorsements", () => {
  it("heals legacy rows by reading each endorser's live party and reverses the bump once per candidate", async () => {
    const db = createInMemoryDb();
    const ids = seedScenario(db, { support: 60 });
    // Defector (party already rewritten) + loyal member both endorsed LBJ.
    const defectorId = new ObjectId();
    const loyalId = new ObjectId();
    seededEndorser(db, defectorId, "4");
    seededEndorser(db, loyalId, "1");
    seedEndorsement(db, { ...ids, endorserId: defectorId }, { characterId: defectorId });
    seedEndorsement(db, { ...ids, endorserId: loyalId }, { characterId: loyalId });

    const withdrawn = await sweepPartyMismatchedPlayerEndorsements(
      db as never,
      PRIMARY_OPEN_TURN,
      NOW
    );

    expect(withdrawn).toBe(1);
    const rows = await db.collection("playerEndorsements").find({}).toArray();
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
    await expect(
      db.collection("electionCandidates").findOne({ _id: ids.candidateRowId })
    ).resolves.toMatchObject({ support: 57 }); // single -3, not -6
  });

  it("does nothing when every active endorsement is aligned", async () => {
    const db = createInMemoryDb();
    const ids = seedScenario(db);
    seededEndorser(db, ids.endorserId, "1");
    seedEndorsement(db, ids);

    const withdrawn = await sweepPartyMismatchedPlayerEndorsements(
      db as never,
      PRIMARY_OPEN_TURN,
      NOW
    );

    expect(withdrawn).toBe(0);
  });
});
