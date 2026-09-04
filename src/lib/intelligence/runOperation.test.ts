import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { IntelligenceAgency } from "@/lib/db/types/intelligence";
import { ACTION_MIN_COVERAGE, COLLECTION_COST, COLLECTION_GAIN } from "./config";

const state = {
  network: null as Record<string, unknown> | null,
  coverage: null as Record<string, unknown> | null,
  targetAgency: null as Record<string, unknown> | null,
  /** The acting agency as a re-read would find it after a failed claim. */
  ownAgency: null as Record<string, unknown> | null,
  /** Whether the atomic budget-and-slot claim matched. */
  claimMatched: true,
  coverageWrites: [] as unknown[],
  networkWrites: [] as unknown[],
  agencyClaims: [] as unknown[],
  logRows: [] as Record<string, unknown>[],
};

vi.mock("@/lib/coldwar/tension", () => ({ applyTensionEvent: vi.fn() }));
vi.mock("./strategicAction", () => ({ applyStrategicAction: vi.fn() }));
vi.mock("./militaryAction", () => ({ applyMilitaryAction: vi.fn() }));
vi.mock("./flags", () => ({ readMilitarySabotageEnabled: vi.fn() }));
vi.mock("@/lib/db/collections/intelligence", () => ({
  getIntelligenceNetworksCollection: async () => ({
    findOne: async () => state.network,
    updateOne: async (_f: unknown, u: unknown) => {
      state.networkWrites.push(u);
    },
  }),
  getIntelligenceCoverageCollection: async () => ({
    findOne: async () => state.coverage,
    updateOne: async (_f: unknown, u: unknown) => {
      state.coverageWrites.push(u);
    },
  }),
  getIntelligenceAgenciesCollection: async () => ({
    // `_id` in the filter means the acting agency being re-read after a refused
    // claim; `countryId` means the TARGET's posture.
    findOne: async (filter: Record<string, unknown>) =>
      "_id" in filter ? state.ownAgency : state.targetAgency,
    updateOne: async (_f: unknown, u: unknown) => {
      state.agencyClaims.push(u);
      return { modifiedCount: state.claimMatched ? 1 : 0 };
    },
  }),
  getIntelligenceOpLogCollection: async () => ({
    insertOne: async (row: Record<string, unknown>) => {
      state.logRows.push(row);
    },
  }),
}));

const { applyTensionEvent } = await import("@/lib/coldwar/tension");
const { applyStrategicAction } = await import("./strategicAction");
const { applyMilitaryAction } = await import("./militaryAction");
const { readMilitarySabotageEnabled } = await import("./flags");

const db = {} as Db;

function agency(over: Partial<IntelligenceAgency> = {}): IntelligenceAgency {
  return {
    _id: "a1",
    countryId: "US",
    directorCharacterId: null,
    tradecraft: 5,
    counterIntel: 20,
    budgetRemaining: 10_000_000,
    opSlots: { turn: 10, remaining: 2 },
    foundedTurn: 1,
    updatedAt: new Date(0),
    ...over,
  } as unknown as IntelligenceAgency;
}

function network(over: Record<string, unknown> = {}) {
  return {
    _id: "n1",
    ownerCountryId: "US",
    targetCountryId: "RU",
    level: 3,
    progress: 0,
    funding: "steady",
    suspicion: 20,
    status: "active",
    cooledUntilTurn: null,
    lastOpTurn: 0,
    updatedAt: new Date(0),
    ...over,
  };
}

async function run(args: Record<string, unknown> = {}) {
  const { runOperation } = await import("./runOperation");
  return runOperation({
    db,
    agency: agency(),
    targetCountryId: "RU",
    domain: "military",
    kind: "collect",
    opType: "assess",
    turn: 10,
    statMultiplier: 1,
    actorUserId: null,
    rolls: { success: 0, compromise: 0.99 },
    ...args,
  } as never);
}

beforeEach(() => {
  // Clears call records, not implementations. Without it the tension
  // assertions below count calls from earlier tests.
  vi.clearAllMocks();
  state.network = network();
  state.coverage = null;
  state.targetAgency = { counterIntel: 20 };
  state.ownAgency = { budgetRemaining: 10_000_000, opSlots: { turn: 10, remaining: 2 } };
  state.claimMatched = true;
  state.coverageWrites = [];
  state.networkWrites = [];
  state.agencyClaims = [];
  state.logRows = [];
  vi.mocked(applyMilitaryAction).mockResolvedValue({
    frontSabotaged: "war1",
    formationsDegraded: 3,
  });
  // The gate is ON for the effect tests below; its own tests flip it.
  vi.mocked(readMilitarySabotageEnabled).mockResolvedValue(true);
});

describe("runOperation gates", () => {
  it("refuses an operation against your own country", async () => {
    const r = await run({ targetCountryId: "US" });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses when there is no network", async () => {
    state.network = null;
    expect(await run()).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses to use a burned network still cooling", async () => {
    state.network = network({ status: "burned", cooledUntilTurn: 20 });
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { error: string }).error).toContain("cooling");
  });

  it("refuses covert action below the coverage floor: you cannot act blind", async () => {
    state.coverage = { valueAtCollection: 5, lastCollectedTurn: 10 };
    const r = await run({ kind: "action" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { error: string }).error).toContain(String(ACTION_MIN_COVERAGE));
  });

  it("allows covert action once coverage clears the floor", async () => {
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    expect(await run({ kind: "action" })).toMatchObject({ ok: true });
  });

  it("refuses when the claim finds the budget short", async () => {
    // The claim is one conditional update, so a refusal is "did not match".
    // The re-read is what tells the two refusals apart.
    state.claimMatched = false;
    state.ownAgency = { budgetRemaining: COLLECTION_COST - 1, opSlots: { turn: 10, remaining: 2 } };
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { error: string }).error).toContain("afford");
  });

  it("refuses with 429 when the claim finds the turn's slots spent", async () => {
    state.claimMatched = false;
    state.ownAgency = { budgetRemaining: 10_000_000, opSlots: { turn: 10, remaining: 0 } };
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 429 });
  });

  it("claims the budget and the slot in ONE conditional update", async () => {
    // Read-then-write would let two concurrent operations both pass the gate and
    // both spend. The guard is that the loser simply does not match.
    await run();
    expect(state.agencyClaims).toHaveLength(1);
    const claim = state.agencyClaims[0] as unknown[];
    expect(Array.isArray(claim)).toBe(true);
  });

  it("does no further work when the claim is refused", async () => {
    state.claimMatched = false;
    state.ownAgency = { budgetRemaining: 0, opSlots: { turn: 10, remaining: 2 } };
    await run();
    expect(state.coverageWrites).toHaveLength(0);
    expect(state.networkWrites).toHaveLength(0);
    expect(state.logRows).toHaveLength(0);
  });

  it("spends nothing when a gate refuses", async () => {
    state.network = null;
    await run();
    expect(state.networkWrites).toHaveLength(0);
    expect(state.coverageWrites).toHaveLength(0);
    expect(state.logRows).toHaveLength(0);
  });
});

describe("runOperation effects", () => {
  it("raises coverage on a successful collection", async () => {
    const r = await run({ rolls: { success: 0, compromise: 0.99 } });
    expect(r).toMatchObject({ ok: true, outcome: "success", compromise: "clean" });
    expect((r as { coverage: number }).coverage).toBe(COLLECTION_GAIN);
    expect(state.coverageWrites).toHaveLength(1);
  });

  it("KEEPS the coverage a successful collection bought even when blown", async () => {
    // The regression this guards: an earlier design had `blown` reset coverage,
    // so success + blown cancelled itself and still charged the suspicion.
    // Compromise costs future ACCESS, never intelligence already in hand.
    // counterIntel 0 + suspicion 20 + tradecraft 1 gives a 0.15 compromise
    // chance; 0.12 lands inside it, at a depth that reads as blown rather than
    // detected or attributed.
    state.targetAgency = { counterIntel: 0 };
    const r = await run({
      agency: agency({ tradecraft: 1 }),
      rolls: { success: 0, compromise: 0.12 },
    });

    expect(r).toMatchObject({ ok: true, outcome: "success", compromise: "blown" });
    expect((r as { coverage: number }).coverage).toBe(COLLECTION_GAIN);
    expect(state.coverageWrites).toHaveLength(1);
    // And the network really did pay.
    expect((r as { networkLevel: number }).networkLevel).toBe(2);
  });

  it("writes no coverage when the collection misses", async () => {
    const r = await run({ rolls: { success: 0.999, compromise: 0.99 } });
    expect(r).toMatchObject({ ok: true, outcome: "miss" });
    expect(state.coverageWrites).toHaveLength(0);
  });

  it("writes no coverage for an action operation, which is not collection", async () => {
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    await run({ kind: "action", rolls: { success: 0, compromise: 0.99 } });
    expect(state.coverageWrites).toHaveLength(0);
  });

  it("logs both axes and the roll detail for audit", async () => {
    await run();
    expect(state.logRows).toHaveLength(1);
    const row = state.logRows[0];
    expect(row.outcome).toBe("success");
    expect(row.compromise).toBe("clean");
    expect(row.rollDetail).toMatchObject({ counterIntel: 20, difficulty: 20 });
  });

  it("treats a target that has never stood a service up as undefended", async () => {
    state.targetAgency = null;
    await run();
    expect((state.logRows[0].rollDetail as { counterIntel: number }).counterIntel).toBe(0);
  });

  it("decays stored coverage before judging the action gate", async () => {
    // Collected long ago: the stored reading is high, the live one is not.
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 0 };
    const r = await run({ kind: "action", turn: 40 });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("strategic attribution and world tension", () => {
  it("spikes tension when a STRATEGIC operation is attributed", async () => {
    state.targetAgency = { counterIntel: 100 };
    await run({ domain: "strategic", rolls: { success: 0, compromise: 0 } });
    expect(applyTensionEvent).toHaveBeenCalledTimes(1);
    const [, , kind, label] = vi.mocked(applyTensionEvent).mock.calls[0];
    expect(kind).toBe("espionage");
    expect(label).toContain("RU");
  });

  it("stays quiet when a strategic operation is merely detected", async () => {
    // Detected means the target knows an operation happened, not whose. There is
    // nothing for the world to react to.
    state.targetAgency = { counterIntel: 0 };
    await run({
      agency: agency({ tradecraft: 1 }),
      domain: "strategic",
      rolls: { success: 0, compromise: 0.05 },
    });
    const calls = vi.mocked(applyTensionEvent).mock.calls;
    expect(calls.length).toBe(0);
  });

  it("stays quiet for an attributed operation in another domain", async () => {
    state.targetAgency = { counterIntel: 100 };
    await run({ domain: "military", rolls: { success: 0, compromise: 0 } });
    expect(applyTensionEvent).not.toHaveBeenCalled();
  });
});

describe("strategic action reporting", () => {
  it("says plainly when there was nothing to break", async () => {
    // Refusing at the gate would leak whether a covert programme exists to an
    // operator whose coverage has not earned that answer. Reporting success
    // would be a lie. So it succeeds and says what actually happened.
    vi.mocked(applyStrategicAction).mockResolvedValue({ sabotaged: false, crackdown: false });
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    const r = await run({
      domain: "strategic",
      kind: "action",
      rolls: { success: 0, compromise: 0.99 },
    });
    expect(r).toMatchObject({ ok: true, outcome: "success" });
    expect((r as { message: string }).message).toContain("nothing worth breaking");
  });

  it("reports a patron's raid as public", async () => {
    vi.mocked(applyStrategicAction).mockResolvedValue({ sabotaged: true, crackdown: true });
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    const r = await run({
      domain: "strategic",
      kind: "action",
      rolls: { success: 0, compromise: 0.99 },
    });
    expect((r as { message: string }).message).toContain("public");
  });

  it("reports an outsider's sabotage without announcing it", async () => {
    vi.mocked(applyStrategicAction).mockResolvedValue({ sabotaged: true, crackdown: false });
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    const r = await run({
      domain: "strategic",
      kind: "action",
      rolls: { success: 0, compromise: 0.99 },
    });
    const message = (r as { message: string }).message;
    expect(message).toContain("did what it was sent to do");
    expect(message).not.toContain("public");
  });

  it("runs no strategic effect for a collection operation", async () => {
    await run({ domain: "strategic", kind: "collect" });
    expect(applyStrategicAction).not.toHaveBeenCalled();
  });

  it("runs no strategic effect when the action misses", async () => {
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    await run({ domain: "strategic", kind: "action", rolls: { success: 0.999, compromise: 0.99 } });
    expect(applyStrategicAction).not.toHaveBeenCalled();
  });
});

describe("military action effects", () => {
  it("runs the military effect for a successful military action", async () => {
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    await run({ domain: "military", kind: "action", rolls: { success: 0, compromise: 0.99 } });
    expect(applyMilitaryAction).toHaveBeenCalledWith(expect.anything(), "RU");
  });

  it("runs no military effect for a collection", async () => {
    await run({ domain: "military", kind: "collect" });
    expect(applyMilitaryAction).not.toHaveBeenCalled();
  });

  it("runs no military effect when the action misses", async () => {
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    await run({ domain: "military", kind: "action", rolls: { success: 0.999, compromise: 0.99 } });
    expect(applyMilitaryAction).not.toHaveBeenCalled();
  });

  it("says plainly when a military action found nothing to break", async () => {
    vi.mocked(applyMilitaryAction).mockResolvedValue({
      frontSabotaged: null,
      formationsDegraded: 0,
    });
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    const r = await run({
      domain: "military",
      kind: "action",
      rolls: { success: 0, compromise: 0.99 },
    });
    expect((r as { message: string }).message).toContain("nothing worth breaking");
  });

  it("never runs BOTH domain effects for one operation", async () => {
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    await run({ domain: "strategic", kind: "action", rolls: { success: 0, compromise: 0.99 } });
    expect(applyMilitaryAction).not.toHaveBeenCalled();
  });
});

describe("the military sabotage balance gate", () => {
  it("applies no effect at all while the gate is OFF", async () => {
    // The magnitudes are a balance change whose simulation report could not be
    // produced (no engaged front in the live world). Shipping them live on
    // unverified numbers is what the gate exists to prevent.
    vi.mocked(readMilitarySabotageEnabled).mockResolvedValue(false);
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    const r = await run({
      domain: "military",
      kind: "action",
      rolls: { success: 0, compromise: 0.99 },
    });
    expect(applyMilitaryAction).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, outcome: "success" });
    expect((r as { message: string }).message).toContain("nothing worth breaking");
  });

  it("still charges the operation while the gate is off", async () => {
    // It costs the slot, the budget and the suspicion either way. A gated effect
    // must not become a free way to probe a target.
    vi.mocked(readMilitarySabotageEnabled).mockResolvedValue(false);
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    await run({ domain: "military", kind: "action", rolls: { success: 0, compromise: 0.99 } });
    expect(state.agencyClaims).toHaveLength(1);
    expect(state.logRows).toHaveLength(1);
  });

  it("applies the effect once the gate is on", async () => {
    vi.mocked(readMilitarySabotageEnabled).mockResolvedValue(true);
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    await run({ domain: "military", kind: "action", rolls: { success: 0, compromise: 0.99 } });
    expect(applyMilitaryAction).toHaveBeenCalled();
  });

  it("does not consult the gate for a strategic action", async () => {
    // Strategic effects are not balance-gated: they move a covert programme's
    // stage, not a battle.
    state.coverage = { valueAtCollection: 100, lastCollectedTurn: 10 };
    await run({ domain: "strategic", kind: "action", rolls: { success: 0, compromise: 0.99 } });
    expect(readMilitarySabotageEnabled).not.toHaveBeenCalled();
  });
});
