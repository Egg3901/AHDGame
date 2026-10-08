import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { newVenture, referenceFundingPerTurn } from "./engine";
import { settleCancelledVentureReceipt } from "./refund";
import { loadVentureBoostBySectorId, processProductVentures } from "./turn";
import type { ProductVenture } from "./types";

const corpId = new ObjectId();
const userId = new ObjectId();
const sectorId = new ObjectId();

function sector(extra: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: sectorId,
    corporationId: corpId,
    sectorType: "media",
    strategyId: "newspaper",
    realizedRevenue: 24_000,
    revenue: 24_000,
    ...extra,
  } as unknown as CorporateSector;
}

function setup(cash = 1_000_000, ventures: ProductVenture[] = []) {
  const corpRow: Record<string, unknown> = { _id: corpId, liquidCapital: cash };
  const store = new Map(ventures.map((v) => [v._id, structuredClone(v)]));
  const corpUpdates: unknown[] = [];
  const db = {
    collection: (name: string) => {
      if (name === "productVentures") {
        return {
          find: (filter: { stage?: { $in?: string[] } | string; boostEndsTurn?: unknown }) => ({
            toArray: async () =>
              [...store.values()].filter((v) => {
                const stages = (filter.stage as { $in?: string[] })?.$in;
                if (stages) return stages.includes(v.stage);
                return v.stage === filter.stage;
              }),
          }),
          findOne: async (f: { _id: string }) => store.get(f._id) ?? null,
          replaceOne: async (
            f: { _id: string; rev: number; stage: string },
            doc: Record<string, unknown>
          ) => {
            const cur = store.get(f._id);
            if (!cur || cur.stage !== f.stage || (cur.rev ?? 0) !== f.rev)
              return { matchedCount: 0 };
            store.set(f._id, { _id: f._id, ...doc } as ProductVenture);
            return { matchedCount: 1 };
          },
        };
      }
      return {
        find: () => ({ toArray: async () => [{ ...corpRow }] }),
        findOne: async () => ({ ...corpRow }),
        updateOne: async (filter: Record<string, unknown>, update: Record<string, any>) => {
          corpUpdates.push(update);
          const receipts = (corpRow.productVentureDebitsV1 ?? {}) as Record<string, any>;
          const key = Object.keys(filter).find((k) => k.endsWith(".turn"));
          const id = key?.split(".")[1];
          const want = key ? (filter[key] as unknown) : undefined;
          if (key && typeof want === "object" && want !== null) {
            if (receipts[id!]?.turn === (want as { $ne: number }).$ne) return { matchedCount: 0 };
          } else if (key && receipts[id!]?.turn !== want) return { matchedCount: 0 };
          for (const [k, v] of Object.entries(update.$inc ?? {})) {
            if ((corpRow[k] as number) + (v as number) < 0) return { matchedCount: 0 };
            corpRow[k] = (corpRow[k] as number) + (v as number);
          }
          for (const [k, v] of Object.entries(update.$set ?? {})) {
            const [, vid] = k.split(".");
            corpRow.productVentureDebitsV1 = { ...receipts, [vid!]: v };
          }
          for (const k of Object.keys(update.$unset ?? {})) {
            const [, vid] = k.split(".");
            const next = { ...((corpRow.productVentureDebitsV1 ?? {}) as Record<string, unknown>) };
            delete next[vid!];
            corpRow.productVentureDebitsV1 = next;
          }
          return { matchedCount: 1 };
        },
      };
    },
  };
  const notify = vi.fn(async () => {});
  const corp = {
    _id: corpId,
    userId,
    ceoType: "player",
    averageQuality: 50,
  } as unknown as Corporation;
  const args = (turn: number) => ({
    db: db as never,
    turn,
    corporations: [corp],
    sectorsByCorp: new Map([[corpId.toString(), [sector()]]]),
    exchangeRatesByCurrency: new Map(),
    enabled: { media: true, manufacturing: true },
    notify,
  });
  return { store, corpRow, args, notify, corpUpdates };
}

function venture(id = "v1"): ProductVenture {
  return newVenture({
    id,
    corporationId: corpId.toString(),
    domain: "media",
    lineId: "newspaper_edition",
    name: "The Record",
    turn: 100,
    baselineRevenueAnchor: 1_000,
  });
}

describe("processProductVentures", () => {
  it("debits funding from cash and records it on the venture", async () => {
    const v = venture();
    const ctx = setup(500_000, [v]);
    const result = await processProductVentures(ctx.args(101));
    const expected = referenceFundingPerTurn(v.targetAnchor);
    expect(ctx.corpRow.liquidCapital).toBeCloseTo(500_000 - expected);
    expect(ctx.store.get("v1")!.investedAnchor).toBeCloseTo(expected);
    expect(ctx.store.get("v1")!.lastProcessedTurn).toBe(101);
    expect(result.paidAnchor).toBeCloseTo(expected);
  });

  it("never charges twice for the same turn", async () => {
    const ctx = setup(500_000, [venture()]);
    await processProductVentures(ctx.args(101));
    const after = ctx.corpRow.liquidCapital;
    await processProductVentures(ctx.args(101));
    expect(ctx.corpRow.liquidCapital).toBe(after);
  });

  it("replays from the receipt when the venture write was lost after the debit", async () => {
    const v = venture();
    const ctx = setup(500_000, [v]);
    const expected = referenceFundingPerTurn(v.targetAnchor);
    ctx.corpRow.liquidCapital = 500_000 - expected;
    ctx.corpRow.productVentureDebitsV1 = {
      v1: { turn: 101, amountAnchor: expected, investmentAnchor: expected, chargeAnchor: 0 },
    };
    await processProductVentures(ctx.args(101));
    expect(ctx.corpRow.liquidCapital).toBeCloseTo(500_000 - expected);
    expect(ctx.store.get("v1")!.investedAnchor).toBeCloseTo(expected);
  });

  it("pays only what the corporation can afford and still advances time", async () => {
    const ctx = setup(3, [venture()]);
    await processProductVentures(ctx.args(101));
    expect(ctx.corpRow.liquidCapital as number).toBeGreaterThanOrEqual(0);
    expect(ctx.store.get("v1")!.investedAnchor).toBeLessThanOrEqual(3);
    expect(ctx.store.get("v1")!.lastProcessedTurn).toBe(101);
  });

  it("refunds a debit exactly once when the venture was cancelled mid-turn", async () => {
    const v = venture();
    const ctx = setup(500_000, [v]);
    // Cancel lands between the processor's read and its write.
    const original = ctx.store.get("v1")!;
    const gone = { ...original, stage: "cancelled" as const, activeKey: undefined, rev: 1 };
    const collection = (ctx.args(101).db as any).collection("productVentures");
    const realReplace = collection.replaceOne;
    void realReplace;
    ctx.store.set("v1", original);
    const args = ctx.args(101);
    const db = args.db as any;
    const orig = db.collection;
    db.collection = (name: string) => {
      const c = orig(name);
      if (name === "productVentures") {
        return {
          ...c,
          replaceOne: async () => {
            ctx.store.set("v1", gone as never);
            return { matchedCount: 0 };
          },
        };
      }
      return c;
    };
    await processProductVentures(args);
    expect(ctx.corpRow.liquidCapital).toBeCloseTo(500_000);
    await processProductVentures(ctx.args(101));
    expect(ctx.corpRow.liquidCapital).toBeCloseTo(500_000);
    expect(ctx.store.get("v1")!.stage).toBe("cancelled");
  });

  it("cancel refunds an unapplied debit once, racing the turn refund", async () => {
    const ctx = setup(400_000, [venture()]);
    ctx.corpRow.productVentureDebitsV1 = {
      v1: {
        turn: 101,
        amountAnchor: 100_000,
        investmentAnchor: 100_000,
        chargeAnchor: 0,
        localAmount: 100_000,
      },
    };
    const db = ctx.args(101).db;
    const first = await settleCancelledVentureReceipt(db, corpId, "v1", 100);
    const second = await settleCancelledVentureReceipt(db, corpId, "v1", 100);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(ctx.corpRow.liquidCapital).toBe(500_000);
  });

  it("cancel never refunds a debit whose turn was already applied", async () => {
    const ctx = setup(400_000, [venture()]);
    ctx.corpRow.productVentureDebitsV1 = {
      v1: {
        turn: 101,
        amountAnchor: 100_000,
        investmentAnchor: 100_000,
        chargeAnchor: 0,
        localAmount: 100_000,
      },
    };
    const refunded = await settleCancelledVentureReceipt(ctx.args(101).db, corpId, "v1", 101);
    expect(refunded).toBe(false);
    expect(ctx.corpRow.liquidCapital).toBe(400_000);
    expect(ctx.corpRow.productVentureDebitsV1).toEqual({});
  });

  it("sends the CEO a notification when a decision opens", async () => {
    const v = venture();
    const ctx = setup(500_000, [v]);
    await processProductVentures(ctx.args(v.events[0]!.triggerTurn));
    expect(ctx.notify).toHaveBeenCalledTimes(1);
    const sent = (
      ctx.notify.mock.calls[0] as unknown as [Array<{ type: string; userId: ObjectId }>]
    )[0];
    expect(sent[0]!.type).toBe("corp_product_event");
    expect(sent[0]!.userId).toBe(userId);
  });

  it("accrues measured uplift for a running hit and stops after expiry", async () => {
    const hit: ProductVenture = {
      ...venture("hit"),
      stage: "released",
      activeKey: undefined,
      releasedTurn: 100,
      lastProcessedTurn: 100,
      boostFraction: 0.15,
      boostEndsTurn: 172,
      upliftToDateAnchor: 0,
    };
    const ctx = setup(0, [hit]);
    await processProductVentures(ctx.args(101));
    // 24000 per day is 1000 per turn, unboosted last turn, 15% lift.
    expect(ctx.store.get("hit")!.upliftToDateAnchor).toBeCloseTo(150);
    await processProductVentures(ctx.args(173));
    expect(ctx.store.get("hit")!.stage).toBe("expired");
  });
});

describe("loadVentureBoostBySectorId", () => {
  it("lifts matching sectors from the turn after release and caps stacking", async () => {
    const mk = (id: string, boost: number, releasedTurn: number): ProductVenture => ({
      ...venture(id),
      stage: "released",
      releasedTurn,
      boostFraction: boost,
      boostEndsTurn: 172,
    });
    const ctx = setup(0, [mk("a", 0.2, 100), mk("b", 0.2, 100), mk("c", 0.2, 105)]);
    const map = await loadVentureBoostBySectorId(ctx.args(101).db as never, {
      turn: 101,
      sectorsByCorp: new Map([[corpId.toString(), [sector()]]]),
      enabled: { media: true, manufacturing: true },
    });
    expect(map.get(sectorId.toString())).toBeCloseTo(1.25);
    const none = await loadVentureBoostBySectorId(ctx.args(101).db as never, {
      turn: 100,
      sectorsByCorp: new Map([[corpId.toString(), [sector()]]]),
      enabled: { media: true, manufacturing: true },
    });
    expect(none.get(sectorId.toString())).toBeUndefined();
  });
});
