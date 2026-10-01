import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

// getGameTime is ambient inside upgradeCampaign (as in production); pin it.
vi.mock("@/lib/time/gameTime", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 13 }),
}));

import {
  OPPO_DRIVER_EFFECT_TURNS,
  OPPO_DRIVER_PRESET,
  OPPO_DRIVER_TURNS,
  OPPO_TARGET_REQUIRED_MESSAGE,
  isOppoTargetRequiredRejection,
  mapOppoPurchaseError,
  OppoDriverError,
  projectOppoEffects,
  resolveOppoPickerRoute,
  runOppositionResearchFlow,
  selectStableOppoTarget,
  summarizeOppoDriverEvidence,
  OPPO_DRIVER_CHOOSER_ANCHOR,
  OPPO_DRIVER_PURCHASE_ANCHOR,
  OPPO_DRIVER_QUERY_ANCHOR,
  type OppoDriverEvidence,
} from "./oppositionResearchDriver";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-memory Mongo-like stub (same established pattern as
// src/lib/elections/germanyLandesliste.test.ts and
// src/lib/altDetection/run.test.ts): equality plus the operators the
// opposition-research path actually issues ($in, $gte, $ne, $inc/$set/$push
// with dotted keys). Sandbox fixtures only — never a live database.
// ─────────────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((val, key) => (val as Doc)?.[key], doc);
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const keys = path.split(".");
  let node = doc;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const next = node[keys[i] as string];
    if (typeof next !== "object" || next === null) node[keys[i] as string] = {};
    node = node[keys[i] as string] as Doc;
  }
  node[keys[keys.length - 1] as string] = value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof ObjectId || b instanceof ObjectId) {
    try {
      return new ObjectId(a as never).equals(new ObjectId(b as never));
    } catch {
      return false;
    }
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchesQuery(doc: Doc, query: Doc): boolean {
  for (const [key, cond] of Object.entries(query)) {
    const value = getPath(doc, key);
    if (
      cond !== null &&
      typeof cond === "object" &&
      !(cond instanceof ObjectId) &&
      !(cond instanceof Date) &&
      !Array.isArray(cond)
    ) {
      const ops = cond as Doc;
      if ("$in" in ops && !((ops.$in as unknown[]) ?? []).some((v) => valuesEqual(value, v)))
        return false;
      if ("$gte" in ops && !((value as number) >= (ops.$gte as number))) return false;
      if ("$ne" in ops && valuesEqual(value, ops.$ne)) return false;
      if ("$exists" in ops && (value !== undefined) !== Boolean(ops.$exists)) return false;
      continue;
    }
    if (!valuesEqual(value, cond)) return false;
  }
  return true;
}

function applyUpdate(doc: Doc, update: Doc): void {
  if (update.$inc) {
    for (const [key, delta] of Object.entries(update.$inc as Doc)) {
      setPath(doc, key, ((getPath(doc, key) as number) ?? 0) + (delta as number));
    }
  }
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set as Doc)) setPath(doc, key, value);
  }
  if (update.$push) {
    for (const [key, spec] of Object.entries(update.$push as Doc)) {
      const arr = (getPath(doc, key) as unknown[]) ?? [];
      const items = (spec as Doc).$each as unknown[];
      const next = [...arr, ...items];
      const slice = (spec as Doc).$slice as number | undefined;
      setPath(doc, key, typeof slice === "number" && slice < 0 ? next.slice(slice) : next);
    }
  }
}

function collectionStub(store: Doc[]) {
  return {
    findOne: vi.fn(async (filter: Doc = {}) => store.find((d) => matchesQuery(d, filter)) ?? null),
    find: vi.fn((filter: Doc = {}) => ({
      toArray: async () => store.filter((d) => matchesQuery(d, filter)),
    })),
    insertOne: vi.fn(async (doc: Doc) => {
      const copy = { ...doc };
      if (!copy._id) copy._id = new ObjectId();
      store.push(copy);
      return { insertedId: copy._id };
    }),
    updateOne: vi.fn(async (filter: Doc, update: Doc) => {
      const doc = store.find((d) => matchesQuery(d, filter));
      if (!doc) return { modifiedCount: 0, matchedCount: 0 };
      applyUpdate(doc, update);
      return { modifiedCount: 1, matchedCount: 1 };
    }),
    updateMany: vi.fn(async () => ({ modifiedCount: 0, matchedCount: 0 })),
    bulkWrite: vi.fn(async () => ({})),
    countDocuments: vi.fn(
      async (filter: Doc = {}) => store.filter((d) => matchesQuery(d, filter)).length
    ),
  };
}

function stubDb(seed: Record<string, Doc[]>): Db {
  const stores = seed;
  return {
    databaseName: "ahd_sim_oppo_driver",
    collection: (name: string) => {
      if (!stores[name]) stores[name] = [];
      return collectionStub(stores[name]);
    },
  } as unknown as Db;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox fixtures: two synthetic candidates, one active founding
// presidential race (primary, turns 1-40 of 1-89), US country.
// ─────────────────────────────────────────────────────────────────────────────

const BUYER_ID = new ObjectId("111111111111111111111111");
const RIVAL_ID = new ObjectId("222222222222222222222222");
const ELECTION_ID = new ObjectId("333333333333333333333333");
const BUYER_USER_ID = new ObjectId("444444444444444444444444");
const RIVAL_USER_ID = new ObjectId("555555555555555555555555");

function seedStores(): Record<string, Doc[]> {
  return {
    gameState: [{ _id: "current", currentTurn: 13 }],
    elections: [
      {
        _id: ELECTION_ID,
        countryId: "US",
        electionType: "president",
        status: "active",
        startTime: null,
        primaryEndTime: null,
        endTime: null,
        startTurn: 1,
        primaryEndTurn: 40,
        endTurn: 89,
      },
    ],
    electionCandidates: [
      {
        _id: new ObjectId(),
        electionId: ELECTION_ID,
        characterId: BUYER_ID,
        characterName: "Ariane Yeong",
        party: "1",
        status: "active",
      },
      {
        _id: new ObjectId(),
        electionId: ELECTION_ID,
        characterId: RIVAL_ID,
        characterName: "Reginald Lindqvist",
        party: "1",
        status: "active",
      },
    ],
    characters: [
      { _id: BUYER_ID, userId: BUYER_USER_ID, name: "Ariane Yeong", countryId: "US" },
      { _id: RIVAL_ID, userId: RIVAL_USER_ID, name: "Reginald Lindqvist", countryId: "US" },
    ],
    campaigns: [],
    exchangeRates: [],
    notifications: [],
  };
}

function buyerUser() {
  return {
    userId: BUYER_USER_ID.toString(),
    username: "sim.actor.oppo.buyer",
    isAdmin: false,
    hasCharacter: true as const,
    character: {
      _id: BUYER_ID,
      name: "Ariane Yeong",
      countryId: "US",
    },
  } as never;
}

const FLOW_OPTIONS = {
  seed: "oppo-driver-seed",
  runId: "00000000-0000-4000-8000-000000000001",
  sourceCommit: "0000000000000000000000000000000000000000",
  electionId: ELECTION_ID,
  gameTime: { currentTurn: 13 } as never,
  fixtureFunds: 100_000,
  fixtureActions: 50,
};

let db: Db;

beforeEach(async () => {
  db = stubDb(seedStores());
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db);
});

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

async function runFlow(): Promise<OppoDriverEvidence> {
  return runOppositionResearchFlow(db, {
    ...FLOW_OPTIONS,
    actors: {
      buyerCandidateId: BUYER_ID,
      rivalCandidateId: RIVAL_ID,
      buyerUser: buyerUser(),
      party: "1",
    },
  });
}

describe("opposition-research flow driver", () => {
  it("enters both candidates into one shared race", async () => {
    const evidence = await runFlow();
    expect(evidence.raceId).toBe(ELECTION_ID.toString());
    expect(evidence.buyerCampaignId).not.toBe(evidence.rivalCampaignId);
    const campaigns = await db.collection("campaigns").find({}).toArray();
    expect(campaigns).toHaveLength(2);
    for (const campaign of campaigns) {
      expect((campaign.electionId as ObjectId).toString()).toBe(ELECTION_ID.toString());
    }
  });

  it("queries eligible targets and selects the rival stably", async () => {
    const evidence = await runFlow();
    expect(evidence.eligibleBefore.map((t) => t.id)).toEqual([RIVAL_ID.toString()]);
    expect(evidence.selectedTarget.id).toBe(RIVAL_ID.toString());
    expect(evidence.selectedTarget.name).toBe("Reginald Lindqvist");
    // Picker read and post-purchase read agree exactly: no reshuffle.
    expect(evidence.eligiblePicker.map((t) => t.id)).toEqual(
      evidence.eligibleBefore.map((t) => t.id)
    );
    expect(evidence.eligibleAfter.map((t) => t.id)).toEqual(
      evidence.eligibleBefore.map((t) => t.id)
    );
    expect(evidence.selectedTarget.id).not.toBe(BUYER_ID.toString());
  });

  it("purchases through the real command and reconciles debits", async () => {
    const evidence = await runFlow();
    expect(evidence.purchaseRequest).toEqual({
      category: "oppositionResearch",
      branch: null,
      targetId: RIVAL_ID.toString(),
    });
    expect(evidence.purchaseTargetId).toBe(RIVAL_ID.toString());
    expect(evidence.actualFundsDebit).toBe(evidence.expectedFundsDebit);
    expect(evidence.actualActionsDebit).toBe(evidence.expectedActionsDebit);
    expect(evidence.expectedFundsDebit).toBeGreaterThan(0);
    expect(evidence.expectedActionsDebit).toBeGreaterThan(0);
  });

  it("persists the target identity on the campaign", async () => {
    const evidence = await runFlow();
    expect(evidence.persistedTargetId).toBe(RIVAL_ID.toString());
    const stored = await db
      .collection("campaigns")
      .findOne({ _id: new ObjectId(evidence.buyerCampaignId) });
    expect((stored?.oppositionTargetId as ObjectId).toString()).toBe(RIVAL_ID.toString());
  });

  it("retains four turns of favorability effects from the production rule", async () => {
    const evidence = await runFlow();
    expect(evidence.effects).toHaveLength(OPPO_DRIVER_EFFECT_TURNS);
    expect(evidence.drainPerTurn).toBeGreaterThan(0);
    for (const [index, effect] of evidence.effects.entries()) {
      expect(effect.turnOffset).toBe(index + 1);
      expect(effect.favorabilityDelta).toBe(-evidence.drainPerTurn);
      expect(effect.cumulativeDelta).toBeCloseTo(-evidence.drainPerTurn * (index + 1), 10);
    }
  });

  it("routes the first pick with the unlock and records a closing chooser", async () => {
    const evidence = await runFlow();
    // Pre-unlock picks must travel with the unlock (the route that SETS the
    // first target), never to /retarget: the deadlock shape behind the
    // reported recursive-dialog-then-failure sequence.
    expect(evidence.pickerRoute).toBe("unlock");
    expect(evidence.pickerClosedOnPick).toBe(true);
    expect(evidence.eligibleBefore.length).toBeGreaterThan(0);
    expect(evidence.covered).toBe(true);
  });

  it("fails when no target can be selected", () => {
    expect(() => selectStableOppoTarget([])).toThrow(OppoDriverError);
    expect(() => selectStableOppoTarget([])).toThrow(
      "no eligible opposition target can be selected"
    );
  });

  it("fails on a target-required rejection after a valid selection", () => {
    const rejection = new Error(OPPO_TARGET_REQUIRED_MESSAGE);
    expect(isOppoTargetRequiredRejection(rejection)).toBe(true);
    expect(isOppoTargetRequiredRejection(new Error("Insufficient funds"))).toBe(false);
    const mapped = mapOppoPurchaseError(rejection, RIVAL_ID.toString());
    expect(mapped).toBeInstanceOf(OppoDriverError);
    expect((mapped as Error).message).toContain(RIVAL_ID.toString());
    // Anything else propagates unchanged.
    const other = new Error("Insufficient funds");
    expect(mapOppoPurchaseError(other, RIVAL_ID.toString())).toBe(other);
  });

  it("pins the experiment envelope and provenance", async () => {
    const evidence = await runFlow();
    expect(evidence.preset).toBe(OPPO_DRIVER_PRESET);
    expect(evidence.processedTurns).toBe(OPPO_DRIVER_TURNS);
    expect(evidence.runId).toBe("00000000-0000-4000-8000-000000000001");
    expect(evidence.sourceCommit).toBe("0000000000000000000000000000000000000000");
    expect(evidence.mechanicId).toBe("campaigns-player-actions");
  });

  it("renders a sanitized public report", async () => {
    const evidence = await runFlow();
    const lines = summarizeOppoDriverEvidence(evidence);
    const text = lines.join("\n");
    expect(text).toContain(evidence.runId);
    expect(text).toContain(evidence.sourceCommit);
    expect(text).toContain(OPPO_DRIVER_PRESET);
    expect(text).toContain(RIVAL_ID.toString());
    expect(text).toContain("COVERED");
    expect(text).not.toContain("funds=0 ");
  });

  it("keeps the source seams pinned (drift guard)", () => {
    const root = process.cwd();
    const commands = readFileSync(
      join(root, "src/lib/campaigns/commands/campaignCommands.ts"),
      "utf8"
    );
    expect(commands).toContain(OPPO_DRIVER_PURCHASE_ANCHOR);
    const query = readFileSync(join(root, "src/lib/campaigns/oppositionTargets.ts"), "utf8");
    expect(query).toContain(OPPO_DRIVER_QUERY_ANCHOR);
    // The chooser closes the picker synchronously on pick, before routing:
    // the close must precede the unlocked/retarget branch or the dialog can
    // reopen around the purchase that follows.
    const chooser = readFileSync(
      join(root, "src/app/campaign/[id]/blend/BlendOpsSection.tsx"),
      "utf8"
    );
    const closeAt = chooser.indexOf(OPPO_DRIVER_CHOOSER_ANCHOR);
    expect(closeAt).toBeGreaterThan(-1);
    const branchAt = chooser.indexOf("if (tree.unlocked && onRetarget)");
    expect(branchAt).toBeGreaterThan(closeAt);
    // The picker's options and the purchase validator read the same query.
    const viewModel = readFileSync(
      join(root, "src/app/campaign/[id]/blend/campaignBlendViewModel.ts"),
      "utf8"
    );
    expect(viewModel).toContain("c.oppositionTargets");
  });
});

describe("oppo driver pure helpers", () => {
  it("projects a constant per-turn drain over four turns", () => {
    const effects = projectOppoEffects(0.5);
    expect(effects).toHaveLength(4);
    expect(effects.map((e) => e.favorabilityDelta)).toEqual([-0.5, -0.5, -0.5, -0.5]);
    expect(effects[3]?.cumulativeDelta).toBeCloseTo(-2.0, 10);
  });

  it("rejects a non-positive drain instead of retaining empty effects", () => {
    expect(() => projectOppoEffects(0)).toThrow(OppoDriverError);
  });

  it("routes pre-unlock picks to the unlock and post-unlock picks to retarget", () => {
    expect(resolveOppoPickerRoute({ unlocked: false })).toBe("unlock");
    expect(resolveOppoPickerRoute({ unlocked: true })).toBe("retarget");
  });
});
