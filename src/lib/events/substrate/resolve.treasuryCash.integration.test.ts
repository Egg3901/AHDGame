import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { EventInstance } from "@/lib/db/types/events";
import { applyDeclarativeEffects } from "./applyEffects";
import { _resetEventHandlerRegistryForTests, registerEventHandler } from "./registry";
import { resolveEvent } from "./resolve";
import { sweepExpired } from "./sweep";
import type { EventHandler } from "./types";
import { DEMOCRATIC_HEALTH_METRIC_IDS } from "@/lib/governanceStyle/score";

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue("applied"),
}));

const NOW = new Date("2026-10-04T00:00:00Z");
const TURN = 4;

function setup(applyOverride?: EventHandler["applyEffects"]) {
  const db = createInMemoryDb();
  const instanceId = new ObjectId("650000000000000000000091");
  const scopeId = new ObjectId("650000000000000000000092");
  db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  db.seed("federalBudget", [
    {
      _id: "US",
      countryId: "US",
      currencyCode: "USD",
      treasuryCashLocal: 20,
      treasuryBalance: 0,
    },
  ]);
  db.seed("governmentApprovals", [
    { _id: "US", countryId: "US", approvalRating: 50, disapprovalRating: 50, netApproval: 0 },
  ]);
  db.seed("politicalMetrics", [
    {
      _id: "TX",
      countryId: "US",
      values: Object.fromEntries(DEMOCRATIC_HEALTH_METRIC_IDS.map((metric) => [metric, 60])),
      residuals: Object.fromEntries(DEMOCRATIC_HEALTH_METRIC_IDS.map((metric) => [metric, 5])),
      lastUpdated: NOW,
    },
  ]);
  const event: EventInstance = {
    _id: instanceId,
    kind: "funded-choice-fixture",
    scope: "country",
    scopeId,
    definitionVersion: 1,
    status: "pending",
    roll: 50,
    payload: { countryId: "US" },
    offeredAtTurn: TURN,
    offeredAt: NOW,
    expiresAtRealtimeMs: Date.now() + 60_000,
    createdAt: NOW,
    updatedAt: NOW,
  };
  db.seed("eventInstances", [event as unknown as Record<string, unknown>]);
  registerEventHandler({
    kind: event.kind,
    defaultOptionId: "large-payment",
    options: [
      {
        id: "small-payment",
        label: "Small payment",
        description: "Pay five",
        outcomeTable: [
          {
            minRoll: 1,
            maxRoll: 100,
            label: "small",
            effects: [
              { type: "treasuryDelta", deltaAnchor: -5 },
              { type: "approvalDelta", delta: 2 },
              { type: "sectorDemandModifier", sectorType: "technology", pct: 5, durationTurns: 4 },
              { type: "democraticHealthDelta", delta: 3 },
            ],
          },
        ],
      },
      {
        id: "large-payment",
        label: "Large payment",
        description: "Pay eight",
        outcomeTable: [
          {
            minRoll: 1,
            maxRoll: 100,
            label: "large",
            effects: [
              { type: "treasuryDelta", deltaAnchor: -8 },
              { type: "approvalDelta", delta: 5 },
            ],
          },
        ],
      },
    ],
    applyEffects:
      applyOverride ??
      (async (ctx) => {
        await applyDeclarativeEffects(ctx, ctx.tier.effects);
      }),
  });
  return { db, event, instanceId };
}

function synchronizeFirstTwoEventReads(db: Db): Db {
  let reads = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "collection") {
        return (name: string) => {
          const collection = target.collection(name);
          if (name !== "eventInstances") return collection;
          return new Proxy(collection, {
            get(collectionTarget, key, collectionReceiver) {
              if (key === "findOne") {
                const findOne = Reflect.get(collectionTarget, key, collectionReceiver) as (
                  ...args: unknown[]
                ) => Promise<unknown>;
                return async (...args: unknown[]) => {
                  const result = await findOne.apply(collectionTarget, args);
                  if (reads < 2) {
                    reads += 1;
                    if (reads === 2) release();
                    await bothRead;
                  }
                  return result;
                };
              }
              const value = Reflect.get(collectionTarget, key, collectionReceiver);
              return typeof value === "function" ? value.bind(collectionTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("funded country event choice ownership", () => {
  beforeEach(() => _resetEventHandlerRegistryForTests());

  it("does not resolve one paid option using another option's Treasury receipt", async () => {
    const { db, event, instanceId } = setup();
    const racedDb = synchronizeFirstTwoEventReads(db as unknown as Db);
    const outcomes = await Promise.allSettled([
      resolveEvent(
        racedDb,
        instanceId,
        "small-payment",
        "player",
        TURN,
        undefined,
        undefined,
        true
      ),
      resolveEvent(
        racedDb,
        instanceId,
        "large-payment",
        "player",
        TURN,
        undefined,
        undefined,
        true
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const resolved = db.collection("eventInstances").docs[0] as unknown as EventInstance;
    const amount = resolved.resolvedOptionId === "small-payment" ? 5 : 8;
    expect(resolved.resolutionClaim).toMatchObject({
      optionId: resolved.resolvedOptionId,
      reason: "player",
      turn: TURN,
    });
    expect(resolved.status).toBe("resolved");
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(20 - amount);
    expect(db.collection("governmentApprovals").docs[0]?.approvalRating).toBe(
      50 + (resolved.resolvedOptionId === "small-payment" ? 2 : 5)
    );
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]?.event).toMatchObject({
      meta: { amountLocal: -amount, turn: TURN },
    });
    expect(resolved._id).toEqual(event._id);
  });

  it("recovers the reserved paid option and does not repeat approval after cash lands", async () => {
    let crashAfterPayment = true;
    const { db, instanceId } = setup(async (ctx) => {
      await applyDeclarativeEffects(ctx, ctx.tier.effects);
      if (crashAfterPayment) {
        crashAfterPayment = false;
        throw new Error("crash after funded receipt");
      }
    });

    await expect(
      resolveEvent(
        db as unknown as Db,
        instanceId,
        "small-payment",
        "player",
        TURN,
        undefined,
        undefined,
        true
      )
    ).rejects.toThrow("crash after funded receipt");
    const pending = db.collection("eventInstances").docs[0] as unknown as EventInstance;
    expect(pending.status).toBe("pending");
    expect(pending.resolutionClaim?.optionId).toBe("small-payment");
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(15);
    expect(db.collection("governmentApprovals").docs[0]?.approvalRating).toBe(52);

    await expect(
      resolveEvent(
        db as unknown as Db,
        instanceId,
        "large-payment",
        "player",
        TURN + 1,
        undefined,
        undefined,
        true
      )
    ).rejects.toThrow(/reserved for another choice/);

    await db
      .collection("eventInstances")
      .updateOne({ _id: instanceId }, { $set: { expiresAtRealtimeMs: Date.now() - 1 } });

    await resolveEvent(
      db as unknown as Db,
      instanceId,
      "small-payment",
      "player",
      TURN + 1,
      undefined,
      undefined,
      true
    );
    const resolved = db.collection("eventInstances").docs[0] as unknown as EventInstance;
    expect(resolved).toMatchObject({ status: "resolved", resolvedOptionId: "small-payment" });
    expect(resolved.resolutionClaim).toMatchObject({ optionId: "small-payment", turn: TURN });
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(15);
    expect(db.collection("governmentApprovals").docs[0]?.approvalRating).toBe(52);
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("countryModifiers").docs).toHaveLength(1);
    const politicalValues = db.collection("politicalMetrics").docs[0]?.values as Record<
      string,
      number
    >;
    expect(politicalValues[DEMOCRATIC_HEALTH_METRIC_IDS[0]!]).toBe(63);
  });

  it("lets the timeout sweep recover the original funded choice instead of its default", async () => {
    let crashAfterPayment = true;
    const { db, instanceId } = setup(async (ctx) => {
      await applyDeclarativeEffects(ctx, ctx.tier.effects);
      if (crashAfterPayment) {
        crashAfterPayment = false;
        throw new Error("crash after funded receipt");
      }
    });
    await expect(
      resolveEvent(
        db as unknown as Db,
        instanceId,
        "small-payment",
        "player",
        TURN,
        undefined,
        undefined,
        true
      )
    ).rejects.toThrow("crash after funded receipt");

    const pending = db.collection("eventInstances").docs[0] as unknown as EventInstance;
    const swept = await sweepExpired(
      db as unknown as Db,
      TURN + 1,
      pending.expiresAtRealtimeMs + 1,
      undefined,
      true
    );

    expect(swept.swept).toHaveLength(1);
    expect(swept.swept[0]).toMatchObject({
      status: "resolved",
      resolvedOptionId: "small-payment",
      resolveReason: "player",
    });
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(15);
    expect(db.collection("governmentApprovals").docs[0]?.approvalRating).toBe(52);
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("countryModifiers").docs).toHaveLength(1);
  });
});
