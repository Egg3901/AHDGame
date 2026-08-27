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
}) {
  const writes: Array<{ coll: string; filter: unknown; update: unknown }> = [];
  const db = {
    collection: (name: string) => ({
      find: () => ({
        toArray: async () =>
          name === "politicalParties" ? (opts.parties ?? []) : (opts.officials ?? []),
      }),
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
  return { db, writes };
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
