import { describe, expect, it } from "vitest";
import { checkFederalBudgetInvariants, reconcileFederalBudgetInvariants } from "./budgetInvariants";

const clean = {
  revenue: { total: 1000 },
  spending: { total: 1400 },
  surplus: -400,
  treasuryBalance: -5000,
  debt: { principal: 5000 },
};

describe("checkFederalBudgetInvariants", () => {
  it("reports nothing for a consistent budget", () => {
    expect(checkFederalBudgetInvariants(clean)).toEqual([]);
  });

  it("reports a stale surplus cache", () => {
    const breaches = checkFederalBudgetInvariants({ ...clean, surplus: -450 });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].field).toBe("surplus");
    expect(breaches[0].stored).toBe(-450);
    expect(breaches[0].derived).toBe(-400);
    expect(breaches[0].absDelta).toBe(50);
  });

  it("reports a stale debt principal mirror", () => {
    const breaches = checkFederalBudgetInvariants({
      ...clean,
      debt: { principal: 4900 },
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].field).toBe("debtPrincipal");
    expect(breaches[0].derived).toBe(5000);
  });

  it("floors debt principal at zero when the treasury is in surplus", () => {
    const breaches = checkFederalBudgetInvariants({
      ...clean,
      treasuryBalance: 250,
      debt: { principal: 0 },
    });
    expect(breaches).toEqual([]);
  });

  it("tolerates sub-unit floating point noise", () => {
    const breaches = checkFederalBudgetInvariants({ ...clean, surplus: -400.4 });
    expect(breaches).toEqual([]);
  });

  it("reports both fields when both drift", () => {
    const breaches = checkFederalBudgetInvariants({
      ...clean,
      surplus: -450,
      debt: { principal: 4900 },
    });
    expect(breaches.map((b) => b.field).sort()).toEqual(["debtPrincipal", "surplus"]);
  });

  it("skips a field the document does not carry", () => {
    expect(checkFederalBudgetInvariants({ revenue: { total: 1 }, spending: { total: 1 } })).toEqual(
      []
    );
  });
});

describe("reconcileFederalBudgetInvariants", () => {
  type Op = { updateOne: { filter: { _id: unknown }; update: { $set: Record<string, number> } } };

  function stubDb(docs: unknown[], onWrite?: (ops: Op[]) => void) {
    return {
      collection: () => ({
        find: () => ({ toArray: async () => docs }),
        bulkWrite: async (ops: Op[]) => {
          onWrite?.(ops);
          return { ok: 1 };
        },
      }),
    } as unknown as Parameters<typeof reconcileFederalBudgetInvariants>[0];
  }

  it("writes a drifted surplus back to its own definition", async () => {
    const ops: Op[] = [];
    const db = stubDb([{ _id: "IE", countryId: "IE", ...clean, surplus: -450 }], (o) =>
      ops.push(...o)
    );
    const r = await reconcileFederalBudgetInvariants(db, 673);
    expect(r.corrected).toBe(1);
    expect(ops[0].updateOne.update.$set).toEqual({ surplus: -400 });
  });

  it("writes a drifted debt principal back to the treasury balance", async () => {
    const ops: Op[] = [];
    const db = stubDb(
      [{ _id: "BAL", countryId: "BAL", ...clean, debt: { principal: 5400 } }],
      (o) => ops.push(...o)
    );
    await reconcileFederalBudgetInvariants(db, 673);
    expect(ops[0].updateOne.update.$set).toEqual({ "debt.principal": 5000 });
  });

  it("does not write at all when every budget already agrees", async () => {
    let wrote = false;
    const db = stubDb([{ _id: "US", countryId: "US", ...clean }], () => {
      wrote = true;
    });
    const r = await reconcileFederalBudgetInvariants(db, 673);
    expect(wrote).toBe(false);
    expect(r).toEqual({ checked: 1, corrected: 0, skipped: 0 });
  });

  it("refuses to launder an implausible drift into the cache", async () => {
    // The whole safety argument for writing is that the derived expression is the
    // truth. A drift this large means a SOURCE field is broken, and quietly writing
    // the cache from it would turn a reportable fault into a plausible-looking number.
    const ops: Op[] = [];
    const db = stubDb([{ _id: "XX", countryId: "XX", ...clean, surplus: 999_999 }], (o) =>
      ops.push(...o)
    );
    const r = await reconcileFederalBudgetInvariants(db, 673);
    expect(r.skipped).toBe(1);
    expect(r.corrected).toBe(0);
    expect(ops).toHaveLength(0);
  });

  it("never throws, so a hygiene pass cannot fail a turn", async () => {
    const db = {
      collection: () => ({
        find: () => ({
          toArray: async () => {
            throw new Error("mongo is having a day");
          },
        }),
      }),
    } as unknown as Parameters<typeof reconcileFederalBudgetInvariants>[0];
    await expect(reconcileFederalBudgetInvariants(db, 673)).resolves.toEqual({
      checked: 0,
      corrected: 0,
      skipped: 0,
    });
  });
});
