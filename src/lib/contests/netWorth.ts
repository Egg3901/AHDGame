/**
 * Personal net worth for the wealth contest, valued the same way as the legacy
 * leaderboard (cash + savings + shares + bonds + index funds, in ₳), but read
 * only for the characters asked about. loadExternalInflows is the money that
 * arrived from outside a character's own play (wires, loan principal), which
 * the contest nets out of growth.
 */
import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { Corporation } from "@/lib/db/types/corporation";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { IndexFund, IndexFundPosition } from "@/lib/db/types/indexFund";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import { fetchExchangeRateMap, getRateDoc, toInternalAmount } from "@/lib/world/forex";

const add = (m: Map<string, number>, key: string, value: number) =>
  m.set(key, (m.get(key) ?? 0) + value);

/** Net worth in ₳ by character id, for the given characters only. */
export async function loadCharacterNetWorths(
  db: Db,
  characterIds: ObjectId[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (characterIds.length === 0) return out;
  const [characters, rateMap, fx, corps, bonds, positions] = await Promise.all([
    db
      .collection<Character>("characters")
      .find(
        { _id: { $in: characterIds } },
        { projection: { countryId: 1, currencyBalances: 1, cashOnHand: 1, savingsOnHand: 1 } }
      )
      .toArray(),
    fetchExchangeRateMap(db),
    loadValuationFxRates(db),
    db
      .collection<Corporation>("corporations")
      .find(
        { "shareholders.characterId": { $in: characterIds } },
        { projection: { shareholders: 1, sharePrice: 1, liquidCurrencyCode: 1 } }
      )
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find(
        { "holders.characterId": { $in: characterIds } },
        { projection: { holders: 1, marketPrice: 1, currencyCode: 1 } }
      )
      .toArray(),
    db
      .collection<IndexFundPosition>("indexFundPositions")
      .find(
        { holderKind: "character", characterId: { $in: characterIds } },
        { projection: { fundId: 1, characterId: 1, units: 1 } }
      )
      .toArray(),
  ]);

  const wanted = new Set(characterIds.map((id) => id.toString()));
  const holdings = new Map<string, number>();
  for (const corp of corps) {
    const rate = fxRateForCorpFromMap(corp, fx);
    for (const h of corp.shareholders ?? []) {
      const id = h.characterId?.toString();
      if (!id || !wanted.has(id) || (h.shares ?? 0) <= 0) continue;
      add(holdings, id, shareTradeAnchorValue(h.shares, corp, rate));
    }
  }
  for (const bond of bonds) {
    const rate = bond.currencyCode ? (fx.get(bond.currencyCode) ?? 1) : 1;
    for (const h of bond.holders ?? []) {
      const id = h.characterId?.toString();
      if (!id || !wanted.has(id) || (h.units ?? 0) <= 0) continue;
      const local = h.units * BOND_UNIT_FACE_VALUE * (bond.marketPrice ?? 1);
      add(holdings, id, corpCapitalToAnchor(local, bond.currencyCode, rate));
    }
  }
  if (positions.length > 0) {
    const funds = await db
      .collection<IndexFund>("indexFunds")
      .find(
        { _id: { $in: [...new Set(positions.map((p) => p.fundId))] } },
        { projection: { quotedNav: 1 } }
      )
      .toArray();
    const nav = new Map(funds.map((f) => [f._id.toString(), f.quotedNav ?? 0]));
    for (const p of positions) {
      const id = p.characterId?.toString();
      if (!id || (p.units ?? 0) <= 0) continue;
      add(holdings, id, p.units * (nav.get(p.fundId.toString()) ?? 0));
    }
  }

  for (const c of characters) {
    const id = c._id.toString();
    const home = getHomeCurrency(c);
    const cash = c.currencyBalances?.personal?.[home] ?? c.cashOnHand ?? 0;
    const savings = c.currencyBalances?.savings?.[home] ?? c.savingsOnHand ?? 0;
    const rateDoc = getRateDoc(rateMap, c.countryId);
    out.set(
      id,
      toInternalAmount(cash, rateDoc) + toInternalAmount(savings, rateDoc) + (holdings.get(id) ?? 0)
    );
  }
  return out;
}

/** Inflows that are not growth: wires received and loan principal, less loan repayments. */
const INFLOW_SIGN: Record<string, 1 | -1> = {
  wire_transfer_in: 1,
  bank_loan_origination: 1,
  bank_loan_repayment: -1,
};

/** External money each character received in (since, until], in ₳. */
export async function loadExternalInflows(
  db: Db,
  characterIds: ObjectId[],
  since: Date,
  until: Date
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (characterIds.length === 0) return totals;
  const [rows, fx] = await Promise.all([
    db
      .collection("financialTxLog")
      .find(
        {
          type: { $in: Object.keys(INFLOW_SIGN) },
          subjectType: "character",
          subjectId: { $in: characterIds },
          createdAt: { $gt: since, $lte: until },
        },
        {
          projection: {
            type: 1,
            subjectId: 1,
            amount: 1,
            currencyCode: 1,
            anchorAmount: 1,
            "meta.wireAnchorAmount": 1,
          },
        }
      )
      .toArray(),
    loadValuationFxRates(db),
  ]);
  for (const row of rows) {
    const sign = INFLOW_SIGN[String(row.type)] ?? 0;
    const amount = Math.abs(typeof row.amount === "number" ? row.amount : 0);
    const anchor =
      typeof row.anchorAmount === "number"
        ? Math.abs(row.anchorAmount)
        : typeof row.meta?.wireAnchorAmount === "number"
          ? Math.abs(row.meta.wireAnchorAmount)
          : corpCapitalToAnchor(
              amount,
              row.currencyCode,
              fx.get(row.currencyCode as CurrencyCode) ?? 1
            );
    add(totals, String(row.subjectId), sign * anchor);
  }
  return totals;
}
