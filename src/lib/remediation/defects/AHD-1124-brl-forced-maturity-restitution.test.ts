import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import {
  COUNTERFACTUAL_BRL_RATE,
  DEFECT_ID,
  FORCED_BRL_MATURITIES,
  creditAnchorForRow,
  defect,
  groupCredits,
  totalCreditAnchor,
  type ForcedMaturityRow,
} from "./AHD-1124-brl-forced-maturity-restitution";

// Untyped on purpose: the assertions below read call arguments positionally.
const emitTxBulk = vi.fn();

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk: async (...args: unknown[]) => emitTxBulk(...args),
  loadTxThresholds: async () => ({}),
}));

function findRow(txId: string): ForcedMaturityRow {
  const row = FORCED_BRL_MATURITIES.find((candidate) => candidate.txId === txId);
  if (!row) throw new Error(`no pinned row ${txId}`);
  return row;
}

describe("AHD-1124 per-row credit", () => {
  it("credits a character the anchor gap on a real forced maturity", () => {
    // Selina Meyer, turn 192: BRL 1,000,000,000 face value settled for
    // 43,240,780.40 anchor at the corrupted rate.
    const row = findRow("6a833e27f35db6c1c52230e1");
    expect(row.subjectType).toBe("character");
    const expected = 1_000_000_000 / COUNTERFACTUAL_BRL_RATE - 43_240_780.39681943;
    expect(creditAnchorForRow(row)).toBeCloseTo(expected, 6);
    expect(creditAnchorForRow(row)).toBeCloseTo(11_198_178.92, 2);
  });

  it("credits a corporation on the same formula", () => {
    // Lockheed Chemicals, turn 216: the single largest forced maturity.
    const row = findRow("6a848fa68977c214beb23013");
    expect(row.subjectType).toBe("corporation");
    const expected = 1_600_000_000 / COUNTERFACTUAL_BRL_RATE - 61_094_617.86211565;
    expect(creditAnchorForRow(row)).toBeCloseTo(expected, 6);
    expect(creditAnchorForRow(row)).toBeCloseTo(26_007_717.05, 2);
  });

  it("floors at zero rather than clawing back an over-payment", () => {
    // No pinned row settles ABOVE the counterfactual (BRL only ever ran weak),
    // so the floor is asserted against a constructed row. This heal credits
    // only, and must never take money back.
    const overpaid: ForcedMaturityRow = {
      txId: "constructed",
      turn: 180,
      subjectType: "character",
      subjectId: "6a77b5f318e42bc9dfb15a12",
      subjectName: "Overpaid Holder",
      brlAmount: 1_000_000,
      anchorAmount: 1_000_000 / COUNTERFACTUAL_BRL_RATE + 5_000,
    };
    expect(creditAnchorForRow(overpaid)).toBe(0);
    expect(FORCED_BRL_MATURITIES.every((row) => creditAnchorForRow(row) > 0)).toBe(true);
  });
});

describe("AHD-1124 affected set", () => {
  it("pins the 22 verified rows across 18 distinct holders", () => {
    expect(FORCED_BRL_MATURITIES).toHaveLength(22);
    expect(groupCredits()).toHaveLength(18);
    const turns = new Set(FORCED_BRL_MATURITIES.map((row) => row.turn));
    expect([...turns].sort((a, b) => a - b)).toEqual([180, 192, 204, 216]);
  });

  it("totals the owner-approved restitution, split character vs corporation", () => {
    const total = totalCreditAnchor();
    const characters = FORCED_BRL_MATURITIES.filter((row) => row.subjectType === "character");
    const corporations = FORCED_BRL_MATURITIES.filter((row) => row.subjectType === "corporation");
    expect(total).toBeCloseTo(91_597_786.52, 1);
    expect(totalCreditAnchor(characters)).toBeCloseTo(12_255_466.81, 1);
    expect(totalCreditAnchor(corporations)).toBeCloseTo(79_342_319.71, 1);
    // Grouping must not lose or duplicate value.
    expect(groupCredits().reduce((sum, credit) => sum + credit.creditAnchor, 0)).toBeCloseTo(
      total,
      6
    );
  });
});

// ── Fake Mongo, just enough for detect/plan/apply/verify ────────────────────

type Doc = Record<string, unknown>;

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = doc;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part] as Doc;
  }
  node[parts[parts.length - 1]] = value;
}

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => {
    if (typeof node !== "object" || node === null) return undefined;
    return (node as Doc)[part];
  }, doc);
}

function makeDb(collections: Record<string, Doc[]>): Db {
  return {
    collection(name: string) {
      const docs = collections[name] ?? [];
      return {
        find(filter: Doc = {}) {
          return {
            async toArray() {
              const ids = (filter._id as { $in?: ObjectId[] } | undefined)?.$in;
              if (!ids) return docs;
              const wanted = new Set(ids.map((id) => id.toString()));
              return docs.filter((doc) => wanted.has(String(doc._id)));
            },
          };
        },
        async updateOne(filter: Doc, update: Doc) {
          const doc = docs.find((candidate) => String(candidate._id) === String(filter._id));
          if (!doc) return { modifiedCount: 0 };
          for (const [path, condition] of Object.entries(filter)) {
            if (path === "_id") continue;
            const exists = getPath(doc, path) !== undefined;
            if ((condition as { $exists?: boolean }).$exists === false && exists) {
              return { modifiedCount: 0 };
            }
          }
          for (const [path, delta] of Object.entries((update.$inc ?? {}) as Doc)) {
            setPath(doc, path, ((getPath(doc, path) as number) ?? 0) + (delta as number));
          }
          for (const [path, value] of Object.entries((update.$set ?? {}) as Doc)) {
            setPath(doc, path, value);
          }
          return { modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

const CTX = { env: "prod" as const, dryRun: false, runId: "run-1124", now: new Date() };

function buildWorld() {
  const credits = groupCredits();
  const characters = credits
    .filter((credit) => credit.subjectType === "character")
    .map((credit) => ({
      _id: new ObjectId(credit.subjectId),
      name: credit.subjectName,
      countryId: "US",
      currencyBalances: { personal: { USD: 1_000 } },
    }));
  const corporations = credits
    .filter((credit) => credit.subjectType === "corporation")
    .map((credit) => ({
      _id: new ObjectId(credit.subjectId),
      name: credit.subjectName,
      countryId: "US",
      liquidCurrencyCode: "USD",
      liquidCapital: 1_000,
    }));
  return {
    characters,
    corporations,
    exchangeRates: [{ _id: "US", countryId: "US", currencyCode: "USD", rate: 2 }],
    financialTxLog: [],
  };
}

describe("AHD-1124 heal lifecycle", () => {
  it("detects, plans, applies, verifies, and is a no-op on a second run", async () => {
    emitTxBulk.mockClear();
    const world = buildWorld();
    const db = makeDb(world as unknown as Record<string, Doc[]>);

    const before = await defect.detect(db, CTX);
    expect(before.affected).toBe(18);

    const plan = await defect.plan(db, CTX);
    expect(plan.affected).toBe(18);
    expect(plan.moneyDelta).toBeCloseTo(91_597_786.52, 1);

    const result = await defect.apply(db, plan, CTX);
    expect(result.documentsUpdated).toBe(18);
    // One receipt per source row, not one per holder, so each credit points at
    // the maturity it repays.
    expect(emitTxBulk).toHaveBeenCalledTimes(1);
    const entries = emitTxBulk.mock.calls[0][1] as Array<{
      type: string;
      anchorAmount: number;
      meta: { ticket: number; sourceTxId: string };
    }>;
    expect(entries).toHaveLength(22);
    expect(entries.every((entry) => entry.type === "restitution_credit")).toBe(true);
    expect(entries.every((entry) => entry.meta.ticket === 1124)).toBe(true);
    expect(new Set(entries.map((entry) => entry.meta.sourceTxId)).size).toBe(22);
    expect(entries.reduce((sum, entry) => sum + entry.anchorAmount, 0)).toBeCloseTo(
      91_597_786.52,
      1
    );

    // The USD rate is 2 local per anchor, so balances moved by twice the anchor.
    const creditedAnchor = world.characters.reduce(
      (sum, doc) =>
        sum + (((doc.currencyBalances.personal as { USD: number }).USD - 1_000) as number) / 2,
      0
    );
    expect(creditedAnchor).toBeCloseTo(12_255_466.81, 1);

    const verified = await defect.verify(db, CTX);
    expect(verified.ok).toBe(true);
    expect(verified.remaining).toBe(0);

    // Second run: markers are present, so nothing matches and nobody is paid twice.
    emitTxBulk.mockClear();
    const balancesAfterFirstRun = world.corporations.map((doc) => doc.liquidCapital);
    expect((await defect.detect(db, CTX)).affected).toBe(0);
    const replan = await defect.plan(db, CTX);
    expect(replan.affected).toBe(0);
    expect(replan.moneyDelta).toBe(0);
    const rerun = await defect.apply(db, replan, CTX);
    expect(rerun.documentsUpdated).toBe(0);
    expect(emitTxBulk).not.toHaveBeenCalled();
    expect(world.corporations.map((doc) => doc.liquidCapital)).toEqual(balancesAfterFirstRun);
  });

  it("stamps a durable marker carrying its source rows", async () => {
    const world = buildWorld();
    const db = makeDb(world as unknown as Record<string, Doc[]>);
    const plan = await defect.plan(db, CTX);
    await defect.apply(db, plan, CTX);
    const marker = (world.corporations[0] as unknown as Doc).remediation as Doc;
    const entry = marker[DEFECT_ID] as { ticket: number; sourceTxIds: string[]; runId: string };
    expect(entry.ticket).toBe(1124);
    expect(entry.sourceTxIds.length).toBeGreaterThan(0);
    expect(entry.runId).toBe("run-1124");
  });
});

describe("AHD-1124 defect registration", () => {
  it("declares that it mints money and therefore drops the money-conserving guard", () => {
    expect(defect.mintsMoney).toBe(true);
    expect(defect.guards).not.toContain("money-conserving");
  });

  it("is idempotent and capped above the 18 holders but well below a runaway", () => {
    expect(defect.idempotent).toBe(true);
    expect(defect.guards).toContain("max-affected:25");
    expect(defect.guards).toContain("turn-lock-free");
  });

  it("pins the code fix and answers the seed question", () => {
    expect(defect.codeFix?.requiredCommit).toBe("c116e8ecf7924785ca4a9077961f56de8901d4da");
    expect(defect.seedFix.status).toBe("fixed");
    expect(defect.seedFix.note).toBeTruthy();
  });
});
