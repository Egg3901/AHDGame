import type { Db, Document, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  COUNTRY_CURRENCY_MAP,
  getInitialRates,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import {
  currencyConversionScale,
  currencyForCountryAtYear,
  euroMembersAtYear,
} from "@/lib/currency/rules/eraCurrency";
import {
  redenominateFederalBudget,
  redenominateStateBudget,
} from "@/lib/currency/rules/redenominate";
import { convertCorpCurrency } from "@/lib/corporations/convertCorpCurrency";

type AnyDoc = Document & { _id: ObjectId | string; countryId: string };

/**
 * Apply an era's currency union after every economic seed has run. This shell
 * owns database IO; denomination math lives in currency/rules. It is safe on a
 * fresh/reset world and idempotent because documents already stamped EUR are
 * skipped rather than scaled twice.
 */
export async function applyEraCurrencyTopology(
  db: Db,
  preset: string,
  log: (message: string) => void
): Promise<void> {
  const year = getStartingYearForPreset(preset);
  const members = euroMembersAtYear(year);
  if (members.length === 0) return;

  const rates = getInitialRates(preset);
  const eurRate = rates.DE;
  if (eurRate === undefined || eurRate <= 0) {
    throw new Error(`Cannot apply ${year} euro topology: missing EUR anchor rate`);
  }
  const fxByCurrency = new Map<CurrencyCode, number>();
  for (const [countryId, currencyCode] of Object.entries(COUNTRY_CURRENCY_MAP)) {
    const rate = rates[countryId as keyof typeof rates];
    if (rate !== undefined && rate > 0 && !fxByCurrency.has(currencyCode)) {
      fxByCurrency.set(currencyCode, rate);
    }
  }
  fxByCurrency.set("EUR", eurRate);

  let convertedCountries = 0;
  for (const countryId of members) {
    const legacyCurrency = COUNTRY_CURRENCY_MAP[countryId];
    if (currencyForCountryAtYear(countryId, year, legacyCurrency) !== "EUR") continue;
    const legacyRate = rates[countryId];
    if (legacyRate === undefined || legacyRate <= 0) {
      throw new Error(`Cannot redenominate ${countryId}: missing ${legacyCurrency} rate`);
    }
    const scale = currencyConversionScale(legacyRate, eurRate);

    const budget = (await db.collection("federalBudget").findOne({ countryId })) as AnyDoc | null;
    const needsFiscalConversion = budget?.currencyCode !== "EUR";
    if (budget && needsFiscalConversion) {
      await db.collection<AnyDoc>("federalBudget").updateOne(
        { _id: budget._id },
        {
          $set: {
            ...redenominateFederalBudget(budget as never, scale),
            currencyCode: "EUR",
            updatedAt: new Date(),
          },
        }
      );
    }

    const stateBudgets = (await db
      .collection("stateBudgets")
      .find({ countryId })
      .toArray()) as AnyDoc[];
    if (stateBudgets.length > 0 && needsFiscalConversion) {
      await db.collection<AnyDoc>("stateBudgets").bulkWrite(
        stateBudgets.map((doc) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: { ...redenominateStateBudget(doc as never, scale), updatedAt: new Date() },
            },
          },
        }))
      );
      await db.collection("states").updateMany({ countryId }, { $mul: { gdp: scale } });
    }

    if (needsFiscalConversion) {
      for (const collection of ["politicalParties", "statePartyOrg"] as const) {
        await db.collection(collection).updateMany({ countryId }, { $mul: { treasury: scale } });
      }
    }

    const npps = (await db
      .collection("npps")
      .find({ countryId, [`currencyBalances.personal.${legacyCurrency}`]: { $exists: true } })
      .project({ currencyBalances: 1 })
      .toArray()) as Document[];
    if (npps.length > 0) {
      await db.collection("npps").bulkWrite(
        npps.map((npp) => ({
          updateOne: {
            filter: { _id: npp._id },
            update: {
              $set: {
                "currencyBalances.personal.EUR":
                  Number(npp.currencyBalances?.personal?.[legacyCurrency] ?? 0) * scale,
                updatedAt: new Date(),
              },
              $unset: { [`currencyBalances.personal.${legacyCurrency}`]: "" },
            },
          },
        }))
      );
    }

    const corporations = await db
      .collection<Corporation>("corporations")
      .find({ countryId })
      .toArray();
    for (const corporation of corporations) {
      if (corporation.liquidCurrencyCode === "EUR") continue;
      const result = await convertCorpCurrency(
        db,
        corporation,
        "EUR",
        fxByCurrency,
        new Date(),
        true
      );
      if (!result.ok)
        throw new Error(`Cannot redenominate ${countryId} corporation: ${result.error}`);
    }

    const bonds = (await db
      .collection("bonds")
      .find({ countryId, currencyCode: { $ne: "EUR" } })
      .toArray()) as Document[];
    if (bonds.length > 0) {
      await db.collection("bonds").bulkWrite(
        bonds.map((bond) => ({
          updateOne: {
            filter: { _id: bond._id },
            update: {
              $set: {
                currencyCode: "EUR",
                faceValue: Number(bond.faceValue ?? 0) * scale,
                totalIssued: Number(bond.totalIssued ?? 0) * scale,
                ...(bond.originalTotalIssued == null
                  ? {}
                  : { originalTotalIssued: Number(bond.originalTotalIssued) * scale }),
                holders: Array.isArray(bond.holders)
                  ? bond.holders.map((holder: Document) => ({
                      ...holder,
                      ...(holder.avgCostPerUnit == null
                        ? {}
                        : { avgCostPerUnit: Number(holder.avgCostPerUnit) * scale }),
                    }))
                  : [],
                updatedAt: new Date(),
              },
            },
          },
        }))
      );
    }

    await db.collection<Document & { _id: string }>("exchangeRates").updateOne(
      { _id: countryId },
      {
        $set: {
          currencyCode: "EUR",
          rate: eurRate,
          baseRate: eurRate,
          macroTarget: eurRate,
          updatedAt: new Date(),
        },
      }
    );
    convertedCountries++;
  }

  log(
    `Applied ${year} EUR topology to ${convertedCountries} countr${convertedCountries === 1 ? "y" : "ies"}`
  );
}
