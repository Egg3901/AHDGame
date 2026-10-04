import type { ClientSession, Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { SuccessionFiscalShare } from "./rules/fiscalShares";
import { materializeFederationFiscalAccounts } from "./materializeFiscalAccounts";

const session = {} as ClientSession;
const applicationId = "1991-default:ussr-split:1";
const accounting = {
  signedCashMinor: 10_000,
  financialAssetsMinor: 10_000,
  cashDeficitMinor: 0,
  creditorDebtMinor: 20_000,
  creditorPrincipalByBondMinor: { bond1: 20_000 },
  reportedDebtMinor: 20_000,
  ratesLocalPerAnchor: { SUR: 2 },
};
const share = (
  entityId: string,
  kind: SuccessionFiscalShare["kind"],
  cash: number,
  contribution: number,
  service: number
): SuccessionFiscalShare => ({
  entityId,
  kind,
  financialAssetEntitlementMinor: cash,
  creditorContributionMinor: contribution,
  servicingCreditorPrincipalMinor: service,
  cashDeficitResponsibilityMinor: 0,
  facilityClaimLiabilityMinor: 0,
  claimIds: [],
});

describe("federation fiscal materialization", () => {
  it("conserves shared-unit cash and debt duties without rewriting creditor bonds", async () => {
    const mem = createInMemoryDb();
    mem.seed("federalBudget", [
      { _id: "RU", countryId: "RU", currencyCode: "SUR", treasuryBalance: 200 },
    ]);
    mem.seed("macroCountries", [
      {
        _id: "UKR",
        entityId: "UKR",
        presetId: "1991-default",
        simulationTier: "background-macro",
        dataQuality: { provenance: "succession-derived" },
      },
    ]);
    mem.seed("bonds", [{ _id: "bond1", countryId: "RU", issuerType: "sovereign" }]);
    const db = mem as unknown as Db;
    const accounts = await materializeFederationFiscalAccounts({
      db,
      session,
      applicationId,
      sourceCountryId: "RU",
      accounting,
      shares: [
        share("RU", "continuing-state", 6000, 12_000, 20_000),
        share("UKR", "background-successor", 4000, 8000, 0),
      ],
    });
    expect(accounts.map((account) => [account.entityId, account.openingCashMinor])).toEqual([
      ["RU", 6000],
      ["UKR", 4000],
    ]);
    expect(await db.collection("federalBudget").findOne({ _id: "RU" as never })).toMatchObject({
      treasuryBalance: 120,
    });
    expect(await db.collection("macroCountries").findOne({ _id: "UKR" as never })).toMatchObject({
      federationTreasuryMinor: 4000,
      federationDebtResponsibilityMinor: 8000,
    });
    expect(await db.collection("bonds").findOne({ _id: "bond1" as never })).toMatchObject({
      countryId: "RU",
      issuerType: "sovereign",
    });
    expect(await db.collection("federationFiscalAccounts").countDocuments({})).toBe(2);
  });

  it("rejects a changed source cash balance before moving anything", async () => {
    const mem = createInMemoryDb();
    mem.seed("federalBudget", [
      { _id: "RU", countryId: "RU", currencyCode: "SUR", treasuryBalance: 199 },
    ]);
    const db = mem as unknown as Db;
    await expect(
      materializeFederationFiscalAccounts({
        db,
        session,
        applicationId,
        sourceCountryId: "RU",
        accounting,
        shares: [
          share("RU", "continuing-state", 6000, 12_000, 20_000),
          share("UKR", "background-successor", 4000, 8000, 0),
        ],
      })
    ).rejects.toThrow("source cash changed");
    expect(await db.collection("federationFiscalAccounts").countDocuments({})).toBe(0);
  });

  it("keeps the dissolved issuer for creditor service while assigning deficit shares", async () => {
    const mem = createInMemoryDb();
    mem.seed("federalBudget", [
      { _id: "CS", countryId: "CS", currencyCode: "SUR", treasuryBalance: -40 },
    ]);
    mem.seed(
      "macroCountries",
      ["CZ2", "SK"].map((entityId) => ({
        _id: entityId,
        entityId,
        presetId: "1991-default",
        simulationTier: "background-macro",
        dataQuality: { provenance: "succession-derived" },
      }))
    );
    const db = mem as unknown as Db;
    const shares: SuccessionFiscalShare[] = [
      {
        ...share("CZ2", "background-successor", 0, 12_000, 0),
        cashDeficitResponsibilityMinor: 1200,
      },
      { ...share("SK", "background-successor", 0, 8000, 0), cashDeficitResponsibilityMinor: 800 },
      share("CS", "legacy-administration", 0, 0, 20_000),
    ];
    const accounts = await materializeFederationFiscalAccounts({
      db,
      session,
      applicationId: "1991-default:cs-split:1",
      sourceCountryId: "CS",
      accounting: {
        ...accounting,
        signedCashMinor: -2000,
        financialAssetsMinor: 0,
        cashDeficitMinor: 2000,
      },
      shares,
    });
    expect(accounts.map((account) => [account.entityId, account.openingCashMinor])).toEqual([
      ["CZ2", -1200],
      ["SK", -800],
      ["CS", 0],
    ]);
    expect(await db.collection("federalBudget").findOne({ _id: "CS" as never })).toMatchObject({
      treasuryBalance: 0,
    });
    expect(await db.collection("macroCountries").findOne({ _id: "CZ2" as never })).toMatchObject({
      federationTreasuryMinor: -1200,
    });
  });
});
