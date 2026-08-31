import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import { acceptPeace } from "../acceptPeace";

const convertSpy = vi.fn((_f: string, _t: string, amount: number) => amount);
const standDownSpy = vi.fn();
const recordTruceSpy = vi.fn();
const resolveSpy = vi.fn();
const budgetSpy = vi.fn();
const conflictUpdateSpy = vi.fn();
const offerUpdateSpy = vi.fn();
/** modifiedCount the offer-claim write returns; 0 means someone else accepted first. */
let claimResult = 1;

vi.mock("@/lib/internationalOrganizations/organizationFund", () => ({
  convertLocal: (...a: unknown[]) => convertSpy(...(a as [string, string, number])),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({ loadWorldPreset: async () => "cold_war" }));
vi.mock("@/lib/military/leaveConflict", () => ({
  standDownCountry: (...a: unknown[]) => {
    standDownSpy(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/military/truce", () => ({
  recordTruce: (...a: unknown[]) => {
    recordTruceSpy(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/military/resolveConflict", () => ({
  resolveConflict: (...a: unknown[]) => {
    resolveSpy(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/db/collections/conflicts", () => ({
  getConflictsCollection: () => ({
    updateOne: (...a: unknown[]) => {
      conflictUpdateSpy(...a);
      return Promise.resolve({ modifiedCount: 1 });
    },
  }),
}));
vi.mock("@/lib/db/collections/peaceOffers", () => ({
  getPeaceOffersCollection: () => ({
    updateOne: (...a: unknown[]) => {
      offerUpdateSpy(...a);
      return Promise.resolve({ modifiedCount: claimResult });
    },
  }),
}));
// Budget self-heal is orthogonal to what these tests assert (the indemnity
// $inc pair still fires via the db mock's updateOne). Stub it so it does not
// need a findOne on the minimal db mock.
vi.mock("@/lib/turn/ensureFederalBudget", () => ({
  ensureFederalBudget: vi.fn().mockResolvedValue(null),
}));

const db = {
  collection: () => ({
    updateOne: (...a: unknown[]) => {
      budgetSpy(...a);
      return Promise.resolve({ modifiedCount: 1 });
    },
  }),
} as unknown as Db;

/** A coalition war: side A = US+UK, side B = CN. */
function makeConflict(): ConflictDoc {
  return {
    _id: "t1",
    status: "active",
    hostCountry: "CN",
    sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition" },
    sideB: { label: "PLA", countries: ["CN"], kind: "state" },
  } as unknown as ConflictDoc;
}

const offer = (o: Partial<PeaceOfferDoc> = {}): PeaceOfferDoc => {
  const fromCountry = o.fromCountry ?? "UK";
  return {
    _id: "o1",
    conflictId: "t1",
    fromCountry,
    toCountry: "CN",
    // Defaults to the original direction, the sender leaving, so every case written
    // before offers ran both ways still means what it meant. Derived from
    // `fromCountry` rather than pinned, so a case that overrides the sender does not
    // silently keep the previous sender as the one who leaves.
    leaver: o.leaver ?? fromCountry,
    term: { kind: "indemnity" as const, payer: "UK", amount: 100 },
    status: "pending",
    offeredTurn: 1,
    expiresTurn: 99,
    offeredBy: "c0",
    ...o,
  } as unknown as PeaceOfferDoc;
};

/** The $inc applied to a country treasuryBalance, or undefined. */
function budgetInc(country: string): number | undefined {
  const call = budgetSpy.mock.calls.find(
    (c) => (c[0] as { countryId: string }).countryId === country
  );
  return call ? (call[1] as { $inc: { treasuryBalance: number } }).$inc.treasuryBalance : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  claimResult = 1;
  convertSpy.mockImplementation((_f, _t, amount) => amount);
});

describe("the indemnity", () => {
  it("debits the payer the quoted amount and credits the CONVERTED amount", async () => {
    // Quoted in the payer currency; the recipient is credited in theirs.
    convertSpy.mockReturnValue(250);
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(budgetInc("UK")).toBe(-100);
    expect(budgetInc("CN")).toBe(250);
  });

  it("converts FROM the payer TO the recipient, in that order", async () => {
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(convertSpy).toHaveBeenCalledWith("UK", "CN", 100, "cold_war");
  });

  it("moves the figure unchanged when both share a currency", async () => {
    // convertLocal is a no-op for a same-currency pair; this pins that the
    // conversion is applied ONCE and not twice.
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(budgetInc("UK")).toBe(-100);
    expect(budgetInc("CN")).toBe(100);
  });

  it("converts exactly once", async () => {
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(convertSpy).toHaveBeenCalledTimes(1);
  });

  it("bills the RECIPIENT when the other party is the payer", async () => {
    // Either party may pay: a winning country may pay to disengage.
    await acceptPeace(
      db,
      offer({ term: { kind: "indemnity" as const, payer: "CN", amount: 50 } }),
      makeConflict(),
      40,
      "c1"
    );
    expect(budgetInc("CN")).toBe(-50);
    expect(budgetInc("UK")).toBe(50);
  });

  it("never writes debt.principal", async () => {
    // It is a derived mirror of treasuryBalance; treasuryTurn owns it.
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    for (const call of budgetSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/principal/);
    }
  });

  it("pays into debt rather than refusing", async () => {
    // treasuryBalance is a signed position — a country already in debt must still
    // be able to buy peace.
    const r = await acceptPeace(
      db,
      offer({ term: { kind: "indemnity" as const, payer: "UK", amount: 1e12 } }),
      makeConflict(),
      40,
      "c1"
    );
    expect(r.resolved).toBe(false);
    expect(budgetInc("UK")).toBe(-1e12);
  });

  it("moves no money for a white peace", async () => {
    await acceptPeace(
      db,
      offer({ term: { kind: "indemnity" as const, payer: "UK", amount: 0 } }),
      makeConflict(),
      40,
      "c1"
    );
    expect(budgetSpy).not.toHaveBeenCalled();
    expect(convertSpy).not.toHaveBeenCalled();
  });
});

describe("leaving the war", () => {
  it("stands the LEAVER down, not the other party", async () => {
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(standDownSpy).toHaveBeenCalledTimes(1);
    expect(standDownSpy.mock.calls[0][2]).toBe("UK");
  });

  it("pulls the leaver off the roster of the side it fought on", async () => {
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    // Found rather than indexed: the settlement stamp is also a conflicts write, and
    // asserting on call order would break the moment another one is added.
    const pull = conflictUpdateSpy.mock.calls.find((c) => c[1]?.$pull);
    expect(pull?.[1]).toEqual({ $pull: { "sideA.countries": "UK" } });
  });

  it("records the truce between the two parties", async () => {
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(recordTruceSpy).toHaveBeenCalledWith(expect.anything(), "UK", "CN", 40);
  });

  it("marks the offer accepted, with who and when", async () => {
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    const [, update] = offerUpdateSpy.mock.calls[0];
    expect(update).toEqual({
      $set: { status: "accepted", resolvedBy: "c1", resolvedTurn: 40 },
    });
  });

  it("claims the offer conditionally on it still being pending", async () => {
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    const [filter] = offerUpdateSpy.mock.calls[0];
    expect(filter).toEqual({ _id: "o1", status: "pending" });
  });

  it("leaves the war running while allies remain", async () => {
    const r = await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(r.resolved).toBe(false);
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});

describe("when the leaver was the last of its side", () => {
  it("resolves the war with the OTHER side as winner", async () => {
    // CN is alone on side B; it leaving hands the war to side A.
    const r = await acceptPeace(
      db,
      offer({
        fromCountry: "CN",
        toCountry: "UK",
        term: { kind: "indemnity" as const, payer: "CN", amount: 0 },
      }),
      makeConflict(),
      40,
      "c1"
    );
    expect(r.resolved).toBe(true);
    expect(resolveSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "A", 40);
  });

  it("names side B the winner when side A is the one that empties", async () => {
    const duel = makeConflict();
    duel.sideA.countries = ["UK"];
    const r = await acceptPeace(db, offer(), duel, 40, "c1");
    expect(r.resolved).toBe(true);
    expect(resolveSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "B", 40);
  });

  it("removes the leaver from the roster BEFORE resolving", async () => {
    // resolveConflict truces every remaining cross-side pair. A stale roster would
    // truce the leaver a second time, overwriting its expiry.
    const duel = makeConflict();
    duel.sideA.countries = ["UK"];
    await acceptPeace(db, offer(), duel, 40, "c1");
    const passed = resolveSpy.mock.calls[0][1] as ConflictDoc;
    expect(passed.sideA.countries).toEqual([]);
  });
});

describe("a double accept", () => {
  it("applies NOTHING when the offer was already claimed", async () => {
    // Two simultaneous accepts both clear the route revalidation; only one can move
    // the document off pending. Without this, both would move the money.
    claimResult = 0;
    const r = await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(r).toEqual({ applied: false, resolved: false });
    expect(budgetSpy).not.toHaveBeenCalled();
    expect(standDownSpy).not.toHaveBeenCalled();
    expect(recordTruceSpy).not.toHaveBeenCalled();
    expect(conflictUpdateSpy).not.toHaveBeenCalled();
  });

  it("reports applied on the accept that wins", async () => {
    const r = await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    expect(r.applied).toBe(true);
  });
});

describe("treaty release", () => {
  /** US attacks DD; RU was pulled in under the Warsaw Pact to defend DD. */
  function pactConflict(): ConflictDoc {
    return {
      _id: "t1",
      status: "active",
      hostCountry: "DD",
      sideA: { label: "US", countries: ["US"], kind: "state" },
      sideB: { label: "Pact", countries: ["DD", "RU"], kind: "coalition" },
      treatyEntries: [
        { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 5 },
      ],
    } as unknown as ConflictDoc;
  }

  const ddLeaves = () =>
    offer({
      fromCountry: "DD",
      toCountry: "US",
      term: { kind: "indemnity" as const, payer: "DD", amount: 0 },
    });

  it("takes the ally out when the country it defended makes peace", async () => {
    const conflict = pactConflict();
    await acceptPeace(db, ddLeaves(), conflict, 100, "c1");
    expect(standDownSpy).toHaveBeenCalledWith(expect.anything(), conflict, "DD");
    expect(standDownSpy).toHaveBeenCalledWith(expect.anything(), conflict, "RU");
  });

  it("truces the released ally against the opposing side", async () => {
    await acceptPeace(db, ddLeaves(), pactConflict(), 100, "c1");
    expect(recordTruceSpy).toHaveBeenCalledWith(expect.anything(), "RU", "US", 100);
  });

  it("resolves the war when the principal and its allies were the whole side", async () => {
    const res = await acceptPeace(db, ddLeaves(), pactConflict(), 100, "c1");
    expect(resolveSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "A", 100);
    expect(res.resolved).toBe(true);
  });

  it("leaves allies bound to a different member in place", async () => {
    const conflict = pactConflict();
    conflict.sideB.countries = ["DD", "RU", "PL"];
    conflict.treatyEntries = [
      { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 5 },
      { countryId: "PL", organizationId: "WARSAW_PACT", defending: "CS", joinedTurn: 5 },
    ];
    await acceptPeace(db, ddLeaves(), conflict, 100, "c1");
    expect(standDownSpy).not.toHaveBeenCalledWith(expect.anything(), conflict, "PL");
  });

  it("is unchanged for a conflict with no treaty entries", async () => {
    await acceptPeace(db, offer(), makeConflict(), 100, "c1");
    expect(standDownSpy).toHaveBeenCalledTimes(1);
  });

  // The ally's enemy roster must be captured BEFORE the roster splices run, or the
  // truce loop reads an array the principal has already been removed from and the ally
  // walks away with no truce at all.
  it("truces a released ally against every enemy, not only the survivors", async () => {
    const conflict = pactConflict();
    conflict.sideA.countries = ["US", "UK"];
    await acceptPeace(db, ddLeaves(), conflict, 100, "c1");
    expect(recordTruceSpy).toHaveBeenCalledWith(expect.anything(), "RU", "US", 100);
    expect(recordTruceSpy).toHaveBeenCalledWith(expect.anything(), "RU", "UK", 100);
  });
});

describe("the settlement stamp", () => {
  it("records the term, so the war wire can report what was taken", async () => {
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    const stamp = conflictUpdateSpy.mock.calls.find((c) => c[1]?.$set?.settlement);
    expect(stamp?.[1].$set.settlement).toMatchObject({
      path: "negotiated",
      imposedBy: "UK",
      target: "CN",
      turn: 40,
    });
  });

  it("posts nothing itself, because this runs on a request path", async () => {
    // A news post made from a request would fire again on a retry. The turn sweep
    // reads the stamp instead.
    await acceptPeace(db, offer(), makeConflict(), 40, "c1");
    const stamp = conflictUpdateSpy.mock.calls.find((c) => c[1]?.$set?.settlement);
    expect(stamp).toBeTruthy();
    expect(JSON.stringify(conflictUpdateSpy.mock.calls)).not.toContain("postedWireEvents");
  });
});

describe("a withdrawal asked of the recipient", () => {
  it("removes the RECIPIENT and leaves the sender in the war", async () => {
    // "You get out": the sender stays and fights on. This is how a coalition is
    // peeled apart by negotiation rather than by battle.
    await acceptPeace(db, offer({ leaver: "CN" }), makeConflict(), 40, "c1");
    const pull = conflictUpdateSpy.mock.calls.find((c) => c[1]?.$pull);
    expect(pull?.[1]).toEqual({ $pull: { "sideB.countries": "CN" } });
  });

  it("stands the RECIPIENT down, not the sender", async () => {
    await acceptPeace(db, offer({ leaver: "CN" }), makeConflict(), 40, "c1");
    expect(standDownSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "CN");
    expect(standDownSpy).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "UK");
  });

  it("truces the same pair whichever way the deal runs", async () => {
    await acceptPeace(db, offer({ leaver: "CN" }), makeConflict(), 40, "c1");
    expect(recordTruceSpy).toHaveBeenCalledWith(expect.anything(), "CN", "UK", 40);
  });

  it("releases the LEAVER's treaty guests, not the sender's", async () => {
    // The guarantee follows the country that leaves: an ally pulled in to defend the
    // departing country goes with it.
    const c = makeConflict();
    c.treatyEntries = [
      { countryId: "RU", organizationId: "WARSAW_PACT", defending: "CN", joinedTurn: 1 },
    ] as never;
    c.sideB.countries = ["CN", "RU"] as never;
    await acceptPeace(db, offer({ leaver: "CN" }), c, 40, "c1");
    expect(standDownSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "RU");
  });
});
