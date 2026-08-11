import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { requirePeaceNegotiator } from "../requirePeaceNegotiator";

const HOG = new ObjectId();
const MINISTER = new ObjectId();
const BYSTANDER = new ObjectId();

const hogSpy = vi.fn();
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: (...a: unknown[]) => hogSpy(...a),
}));

let seatHolder: { characterId: ObjectId | null } | null = null;
vi.mock("@/lib/db/collections/cabinetMembers", () => ({
  getCabinetMembersCollection: () => ({ findOne: async () => seatHolder }),
}));

const db = {} as Db;

beforeEach(() => {
  vi.clearAllMocks();
  hogSpy.mockResolvedValue(HOG);
  seatHolder = { characterId: MINISTER };
});

describe("requirePeaceNegotiator", () => {
  it("accepts the head of government EVEN WHILE a player holds the foreign seat", async () => {
    // The whole point of the change. requireForeignMinister returns 403 here,
    // because it gives a seated minister exclusivity.
    const r = await requirePeaceNegotiator(db, "UK", HOG);
    expect(r.ok).toBe(true);
    expect((r as { via: string }).via).toBe("head_of_government");
  });

  it("accepts the foreign seat holder while a head of government exists", async () => {
    const r = await requirePeaceNegotiator(db, "UK", MINISTER);
    expect(r.ok).toBe(true);
    expect((r as { via: string }).via).toBe("foreign_minister");
  });

  it("accepts the head of government when the seat is vacant", async () => {
    seatHolder = null;
    expect((await requirePeaceNegotiator(db, "UK", HOG)).ok).toBe(true);
  });

  it("accepts the head of government when the seat is NPP-held", async () => {
    // An NPP seat has a null characterId — it belongs to no player actor, so it
    // must neither authorize anyone nor block the head of government.
    seatHolder = { characterId: null };
    expect((await requirePeaceNegotiator(db, "UK", HOG)).ok).toBe(true);
  });

  it("refuses an NPP seat as an actor in its own right", async () => {
    seatHolder = { characterId: null };
    expect((await requirePeaceNegotiator(db, "UK", BYSTANDER)).ok).toBe(false);
  });

  it("accepts the head of government for a country with NO foreign seat configured", async () => {
    // FOREIGN_AFFAIRS_POSITION_BY_COUNTRY is null for BR and others. Nobody is
    // ever locked out of negotiating for their own country.
    expect((await requirePeaceNegotiator(db, "BR", HOG)).ok).toBe(true);
  });

  it("refuses a character who is neither", async () => {
    const r = await requirePeaceNegotiator(db, "UK", BYSTANDER);
    expect(r.ok).toBe(false);
    expect((r as { response: Response }).response.status).toBe(403);
  });

  it("names BOTH offices in the refusal", async () => {
    // A player who holds neither should learn who does.
    const r = await requirePeaceNegotiator(db, "UK", BYSTANDER);
    const body = await (r as { response: Response }).response.json();
    expect(body.error).toMatch(/foreign minister/i);
    expect(body.error).toMatch(/head of government/i);
  });

  it("resolves the leader through the shared helper, not a hand-rolled lookup", async () => {
    // Presidential leaders live in electedOfficials, parliamentary ones in
    // governmentFormations. getHeadOfGovernmentCharacterId branches on the runtime
    // government type; reading either collection directly gets one of them wrong.
    await requirePeaceNegotiator(db, "US", HOG);
    expect(hogSpy).toHaveBeenCalledWith(db, "US");
  });

  it("does not fall over when there is no head of government at all", async () => {
    seatHolder = null;
    hogSpy.mockResolvedValue(null);
    const r = await requirePeaceNegotiator(db, "UK", BYSTANDER);
    expect(r.ok).toBe(false);
  });
});

describe("admins", () => {
  it("bypasses, matching the declare-war route", async () => {
    // Both executive shells show the Foreign Affairs tab to admins. Without this
    // an admin would get a working declaration button beside a peace form that 403s.
    const r = await requirePeaceNegotiator(db, "UK", BYSTANDER, true);
    expect(r.ok).toBe(true);
    expect((r as { via: string }).via).toBe("admin");
  });

  it("does not bypass for a non-admin", async () => {
    expect((await requirePeaceNegotiator(db, "UK", BYSTANDER, false)).ok).toBe(false);
  });

  it("defaults to NOT bypassing when the flag is omitted", async () => {
    // A caller that forgets the argument must fail closed.
    expect((await requirePeaceNegotiator(db, "UK", BYSTANDER)).ok).toBe(false);
  });
});
