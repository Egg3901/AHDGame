import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { MAX_COERCIVE_RUNG } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("../actorContext", () => ({ loadSettlementActorContext: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(412) }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();
const characterId = new ObjectId();

function ctx(seat: Record<string, unknown> | null) {
  return { crisisId: CRISIS_ID.toString(), seat, personal: { actionsRemaining: 3 } };
}

const usSeat = {
  id: "US",
  role: "headOfGovernment",
  direction: -1,
  budget: { actionsPerTurn: 1, actionsRemaining: 1, capital: 60 },
  canAct: true,
  blockedReason: null,
};

describe("armSettlementLadder", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(ctx(usSeat) as never);
  });

  it("refuses when the feature gate is off", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(null);
    const { armSettlementLadder } = await import("./armLadder");
    expect(await armSettlementLadder(db as unknown as Db, characterId)).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("refuses a character with no delegation", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(ctx(null) as never);
    const { armSettlementLadder } = await import("./armLadder");
    expect(await armSettlementLadder(db as unknown as Db, characterId)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("refuses a delegation without escalation authority", async () => {
    // East Berlin can raise heat with coercive plays but cannot force the rung.
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      ctx({ ...usSeat, id: "DD", direction: 1 }) as never
    );
    const { armSettlementLadder } = await import("./armLadder");
    const res = await armSettlementLadder(db as unknown as Db, characterId);
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("allows Moscow as well as Washington", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      ctx({ ...usSeat, id: "RU", direction: 1 }) as never
    );
    const { armSettlementLadder } = await import("./armLadder");
    expect(await armSettlementLadder(db as unknown as Db, characterId)).toMatchObject({ ok: true });
  });

  it("refuses an authority seat whose country is in neither bloc", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      ctx({ ...usSeat, direction: null }) as never
    );
    const { armSettlementLadder } = await import("./armLadder");
    expect(await armSettlementLadder(db as unknown as Db, characterId)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("guards on the ladder still sitting exactly at the coercive cap", async () => {
    const { armSettlementLadder } = await import("./armLadder");
    await armSettlementLadder(db as unknown as Db, characterId);
    const [filter, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter).toMatchObject({ status: "open", "ladder.heat": MAX_COERCIVE_RUNG });
    expect(update.$set["ladder.heat"]).toBe(5);
  });

  it("stamps the turn the brink was reached", async () => {
    const { armSettlementLadder } = await import("./armLadder");
    await armSettlementLadder(db as unknown as Db, characterId);
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(update.$set["ladder.armedTurn"]).toBe(412);
  });

  it("refuses when the guarded write matches nothing", async () => {
    // Either a second authority seat got there first, or a tick decayed the
    // heat between the read and the write.
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { armSettlementLadder } = await import("./armLadder");
    expect(await armSettlementLadder(db as unknown as Db, characterId)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("reports the rung it armed to", async () => {
    const { armSettlementLadder } = await import("./armLadder");
    expect(await armSettlementLadder(db as unknown as Db, characterId)).toEqual({
      ok: true,
      heat: 5,
    });
  });
});
