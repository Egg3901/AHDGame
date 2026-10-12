import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { makeStrictInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import type { CompensationSpec } from "./types";

const emitted: { entries: Array<Record<string, unknown>>; ledgerTurn: number | null }[] = [];
vi.mock("@/lib/financialTxLog/emit", async () => {
  const { resolveLedgerTurn } = await import("@/lib/ledger/ledgerTurn");
  return {
    loadTxThresholds: async () => ({}),
    emitTxBulk: async (
      db: { collection: (name: string) => { insertMany: (docs: unknown[]) => Promise<unknown> } },
      entries: Array<Record<string, unknown>>
    ) => {
      emitted.push({ entries, ledgerTurn: await resolveLedgerTurn(db as never) });
      await db
        .collection("financialTxLog")
        .insertMany(entries.map((e) => ({ _id: new ObjectId(), ...e })));
    },
  };
});

const { compensationId, compileCompensationDefect, validateCompensationSpec } =
  await import("./compensation");
const { runApply, runPlan } = await import("./runner");
const { validateAdhocSpec } = await import("./adhoc");

const A = new ObjectId("6ac763824f4573325e5f8069");
const B = new ObjectId("6ac3dbf9c6e9f850d977790d");

function spec(overrides: Partial<CompensationSpec> = {}): CompensationSpec {
  return {
    description: "turn 134 governor cliff repayment for ticket 1502",
    ticket: "1502",
    mode: "credit",
    credits: [
      { corporationId: A.toString(), amountLocal: 7_465_290, basis: "turn 134 income shortfall" },
      { corporationId: B.toString(), amountLocal: 1_132_397_399 },
    ],
    expectedMax: 5,
    ...overrides,
  };
}

function seed() {
  return makeStrictInMemoryStore({
    gameState: [{ _id: "current", isActive: true, currentTurn: 146, isProcessing: false }],
    exchangeRates: [
      { _id: "usd", currencyCode: "USD", rate: 0.97 },
      { _id: "jpy", currencyCode: "JPY", rate: 126.5 },
    ],
    corporations: [
      {
        _id: A.toString(),
        name: "Broadcaster",
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 100,
      },
      {
        _id: B.toString(),
        name: "Asset Manager",
        countryId: "JP",
        liquidCurrencyCode: "JPY",
        liquidCapital: 1_000,
      },
    ],
    financialTxLog: [],
  });
}

beforeEach(() => {
  emitted.length = 0;
});

describe("validateCompensationSpec", () => {
  const fields = (s: CompensationSpec) => validateCompensationSpec(s).map((p) => p.field);
  it("accepts a well-formed credit", () => expect(validateCompensationSpec(spec())).toEqual([]));
  it("refuses debits, duplicates and bad ids", () => {
    expect(fields(spec({ credits: [{ corporationId: A.toString(), amountLocal: -5 }] }))).toContain(
      "credits[0].amountLocal"
    );
    expect(
      fields(
        spec({
          credits: [
            { corporationId: A.toString(), amountLocal: 1 },
            { corporationId: A.toString(), amountLocal: 2 },
          ],
        })
      )
    ).toContain("credits[1].corporationId");
    expect(fields(spec({ credits: [{ corporationId: "abc", amountLocal: 1 }] }))).toContain(
      "credits[0].corporationId"
    );
  });
  it("holds the run to expectedMax", () =>
    expect(fields(spec({ expectedMax: 1 }))).toContain("expectedMax"));
  it("needs when and in which ledger turn money moved for a receipt-only run", () => {
    expect(fields(spec({ mode: "receipt-only" }))).toEqual(
      expect.arrayContaining(["movedAt", "ledgerTurn"])
    );
    expect(
      validateCompensationSpec(
        spec({ mode: "receipt-only", movedAt: "2026-10-12T07:04:37Z", ledgerTurn: 136 })
      )
    ).toEqual([]);
    expect(fields(spec({ movedAt: "2026-10-12T07:04:37Z" }))).toContain("movedAt");
  });
  it("gives the same credits the same id and different modes different ids", () => {
    expect(compensationId(spec())).toBe(
      compensationId(spec({ description: "other words entirely" }))
    );
    expect(compensationId(spec())).not.toBe(
      compensationId(
        spec({ mode: "receipt-only", movedAt: "2026-10-12T07:04:37Z", ledgerTurn: 136 })
      )
    );
  });
});

describe("compensation through the runner", () => {
  it("credits the exact amount once, reports the mint and writes a receipt per corporation", async () => {
    const store = seed();
    const defect = compileCompensationDefect(spec());
    const planned = await runPlan(store.db, defect, { env: "sandbox", operator: "tester" });
    expect(planned.plan.affected).toBe(2);
    expect(planned.plan.moneyDelta).toBeCloseTo(7_465_290 / 0.97 + 1_132_397_399 / 126.5, 3);
    expect(planned.token).not.toBeNull();

    const applied = await runApply(store.db, defect, {
      env: "sandbox",
      tokenId: planned.token!.id,
      operator: "tester",
    });
    expect(applied.refusal ?? null).toBeNull();
    expect(applied.ok).toBe(true);
    const corps = new Map(store.cols.corporations.map((c) => [String(c._id), c]));
    expect(corps.get(A.toString())!.liquidCapital).toBe(100 + 7_465_290);
    expect(corps.get(B.toString())!.liquidCapital).toBe(1_000 + 1_132_397_399);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].entries.map((e) => e.type)).toEqual([
      "restitution_credit",
      "restitution_credit",
    ]);
    expect(emitted[0].entries[0]).toMatchObject({
      amount: 7_465_290,
      currencyCode: "USD",
      turn: 146,
    });
    expect(store.cols.financialTxLog).toHaveLength(2);

    // A repeat plan finds nobody owed: the marker makes the credit idempotent.
    const again = await runPlan(store.db, defect, { env: "sandbox", operator: "tester" });
    expect(again.plan.affected).toBe(0);
  });

  it("receipt-only records money that already moved, in the turn it moved, without moving it again", async () => {
    const store = seed();
    const defect = compileCompensationDefect(
      spec({ mode: "receipt-only", movedAt: "2026-10-12T07:04:37.759Z", ledgerTurn: 136 })
    );
    const planned = await runPlan(store.db, defect, { env: "sandbox", operator: "tester" });
    expect(planned.plan.moneyDelta).toBe(0);
    const applied = await runApply(store.db, defect, {
      env: "sandbox",
      tokenId: planned.token!.id,
      operator: "tester",
    });
    expect(applied.refusal ?? null).toBeNull();
    expect(applied.ok).toBe(true);
    expect(store.cols.corporations.map((c) => c.liquidCapital).sort()).toEqual([100, 1_000]);
    expect(emitted[0].ledgerTurn).toBe(136);
    expect(emitted[0].entries[0]).toMatchObject({
      turn: 135,
      createdAt: new Date("2026-10-12T07:04:37.759Z"),
    });
  });
});

describe("ad-hoc balance edits", () => {
  const base = {
    description: "repay ticket 1498 company the held back energy revenue",
    filter: { name: "X" },
    expectedMax: 1,
    touchesMoney: true,
  };
  it("refuses a payment written as a liquidCapital or funds edit", () => {
    expect(
      validateAdhocSpec({
        ...base,
        collection: "corporations",
        action: { kind: "set", set: { liquidCapital: 5 } },
      }).map((p) => p.field)
    ).toContain("action");
    expect(
      validateAdhocSpec({
        ...base,
        collection: "characters",
        action: { kind: "set", set: { funds: 5 } },
      }).map((p) => p.field)
    ).toContain("action");
  });
  it("still allows a declared correction of a broken value", () => {
    expect(
      validateAdhocSpec({
        ...base,
        collection: "corporations",
        action: { kind: "set", set: { liquidCapital: 0 } },
        balanceCorrection: true,
      })
    ).toEqual([]);
  });
});
