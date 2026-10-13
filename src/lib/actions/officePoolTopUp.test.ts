import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { VP_ACTION_CAP } from "@/lib/constants/vicePresidentActions";
import { JUSTICE_ACTION_CAP } from "@/lib/constants/justiceActions";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { GUBERNATORIAL_ACTION_CAP } from "@/lib/constants/governorOffice";
import { OFFICE_POOL_TOP_UP_AP_COST, topUpOfficePool } from "./officePoolTopUp";
import { officePoolTopUpBlock, officePoolTopUpStatus } from "./officePoolTopUpRules";

vi.mock("@/lib/governorOffice/access", () => ({ resolveOfficeAccess: vi.fn() }));
vi.mock("@/lib/governorOffice/isSittingLeader", () => ({ isSittingLeader: vi.fn() }));

type Doc = Record<string, unknown> & { _id: unknown };

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const actual = doc[key];
    if (value != null && typeof value === "object" && !(value instanceof ObjectId)) {
      const ops = value as Record<string, unknown>;
      if ("$gte" in ops) return typeof actual === "number" && actual >= (ops.$gte as number);
      if ("$lt" in ops) return typeof actual === "number" && actual < (ops.$lt as number);
      if ("$ne" in ops) return !sameValue(actual, ops.$ne);
      return false;
    }
    return sameValue(actual, value);
  });
}

function applyUpdate(doc: Doc, update: Record<string, Record<string, unknown>>) {
  for (const [key, delta] of Object.entries(update.$inc ?? {})) {
    doc[key] = ((doc[key] as number) ?? 0) + (delta as number);
  }
  Object.assign(doc, update.$set ?? {});
}

/** Back one mock collection with an in-memory doc list. */
function backCollection(db: MockDb, name: string, docs: Doc[]) {
  const col = db.collection(name) as unknown as MockDb["collectionMocks"][string];
  col.findOne.mockImplementation(
    async (filter: Record<string, unknown>) => docs.find((d) => matches(d, filter)) ?? null
  );
  col.findOneAndUpdate.mockImplementation(
    async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      const found = docs.find((d) => matches(d, filter));
      if (!found) return null;
      applyUpdate(found, update);
      return { ...found };
    }
  );
  col.updateOne.mockImplementation(
    async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      const found = docs.find((d) => matches(d, filter));
      if (!found) return { modifiedCount: 0, matchedCount: 0 };
      applyUpdate(found, update);
      return { modifiedCount: 1, matchedCount: 1 };
    }
  );
  col.updateMany.mockImplementation(
    async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      const hits = docs.filter((d) => matches(d, filter));
      hits.forEach((d) => applyUpdate(d, update));
      return { modifiedCount: hits.length, matchedCount: hits.length };
    }
  );
  return col;
}

const TURN = 500;
let db: MockDb;
let me: ObjectId;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  me = new ObjectId();
});

function setupVp(opts: { actions: number; pool: number; lastTopUp?: number; holder?: ObjectId }) {
  const character: Doc = { _id: me, actions: opts.actions };
  const vp: Doc = {
    _id: new ObjectId(),
    countryId: "US",
    officeType: "vicePresident",
    characterId: opts.holder ?? me,
    vpActionsRemaining: opts.pool,
    lastVpActionResetDay: "2026-10-13",
    ...(opts.lastTopUp != null ? { lastVpActionTopUpTurn: opts.lastTopUp } : {}),
  };
  backCollection(db, "characters", [character]);
  const officials = backCollection(db, "electedOfficials", [vp]);
  return { character, vp, officials };
}

describe("officePoolTopUpBlock", () => {
  const base = { remaining: 0, cap: 2, lastTopUpTurn: null, currentTurn: TURN, playerActions: 50 };

  it("allows a holder below cap with enough AP who has not topped up this turn", () => {
    expect(officePoolTopUpBlock(base)).toBeNull();
    expect(officePoolTopUpBlock({ ...base, lastTopUpTurn: TURN - 1 })).toBeNull();
  });

  it("blocks a full pool, a second buy in the same turn, and short AP", () => {
    expect(officePoolTopUpBlock({ ...base, remaining: 2 })?.reason).toBe("full");
    expect(officePoolTopUpBlock({ ...base, lastTopUpTurn: TURN })?.reason).toBe(
      "already_this_turn"
    );
    expect(
      officePoolTopUpBlock({ ...base, playerActions: OFFICE_POOL_TOP_UP_AP_COST - 1 })?.reason
    ).toBe("insufficient_ap");
  });

  it("reports usedThisTurn only for the current turn", () => {
    expect(officePoolTopUpStatus(TURN, TURN, 12)).toEqual({
      cost: OFFICE_POOL_TOP_UP_AP_COST,
      playerActions: 12,
      usedThisTurn: true,
    });
    expect(officePoolTopUpStatus(TURN - 1, TURN, null).usedThisTurn).toBe(false);
  });
});

describe("topUpOfficePool: vice-president", () => {
  it("debits 10 AP and credits one VP action, stamping the turn", async () => {
    const { character, vp } = setupVp({ actions: 25, pool: 0 });
    const result = await topUpOfficePool(
      db as unknown as Db,
      me,
      { kind: "vp", countryId: "US" as never },
      TURN
    );
    expect(result).toEqual({
      ok: true,
      kind: "vp",
      remaining: 1,
      cap: VP_ACTION_CAP,
      actionsLeft: 15,
    });
    expect(character.actions).toBe(15);
    expect(vp.vpActionsRemaining).toBe(1);
    expect(vp.lastVpActionTopUpTurn).toBe(TURN);
  });

  it("rejects insufficient AP without touching either document", async () => {
    const { character, vp } = setupVp({ actions: OFFICE_POOL_TOP_UP_AP_COST - 1, pool: 0 });
    const result = await topUpOfficePool(
      db as unknown as Db,
      me,
      { kind: "vp", countryId: "US" as never },
      TURN
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(character.actions).toBe(OFFICE_POOL_TOP_UP_AP_COST - 1);
    expect(vp.vpActionsRemaining).toBe(0);
  });

  it("rejects a pool already at cap", async () => {
    const { character } = setupVp({ actions: 50, pool: VP_ACTION_CAP });
    const result = await topUpOfficePool(
      db as unknown as Db,
      me,
      { kind: "vp", countryId: "US" as never },
      TURN
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining("full"),
    });
    expect(character.actions).toBe(50);
  });

  it("allows only one top-up per pool per turn", async () => {
    const { character, vp } = setupVp({ actions: 50, pool: 0 });
    const target = { kind: "vp" as const, countryId: "US" as never };
    await expect(topUpOfficePool(db as unknown as Db, me, target, TURN)).resolves.toMatchObject({
      ok: true,
    });
    await expect(topUpOfficePool(db as unknown as Db, me, target, TURN)).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    expect(character.actions).toBe(40);
    expect(vp.vpActionsRemaining).toBe(1);
    await expect(topUpOfficePool(db as unknown as Db, me, target, TURN + 1)).resolves.toMatchObject(
      {
        ok: true,
        remaining: 2,
      }
    );
  });

  it("refunds the AP when the pool credit loses a race", async () => {
    const { character, officials } = setupVp({ actions: 30, pool: 0 });
    officials.findOneAndUpdate.mockResolvedValueOnce(null);
    const result = await topUpOfficePool(
      db as unknown as Db,
      me,
      { kind: "vp", countryId: "US" as never },
      TURN
    );
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(character.actions).toBe(30);
  });

  it("refuses anyone but the seated vice-president", async () => {
    const { character } = setupVp({ actions: 50, pool: 0, holder: new ObjectId() });
    const result = await topUpOfficePool(
      db as unknown as Db,
      me,
      { kind: "vp", countryId: "US" as never },
      TURN
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(character.actions).toBe(50);
  });
});

describe("topUpOfficePool: Justice", () => {
  it("credits the seated Justice's pool up to the cap", async () => {
    const character: Doc = { _id: me, actions: 10 };
    const seat: Doc = {
      _id: new ObjectId(),
      countryId: "US",
      seatNumber: 3,
      justiceCharacterId: me,
      justiceActionsRemaining: JUSTICE_ACTION_CAP - 1,
    };
    backCollection(db, "characters", [character]);
    backCollection(db, "supremeCourtSeats", [seat]);
    const result = await topUpOfficePool(
      db as unknown as Db,
      me,
      { kind: "justice", countryId: "US" as never, seatNumber: 3 },
      TURN
    );
    expect(result).toMatchObject({ ok: true, remaining: JUSTICE_ACTION_CAP, actionsLeft: 0 });
    expect(seat.lastJusticeActionTopUpTurn).toBe(TURN);
  });
});

describe("topUpOfficePool: ministerial", () => {
  it("credits a per-row pool for a non-UK cabinet holder", async () => {
    const character: Doc = { _id: me, actions: 20 };
    const row: Doc = {
      _id: new ObjectId(),
      countryId: "US",
      positionId: "secretary_of_state",
      characterId: me,
      ministerialActions: 1,
      lastMinisterialActionResetDay: "2026-10-13",
    };
    backCollection(db, "characters", [character]);
    backCollection(db, "cabinetMembers", [row]);
    const result = await topUpOfficePool(
      db as unknown as Db,
      me,
      { kind: "ministerial", countryId: "US" as never, positionId: "secretary_of_state" },
      TURN
    );
    expect(result).toMatchObject({ ok: true, remaining: 2, cap: MINISTERIAL_ACTION_CAP });
    expect(row.lastMinisterialActionTopUpTurn).toBe(TURN);
    expect(character.actions).toBe(10);
  });

  it("credits the UK shared pool and mirrors it to every row the holder keeps", async () => {
    const character: Doc = { _id: me, actions: 20, sharedMinisterialActions: 1 };
    const rows: Doc[] = ["chancellor", "deputy_prime_minister"].map((positionId) => ({
      _id: new ObjectId(),
      countryId: "UK",
      positionId,
      characterId: me,
      ministerialActions: 1,
      lastMinisterialActionResetDay: "2026-10-13",
    }));
    backCollection(db, "characters", [character]);
    backCollection(db, "cabinetMembers", rows);
    const result = await topUpOfficePool(
      db as unknown as Db,
      me,
      { kind: "ministerial", countryId: "UK" as never, positionId: "chancellor" },
      TURN
    );
    expect(result).toMatchObject({ ok: true, remaining: 2 });
    expect(character.sharedMinisterialActions).toBe(2);
    expect(character.sharedMinisterialActionTopUpTurn).toBe(TURN);
    expect(character.actions).toBe(10);
    for (const row of rows) expect(row.ministerialActions).toBe(2);
  });
});

describe("topUpOfficePool: gubernatorial", () => {
  it("credits the holder's office pool and refuses a party officer", async () => {
    const { resolveOfficeAccess } = await import("@/lib/governorOffice/access");
    const character: Doc = { _id: me, actions: 40 };
    const office: Doc = {
      _id: new ObjectId(),
      countryId: "US",
      stateId: "CA",
      gubernatorialActions: GUBERNATORIAL_ACTION_CAP - 2,
    };
    backCollection(db, "characters", [character]);
    backCollection(db, "governorOfficeState", [office]);
    const target = { kind: "gubernatorial" as const, countryId: "US" as never, stateId: "ca" };

    vi.mocked(resolveOfficeAccess).mockResolvedValueOnce({ viewerIsHolder: false } as never);
    await expect(topUpOfficePool(db as unknown as Db, me, target, TURN)).resolves.toMatchObject({
      ok: false,
      status: 403,
    });

    vi.mocked(resolveOfficeAccess).mockResolvedValueOnce({ viewerIsHolder: true } as never);
    await expect(topUpOfficePool(db as unknown as Db, me, target, TURN)).resolves.toMatchObject({
      ok: true,
      remaining: GUBERNATORIAL_ACTION_CAP - 1,
      actionsLeft: 30,
    });
    expect(office.lastGubernatorialActionTopUpTurn).toBe(TURN);
  });

  it("gates the national pseudo-state office on the sitting leader", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    const { getNationalStateId } = await import("@/lib/policy/nationalStateId");
    const nationalId = getNationalStateId("US" as never);
    const character: Doc = { _id: me, actions: 40 };
    const office: Doc = {
      _id: new ObjectId(),
      countryId: "US",
      stateId: nationalId,
      gubernatorialActions: 0,
    };
    backCollection(db, "characters", [character]);
    backCollection(db, "governorOfficeState", [office]);
    vi.mocked(isSittingLeader).mockResolvedValueOnce(true);
    await expect(
      topUpOfficePool(
        db as unknown as Db,
        me,
        { kind: "gubernatorial", countryId: "US" as never, stateId: nationalId },
        TURN
      )
    ).resolves.toMatchObject({ ok: true, remaining: 1 });
  });
});
