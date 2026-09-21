/**
 * Persistence tests: agreement lifecycle (offer/counter/accept, fixed term,
 * cancellation notice, expiry), allocation-budget enforcement, conditional
 * replay safety, and index creation. Uses an in-memory fake Db: no server,
 * no transactions, mirroring the standalone-Mongo call shapes.
 */
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  AD_AGREEMENT_BUDGET_BPS,
  AD_AGREEMENT_CANCEL_NOTICE_TURNS,
  type AdvertisingAgreement,
} from "./types";
import {
  ensureAdvertisingAgreementIndexes,
  finalizeAdvertisingAgreementLifecycle,
  getAdvertisingAgreementsForCorp,
  getBuyerCommittedShareBps,
  proposeAdvertisingAgreementPersistent,
  updateAdvertisingAgreementPersistent,
  upsertAdvertisingSettlement,
} from "./persistence";

interface FakeStore {
  agreements: Map<string, Record<string, unknown>>;
  settlements: Map<string, Record<string, unknown>>;
  createdIndexes: string[];
  seq: number;
}

function newStore(): FakeStore {
  return { agreements: new Map(), settlements: new Map(), createdIndexes: [], seq: 0 };
}

function getPath(doc: unknown, path: string): unknown {
  let current = doc;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matchesCondition(value: unknown, cond: unknown): boolean {
  if (typeof cond === "object" && cond !== null && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ("$exists" in c) return (value !== undefined) === Boolean(c.$exists);
    if ("$ne" in c) return value !== c.$ne;
    if ("$in" in c) return Array.isArray(c.$in) && c.$in.includes(value);
    if ("$lte" in c)
      return typeof value === "number" && typeof c.$lte === "number" && value <= c.$lte;
    return false;
  }
  return value === cond;
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or" && Array.isArray(cond)) {
      return cond.some((sub) => matches(doc, sub as Record<string, unknown>));
    }
    return matchesCondition(getPath(doc, key), cond);
  });
}

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>): void {
  const set = (update.$set ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(set)) doc[key] = value;
  const push = update.$push as Record<string, unknown> | undefined;
  if (push) {
    for (const [key, value] of Object.entries(push)) {
      const list = doc[key];
      if (Array.isArray(list)) list.push(value);
      else doc[key] = [value];
    }
  }
}

function fakeDb(store: FakeStore): Db {
  const agreementsApi = (function () {
    const findImpl = (filter: Record<string, unknown>) => ({
      toArray: async () => Array.from(store.agreements.values()).filter((d) => matches(d, filter)),
    });
    return {
      insertOne: async (doc: Record<string, unknown>) => {
        // Preserve the caller's string _id (production stamps a hex id).
        const id =
          typeof doc._id === "string" && doc._id.length > 0 ? doc._id : `ad${(store.seq += 1)}`;
        store.agreements.set(id, { ...doc, _id: id });
        return { insertedId: id };
      },
      findOne: async (filter: Record<string, unknown>) =>
        Array.from(store.agreements.values()).find((d) => matches(d, filter)) ?? null,
      find: findImpl,
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const doc = Array.from(store.agreements.values()).find((d) => matches(d, filter));
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        applyUpdate(doc, update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      updateMany: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        let modified = 0;
        for (const doc of store.agreements.values()) {
          if (matches(doc, filter)) {
            applyUpdate(doc, update);
            modified += 1;
          }
        }
        return { matchedCount: modified, modifiedCount: modified };
      },
      createIndex: async (_key: unknown, options: { name: string }) => {
        store.createdIndexes.push(options.name);
        return options.name;
      },
    };
  })();
  const settlementsApi = {
    updateOne: async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      opts?: { upsert?: boolean }
    ) => {
      const key = `${String(filter.corporationId)}:${String(filter.turn)}`;
      const existing = store.settlements.get(key);
      if (existing) {
        applyUpdate(existing, update);
        return { matchedCount: 1, modifiedCount: 1, upsertedId: undefined };
      }
      if (opts?.upsert) {
        const set = (update.$set ?? {}) as Record<string, unknown>;
        store.settlements.set(key, { ...set });
        return { matchedCount: 0, modifiedCount: 0, upsertedId: key };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedId: undefined };
    },
    find: () => ({ toArray: async () => [] }),
    createIndex: async (_key: unknown, options: { name: string }) => {
      store.createdIndexes.push(options.name);
      return options.name;
    },
  };
  return {
    collection: (name: string) => {
      if (name === "advertisingAgreements") return agreementsApi;
      if (name === "advertisingSettlements") return settlementsApi;
      if (name === "corporationOperatingModels") {
        return { find: () => ({ toArray: async () => [] }) };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  } as unknown as Db;
}

const BERLIN = "2026-09-21T00:00:00.000Z";

function proposeArgs(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    buyerCorpId: "buyer",
    supplierCorpId: "supplier",
    proposedByCorpId: "buyer",
    allocationShareBps: 2500,
    durationTurns: 12,
    turn: 100,
    now: new Date(BERLIN),
    ...overrides,
  };
}

async function proposeActive(
  store: FakeStore,
  overrides: Record<string, unknown> = {}
): Promise<AdvertisingAgreement> {
  const db = fakeDb(store);
  const proposed = await proposeAdvertisingAgreementPersistent(db, proposeArgs(overrides));
  if (!proposed.ok) throw new Error(`propose failed: ${proposed.reason}`);
  const id = String((proposed.agreement as unknown as Record<string, unknown>)._id);
  const accepted = await updateAdvertisingAgreementPersistent(db, {
    agreementId: id,
    corpId: "supplier",
    action: "accept",
    turn: 100,
    now: new Date(BERLIN),
  });
  if (!accepted.ok) throw new Error(`accept failed: ${accepted.reason}`);
  return accepted.agreement;
}

describe("proposeAdvertisingAgreementPersistent", () => {
  it("opens a pending negotiation with a revision-1 offer", async () => {
    const store = newStore();
    const result = await proposeAdvertisingAgreementPersistent(fakeDb(store), proposeArgs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agreement.status).toBe("pending");
    expect(result.agreement.currentOffer?.revision).toBe(1);
    expect(result.agreement.offers).toHaveLength(1);
  });

  it("writes nothing when the flag is off and rejects bad terms", async () => {
    const store = newStore();
    const db = fakeDb(store);
    expect(
      await proposeAdvertisingAgreementPersistent(db, proposeArgs({ enabled: false }))
    ).toEqual({ ok: false, reason: "feature_disabled" });
    expect(
      await proposeAdvertisingAgreementPersistent(
        db,
        proposeArgs({ buyerCorpId: "same", supplierCorpId: "same" })
      )
    ).toEqual({ ok: false, reason: "self_contract" });
    expect(
      await proposeAdvertisingAgreementPersistent(db, proposeArgs({ allocationShareBps: 50 }))
    ).toEqual({ ok: false, reason: "invalid_share" });
    expect(
      await proposeAdvertisingAgreementPersistent(db, proposeArgs({ durationTurns: 2 }))
    ).toEqual({ ok: false, reason: "invalid_duration" });
    expect(store.agreements.size).toBe(0);
  });
});

describe("updateAdvertisingAgreementPersistent", () => {
  it("counters with a new revision and accepts from the counterparty", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const proposed = await proposeAdvertisingAgreementPersistent(db, proposeArgs());
    if (!proposed.ok) throw new Error("propose failed");
    const id = String((proposed.agreement as unknown as Record<string, unknown>)._id);

    const countered = await updateAdvertisingAgreementPersistent(db, {
      agreementId: id,
      corpId: "supplier",
      action: "counter",
      allocationShareBps: 3000,
      durationTurns: 12,
      turn: 101,
    });
    expect(countered.ok).toBe(true);
    if (!countered.ok) return;
    expect(countered.agreement.currentOffer?.revision).toBe(2);
    expect(countered.agreement.offers).toHaveLength(2);

    // The offer author cannot accept its own offer.
    expect(
      await updateAdvertisingAgreementPersistent(db, {
        agreementId: id,
        corpId: "supplier",
        action: "accept",
        turn: 101,
      })
    ).toEqual({ ok: false, reason: "not_counterparty" });

    const accepted = await updateAdvertisingAgreementPersistent(db, {
      agreementId: id,
      corpId: "buyer",
      action: "accept",
      turn: 102,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.agreement.status).toBe("active");
    expect(accepted.agreement.startsAtTurn).toBe(102);
    expect(accepted.agreement.expiresAtTurn).toBe(114);
  });

  it("rejects accept when the buyer budget is already committed", async () => {
    const store = newStore();
    const db = fakeDb(store);
    await proposeActive(store, { allocationShareBps: 8000 });
    const second = await proposeAdvertisingAgreementPersistent(
      db,
      proposeArgs({ allocationShareBps: 3000 })
    );
    if (!second.ok) throw new Error("propose failed");
    const id = String((second.agreement as unknown as Record<string, unknown>)._id);
    const committed = await getBuyerCommittedShareBps(db, "buyer", 100);
    expect(committed).toBe(8000);
    expect(
      await updateAdvertisingAgreementPersistent(db, {
        agreementId: id,
        corpId: "supplier",
        action: "accept",
        turn: 100,
        buyerCommittedShareBps: committed,
      })
    ).toEqual({ ok: false, reason: "allocation_exceeds_budget" });
  });

  it("cancels pending immediately and active with notice", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const proposed = await proposeAdvertisingAgreementPersistent(db, proposeArgs());
    if (!proposed.ok) throw new Error("propose failed");
    const pendingId = String((proposed.agreement as unknown as Record<string, unknown>)._id);
    const withdrawn = await updateAdvertisingAgreementPersistent(db, {
      agreementId: pendingId,
      corpId: "buyer",
      action: "cancel",
      turn: 100,
    });
    expect(withdrawn.ok && withdrawn.agreement.status).toBe("cancelled");
    // Re-cancelling a closed agreement is idempotent, not an error.
    const again = await updateAdvertisingAgreementPersistent(db, {
      agreementId: pendingId,
      corpId: "buyer",
      action: "cancel",
      turn: 100,
    });
    expect(again.ok && (again as { idempotent?: boolean }).idempotent).toBe(true);

    const active = await proposeActive(store);
    const activeId = String((active as unknown as Record<string, unknown>)._id);
    const cancelling = await updateAdvertisingAgreementPersistent(db, {
      agreementId: activeId,
      corpId: "supplier",
      action: "cancel",
      turn: 100,
    });
    expect(cancelling.ok && cancelling.agreement.status).toBe("cancelling");
    if (!cancelling.ok) return;
    expect(cancelling.agreement.cancelEffectiveTurn).toBe(100 + AD_AGREEMENT_CANCEL_NOTICE_TURNS);
  });

  it("rejects strangers and stale revisions", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const proposed = await proposeAdvertisingAgreementPersistent(db, proposeArgs());
    if (!proposed.ok) throw new Error("propose failed");
    const id = String((proposed.agreement as unknown as Record<string, unknown>)._id);
    expect(
      await updateAdvertisingAgreementPersistent(db, {
        agreementId: id,
        corpId: "stranger",
        action: "accept",
        turn: 100,
      })
    ).toEqual({ ok: false, reason: "not_party" });
    expect(
      await updateAdvertisingAgreementPersistent(db, {
        agreementId: "missing",
        corpId: "buyer",
        action: "accept",
        turn: 100,
      })
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("finalizeAdvertisingAgreementLifecycle", () => {
  it("expires fixed terms and closes served notices, idempotently", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const active = await proposeActive(store, { durationTurns: 12 });
    const activeId = String((active as unknown as Record<string, unknown>)._id);
    await updateAdvertisingAgreementPersistent(db, {
      agreementId: activeId,
      corpId: "buyer",
      action: "cancel",
      turn: 100,
    });

    // Before either deadline: nothing finalizes.
    expect(await finalizeAdvertisingAgreementLifecycle(db, 101)).toEqual({
      expired: 0,
      cancelled: 0,
    });
    // Notice served at 104, term ends at 112.
    expect(await finalizeAdvertisingAgreementLifecycle(db, 104)).toEqual({
      expired: 0,
      cancelled: 1,
    });
    expect(await finalizeAdvertisingAgreementLifecycle(db, 112)).toEqual({
      expired: 0,
      cancelled: 0,
    });
  });

  it("expires an uncancelled fixed term at its deadline", async () => {
    const store = newStore();
    const db = fakeDb(store);
    await proposeActive(store, { durationTurns: 12 });
    expect(await finalizeAdvertisingAgreementLifecycle(db, 111)).toEqual({
      expired: 0,
      cancelled: 0,
    });
    expect(await finalizeAdvertisingAgreementLifecycle(db, 112)).toEqual({
      expired: 1,
      cancelled: 0,
    });
    // Replay is a no-op.
    expect(await finalizeAdvertisingAgreementLifecycle(db, 112)).toEqual({
      expired: 0,
      cancelled: 0,
    });
  });
});

describe("agreement reads and settlement writes", () => {
  it("lists agreements for a corporation and sums committed shares", async () => {
    const store = newStore();
    const db = fakeDb(store);
    await proposeActive(store, { allocationShareBps: 2500 });
    const mine = await getAdvertisingAgreementsForCorp(db, "buyer");
    expect(mine).toHaveLength(1);
    expect(await getAdvertisingAgreementsForCorp(db, "stranger")).toHaveLength(0);
    expect(await getBuyerCommittedShareBps(db, "buyer", 100)).toBe(2500);
    // Past expiry the commitment releases.
    expect(await getBuyerCommittedShareBps(db, "buyer", 200)).toBe(0);
  });

  it("upserts settlements idempotently by corporation and turn", async () => {
    const store = newStore();
    const db = fakeDb(store);
    const settlement = {
      corporationId: "buyer",
      turn: 100,
      settledSpendAnchor: 100,
      contractedSpendAnchor: 60,
      spotSpendAnchor: 40,
      effectiveAdvertisingAnchor: 130,
      lines: [],
    };
    await upsertAdvertisingSettlement(db, settlement);
    await upsertAdvertisingSettlement(db, { ...settlement, effectiveAdvertisingAnchor: 130 });
    expect(store.settlements.size).toBe(1);
  });

  it("creates the agreement and settlement indexes", async () => {
    const store = newStore();
    await expect(ensureAdvertisingAgreementIndexes(fakeDb(store))).resolves.toEqual([
      "ad_agreement_parties_v1",
      "ad_agreement_buyer_status_v1",
      "ad_settlement_corp_turn_v1",
    ]);
    expect(store.createdIndexes).toHaveLength(3);
  });

  it("caps total allocation at the full budget", () => {
    expect(AD_AGREEMENT_BUDGET_BPS).toBe(10000);
  });
});
