import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  acquireRelocationBondFundingLease,
  hasProtectedRelocationProperty,
} from "./relocationBondFunding";

const CORP = new ObjectId();

function proposed() {
  return {
    operationKey: "hq-bond:corp:US:TX:31",
    targetStateId: "TX",
    targetCountryId: "US" as const,
    turn: 31,
    relocationCostAnchor: 10_000,
    crossCountry: false,
    relocationSpreadAnchor: 0,
    currencyCode: "USD" as const,
    nativeFxRate: 1,
    sourceCountryIdPresent: true,
    sourceCountryId: "US" as const,
    sourceLiquidCurrencyCodePresent: true,
    sourceLiquidCurrencyCode: "USD" as const,
    bondId: new ObjectId(),
    preflight: {
      ok: true,
      cooldownTurnsRemaining: null,
      availableBondCapacity: 50_000,
      existingDebt: 0,
      totalEquity: 100_000,
    },
    ceoVacated: false,
    ceoId: new ObjectId(),
    ceoType: "character" as const,
  };
}

describe("relocation bond publication lease", () => {
  it("allows retry of its own held HQ markers but rejects other holds and claims", () => {
    const lease = proposed();
    const sectorId = new ObjectId();
    const ownMarker = {
      _id: sectorId,
      constructionPropertyTransition: {
        key: `headquarters:${CORP.toHexString()}:US:TX:${sectorId.toHexString()}`,
        kind: "headquarters_relocation",
      },
    };

    expect(hasProtectedRelocationProperty([ownMarker], CORP, lease)).toBe(false);
    expect(hasProtectedRelocationProperty([ownMarker], CORP, undefined)).toBe(true);
    expect(
      hasProtectedRelocationProperty(
        [
          {
            ...ownMarker,
            constructionPropertyTransition: {
              ...ownMarker.constructionPropertyTransition,
              key: "other",
            },
          },
        ],
        CORP,
        lease
      )
    ).toBe(true);
    expect(
      hasProtectedRelocationProperty(
        [
          {
            ...ownMarker,
            constructionFinancing: {
              status: "funding",
              escrowLocal: 0,
            } as never,
          },
        ],
        CORP,
        lease
      )
    ).toBe(true);
  });

  it("reuses the original quote and bond identity after an interrupted publication", async () => {
    const db = createInMemoryDb();
    const frozen = proposed();
    db.seed("corporations", [
      {
        _id: CORP,
        countryId: "US",
        liquidCurrencyCode: "USD",
        ceoId: frozen.ceoId,
        ceoType: frozen.ceoType,
      },
    ]);

    const acquired = await acquireRelocationBondFundingLease(
      db as unknown as Db,
      {
        _id: CORP,
        countryId: "US",
        liquidCurrencyCode: "USD",
      },
      frozen
    );
    const retry = await acquireRelocationBondFundingLease(
      db as unknown as Db,
      { _id: CORP, countryId: "US", liquidCurrencyCode: "USD" },
      { ...proposed(), operationKey: frozen.operationKey }
    );

    expect(acquired).toEqual(frozen);
    expect(retry).toEqual(frozen);
    expect(retry?.bondId).toEqual(frozen.bondId);
    expect(retry?.preflight).toEqual(frozen.preflight);
    expect(db.collection("corporations").docs).toHaveLength(1);
  });

  it("does not acquire when underwriting already holds the corporation cash lease", async () => {
    const db = createInMemoryDb();
    db.seed("corporations", [
      {
        _id: CORP,
        countryId: "US",
        liquidCurrencyCode: "USD",
        bankUnderwritingFunding: { key: "underwriting:fill", turn: 31 },
      },
    ]);

    const result = await acquireRelocationBondFundingLease(
      db as unknown as Db,
      { _id: CORP, countryId: "US", liquidCurrencyCode: "USD" },
      proposed()
    );

    expect(result).toBeNull();
    expect(db.collection("corporations").docs[0].headquartersRelocationBondFunding).toBeUndefined();
  });
});
