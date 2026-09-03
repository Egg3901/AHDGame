import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import {
  BOND_CURRENCY,
  DEFECT_ID,
  REPUDIATION_REFUNDS,
  REPUDIATION_SEVERITY,
  defect,
  refundTrlForRow,
  totalRefundTrl,
} from "./AHD-1266-tr-repudiation-restitution";

// Untyped on purpose: the assertions below read call arguments positionally.
const emitTxBulk = vi.fn();

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk: async (...args: unknown[]) => emitTxBulk(...args),
  loadTxThresholds: async () => ({}),
}));

vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: async () =>
    new Map([
      ["TRL", 35],
      ["GBP", 0.34],
      ["USD", 1],
    ]),
  resolveCorpLiquidCurrencyCode: (corp: { liquidCurrencyCode?: string | null }) =>
    corp.liquidCurrencyCode ?? undefined,
  anchorToCorpLiquidCapital: (anchor: number, _corp: unknown, fxRate: number) => anchor * fxRate,
}));

describe("AHD-1266 refund math", () => {
  it("repays STDS the exact second charge in TRL", () => {
    const row = REPUDIATION_REFUNDS.find((r) => r.subjectId === "6a789d7585aed43665ca529d")!;
    // 2,438,245 units × 1,000 face × 0.95 severity
    expect(refundTrlForRow(row)).toBeCloseTo(2_316_332_750, 6);
  });

  it("pins 19 holders: 9 corporations, 10 characters", () => {
    expect(REPUDIATION_REFUNDS).toHaveLength(19);
    expect(REPUDIATION_REFUNDS.filter((r) => r.subjectType === "corporation")).toHaveLength(9);
    expect(REPUDIATION_REFUNDS.filter((r) => r.subjectType === "character")).toHaveLength(10);
    expect(new Set(REPUDIATION_REFUNDS.map((r) => `${r.subjectType}:${r.subjectId}`)).size).toBe(
      19
    );
  });

  it("totals the owner-approved restitution without loss or duplication", () => {
    const total = totalRefundTrl();
    const byType = (t: string) =>
      totalRefundTrl(REPUDIATION_REFUNDS.filter((r) => r.subjectType === t));
    expect(total).toBeCloseTo(byType("character") + byType("corporation"), 6);
    expect(REPUDIATION_REFUNDS.every((r) => refundTrlForRow(r) > 0)).toBe(true);
    expect(REPUDIATION_SEVERITY).toBe(0.95);
    expect(BOND_CURRENCY).toBe("TRL");
  });
});

// ── Fake Mongo, just enough for detect/plan/apply/verify ────────────────────

type Doc = Record<string, unknown>;

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => {
    if (typeof node !== "object" || node === null) return undefined;
    return (node as Doc)[part];
  }, doc);
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = doc;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part] as Doc;
  }
  node[parts[parts.length - 1]] = value;
}

function makeDb(collections: Record<string, Doc[]>): { db: Db; docs: Record<string, Doc[]> } {
  const docs = collections;
  const db = {
    collection(name: string) {
      const rows = docs[name] ?? [];
      return {
        find(filter: Doc = {}) {
          return {
            async toArray() {
              const ids = (filter._id as { $in?: ObjectId[] } | undefined)?.$in;
              if (!ids) return rows;
              const wanted = new Set(ids.map((id) => id.toString()));
              return rows.filter((row) => wanted.has(String(row._id)));
            },
          };
        },
        async updateOne(filter: Doc, update: Doc) {
          const row = rows.find((candidate) => String(candidate._id) === String(filter._id));
          if (!row) return { modifiedCount: 0 };
          const markerPath = Object.keys(filter).find((key) => key.startsWith("remediation."));
          if (markerPath && getPath(row, markerPath) !== undefined) return { modifiedCount: 0 };
          for (const [path, amount] of Object.entries((update.$inc as Doc) ?? {})) {
            setPath(row, path, (Number(getPath(row, path)) || 0) + Number(amount));
          }
          for (const [path, value] of Object.entries((update.$set as Doc) ?? {})) {
            setPath(row, path, value);
          }
          return { modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
  return { db, docs };
}

function characterDoc(id: string) {
  return { _id: new ObjectId(id), name: "holder", currencyBalances: { personal: { TRL: 1000 } } };
}

function corpDoc(id: string, liquidCurrencyCode = "GBP") {
  return { _id: new ObjectId(id), name: "holder co", countryId: "UK", liquidCurrencyCode };
}

describe("AHD-1266 detect/plan/apply/verify", () => {
  it("detects the pinned holders, then goes clean after apply", async () => {
    const stds = "6a789d7585aed43665ca529d";
    const rgold = "6a77d50e2fb91e2bdc779937";
    const { db } = makeDb({
      characters: [characterDoc(rgold)],
      corporations: [corpDoc(stds)],
    });
    const ctx = { env: "prod" as const, dryRun: false, now: new Date(), runId: "run-1" };

    // Only the two loaded recipients are plannable; the other 17 are gone.
    const detected = await defect.detect(db, ctx);
    expect(detected.affected).toBe(2);

    const planned = await defect.plan(db, ctx);
    expect(planned.affected).toBe(2);
    expect(planned.moneyDelta).toBeGreaterThan(0);

    // STDS: 2,316,332,750 TRL / 35 = 66,180,935.71 anchor × 0.34 GBP = 22,501,518.14
    const stdsTouch = (planned.touched ?? []).find((t) => t.collection === "corporations");
    expect(stdsTouch?.ids).toEqual([stds]);

    const applied = await defect.apply(db, planned, ctx);
    expect(applied.documentsUpdated).toBe(2);
    expect(emitTxBulk).toHaveBeenCalledTimes(1);

    const verified = await defect.verify(db, ctx);
    expect(verified.ok).toBe(true);
    expect(verified.remaining).toBe(0);

    // Re-run is a safe no-op: markers are set, detector finds nobody.
    const replanned = await defect.plan(db, ctx);
    expect(replanned.affected).toBe(0);
    const reapplied = await defect.apply(db, replanned, ctx);
    expect(reapplied.documentsUpdated).toBe(0);
  });

  it("credits characters straight TRL and corps converted home currency", async () => {
    const rgold = "6a77d50e2fb91e2bdc779937";
    const stds = "6a789d7585aed43665ca529d";
    const { db, docs } = makeDb({
      characters: [characterDoc(rgold)],
      corporations: [corpDoc(stds, "GBP")],
    });
    const ctx = { env: "prod" as const, dryRun: false, now: new Date(), runId: "run-2" };

    const planned = await defect.plan(db, ctx);
    const payload = planned.payload as {
      credits: Array<{ subjectId: string; creditLocal: number }>;
    };
    const charCredit = payload.credits.find((c) => c.subjectId === rgold)!;
    const corpCredit = payload.credits.find((c) => c.subjectId === stds)!;
    // Rgold: 7,307,531 × 1,000 × 0.95 straight TRL.
    expect(charCredit.creditLocal).toBeCloseTo(6_942_154_450, 6);
    // STDS: anchor × GBP rate.
    expect(corpCredit.creditLocal).toBeCloseTo((2_316_332_750 / 35) * 0.34, 2);

    await defect.apply(db, planned, ctx);
    expect((docs.characters[0].currencyBalances as Doc).personal).toMatchObject({
      TRL: 1000 + 6_942_154_450,
    });
    expect(docs.corporations[0].liquidCapital).toBeCloseTo((2_316_332_750 / 35) * 0.34, 2);
    expect(getPath(docs.corporations[0], `remediation.${DEFECT_ID}`)).toMatchObject({
      ticket: 1266,
    });
  });
});
