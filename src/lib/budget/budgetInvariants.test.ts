import { describe, expect, it } from "vitest";
import { checkFederalBudgetInvariants, reconcileFederalBudgetInvariants } from "./budgetInvariants";

const clean = {
  revenue: { total: 1000 },
  spending: { total: 1400 },
  surplus: -400,
  treasuryBalance: -5000,
  debt: { principal: 5000 },
  gdp: 100_000,
  // Bond ledger backs the stored stock: 5000 face, no haircut.
  outstandingSovereignPrincipal: 5000,
};

function bondDocs(face: number) {
  return [
    {
      _id: "b1",
      countryId: "BAL",
      issuerType: "sovereign",
      matured: false,
      defaulted: false,
      totalIssued: face,
      restructureHaircutPercent: null,
    },
  ];
}

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

  it("reports stored principal that disagrees with the bond ledger", () => {
    const breaches = checkFederalBudgetInvariants({
      ...clean,
      debt: { principal: 4900 },
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].field).toBe("debtPrincipal");
    expect(breaches[0].derived).toBe(5000);
  });

  it("ignores treasury cash when checking principal: cash cannot overwrite the bond stock", () => {
    // A 4000 cash swing with the same bond stock is not a breach.
    expect(checkFederalBudgetInvariants({ ...clean, treasuryBalance: -1000 })).toEqual([]);
    expect(checkFederalBudgetInvariants({ ...clean, treasuryBalance: 250 })).toEqual([]);
  });

  it("expects zero principal when the ledger is empty, even for a negative balance", () => {
    const breaches = checkFederalBudgetInvariants({
      ...clean,
      treasuryBalance: -5000,
      debt: { principal: 5000 },
      outstandingSovereignPrincipal: 0,
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].field).toBe("debtPrincipal");
    expect(breaches[0].derived).toBe(0);
  });

  it("skips the debt leg when no ledger sum is supplied", () => {
    const { outstandingSovereignPrincipal: _dropped, ...blind } = clean;
    expect(checkFederalBudgetInvariants({ ...blind, debt: { principal: 999_999 } })).toEqual([]);
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
  type Op = {
    updateOne: { filter: { _id: unknown }; update: { $set: Record<string, number | string> } };
  };

  function stubDb(
    budgetDocs: unknown[],
    bondDocsList: unknown[],
    onWrite?: (ops: Op[]) => void,
    onBondsFind?: (filter: unknown, options: unknown) => void
  ) {
    return {
      collection: (name: string) => {
        if (name === "bonds") {
          return {
            find: (filter: unknown, options: unknown) => {
              onBondsFind?.(filter, options);
              return { toArray: async () => bondDocsList };
            },
          };
        }
        return {
          find: () => ({ toArray: async () => budgetDocs }),
          bulkWrite: async (ops: Op[]) => {
            onWrite?.(ops);
            return { ok: 1 };
          },
        };
      },
    } as unknown as Parameters<typeof reconcileFederalBudgetInvariants>[0];
  }

  it("writes a drifted surplus back to its own definition", async () => {
    const ops: Op[] = [];
    const db = stubDb(
      [{ _id: "IE", countryId: "IE", ...clean, surplus: -450 }],
      bondDocs(5000).map((b) => ({ ...b, countryId: "IE" })),
      (o) => ops.push(...o)
    );
    const r = await reconcileFederalBudgetInvariants(db, 673);
    expect(r.corrected).toBe(1);
    expect(ops[0].updateOne.update.$set).toEqual({ surplus: -400 });
  });

  it("re-points a drifted principal at the bond ledger and refreshes its terms", async () => {
    const ops: Op[] = [];
    const db = stubDb(
      [{ _id: "BAL", countryId: "BAL", ...clean, debt: { principal: 5400 } }],
      bondDocs(5000),
      (o) => ops.push(...o)
    );
    await reconcileFederalBudgetInvariants(db, 673);
    expect(ops[0].updateOne.update.$set).toMatchObject({ "debt.principal": 5000 });
    expect(ops[0].updateOne.update.$set["debt.interestRate"]).toBeGreaterThan(0);
    expect(ops[0].updateOne.update.$set.debtToGdpRatio).toBeCloseTo(0.05, 10);
    expect(typeof ops[0].updateOne.update.$set.creditRating).toBe("string");
  });

  it("zeroes principal when the ledger is empty, without touching cash", async () => {
    const ops: Op[] = [];
    const db = stubDb(
      [{ _id: "BAL", countryId: "BAL", ...clean, treasuryBalance: -5000 }],
      [],
      (o) => ops.push(...o)
    );
    await reconcileFederalBudgetInvariants(db, 673);
    expect(ops[0].updateOne.update.$set).toMatchObject({ "debt.principal": 0 });
    expect(ops[0].updateOne.update.$set).not.toHaveProperty("treasuryBalance");
  });

  it("does not write at all when every budget already agrees", async () => {
    let wrote = false;
    const db = stubDb(
      [{ _id: "US", countryId: "US", ...clean }],
      bondDocs(5000).map((b) => ({ ...b, countryId: "US" })),
      () => {
        wrote = true;
      }
    );
    const r = await reconcileFederalBudgetInvariants(db, 673);
    expect(wrote).toBe(false);
    expect(r).toEqual({ checked: 1, corrected: 0, skipped: 0 });
  });

  it("refuses to launder an implausible drift into the cache", async () => {
    // The whole safety argument for writing is that the derived expression is the
    // truth. A drift this large means a SOURCE field is broken, and quietly writing
    // the stored value from it would turn a reportable fault into a plausible-looking number.
    const ops: Op[] = [];
    const db = stubDb(
      [{ _id: "XX", countryId: "XX", ...clean, surplus: 999_999 }],
      bondDocs(5000).map((b) => ({ ...b, countryId: "XX" })),
      (o) => ops.push(...o)
    );
    const r = await reconcileFederalBudgetInvariants(db, 673);
    expect(r.skipped).toBe(1);
    expect(r.corrected).toBe(0);
    expect(ops).toHaveLength(0);
  });

  it("projects the bond fields the outstanding helper re-checks", async () => {
    // Mocks ignore projections and return full docs, but production applies
    // them: a doc arriving without `issuerType` reads as non-sovereign and
    // contributes 0, which would re-point every stored principal at zero.
    let seen: { filter: unknown; options: unknown } | null = null;
    const db = stubDb(
      [{ _id: "US", countryId: "US", ...clean }],
      bondDocs(5000),
      undefined,
      (filter, options) => {
        seen = { filter, options };
      }
    );
    await reconcileFederalBudgetInvariants(db, 673);
    expect(seen!.filter).toEqual({ issuerType: "sovereign", matured: false, defaulted: false });
    expect(seen!.options).toEqual({
      projection: {
        countryId: 1,
        issuerType: 1,
        matured: 1,
        defaulted: 1,
        totalIssued: 1,
        restructureHaircutPercent: 1,
      },
    });
  });

  it("converges on bonds in as-projected shape (only projected fields present)", async () => {
    // What production actually returns under the projection above: no holders,
    // no coupon, no currency. The outstanding sum must still count full face.
    const ops: Op[] = [];
    const db = stubDb(
      [{ _id: "BAL", countryId: "BAL", ...clean, debt: { principal: 5400 } }],
      [
        {
          _id: "b1",
          countryId: "BAL",
          issuerType: "sovereign",
          matured: false,
          defaulted: false,
          totalIssued: 5000,
          restructureHaircutPercent: null,
        },
      ],
      (o) => ops.push(...o)
    );
    await reconcileFederalBudgetInvariants(db, 673);
    expect(ops[0].updateOne.update.$set).toMatchObject({ "debt.principal": 5000 });
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
    const r = await reconcileFederalBudgetInvariants(db, 673);
    expect(r).toEqual({ checked: 0, corrected: 0, skipped: 0 });
  });
});
