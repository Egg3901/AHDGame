import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { resolveBankingPolicy } from "./rules/policy";
import { listPrimaryUnderwritingBanks, resolvePrimaryUnderwritingOffer } from "./underwritingOffer";

describe("primary underwriting mandate resolution", () => {
  it("does no corporation read when the feature is disabled", async () => {
    const collection = vi.fn();
    const db = { collection } as unknown as Db;
    const policy = resolveBankingPolicy(null);
    expect(await listPrimaryUnderwritingBanks(db, policy, "USD")).toEqual([]);
    expect(
      await resolvePrimaryUnderwritingOffer(
        db,
        policy,
        { _id: new ObjectId(), countryId: "US", liquidCurrencyCode: "USD" },
        "USD",
        "equity",
        1
      )
    ).toBeNull();
    expect(collection).not.toHaveBeenCalled();
  });

  it("resolves only a current same-currency charter at the selected epoch", async () => {
    const bankId = new ObjectId();
    const issuerId = new ObjectId();
    const bank = {
      _id: bankId,
      name: "Harbor Investment Bank",
      countryId: "US",
      bankCharter: {
        status: "active",
        type: "investment",
        currency: "USD",
        charteredTurn: 12,
      },
    };
    const findOne = vi.fn().mockResolvedValue(bank);
    const collection = vi.fn().mockReturnValue({ findOne });
    const db = { collection } as unknown as Db;
    const mandate = {
      bankCorporationId: bankId,
      charteredTurn: 12,
      currencyCode: "USD" as const,
      feeRate: 0.015,
      selectedAtTurn: 20,
    };
    const result = await resolvePrimaryUnderwritingOffer(
      db,
      resolveBankingPolicy({ privateBankingEnabled: true, bankUnderwritingEnabled: true }),
      {
        _id: issuerId,
        countryId: "US",
        liquidCurrencyCode: "USD",
        primaryUnderwritingMandate: mandate,
      },
      "USD",
      "corporate_bond",
      21
    );
    expect(result).toMatchObject({
      offer: {
        bankCorporationId: bankId,
        issuerCorporationId: issuerId,
        currencyCode: "USD",
        charteredTurn: 12,
        feeRate: 0.015,
        instrumentType: "corporate_bond",
        originalQuoteTurn: 21,
        issuerCurrencySnapshot: {
          currencyCode: "USD",
          liquidCurrencyCodePresent: true,
          liquidCurrencyCode: "USD",
          countryIdPresent: true,
          countryId: "US",
        },
        bankCurrencySnapshot: {
          currencyCode: "USD",
          liquidCurrencyCodePresent: false,
          countryIdPresent: true,
          countryId: "US",
        },
      },
      bank: { _id: bankId, name: "Harbor Investment Bank" },
    });
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: bankId,
        "bankCharter.currency": "USD",
        "bankCharter.charteredTurn": 12,
      }),
      expect.objectContaining({
        projection: { _id: 1, name: 1, countryId: 1, liquidCurrencyCode: 1, bankCharter: 1 },
      })
    );
  });
});
