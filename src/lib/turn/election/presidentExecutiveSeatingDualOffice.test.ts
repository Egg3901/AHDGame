/**
 * Regression tests for #2038: an NPP seated as US vice president (or president)
 * must not retain a Senate seat awarded in the same founding-election wave.
 *
 * These tests back `electedOfficials` with a small in-memory store so the
 * assertions read real chamber/vacancy state (filled vs unheld rows), not just
 * duplicate counts: the incompatible row must become an unheld vacancy, the
 * executive row must name the NPP, an unrelated NPP keeps its seat, and the
 * governor-succession notification plus leadership re-trigger must run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { clearCabinetOnTransition } from "@/lib/cabinetTransition";
import { triggerLeadershipElectionsAfterChamberVote } from "@/lib/congress/leadershipElections";

vi.mock("@/lib/cabinetTransition", () => ({
  clearCabinetOnTransition: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/singleplayer", () => ({ isSingleplayer: vi.fn(() => false) }));
vi.mock("@/lib/congress/leadershipElections", () => ({
  triggerLeadershipElectionsAfterChamberVote: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/singleplayerHeadOfState", () => ({
  pinnedSingleplayerHeadOfState: vi.fn().mockResolvedValue(null),
  seatSingleplayerHeadOfState: vi.fn().mockResolvedValue(true),
}));

const NOW = new Date("2026-09-17T11:13:41.046Z");

type Row = Record<string, any>;

function valEquals(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId)
    return (a as ObjectId)?.toString() === (b as ObjectId)?.toString();
  return a === b;
}

function matchesOp(docVal: unknown, op: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(op)) {
    if (k === "$ne") {
      if (valEquals(docVal, v)) return false;
    } else if (k === "$in") {
      if (!(v as unknown[]).some((x) => valEquals(docVal, x))) return false;
    } else if (k === "$nin") {
      if ((v as unknown[]).some((x) => valEquals(docVal, x))) return false;
    } else if (k === "$exists") {
      if ((docVal !== undefined) !== Boolean(v)) return false;
    } else {
      return false;
    }
  }
  return true;
}

function matchesDoc(doc: Row, filter: Row): boolean {
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (k === "$or") {
      if (!(v as Row[]).some((f) => matchesDoc(doc, f))) return false;
      continue;
    }
    const dv = doc[k];
    if (v !== null && typeof v === "object" && !(v instanceof ObjectId) && !Array.isArray(v)) {
      if (!matchesOp(dv, v as Record<string, unknown>)) return false;
    } else if (!valEquals(dv, v)) {
      return false;
    }
  }
  return true;
}

function applyUpdate(doc: Row, update: Row): void {
  if (update.$set) for (const [k, v] of Object.entries(update.$set)) doc[k] = v;
  if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
}

function makeElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "president",
    cycle: 0,
    status: "completed",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Election;
}

let db: MockDb;
let store: Row[];
let chars: Map<string, Row>;
let npps: Map<string, Row>;

const VP_NPP = new ObjectId();
const OTHER_NPP = new ObjectId();
const PRES_NPP = new ObjectId();
const WIN_CHAR = new ObjectId();
const VP_CHAR = new ObjectId();
const GOV_CHAR = new ObjectId();

function vacantExecRow(officeType: string): Row {
  return {
    _id: new ObjectId(),
    officeType,
    countryId: "US",
    characterId: null,
    characterName: null,
    party: null,
    isNPP: false,
    nppId: null,
    updatedAt: NOW,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "electedOfficials",
    "characters",
    "npps",
    "electionCandidates",
    "notifications",
    "statePartyOrg",
    "partyBudget",
  ]) {
    db.collection(name);
  }

  store = [
    vacantExecRow("president"),
    vacantExecRow("vicePresident"),
    {
      _id: new ObjectId(),
      officeType: "senate",
      countryId: "US",
      state: "MO",
      senateClass: 1,
      nppId: VP_NPP,
      characterId: null,
      characterName: "Amanda Bishop",
      party: "1",
      isNPP: true,
      electedAt: NOW,
      updatedAt: NOW,
    },
    {
      _id: new ObjectId(),
      officeType: "senate",
      countryId: "US",
      state: "TX",
      senateClass: 2,
      nppId: OTHER_NPP,
      characterId: null,
      characterName: "Unaffected Colleague",
      party: "1",
      isNPP: true,
      electedAt: NOW,
      updatedAt: NOW,
    },
    {
      _id: new ObjectId(),
      officeType: "governor",
      countryId: "US",
      state: "MO",
      characterId: GOV_CHAR,
      characterName: "Mo Governor",
      party: "1",
      isNPP: false,
      electedAt: NOW,
      updatedAt: NOW,
    },
  ];

  chars = new Map([
    [WIN_CHAR.toString(), { _id: WIN_CHAR, name: "President Pat", party: "1", careerHistory: [] }],
    [VP_CHAR.toString(), { _id: VP_CHAR, name: "Veep Char", party: "1", careerHistory: [] }],
    [
      GOV_CHAR.toString(),
      { _id: GOV_CHAR, name: "Mo Governor", party: "1", userId: new ObjectId() },
    ],
  ]);
  npps = new Map([
    [
      VP_NPP.toString(),
      {
        _id: VP_NPP,
        name: "Amanda Bishop",
        party: "1",
        currentOffice: { type: "senate", state: "MO", senateClass: 1 },
      },
    ],
    [
      OTHER_NPP.toString(),
      {
        _id: OTHER_NPP,
        name: "Unaffected Colleague",
        party: "1",
        currentOffice: { type: "senate", state: "TX", senateClass: 2 },
      },
    ],
    [
      PRES_NPP.toString(),
      {
        _id: PRES_NPP,
        name: "President Npp",
        party: "1",
        currentOffice: { type: "senate", state: "CA", senateClass: 3 },
      },
    ],
  ]);

  const officials = db.collectionMocks["electedOfficials"]!;
  officials.find.mockImplementation((filter: Row) => ({
    toArray: async () => store.filter((d) => matchesDoc(d, filter)),
  }));
  officials.findOne.mockImplementation(
    async (filter: Row) => store.find((d) => matchesDoc(d, filter)) ?? null
  );
  officials.updateMany.mockImplementation(async (filter: Row, update: Row) => {
    let n = 0;
    for (const d of store.filter((d) => matchesDoc(d, filter))) {
      applyUpdate(d, update);
      n++;
    }
    return { modifiedCount: n, matchedCount: n };
  });
  officials.updateOne.mockImplementation(async (filter: Row, update: Row, opts: Row) => {
    const hit = store.find((d) => matchesDoc(d, filter));
    if (hit) {
      applyUpdate(hit, update);
      return { modifiedCount: 1, matchedCount: 1 };
    }
    if (opts?.upsert) {
      const doc: Row = { _id: new ObjectId() };
      applyUpdate(doc, update);
      store.push(doc);
      return { modifiedCount: 0, upsertedCount: 1 };
    }
    return { modifiedCount: 0, matchedCount: 0 };
  });
  officials.insertOne.mockImplementation(async (doc: Row) => {
    store.push({ _id: new ObjectId(), ...doc });
    return { insertedId: new ObjectId() };
  });

  db.collectionMocks["characters"]!.findOne.mockImplementation(async (filter: Row) =>
    filter?._id ? (chars.get(filter._id.toString()) ?? null) : null
  );
  db.collectionMocks["npps"]!.findOne.mockImplementation(async (filter: Row) =>
    filter?._id ? (npps.get(filter._id.toString()) ?? null) : null
  );
});

function filledRows() {
  return store.filter((d) => d.characterId || d.nppId);
}

function rowsForNpp(id: ObjectId) {
  return store.filter((d) => d.nppId?.toString() === id.toString());
}

describe("seatPresidentialExecutive dual-office invariant (#2038)", () => {
  it("seats the NPP vice president and vacates their Senate seat through the vacancy mechanism", async () => {
    // Same holder, second incompatible office: a House seat must vacate too.
    store.push({
      _id: new ObjectId(),
      officeType: "house",
      countryId: "US",
      state: "MO",
      nppId: VP_NPP,
      characterId: null,
      characterName: "Amanda Bishop",
      party: "1",
      isNPP: true,
      electedAt: NOW,
      updatedAt: NOW,
    });
    const { seatPresidentialExecutive } = await import("./presidentExecutiveSeating");
    await seatPresidentialExecutive(db as unknown as Db, {
      election: makeElection(),
      winnerCandidate: {
        _id: new ObjectId(),
        isNPP: false,
        characterId: WIN_CHAR,
        characterName: "President Pat",
        party: "1",
      } as unknown as ElectionCandidate,
      vpNppId: VP_NPP,
      now: NOW,
    });

    // Executive row names the NPP exactly once.
    expect(rowsForNpp(VP_NPP)).toHaveLength(1);
    expect(rowsForNpp(VP_NPP)[0].officeType).toBe("vicePresident");

    // Chamber state: the MO Senate seat is an unheld vacancy, not a held seat.
    const moSenate = store.filter(
      (d) => d.officeType === "senate" && d.state === "MO" && d.senateClass === 1
    );
    expect(moSenate).toHaveLength(1);
    expect(moSenate[0].nppId).toBeNull();
    expect(moSenate[0].party).toBeNull();
    expect(moSenate[0].isNPP).toBe(false);
    expect(filledRows().filter((d) => d.state === "MO" && d.officeType === "senate")).toHaveLength(
      0
    );

    // NPP office index tracks the executive seat.
    const vpSet = db.collectionMocks["npps"]!.updateOne.mock.calls.find(
      (c) => (c[0] as Row)?._id?.toString() === VP_NPP.toString()
    );
    expect(vpSet?.[1]).toMatchObject({
      $set: expect.objectContaining({ currentOffice: { type: "vicePresident" } }),
    });

    // Both incompatible rows vacated: no filled House row remains for the NPP.
    expect(filledRows().filter((d) => d.officeType === "house")).toHaveLength(0);

    // Succession side effects ran: governor notified, leadership re-triggered, presence recounted.
    expect(db.collectionMocks["notifications"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Senate Seat Vacant" })
    );
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "senate", NOW);
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "house", NOW);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledWith(
      { _id: "MO_1" },
      expect.anything()
    );

    // Negative control: the unrelated NPP keeps its filled Senate seat.
    const txSenate = store.filter(
      (d) => d.officeType === "senate" && d.state === "TX" && d.senateClass === 2
    );
    expect(txSenate).toHaveLength(1);
    expect(txSenate[0].nppId?.toString()).toBe(OTHER_NPP.toString());
    expect(txSenate[0].party).toBe("1");

    // Future-candidacy guard still covers the NPP identity.
    const withdrawCall = db.collectionMocks["electionCandidates"]!.updateMany.mock.calls.find(
      (c) => c[0]?.status === "active" && c[1]?.$set?.status === "withdrawn"
    );
    const orClause = withdrawCall?.[0].$or as Array<Row>;
    expect(orClause.map((o) => o.nppId?.toString())).toContain(VP_NPP.toString());
  });

  it("vacates both the NPP winner and the character VP legislative seats", async () => {
    store.push({
      _id: new ObjectId(),
      officeType: "senate",
      countryId: "US",
      state: "CA",
      senateClass: 3,
      nppId: PRES_NPP,
      characterId: null,
      characterName: "President Npp",
      party: "1",
      isNPP: true,
      electedAt: NOW,
      updatedAt: NOW,
    });
    store.push({
      _id: new ObjectId(),
      officeType: "senate",
      countryId: "US",
      state: "NV",
      senateClass: 1,
      characterId: VP_CHAR,
      characterName: "Veep Char",
      party: "1",
      isNPP: false,
      electedAt: NOW,
      updatedAt: NOW,
    });

    const { seatPresidentialExecutive } = await import("./presidentExecutiveSeating");
    await seatPresidentialExecutive(db as unknown as Db, {
      election: makeElection(),
      winnerCandidate: {
        _id: new ObjectId(),
        isNPP: true,
        nppId: PRES_NPP,
        characterName: "President Npp",
        party: "1",
      } as unknown as ElectionCandidate,
      vpCharId: VP_CHAR,
      now: NOW,
    });

    const presRows = rowsForNpp(PRES_NPP);
    expect(presRows).toHaveLength(1);
    expect(presRows[0].officeType).toBe("president");

    const charVpRows = store.filter((d) => d.characterId?.toString() === VP_CHAR.toString());
    expect(charVpRows).toHaveLength(1);
    expect(charVpRows[0].officeType).toBe("vicePresident");

    // Both vacated Senate seats read as unheld; chamber holds no duplicate.
    expect(
      filledRows().filter(
        (d) =>
          d.nppId?.toString() === PRES_NPP.toString() ||
          d.characterId?.toString() === VP_CHAR.toString()
      ).length
    ).toBe(2);
    expect(
      filledRows().filter((d) => d.officeType === "senate" && ["CA", "NV"].includes(d.state))
    ).toHaveLength(0);
    expect(clearCabinetOnTransition).toHaveBeenCalled();
  });

  it("is idempotent across seating retries: the second run vacates nothing new", async () => {
    const { seatPresidentialExecutive } = await import("./presidentExecutiveSeating");
    const params = {
      election: makeElection(),
      winnerCandidate: {
        _id: new ObjectId(),
        isNPP: false,
        characterId: WIN_CHAR,
        characterName: "President Pat",
        party: "1",
      } as unknown as ElectionCandidate,
      vpNppId: VP_NPP,
      now: NOW,
    };
    await seatPresidentialExecutive(db as unknown as Db, params);
    const snapshot = JSON.stringify(store.map((d) => ({ ...d, _id: d._id.toString() })));
    const vacateCallsAfterFirst = db.collectionMocks[
      "electedOfficials"
    ]!.updateMany.mock.calls.filter(
      (c) => (c[0] as Row)?.nppId ?? (c[0] as Row)?.characterId
    ).length;

    await seatPresidentialExecutive(db as unknown as Db, params);

    // Still exactly one VP row and one unheld MO vacancy; no new vacate writes.
    expect(rowsForNpp(VP_NPP)).toHaveLength(1);
    expect(filledRows().filter((d) => d.state === "MO" && d.officeType === "senate")).toHaveLength(
      0
    );
    expect(
      db.collectionMocks["electedOfficials"]!.updateMany.mock.calls.filter(
        (c) => (c[0] as Row)?.nppId ?? (c[0] as Row)?.characterId
      ).length
    ).toBe(vacateCallsAfterFirst);
    expect(JSON.stringify(store.map((d) => ({ ...d, _id: d._id.toString() })))).toBe(snapshot);
  });

  it("performs no vacate writes when the executive keeps no other office", async () => {
    const freshNpp = new ObjectId();
    npps.set(freshNpp.toString(), { _id: freshNpp, name: "Fresh", party: "1" });
    const { seatPresidentialExecutive } = await import("./presidentExecutiveSeating");
    await seatPresidentialExecutive(db as unknown as Db, {
      election: makeElection(),
      winnerCandidate: {
        _id: new ObjectId(),
        isNPP: false,
        characterId: WIN_CHAR,
        characterName: "President Pat",
        party: "1",
      } as unknown as ElectionCandidate,
      vpNppId: freshNpp,
      now: NOW,
    });

    expect(
      db.collectionMocks["electedOfficials"]!.updateMany.mock.calls.filter(
        (c) => (c[0] as Row)?.nppId ?? (c[0] as Row)?.characterId
      )
    ).toHaveLength(0);
    expect(triggerLeadershipElectionsAfterChamberVote).not.toHaveBeenCalled();
  });

  it("vacates the pinned singleplayer head of state's House seat before seating", async () => {
    const pinnedId = new ObjectId();
    store.push({
      _id: new ObjectId(),
      officeType: "house",
      countryId: "US",
      state: "MO",
      characterId: pinnedId,
      characterName: "Pinned Player",
      party: "1",
      isNPP: false,
      electedAt: NOW,
      updatedAt: NOW,
    });
    const { pinnedSingleplayerHeadOfState, seatSingleplayerHeadOfState } =
      await import("@/lib/singleplayerHeadOfState");
    vi.mocked(pinnedSingleplayerHeadOfState).mockResolvedValue({ _id: pinnedId } as never);

    const { seatPresidentialExecutive } = await import("./presidentExecutiveSeating");
    await seatPresidentialExecutive(db as unknown as Db, {
      election: makeElection(),
      winnerCandidate: {
        _id: new ObjectId(),
        isNPP: false,
        characterId: WIN_CHAR,
        characterName: "President Pat",
        party: "1",
      } as unknown as ElectionCandidate,
      now: NOW,
    });

    // The pinned holder's House row is an unheld vacancy, not a held seat.
    expect(store.filter((d) => d.characterId?.toString() === pinnedId.toString())).toHaveLength(0);
    const moHouse = store.filter((d) => d.officeType === "house" && d.state === "MO");
    expect(moHouse).toHaveLength(1);
    expect(moHouse[0].party).toBeNull();
    expect(moHouse[0].isNPP).toBe(false);
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "house", NOW);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledWith(
      { _id: "MO_1" },
      expect.anything()
    );

    // The singleplayer seating still ran for the pinned character.
    expect(seatSingleplayerHeadOfState).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ characterId: pinnedId, countryId: "US" })
    );

    // Negative control: the NPP's Senate seat is untouched by the pinned path.
    const txSenate = store.filter(
      (d) => d.officeType === "senate" && d.state === "TX" && d.senateClass === 2
    );
    expect(txSenate).toHaveLength(1);
    expect(txSenate[0].nppId?.toString()).toBe(OTHER_NPP.toString());
  });
});
