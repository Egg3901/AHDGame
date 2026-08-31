import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const { updateCountryState, recordCountryEvent, ensureInitialEscalationState } = vi.hoisted(() => ({
  updateCountryState: vi.fn(async (..._a: unknown[]) => ({}) as never),
  recordCountryEvent: vi.fn(async (..._a: unknown[]) => {}),
  ensureInitialEscalationState: vi.fn(async (..._a: unknown[]) => ({}) as never),
}));

vi.mock("@/lib/countryState", () => ({
  updateCountryState,
  getCountryState: vi.fn(async () => ({ rulingPartyId: null })),
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({ recordCountryEvent }));
vi.mock("@/lib/turn/regimeEscalationTurn", () => ({ ensureInitialEscalationState }));

import { installOnePartyState } from "./installOnePartyState";

interface Party {
  sequentialId: number;
  name: string;
  abbreviation: string;
}

function mockDb(opts: {
  parties?: Party[];
  governingPartyId?: string | number;
  govStatus?: string;
  rulingPartyId?: number | null;
  officials?: Array<{ party?: string; seatsHeld?: number }>;
  /**
   * What the SECOND `electedOfficials` find returns — the "still seated" probe
   * the vacate sweep runs after its delete, to decide whose `currentOffice` to
   * clear. Defaults to nobody, which is the ordinary case: a banned member's
   * only seat was the one just removed.
   */
  stillSeated?: Array<{ characterId?: unknown; nppId?: unknown }>;
}) {
  const writes: Array<{ coll: string; filter: unknown; update: unknown }> = [];
  /** Every `find` filter, so the vacate sweep's party-token query can be asserted. */
  const finds: Array<{ coll: string; filter: unknown }> = [];
  const deletes: Array<{ coll: string; filter: unknown }> = [];
  const db = {
    collection: (name: string) => ({
      find: (filter?: unknown) => {
        finds.push({ coll: name, filter });
        const nth = finds.filter((f) => f.coll === name).length;
        return {
          toArray: async () => {
            if (name === "politicalParties") return opts.parties ?? [];
            // The vacate sweep reads `electedOfficials` twice: the doomed rows,
            // then who is still seated after the delete.
            if (name === "electedOfficials" && nth > 1) return opts.stillSeated ?? [];
            return opts.officials ?? [];
          },
        };
      },
      deleteMany: async (filter: unknown) => {
        deletes.push({ coll: name, filter });
        return { deletedCount: 0 };
      },
      findOne: async () =>
        name === "governmentFormations"
          ? opts.governingPartyId !== undefined
            ? { governingPartyId: opts.governingPartyId, status: opts.govStatus ?? "formed" }
            : null
          : null,
      updateMany: async (filter: unknown, update: unknown) => {
        writes.push({ coll: name, filter, update });
        return { modifiedCount: 1 };
      },
    }),
  } as unknown as Db;
  return { db, writes, finds, deletes };
}

const PARTIES: Party[] = [
  { sequentialId: 1, name: "Liberal Party", abbreviation: "LIB" },
  { sequentialId: 2, name: "Workers Party", abbreviation: "WRK" },
];

beforeEach(() => {
  updateCountryState.mockClear();
  recordCountryEvent.mockClear();
  ensureInitialEscalationState.mockClear();
});

describe("installOnePartyState", () => {
  it("flips the government type and turns the confidence model on", async () => {
    const { db } = mockDb({ parties: PARTIES, governingPartyId: 2 });
    await installOnePartyState(db, "TR", 412);
    expect(updateCountryState).toHaveBeenCalledWith(
      expect.anything(),
      "TR",
      expect.objectContaining({
        governmentType: "onePartyState",
        hasLeaderConfidenceModel: true,
      })
    );
  });

  it("restores vote multipliers, which the conversion out had cleared", async () => {
    const { db } = mockDb({ parties: PARTIES, governingPartyId: 2 });
    await installOnePartyState(db, "TR", 412);
    const patch = updateCountryState.mock.calls[0]![2] as { opsVoteMultipliers?: unknown };
    expect(patch.opsVoteMultipliers).toBeTruthy();
  });

  it("makes the governing party the ruling party", async () => {
    const { db } = mockDb({ parties: PARTIES, governingPartyId: 2 });
    await installOnePartyState(db, "TR", 412);
    const patch = updateCountryState.mock.calls[0]![2] as { rulingPartyId?: number };
    expect(patch.rulingPartyId).toBe(2);
  });

  it("falls back to the largest party by seats when no government is formed", async () => {
    // A presidential system has no governmentFormation to read, so the chamber
    // decides instead.
    const { db } = mockDb({
      parties: PARTIES,
      officials: [
        { party: "Liberal Party", seatsHeld: 30 },
        { party: "Workers Party", seatsHeld: 120 },
      ],
    });
    await installOnePartyState(db, "TR", 412);
    const patch = updateCountryState.mock.calls[0]![2] as { rulingPartyId?: number };
    expect(patch.rulingPartyId).toBe(2);
  });

  it("matches an official's party by abbreviation as well as by name", async () => {
    const { db } = mockDb({
      parties: PARTIES,
      officials: [{ party: "WRK", seatsHeld: 5 }],
    });
    await installOnePartyState(db, "TR", 412);
    const patch = updateCountryState.mock.calls[0]![2] as { rulingPartyId?: number };
    expect(patch.rulingPartyId).toBe(2);
  });

  it("tags the ruling party ruling and every other party banned", async () => {
    const { db, writes } = mockDb({ parties: PARTIES, governingPartyId: 2 });
    await installOnePartyState(db, "TR", 412);
    const party = writes.filter((w) => w.coll === "politicalParties");
    expect(JSON.stringify(party)).toContain("ruling");
    expect(JSON.stringify(party)).toContain("banned");
  });

  it("seeds an escalation row, so the per-turn driver has a document to advance", async () => {
    const { db } = mockDb({ parties: PARTIES, governingPartyId: 2 });
    await installOnePartyState(db, "TR", 412);
    expect(ensureInitialEscalationState).toHaveBeenCalledWith(expect.anything(), "TR", 412);
  });

  it("records the conversion in country history", async () => {
    const { db } = mockDb({ parties: PARTIES, governingPartyId: 2 });
    await installOnePartyState(db, "TR", 412);
    expect(recordCountryEvent).toHaveBeenCalled();
  });

  it("does not crash a country with no parties, and tags nobody", async () => {
    const { db, writes } = mockDb({ parties: [] });
    await expect(installOnePartyState(db, "TR", 412)).resolves.toBeUndefined();
    expect(writes.filter((w) => w.coll === "politicalParties")).toHaveLength(0);
  });

  it("resolves an official's party by sequentialId, the production convention", async () => {
    // Regression: `electedOfficials.party` holds `String(sequentialId)` in the live
    // world. This fallback used to compare only against name and abbreviation, so
    // it never matched, returned null, and left a converted country with no ruling
    // party and nobody banned.
    const { db, writes } = mockDb({
      parties: PARTIES,
      officials: [
        { party: "1", seatsHeld: 10 },
        { party: "2", seatsHeld: 40 },
      ],
    });
    await installOnePartyState(db, "TR", 412);
    const patch = updateCountryState.mock.calls[0]![2] as { rulingPartyId?: number };
    expect(patch.rulingPartyId).toBe(2);
    expect(writes.filter((w) => w.coll === "politicalParties")).toHaveLength(2);
  });

  it("installs the party named explicitly, over the formed government's choice", async () => {
    const { db, writes } = mockDb({ parties: PARTIES, governingPartyId: 1 });
    await installOnePartyState(db, "DE", 470, { rulingPartyId: 2 });
    const patch = updateCountryState.mock.calls[0]![2] as { rulingPartyId?: number };
    expect(patch.rulingPartyId).toBe(2);
    const ruling = writes.find(
      (w) => (w.update as { $set: { regimeStatus: string } }).$set.regimeStatus === "ruling"
    );
    expect((ruling?.filter as { sequentialId: number }).sequentialId).toBe(2);
    const banned = writes.find(
      (w) => (w.update as { $set: { regimeStatus: string } }).$set.regimeStatus === "banned"
    );
    // Banned by an explicit id LIST rather than "everyone but the ruler": the
    // list is what lets a caller tolerate a bloc (`toleratedPartyIds`) without
    // the two writes racing over the same rows.
    expect((banned?.filter as { sequentialId: { $in: number[] } }).sequentialId.$in).toEqual([1]);
  });

  it("marks tolerated parties approved rather than banned", async () => {
    const { db, writes } = mockDb({ parties: PARTIES, governingPartyId: 1 });
    await installOnePartyState(db, "DE", 470, { rulingPartyId: 2, toleratedPartyIds: [1] });
    const approved = writes.find(
      (w) => (w.update as { $set: { regimeStatus: string } }).$set.regimeStatus === "approved"
    );
    expect((approved?.filter as { sequentialId: { $in: number[] } }).sequentialId.$in).toEqual([1]);
    // Nothing is left to ban, so no banned write is issued at all.
    expect(
      writes.find(
        (w) => (w.update as { $set: { regimeStatus: string } }).$set.regimeStatus === "banned"
      )
    ).toBeUndefined();
  });

  it("does not unseat a tolerated party that shares an abbreviation with a banned one", async () => {
    // Reunification leaves Germany holding TWO parties abbreviated "CDU": the
    // western one it bans and the eastern one it tolerates. Matching benches on
    // an abbreviation shared with a non-banned party would unseat both.
    const twoCdus: Party[] = [
      { sequentialId: 2, name: "Christlich Demokratische Union", abbreviation: "CDU" },
      { sequentialId: 7, name: "Sozialistische Einheitspartei", abbreviation: "SED" },
      { sequentialId: 8, name: "Christlich-Demokratische Union (Ost)", abbreviation: "CDU" },
    ];
    const { db, finds } = mockDb({ parties: twoCdus, governingPartyId: 7 });
    await installOnePartyState(db, "DE", 470, {
      rulingPartyId: 7,
      toleratedPartyIds: [8],
      vacateBannedSeats: true,
    });

    const vacate = finds.find(
      (f) => f.coll === "electedOfficials" && (f.filter as { party?: unknown })?.party !== undefined
    );
    expect(vacate).toBeDefined();
    const matched = (vacate!.filter as { party: { $in: string[] } }).party.$in;
    // The banned party's own id is there.
    expect(matched).toContain("2");
    // Its abbreviation is NOT, because the tolerated eastern party shares it.
    expect(matched).not.toContain("CDU");
    // Its unambiguous full name still is.
    expect(matched).toContain("Christlich Demokratische Union");
    // And nothing that identifies the ruling or tolerated parties.
    expect(matched).not.toContain("7");
    expect(matched).not.toContain("8");
    expect(matched).not.toContain("SED");
  });

  it("empties the banned benches and lets their holders go", async () => {
    const banned = { _id: "row1", party: "1", characterId: "char1", nppId: null };
    const bannedNpp = { _id: "row2", party: "1", characterId: null, nppId: "npp1" };
    const { db, deletes, writes } = mockDb({
      parties: PARTIES,
      governingPartyId: 1,
      officials: [banned, bannedNpp] as never,
    });

    await installOnePartyState(db, "DE", 470, { rulingPartyId: 2, vacateBannedSeats: true });

    // The rows go.
    const removed = deletes.find((d) => d.coll === "electedOfficials");
    expect(removed).toBeDefined();
    expect((removed!.filter as { _id: { $in: string[] } })._id.$in).toEqual(["row1", "row2"]);

    // And so does the stored office pointer, for a player and an NPP alike --
    // neither has a seat left, so neither may go on reading as seated.
    const clearedChar = writes.find((w) => w.coll === "characters");
    expect(clearedChar).toBeDefined();
    expect(
      (clearedChar!.update as { $set: { currentOffice: unknown } }).$set.currentOffice
    ).toBeNull();
    const clearedNpp = writes.find((w) => w.coll === "npps");
    expect(clearedNpp).toBeDefined();
    expect(
      (clearedNpp!.update as { $set: { currentOffice: unknown } }).$set.currentOffice
    ).toBeNull();
  });

  it("leaves the office pointer alone for a holder who still has a seat", async () => {
    const banned = { _id: "row1", party: "1", characterId: "char1", nppId: null };
    const { db, writes } = mockDb({
      parties: PARTIES,
      governingPartyId: 1,
      officials: [banned] as never,
      // They hold another seat that survived, so their pointer names a real office.
      stillSeated: [{ characterId: "char1" }],
    });

    await installOnePartyState(db, "DE", 470, { rulingPartyId: 2, vacateBannedSeats: true });

    expect(writes.find((w) => w.coll === "characters")).toBeUndefined();
  });

  it("touches no bench at all when vacating is not asked for", async () => {
    // The shipped `regime_change` peace term must keep behaving exactly as it did.
    const { db, deletes } = mockDb({
      parties: PARTIES,
      governingPartyId: 1,
      officials: [{ _id: "row1", party: "1" }] as never,
    });

    await installOnePartyState(db, "DE", 470, { rulingPartyId: 2 });

    expect(deletes.find((d) => d.coll === "electedOfficials")).toBeUndefined();
  });

  it("never demotes the ruling party to approved, even when named tolerated", async () => {
    const { db, writes } = mockDb({ parties: PARTIES, governingPartyId: 1 });
    await installOnePartyState(db, "DE", 470, { rulingPartyId: 2, toleratedPartyIds: [1, 2] });
    const approved = writes.find(
      (w) => (w.update as { $set: { regimeStatus: string } }).$set.regimeStatus === "approved"
    );
    expect((approved?.filter as { sequentialId: { $in: number[] } }).sequentialId.$in).toEqual([1]);
  });

  it("ignores an explicit party that does not exist in this country", async () => {
    const { db } = mockDb({ parties: PARTIES, governingPartyId: 1 });
    await installOnePartyState(db, "DE", 470, { rulingPartyId: 99 });
    const patch = updateCountryState.mock.calls[0]![2] as { rulingPartyId?: number };
    expect(patch.rulingPartyId).toBe(1);
  });

  it("ignores a non-numeric governing party, as the sync helper does", async () => {
    // `governingPartyId` can be "independent". Number() would make that NaN and
    // tag nobody as ruling while banning everyone.
    const { db } = mockDb({
      parties: PARTIES,
      governingPartyId: "independent",
      officials: [{ party: "Liberal Party", seatsHeld: 9 }],
    });
    await installOnePartyState(db, "TR", 412);
    const patch = updateCountryState.mock.calls[0]![2] as { rulingPartyId?: number };
    expect(patch.rulingPartyId).toBe(1);
  });
});
