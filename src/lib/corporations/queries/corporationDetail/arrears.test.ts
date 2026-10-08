import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { loadArrearsView } from "./arrears";
import { summarizeArrears } from "./rules/arrears";

describe("CEO arrears disclosure", () => {
  it("combines completed operating and tax payments, not pending attempts", () => {
    expect(
      summarizeArrears({
        turn: 12,
        currency: "GBP",
        rates: new Map([
          ["USD", 2],
          ["GBP", 0.5],
        ]),
        operating: { USD: 100, GBP: 30 },
        taxAnchor: { US: 40, UK: 20 },
        receipts: [
          { status: "applied", currency: "GBP", event: { amount: 12.34 } },
          { status: "applied", currency: "USD", event: { amount: 40 } },
          { status: "partial", currency: "GBP", event: { amount: 999 } },
          { status: "rejected", currency: "GBP", event: { amount: 999 } },
        ],
      })
    ).toEqual({ turn: 12, paidLastTurn: 22.34, remaining: 85 });
  });

  it("handles legacy missing balances, invalid amounts and absent FX safely", () => {
    expect(summarizeArrears({ turn: 1, currency: "USD", rates: new Map(), receipts: [] })).toEqual({
      turn: 1,
      paidLastTurn: 0,
      remaining: 0,
    });
    expect(
      summarizeArrears({
        turn: 2,
        currency: "USD",
        rates: new Map([["USD", 0]]),
        operating: { USD: -10, GBP: NaN },
        taxAnchor: { US: Infinity },
        receipts: [{ status: "applied", currency: "USD", event: { amount: NaN } }],
      })
    ).toEqual({ turn: 2, paidLastTurn: 0, remaining: 0 });
  });

  it("preserves same-currency payments when FX changes and supports legacy anchor display", () => {
    const receipts = [{ status: "applied", currency: "USD", event: { amount: 125.25 } }];
    const input = { turn: 9, rates: new Map([["USD", 1.25]]), receipts };
    expect(summarizeArrears({ ...input, currency: "USD" }).paidLastTurn).toBe(125.25);
    expect(summarizeArrears({ ...input, currency: "anchor" }).paidLastTurn).toBeCloseTo(100.2);
  });

  it("does not read or expose arrears for outsiders or a vacant CEO", async () => {
    const corporation = makeCorporation();
    const collection = vi.fn();
    const args = { db: { collection } as unknown as Db, corporation, turn: 8, rates: new Map() };
    expect(await loadArrearsView({ ...args, viewerUserId: null })).toBeUndefined();
    expect(await loadArrearsView({ ...args, viewerUserId: "someone-else" })).toBeUndefined();
    expect(
      await loadArrearsView({
        ...args,
        corporation: { ...corporation, ceoVacant: true },
        viewerUserId: corporation.userId!.toString(),
      })
    ).toBeUndefined();
    expect(collection).not.toHaveBeenCalled();
  });

  it("reads exactly the two receipts for the displayed turn, including after full repayment", async () => {
    const corporation = makeCorporation({ operatingCashArrearsByCurrency: { USD: 0 } });
    const find = vi.fn().mockReturnValue({
      toArray: async () => [{ status: "applied", currency: "USD", event: { amount: 123.45 } }],
    });
    const db = { collection: vi.fn().mockReturnValue({ find }) } as unknown as Db;
    const result = await loadArrearsView({
      db,
      corporation,
      viewerUserId: corporation.userId!.toString(),
      turn: 8,
      rates: new Map([["USD", 1]]),
    });
    expect(result).toEqual({ turn: 8, paidLastTurn: 123.45, remaining: 0 });
    expect(find).toHaveBeenCalledWith(
      {
        _id: {
          $in: [
            `corp-operating-arrears-settle:${corporation._id}:8`,
            `corp-tax-arrears-settle:${corporation._id}:8`,
          ],
        },
        status: "applied",
      },
      { projection: { status: 1, currency: 1, "event.amount": 1 } }
    );
  });
});
