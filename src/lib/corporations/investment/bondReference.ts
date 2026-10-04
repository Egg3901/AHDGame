import type { Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import { ZOD_CURRENCY_ENUM } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { investmentBondReference } from "./rules";

/** One thin active-bond read on the capacity page, never a turn-phase loop. */
export async function loadInvestmentBondReference(
  db: Db,
  currencyCode: string | null | undefined,
  currentTurn: number
) {
  if (!currencyCode || !Number.isInteger(currentTurn)) return null;
  const currency = ZOD_CURRENCY_ENUM.find((code) => code === currencyCode);
  if (!currency) return null;
  const bond = await db.collection<Bond>("bonds").findOne(
    {
      issuerType: "sovereign",
      currencyCode: currency,
      matured: false,
      defaulted: false,
      publicFloat: { $gt: 0 },
      maturityTurn: { $gt: currentTurn, $lte: currentTurn + TURNS_PER_YEAR },
    },
    {
      projection: {
        _id: 0,
        couponRate: 1,
        marketPrice: 1,
        maturityTurn: 1,
        currencyCode: 1,
        issuerName: 1,
        countryId: 1,
      },
      sort: { maturityTurn: 1, _id: 1 },
    }
  );
  return investmentBondReference(bond, currencyCode, currentTurn);
}
