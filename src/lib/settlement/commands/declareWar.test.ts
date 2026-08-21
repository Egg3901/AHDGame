import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("../actorContext", () => ({ loadSettlementActorContext: vi.fn() }));
vi.mock("@/lib/world/blocMembership", () => ({ loadBlocMembership: vi.fn() }));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("1953-default"),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(412) }));
vi.mock("@/lib/military/createConflict", () => ({ createConflict: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();
const characterId = new ObjectId();

const usSeat = {
  id: "US",
  role: "headOfGovernment",
  direction: -1,
  budget: { actionsPerTurn: 1, actionsRemaining: 1, capital: 60 },
  canAct: true,
  blockedReason: null,
};

const ctx = (seat: Record<string, unknown> | null) => ({
  crisisId: CRISIS_ID.toString(),
  seat,
  personal: { actionsRemaining: 3 },
});

describe("declareSettlementWar", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });

    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(ctx(usSeat) as never);
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({
      US: "west",
      UK: "west",
      RU: "east",
      DD: "east",
      // A non-playable world entity in the map must not reach the coalition.
      HU: "east",
      NVN: "east",
    });
    const { createConflict } = await import("@/lib/military/createConflict");
    vi.mocked(createConflict).mockResolvedValue({
      _id: "gq_de_412",
      conflictId: 7,
    } as never);
  });

  it("refuses a delegation without authority", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      ctx({ ...usSeat, id: "DD", direction: 1 }) as never
    );
    const { declareSettlementWar } = await import("./declareWar");
    expect(await declareSettlementWar(db as unknown as Db, characterId)).toMatchObject({
      ok: false,
      status: 403,
    });
    const { createConflict } = await import("@/lib/military/createConflict");
    expect(vi.mocked(createConflict)).not.toHaveBeenCalled();
  });

  it("refuses when an alliance has no members left to fight", async () => {
    const { loadBlocMembership } = await import("@/lib/world/blocMembership");
    vi.mocked(loadBlocMembership).mockResolvedValue({ US: "west", UK: "west" });
    const { declareSettlementWar } = await import("./declareWar");
    expect(await declareSettlementWar(db as unknown as Db, characterId)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("claims the freeze before building the war", async () => {
    const { declareSettlementWar } = await import("./declareWar");
    await declareSettlementWar(db as unknown as Db, characterId);
    const [filter, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter).toMatchObject({ status: "open", "ladder.heat": 5 });
    expect(update.$set.status).toBe("frozen");
  });

  it("builds no war when the claim matches nothing", async () => {
    // A tick decayed the heat, or a second authority seat got there first.
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { declareSettlementWar } = await import("./declareWar");
    expect(await declareSettlementWar(db as unknown as Db, characterId)).toMatchObject({
      ok: false,
      status: 409,
    });
    const { createConflict } = await import("@/lib/military/createConflict");
    expect(vi.mocked(createConflict)).not.toHaveBeenCalled();
  });

  it("puts the two live alliances on opposite sides, anchored on Germany", async () => {
    const { declareSettlementWar } = await import("./declareWar");
    await declareSettlementWar(db as unknown as Db, characterId);
    const { createConflict } = await import("@/lib/military/createConflict");
    const input = vi.mocked(createConflict).mock.calls[0][1];
    expect(input).toMatchObject({
      hostCountry: "DE",
      type: "interstate",
      createdBy: "event",
      startTurn: 412,
    });
    expect(input.sideA).toMatchObject({ backer: "west", kind: "coalition" });
    expect(input.sideB).toMatchObject({ backer: "east", kind: "coalition" });
    expect(input.sideA.countries).toEqual(["UK", "US"]);
  });

  it("keeps non-playable world entities out of the coalitions", async () => {
    // `loadBlocMembership` covers entities the game does not implement; the
    // conflict engine's `countries` must be real CountryIds.
    const { declareSettlementWar } = await import("./declareWar");
    await declareSettlementWar(db as unknown as Db, characterId);
    const { createConflict } = await import("@/lib/military/createConflict");
    const input = vi.mocked(createConflict).mock.calls[0][1];
    expect(input.sideB.countries).not.toContain("NVN");
    expect(input.sideB.countries).toContain("DD");
  });

  it("makes both Germanies the hosts, so both change hands with the war", async () => {
    const { declareSettlementWar } = await import("./declareWar");
    await declareSettlementWar(db as unknown as Db, characterId);
    const { createConflict } = await import("@/lib/military/createConflict");
    expect(vi.mocked(createConflict).mock.calls[0][1].hostEntities).toEqual(["DE", "DD"]);
  });

  it("links the conflict back onto the crisis", async () => {
    const { declareSettlementWar } = await import("./declareWar");
    const res = await declareSettlementWar(db as unknown as Db, characterId);
    expect(res).toEqual({ ok: true, conflictId: "gq_de_412", conflictNumber: 7 });
    const link = prime(db, "settlementCrises").updateOne.mock.calls[1];
    expect(link[1].$set.conflictId).toBe("gq_de_412");
  });
  it("refuses while the escalation ladder is switched off", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue({
      _id: CRISIS_ID,
      rules: { openLog: true, driftRevealed: false, escalationEnabled: false },
    });
    const { declareSettlementWar } = await import("./declareWar");
    const res = await declareSettlementWar(db as unknown as Db, characterId);
    expect(res).toMatchObject({ ok: false, status: 403 });
    // No freeze, and above all no war.
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
    const { createConflict } = await import("@/lib/military/createConflict");
    expect(vi.mocked(createConflict)).not.toHaveBeenCalled();
  });

  it("restates the switch on the freeze claim, tolerating a missing field", async () => {
    const { declareSettlementWar } = await import("./declareWar");
    await declareSettlementWar(db as unknown as Db, characterId);
    const [filter] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter["rules.escalationEnabled"]).toEqual({ $ne: false });
  });
});
