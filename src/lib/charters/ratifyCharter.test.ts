import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { ratifyCharter } from "./ratifyCharter";

vi.mock("@/lib/db/sequentialId", () => ({
  getNextSequentialId: vi.fn().mockImplementation((_db: unknown, type: string) => {
    // First call (party) returns 77; subsequent calls (npp x N) return
    // increasing integers so cohort NPPs get distinct sequentialIds.
    if (type === "party") return Promise.resolve(77);
    return Promise.resolve(100 + Math.floor(Math.random() * 1000));
  }),
}));

vi.mock("@/lib/npp/nameGenerator", () => ({
  generateUniqueNPPName: vi
    .fn()
    .mockImplementation((_existing: string[], _max: number, _country: string) => {
      return `Founding NPP ${Math.floor(Math.random() * 100000)}`;
    }),
}));

vi.mock("@/lib/npp/generator", () => ({
  selectPoliticianImage: vi.fn().mockReturnValue(undefined),
  weightedRandomEthnicity: vi.fn().mockReturnValue("white"),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/caucus/cleanupCaucusParticipationForCharacters", () => ({
  cleanupCaucusParticipationForCharacters: vi.fn().mockResolvedValue({
    candidaciesWithdrawn: 0,
    votesDeleted: 0,
    membershipsClosed: 0,
    factionIdsCleared: 0,
    chairSeatsCleared: 0,
    viceChairSeatsCleared: 0,
  }),
}));

// ratifyCharter opens the party's first national leadership elections via the
// shared create-missing path; stub it so these unit tests stay db-stub only.
vi.mock("@/lib/nationalPartyElections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nationalPartyElections")>()),
  createMissingNationalElections: vi.fn().mockResolvedValue(3),
}));

interface CharterShape {
  _id: ObjectId;
  countryId: string;
  status: string;
  partyId: string | null;
  proposedName: string;
  proposedAbbr: string;
  foundersCharacterIds: ObjectId[];
  pendingFounderSlots: number;
  platform: { economic: number; social: number; foreignPolicy: number; culture: number };
  signatures: Array<{ characterId: ObjectId; signedAt?: Date; rejectedAt?: Date }>;
  expiresAt: Date | null;
  founderReplacementDeadline?: Date | null;
  foundingCohort?: Array<{ stateId: string; economicPosition: number; socialPosition: number }>;
  createdAt: Date;
  updatedAt: Date;
}

interface StubOpts {
  charter: CharterShape | null;
  /** When `true`, the atomic ratification claim will fail (lost-race path). */
  claimFails?: boolean;
  /** Charter document returned by the post-claim re-read on lost-race path. */
  winnerCharter?: { status: string; partyId: string | null } | null;
  states?: Array<{ _id: string }>;
  founderCharacters?: Array<{
    _id: ObjectId;
    userId: ObjectId;
    party?: string;
    homeState?: string;
    favorability?: number;
  }>;
}

function makeDb(opts: StubOpts) {
  const insertedParties: unknown[] = [];
  const insertedOrgRecords: unknown[] = [];
  const insertedNpps: unknown[] = [];
  const updatedCharacters: unknown[] = [];
  const updatedParties: unknown[] = [];
  const updatedManyParties: unknown[] = [];

  let charterReadCount = 0;
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "partyCharters") {
      return {
        findOne: vi.fn().mockImplementation(() => {
          charterReadCount += 1;
          // First read = pre-ratification. Subsequent reads = post-claim
          // (winner lookup on lost-race path).
          if (charterReadCount === 1) {
            return Promise.resolve(opts.charter);
          }
          return Promise.resolve(opts.winnerCharter ?? null);
        }),
        findOneAndUpdate: vi
          .fn()
          .mockResolvedValue(
            opts.claimFails ? null : { status: "pending-signatures", _id: opts.charter?._id }
          ),
      };
    }
    if (name === "characters") {
      return {
        findOne: vi
          .fn()
          .mockResolvedValue(
            opts.founderCharacters?.[0] ?? { _id: new ObjectId(), homeState: "US-CA" }
          ),
        find: () => ({
          toArray: vi.fn().mockResolvedValue(opts.founderCharacters ?? []),
        }),
        // Used by recomputePartyMemberCount when a founder leaves a real party.
        countDocuments: vi.fn().mockResolvedValue(0),
        updateOne: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
          updatedCharacters.push({ filter, update });
          return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
        }),
      };
    }
    if (name === "politicalParties") {
      return {
        insertOne: vi.fn().mockImplementation((doc: unknown) => {
          insertedParties.push(doc);
          return Promise.resolve({ insertedId: (doc as { _id: ObjectId })._id });
        }),
        // findOne is used by ratifyCharter to derive bannedAtCreation on
        // idempotent / race-lost paths. Default to null (treated as "not
        // banned" since the fixture countryId is US / presidential).
        findOne: vi.fn().mockResolvedValue(null),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        updateOne: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
          updatedParties.push({ filter, update });
          return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
        }),
        updateMany: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
          updatedManyParties.push({ filter, update });
          return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
        }),
      };
    }
    if (name === "states") {
      return {
        find: () => ({
          project: () => ({
            toArray: vi.fn().mockResolvedValue(opts.states ?? []),
          }),
        }),
      };
    }
    if (name === "statePartyOrg") {
      return {
        insertMany: vi.fn().mockImplementation((docs: unknown[]) => {
          insertedOrgRecords.push(...docs);
          return Promise.resolve({ insertedCount: docs.length });
        }),
      };
    }
    if (name === "npps") {
      return {
        // The F4 spawn block queries existing NPPs for name dedup —
        // return empty so every generated name is "unique" in our mock.
        find: () => ({
          project: () => ({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
        // Used by recomputePartyMemberCount when a founder leaves a real party.
        countDocuments: vi.fn().mockResolvedValue(0),
        insertMany: vi.fn().mockImplementation((docs: unknown[]) => {
          insertedNpps.push(...docs);
          return Promise.resolve({ insertedCount: docs.length });
        }),
      };
    }
    if (name === "countryState") {
      // Phase 1b: ratifyCharter reads runtime governmentType for the
      // banned-at-creation guard. With no doc the helper self-heals from
      // COUNTRY_CONFIGS — return null so the self-heal path fires using
      // the real seed for whatever country the test charter targets.
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ insertedId: "stub" }),
      };
    }
    if (name === "nationalPartyElections") {
      // withdrawFromPartyLeadershipElections — no voting elections in fixtures.
      return {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        }),
      };
    }
    if (name === "nationalPartyCandidates") {
      return { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }) };
    }
    if (name === "nationalPartyVotes") {
      return { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }) };
    }
    if (name === "gameState") {
      // getCurrentTurn — founders' partyJoinedTurn tenure anchor.
      return { findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 100 }) };
    }
    return {};
  });

  return {
    db: { collection } as unknown as Db,
    insertedParties,
    insertedOrgRecords,
    insertedNpps,
    updatedCharacters,
    updatedParties,
    updatedManyParties,
  };
}

function makeCharter(): CharterShape {
  return {
    _id: new ObjectId(),
    countryId: "US",
    status: "pending-signatures",
    partyId: null,
    proposedName: "Working Families Party",
    proposedAbbr: "WFP",
    foundersCharacterIds: [new ObjectId(), new ObjectId(), new ObjectId()],
    pendingFounderSlots: 0,
    platform: { economic: 36, social: -24, foreignPolicy: 0, culture: 0 },
    signatures: [],
    expiresAt: new Date("2026-06-01"),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("ratifyCharter", () => {
  it("spawns the party row, provisions state-party-org rows, and joins founders (happy path)", async () => {
    const charter = makeCharter();
    // Founder characters now live at the same `_id` as the charter
    // founder slots — the schema rev moved founder identity from
    // userId to characterId, so the anchor-founder lookup is direct.
    const founderChars = charter.foundersCharacterIds.map((cid) => ({
      _id: cid,
      userId: new ObjectId(),
      party: "independent",
      homeState: "US-CA",
    }));
    const { db, insertedParties, insertedOrgRecords, updatedCharacters, updatedParties } = makeDb({
      charter,
      states: [{ _id: "US-CA" }, { _id: "US-TX" }],
      founderCharacters: founderChars,
    });

    const result = await ratifyCharter(charter._id, db);

    expect(result.partyId).toBe("77");
    expect(result.partySequentialId).toBe(77);

    // Party row was inserted
    expect(insertedParties).toHaveLength(1);
    const party = insertedParties[0] as { sequentialId: number; economicPosition: number };
    expect(party.sequentialId).toBe(77);
    // F1 — platform [-60, +60] → [-5, +5]: 36 / 12 = 3, -24 / 12 = -2
    expect(party.economicPosition).toBe(3);

    // F1 — state party org rows were created (one per state)
    expect(insertedOrgRecords).toHaveLength(2);

    // F2 — all 3 founders had their `character.party` updated
    expect(updatedCharacters).toHaveLength(3);

    // F2b — founding a party is a join, so it must stamp the durable
    // party-switch cooldown anchor (lastPartySwitchAt), same as the join
    // route. Otherwise a founder who later goes independent would carry no
    // anchor and could dodge the 24h join cooldown via a leave→rejoin hop.
    for (const { update } of updatedCharacters as Array<{
      update: { $set: Record<string, unknown> };
    }>) {
      expect(update.$set).toHaveProperty("lastPartySwitchAt");
      expect(update.$set.lastPartySwitchAt).toBeInstanceOf(Date);
    }

    // Final memberCount fix-up to founder-character count
    const memberCountUpdate = updatedParties.find((u) =>
      JSON.stringify((u as { update: unknown }).update).includes("memberCount")
    );
    expect(memberCountUpdate).toBeTruthy();
  });

  it("creates the party with vacant leadership (no founder role assignment)", async () => {
    const charter = makeCharter();
    const founderChars = charter.foundersCharacterIds.map((cid) => ({
      _id: cid,
      userId: new ObjectId(),
      party: "independent",
      homeState: "US-CA",
    }));
    const { db, insertedParties } = makeDb({
      charter,
      states: [{ _id: "US-CA" }],
      founderCharacters: founderChars,
    });

    await ratifyCharter(charter._id, db);

    expect(insertedParties).toHaveLength(1);
    const party = insertedParties[0] as {
      chairId: ObjectId | null;
      viceChairId: ObjectId | null;
      treasurerId: ObjectId | null;
      createdBy: ObjectId | null;
    };
    expect(party.chairId).toBeNull();
    expect(party.viceChairId).toBeNull();
    expect(party.treasurerId).toBeNull();
    // Founder slot 0 is still the anchor founder / creator.
    expect(party.createdBy).toEqual(charter.foundersCharacterIds[0]);
  });

  it("opens cycle-aligned national elections immediately after ratification", async () => {
    const { createMissingNationalElections } = await import("@/lib/nationalPartyElections");
    const charter = makeCharter();
    const founderChars = charter.foundersCharacterIds.map((cid) => ({
      _id: cid,
      userId: new ObjectId(),
      party: "independent",
      homeState: "US-CA",
    }));
    const { db } = makeDb({
      charter,
      states: [{ _id: "US-CA" }],
      founderCharacters: founderChars,
    });

    await ratifyCharter(charter._id, db);

    expect(createMissingNationalElections).toHaveBeenCalledWith(
      100, // charterCurrentTurn from the gameState stub
      undefined, // default duration
      expect.any(Date),
      charter.countryId
    );
  });

  it("founder notifications announce open elections, not roles", async () => {
    const { createNotification } = await import("@/lib/notifications");
    vi.mocked(createNotification).mockClear();
    const charter = makeCharter();
    const founderChars = charter.foundersCharacterIds.map((cid) => ({
      _id: cid,
      userId: new ObjectId(),
      party: "independent",
      homeState: "US-CA",
    }));
    const { db } = makeDb({
      charter,
      states: [{ _id: "US-CA" }],
      founderCharacters: founderChars,
    });

    await ratifyCharter(charter._id, db);

    const messages = vi
      .mocked(createNotification)
      .mock.calls.map(([arg]) => (arg as { message: string }).message);
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(m).not.toMatch(/as chair|Vice Chair|Treasurer/);
      expect(m).toMatch(/leadership elections/i);
    }
  });

  it("vacates departing founders' leadership slots on their old party (split cleanup)", async () => {
    // Regression (#0701): when a party's leadership splits off to charter a
    // new party, the founders' `character.party` moves but the OLD party was
    // left pointing at them as chair / vice chair / treasurer. The old party
    // must have those slots vacated so it no longer lists members who left.
    const charter = makeCharter();
    // All 3 founders currently belong to old party seqId "5".
    const founderChars = charter.foundersCharacterIds.map((cid) => ({
      _id: cid,
      userId: new ObjectId(),
      party: "5",
      homeState: "US-CA",
    }));
    const { db, updatedManyParties } = makeDb({
      charter,
      states: [{ _id: "US-CA" }],
      founderCharacters: founderChars,
    });

    await ratifyCharter(charter._id, db);

    // A leadership-vacancy sweep was issued against the politicalParties
    // collection, scoped to the country and excluding the brand-new party.
    expect(updatedManyParties).toHaveLength(1);
    const sweep = updatedManyParties[0] as {
      filter: { countryId: string; sequentialId: { $ne: number } };
      update: unknown;
    };
    expect(sweep.filter.countryId).toBe("US");
    // The freshly-created party (seqId 77) must NOT be swept — its leadership
    // was just set to these same founders intentionally.
    expect(sweep.filter.sequentialId.$ne).toBe(77);
    // The sweep nulls all three leadership slots for departing founders.
    const updateJson = JSON.stringify(sweep.update);
    expect(updateJson).toContain("chairId");
    expect(updateJson).toContain("viceChairId");
    expect(updateJson).toContain("treasurerId");
    // It references the founder ids it is vacating.
    expect(updateJson).toContain(charter.foundersCharacterIds[0]!.toString());
  });

  it("returns the existing partyId when the charter was already ratified (idempotent)", async () => {
    const charter = makeCharter();
    charter.status = "ratified";
    charter.partyId = "42";
    const { db, insertedParties } = makeDb({ charter });
    const result = await ratifyCharter(charter._id, db);
    expect(result.partyId).toBe("42");
    expect(insertedParties).toHaveLength(0);
  });

  it("rolls back the inserted party on lost ratification race and returns the winner's partyId", async () => {
    const charter = makeCharter();
    const { db } = makeDb({
      charter,
      claimFails: true,
      winnerCharter: { status: "ratified", partyId: "99" },
    });
    const result = await ratifyCharter(charter._id, db);
    expect(result.partyId).toBe("99");
  });

  it("throws when the claim fails and there's no winner to return", async () => {
    const charter = makeCharter();
    const { db } = makeDb({ charter, claimFails: true, winnerCharter: null });
    await expect(ratifyCharter(charter._id, db)).rejects.toThrow(/race lost without winner/i);
  });

  it("throws when the charter doesn't exist", async () => {
    const { db } = makeDb({ charter: null });
    await expect(ratifyCharter(new ObjectId(), db)).rejects.toThrow(/not found/i);
  });

  describe("F4 founding cohort", () => {
    it("spawns 3 NPPs distributed across cohort picks (anchor + 2 player picks)", async () => {
      const charter = makeCharter();
      charter.foundingCohort = [
        { stateId: "US-OR", economicPosition: 1.5, socialPosition: -2.5 },
        { stateId: "US-NV", economicPosition: -0.5, socialPosition: 0.5 },
      ];
      const founderChars = charter.foundersCharacterIds.map((cid) => ({
        _id: cid,
        userId: new ObjectId(),
        party: "independent",
        homeState: "US-CA",
        favorability: 60,
      }));
      const { db, insertedNpps } = makeDb({
        charter,
        states: [{ _id: "US-CA" }],
        founderCharacters: founderChars,
      });

      await ratifyCharter(charter._id, db);

      expect(insertedNpps).toHaveLength(3);
      type NppDoc = {
        homeState: string;
        policies: { economic: number; social: number };
        party: string;
        personality: { loyalty: number; ambition: number; stubbornness: number };
        favorability: number;
      };
      const npps = insertedNpps as NppDoc[];

      // NPP 1 anchored to chair's home state with platform-derived positions.
      // Platform economic=36 → 3.0, social=-24 → -2.0 (per axisToPartyPosition).
      expect(npps[0]!.homeState).toBe("US-CA");
      expect(npps[0]!.policies.economic).toBe(3);
      expect(npps[0]!.policies.social).toBe(-2);

      // NPPs 2 & 3 from the cohort picks.
      expect(npps[1]!.homeState).toBe("US-OR");
      expect(npps[1]!.policies.economic).toBe(1.5);
      expect(npps[1]!.policies.social).toBe(-2.5);
      expect(npps[2]!.homeState).toBe("US-NV");
      expect(npps[2]!.policies.economic).toBe(-0.5);
      expect(npps[2]!.policies.social).toBe(0.5);

      // All registered to the new party.
      for (const npp of npps) {
        expect(npp.party).toBe("77");
      }
    });

    it("legacy fallback (no foundingCohort) spawns 3 NPPs all in home state at platform positions", async () => {
      const charter = makeCharter();
      // foundingCohort intentionally absent.
      const founderChars = charter.foundersCharacterIds.map((cid) => ({
        _id: cid,
        userId: new ObjectId(),
        party: "independent",
        homeState: "US-CA",
        favorability: 50,
      }));
      const { db, insertedNpps } = makeDb({
        charter,
        states: [{ _id: "US-CA" }],
        founderCharacters: founderChars,
      });

      await ratifyCharter(charter._id, db);

      expect(insertedNpps).toHaveLength(3);
      for (const npp of insertedNpps as Array<{ homeState: string }>) {
        expect(npp.homeState).toBe("US-CA");
      }
    });

    it("same-state double-up: both picks at same state produces 2 NPPs there + 1 at home", async () => {
      const charter = makeCharter();
      charter.foundingCohort = [
        { stateId: "US-OR", economicPosition: 0, socialPosition: 0 },
        { stateId: "US-OR", economicPosition: 0, socialPosition: 0 },
      ];
      const founderChars = charter.foundersCharacterIds.map((cid) => ({
        _id: cid,
        userId: new ObjectId(),
        party: "independent",
        homeState: "US-CA",
        favorability: 50,
      }));
      const { db, insertedNpps } = makeDb({
        charter,
        states: [{ _id: "US-CA" }],
        founderCharacters: founderChars,
      });

      await ratifyCharter(charter._id, db);

      expect(insertedNpps).toHaveLength(3);
      const homeStates = (insertedNpps as Array<{ homeState: string }>).map((n) => n.homeState);
      expect(homeStates.filter((s) => s === "US-CA")).toHaveLength(1);
      expect(homeStates.filter((s) => s === "US-OR")).toHaveLength(2);
    });

    it("cohort NPPs are seeded as true believers (high loyalty, modest ambition)", async () => {
      const charter = makeCharter();
      charter.foundingCohort = [
        { stateId: "US-OR", economicPosition: 0, socialPosition: 0 },
        { stateId: "US-NV", economicPosition: 0, socialPosition: 0 },
      ];
      const founderChars = charter.foundersCharacterIds.map((cid) => ({
        _id: cid,
        userId: new ObjectId(),
        party: "independent",
        homeState: "US-CA",
        favorability: 50,
      }));
      const { db, insertedNpps } = makeDb({
        charter,
        states: [{ _id: "US-CA" }],
        founderCharacters: founderChars,
      });

      await ratifyCharter(charter._id, db);

      for (const npp of insertedNpps as Array<{
        personality: { loyalty: number; ambition: number; stubbornness: number };
      }>) {
        // True-believer profile per F4 redesign:
        expect(npp.personality.loyalty).toBeGreaterThanOrEqual(75);
        expect(npp.personality.loyalty).toBeLessThan(95);
        expect(npp.personality.ambition).toBeGreaterThanOrEqual(40);
        expect(npp.personality.ambition).toBeLessThan(55);
        expect(npp.personality.stubbornness).toBeGreaterThanOrEqual(40);
        expect(npp.personality.stubbornness).toBeLessThan(60);
      }
    });

    it("cohort NPP favorability tracks chair's favorability ±5 (party baseline)", async () => {
      const charter = makeCharter();
      charter.foundingCohort = [
        { stateId: "US-OR", economicPosition: 0, socialPosition: 0 },
        { stateId: "US-NV", economicPosition: 0, socialPosition: 0 },
      ];
      const founderChars = charter.foundersCharacterIds.map((cid, i) => ({
        _id: cid,
        userId: new ObjectId(),
        party: "independent",
        homeState: "US-CA",
        // Chair (slot 0) has favorability 72 — cohort should cluster in [67, 77].
        favorability: i === 0 ? 72 : 50,
      }));
      const { db, insertedNpps } = makeDb({
        charter,
        states: [{ _id: "US-CA" }],
        founderCharacters: founderChars,
      });

      await ratifyCharter(charter._id, db);

      for (const npp of insertedNpps as Array<{ favorability: number }>) {
        expect(npp.favorability).toBeGreaterThanOrEqual(67);
        expect(npp.favorability).toBeLessThanOrEqual(77);
      }
    });
  });

  it("clears former-party caucus membership for founders who move (ticket #1030)", async () => {
    const charter = makeCharter();
    const founderChars = charter.foundersCharacterIds.map((cid) => ({
      _id: cid,
      userId: new ObjectId(),
      party: "1",
      homeState: "US-CA",
      favorability: 50,
    }));
    const { db } = makeDb({
      charter,
      states: [{ _id: "US-CA" }],
      founderCharacters: founderChars,
    });

    const { cleanupCaucusParticipationForCharacters } =
      await import("@/lib/caucus/cleanupCaucusParticipationForCharacters");
    vi.mocked(cleanupCaucusParticipationForCharacters).mockClear();

    await ratifyCharter(charter._id, db);

    expect(cleanupCaucusParticipationForCharacters).toHaveBeenCalledWith(
      db,
      expect.arrayContaining(charter.foundersCharacterIds),
      expect.objectContaining({
        removeMembership: true,
        membershipStatus: "left",
      })
    );
  });
});
