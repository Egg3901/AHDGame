/**
 * Primary-market underwriting selection. An issuer names one same-currency
 * investment bank; resolveUnderwritingOffer freezes the bank's current charter
 * epoch and fee for a specific equity or corporate bond offer.
 */

import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation } from "@/lib/db/types";
import type { BankingPolicySnapshot } from "./rules/policy";
import {
  DEFAULT_PRIMARY_UNDERWRITING_FEE_RATE,
  primaryUnderwritingCharterEligible,
  type PrimaryUnderwritingOffer,
} from "./rules/underwriting";

export interface UnderwritingBankChoice {
  corporationId: string;
  name: string;
  currencyCode: CurrencyCode;
  charteredTurn: number;
  feeRate: number;
}

export interface ResolvedPrimaryUnderwritingOffer {
  offer: import("./rules/underwriting").PrimaryUnderwritingOffer;
  bank: Pick<Corporation, "_id" | "name" | "bankCharter">;
}

/** Flag-off is a true zero-read path. */
export async function listPrimaryUnderwritingBanks(
  db: Db,
  policy: BankingPolicySnapshot,
  currencyCode: CurrencyCode
): Promise<UnderwritingBankChoice[]> {
  if (!policy.primaryUnderwriting) return [];
  const banks = await db
    .collection<Corporation>("corporations")
    .find(
      {
        "bankCharter.status": "active",
        "bankCharter.type": { $in: ["investment", "universal"] },
        "bankCharter.currency": currencyCode,
        "bankCharter.resolutionClaimedTurn": { $exists: false },
        bankCharterTransfer: { $exists: false },
        bankPrimaryFunding: { $exists: false },
        bankUnderwritingFunding: { $exists: false },
        bankConstructionFunding: { $exists: false },
      },
      {
        projection: {
          _id: 1,
          name: 1,
          liquidCurrencyCode: 1,
          bankCharter: 1,
        },
      }
    )
    .sort({ name: 1 })
    .toArray();
  return banks
    .filter((bank) => primaryUnderwritingCharterEligible(bank.bankCharter, currencyCode))
    .map((bank) => ({
      corporationId: bank._id.toHexString(),
      name: bank.name,
      currencyCode,
      charteredTurn: bank.bankCharter!.charteredTurn,
      feeRate: DEFAULT_PRIMARY_UNDERWRITING_FEE_RATE,
    }));
}

/**
 * Resolve only the issuer's selected bank, and only while the feature is on.
 * The returned terms are a durable snapshot; later fill checks still acquire
 * a parent-corporation epoch lease before moving money.
 */
export async function resolvePrimaryUnderwritingOffer(
  db: Db,
  policy: BankingPolicySnapshot,
  issuer: Pick<Corporation, "_id" | "liquidCurrencyCode" | "primaryUnderwritingMandate">,
  issuerCurrencyCode: CurrencyCode,
  instrumentType: PrimaryUnderwritingOffer["instrumentType"],
  turn: number
): Promise<ResolvedPrimaryUnderwritingOffer | null> {
  if (!policy.primaryUnderwriting || !issuer.primaryUnderwritingMandate) return null;
  const mandate = issuer.primaryUnderwritingMandate;
  const currencyCode = issuerCurrencyCode;
  if (
    !currencyCode ||
    mandate.currencyCode !== currencyCode ||
    mandate.bankCorporationId.equals(issuer._id) ||
    !Number.isInteger(turn) ||
    turn < 0
  ) {
    return null;
  }
  const bank = await db.collection<Corporation>("corporations").findOne(
    {
      _id: mandate.bankCorporationId,
      "bankCharter.status": "active",
      "bankCharter.type": { $in: ["investment", "universal"] },
      "bankCharter.currency": currencyCode,
      "bankCharter.charteredTurn": mandate.charteredTurn,
      "bankCharter.resolutionClaimedTurn": { $exists: false },
      bankCharterTransfer: { $exists: false },
      bankPrimaryFunding: { $exists: false },
      bankUnderwritingFunding: { $exists: false },
      bankConstructionFunding: { $exists: false },
    },
    { projection: { _id: 1, name: 1, bankCharter: 1 } }
  );
  if (!bank || !primaryUnderwritingCharterEligible(bank.bankCharter, currencyCode)) return null;
  return {
    offer: {
      bankCorporationId: bank._id,
      issuerCorporationId: issuer._id,
      charteredTurn: bank.bankCharter!.charteredTurn,
      currencyCode,
      feeRate: mandate.feeRate,
      instrumentType,
      originalQuoteTurn: turn,
    },
    bank: { _id: bank._id, name: bank.name, bankCharter: bank.bankCharter },
  };
}
