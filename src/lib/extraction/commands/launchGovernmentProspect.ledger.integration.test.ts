import { ObjectId, type Db } from "mongodb";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import type { ProspectingSurvey } from "@/lib/db/types/prospectingSurvey";
import type { CountryId } from "@/lib/constants/countries";
import type { ExtractableResource } from "@/lib/constants/commodities";

vi.mock("@/lib/extraction/contractIssuerAuth", () => ({
  isNationalIssuer: vi.fn().mockResolvedValue(true),
  isStateIssuer: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));

const TURN = 100;
const NOW = new Date("2026-10-04T00:00:00Z");
const ACTOR = { characterId: new ObjectId(), userId: "admin", isAdmin: true };

function setup() {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  db.seed("stateResourceCapacity", [
    { _id: "TX", countryId: "US", stateId: "TX", resources: { oil: 1000 } },
  ]);
  db.seed("federalBudget", [
    {
      _id: "US",
      countryId: "US",
      currencyCode: "USD",
      treasuryCashLocal: 5_000_000,
      treasuryBalance: 0,
    },
  ]);
  db.seed("prospectingSurveys", []);
  return db;
}

describe("funded national government prospect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes the frozen national Treasury debit after a crash, without repricing or charging twice", async () => {
    const db = setup();
    const fault = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.treasuryCashLocal === -500_000;
      },
    });
    const { launchGovernmentProspect } = await import("./launchGovernmentProspect");
    const args = {
      countryId: "US" as CountryId,
      stateId: "TX",
      resource: "oil" as ExtractableResource,
      level: "national" as const,
    };

    await expect(launchGovernmentProspect(fault.db, args, ACTOR, TURN, NOW, true)).rejects.toThrow(
      "crash after"
    );
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(4_500_000);
    const frozenClaim = db.collection("prospectingSurveys").docs[0];
    expect(frozenClaim).toMatchObject({
      status: "funding",
      costLocal: 500_000,
      fundingKey: expect.any(String),
    });

    fault.disarm();
    const retried = await launchGovernmentProspect(
      fault.db,
      args,
      ACTOR,
      TURN + 1,
      new Date(NOW.getTime() + 60_000),
      true
    );
    expect(retried.ok).toBe(true);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 4_500_000,
      treasuryBalance: -500_000,
    });
    expect(db.collection("prospectingSurveys").docs[0]).toMatchObject({
      status: "active",
      costLocal: 500_000,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });

  it("uses the winning concurrent claim quote after a duplicate insert", async () => {
    const db = setup();
    const winnerId = new ObjectId(
      createHash("sha256")
        .update(`government-prospect-claim:${TURN}:US:TX:oil`)
        .digest("hex")
        .slice(0, 24)
    );
    const winner: ProspectingSurvey = {
      _id: winnerId,
      initiatorType: "national_government",
      initiatorUserId: "first-admin",
      countryId: "US",
      stateId: "TX",
      resource: "oil",
      startedTurn: TURN,
      completesTurn: TURN + 4,
      costAnchor: 250_000,
      status: "funding",
      fundingKey: "government-prospect:650000000000000000000099",
      costLocal: 125_000,
      currencyCode: "USD",
      treasuryLocalPerAnchor: 0.5,
      priorSuccessCount: 9,
      createdAt: NOW,
      updatedAt: NOW,
    };
    db.collection("prospectingSurveys").insertOne(winner as never);
    const realCollection = db.collection.bind(db);
    let hideInitialClaim = true;
    const concurrentDb = {
      collection(name: string) {
        const collection = realCollection(name);
        if (name !== "prospectingSurveys") return collection;
        return new Proxy(collection, {
          get(target, property, receiver) {
            if (property === "findOne") {
              return async (filter: Record<string, unknown>, _options?: unknown) => {
                if (hideInitialClaim && filter.status === "funding" && !filter._id) {
                  hideInitialClaim = false;
                  return null;
                }
                return target.findOne(filter as never);
              };
            }
            if (property === "insertOne") {
              return async () => {
                const error = new Error("duplicate prospect claim") as Error & { code: number };
                error.code = 11000;
                throw error;
              };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    } as unknown as Db;

    const { launchGovernmentProspect } = await import("./launchGovernmentProspect");
    const result = await launchGovernmentProspect(
      concurrentDb,
      { countryId: "US", stateId: "TX", resource: "oil", level: "national" },
      ACTOR,
      TURN,
      NOW,
      true
    );

    expect(result.ok).toBe(true);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 4_875_000,
      treasuryBalance: -125_000,
    });
    expect(db.collection("prospectingSurveys").docs[0]).toMatchObject({
      costAnchor: 250_000,
      costLocal: 125_000,
      currencyCode: "USD",
      treasuryLocalPerAnchor: 0.5,
      priorSuccessCount: 9,
      status: "active",
    });
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({
      _id: winner.fundingKey,
      event: { meta: { costLocal: 125_000, treasuryLocalPerAnchor: 0.5 } },
      status: "applied",
    });
  });
});
