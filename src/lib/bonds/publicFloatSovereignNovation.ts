/**
 * Reserves and atomically exchanges eligible public-float debt at par before
 * the funded maturity path pays only the frozen residual cash claim.
 */
import { type Db } from "mongodb";
import type { Bond, CentralBank } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, type BondMaturityTurns } from "@/lib/db/types/bond";
import { getBankId } from "@/lib/centralBank/helpers";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import type { FederalBudget } from "@/lib/db/types";
import { readPoolForPrimary } from "@/lib/bonds/primaryMarket";
import { planPublicFloatNovation } from "@/lib/bonds/rules/publicFloatNovation";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { primaryDocumentId } from "./sovereignPrimarySettlement";

type MaturityClaim = NonNullable<Bond["sovereignMaturityClaim"]>;
type Disposition = NonNullable<MaturityClaim["publicFloatDisposition"]>;

const REPLACEMENT_MATURITY: BondMaturityTurns = 48;

function nationalBudgetId(countryId: CountryId): string {
  return countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId;
}

async function freezeDisposition(
  db: Db,
  bond: Bond,
  claim: MaturityClaim,
  turn: number,
  allowNovation: boolean,
  now: Date
): Promise<MaturityClaim> {
  if (claim.publicFloatDisposition) return claim;
  const countryId = bond.countryId;
  const [pool, centralBank, budget] = await Promise.all([
    readPoolForPrimary(db, claim.currencyCode),
    countryId
      ? db
          .collection<CentralBank>("centralBanks")
          .findOne({ _id: getBankId(countryId) }, { projection: { primeRate: 1 } })
      : Promise.resolve(null),
    countryId
      ? db.collection<FederalBudget>("federalBudget").findOne({ _id: nationalBudgetId(countryId) })
      : Promise.resolve(null),
  ]);
  const budgetCurrencyCode = countryId
    ? ((budget ? resolveCountryCurrencyCode(budget) : null) ??
      COUNTRY_CURRENCY_MAP[countryId] ??
      null)
    : null;
  const primeRate =
    centralBank?.primeRate ??
    (countryId ? getCountryConfig(countryId).centralBank.defaultPrimeRate : NaN);
  const couponRate = Number.isFinite(primeRate) ? Math.round(primeRate * 100) / 100 : NaN;
  const plan = planPublicFloatNovation({
    sourceUnits: claim.sourcePublicFloat,
    sourceCurrency: claim.currencyCode,
    replacementCurrency: claim.currencyCode,
    sourceFacePerUnitLocal: BOND_UNIT_FACE_VALUE,
    replacementPricePerUnitLocal: BOND_UNIT_FACE_VALUE,
    appetite: countryId ? pool?.appetiteByCountry?.[countryId] : undefined,
    maturityTurns: REPLACEMENT_MATURITY,
    sourceHaircutPercent: bond.restructureHaircutPercent,
  });
  const canNovate =
    allowNovation &&
    plan.acceptedUnits > 0 &&
    plan.acceptedUnits * BOND_UNIT_FACE_VALUE <= bond.totalIssued &&
    Number.isSafeInteger(bond.totalIssued) &&
    Number.isFinite(bond.couponRate) &&
    Number.isFinite(couponRate) &&
    !!bond.countryId &&
    !!bond.issuerName &&
    !!bond.corporationId &&
    !!budget &&
    budget.countryId === countryId &&
    budgetCurrencyCode === claim.currencyCode &&
    (!bond.currencyCode || bond.currencyCode === budgetCurrencyCode);
  const disposition: Disposition = canNovate
    ? {
        mode: "novation",
        status: "reserved",
        acceptedUnits: plan.acceptedUnits,
        sourceCountryId: countryId!,
        sourceIssuerName: bond.issuerName!,
        sourceCorporationId: bond.corporationId!,
        sourceCurrencyCode: bond.currencyCode ?? null,
        sourceTotalIssued: bond.totalIssued,
        sourceCouponRate: bond.couponRate,
        sourceRestructureHaircutPercent: bond.restructureHaircutPercent ?? null,
        budgetId: nationalBudgetId(countryId!),
        budgetCountryId: budget!.countryId,
        budgetCurrencyCode: (budget?.currencyCode as CurrencyCode | undefined) ?? null,
        novationTurn: turn,
        reservedAt: now,
        replacementIssuerName: bond.issuerName!,
        replacementCorporationId: bond.corporationId!,
        replacementCountryId: countryId!,
        replacementBondId: primaryDocumentId(`${claim.id}:public-float-novation`),
        replacementMaturityTurns: REPLACEMENT_MATURITY,
        replacementCouponRate: couponRate,
        residualAmountLocal: Math.max(
          0,
          claim.amountLocal - plan.acceptedUnits * BOND_UNIT_FACE_VALUE
        ),
      }
    : {
        mode: "cash",
        status: "refused",
        acceptedUnits: 0,
        refusal: allowNovation
          ? (plan.refusal ?? "invalid_replacement_coupon")
          : "existing_maturity_funding",
      };
  await db.collection<Bond>("bonds").updateOne(
    {
      _id: bond._id,
      "sovereignMaturityClaim.id": claim.id,
      "sovereignMaturityClaim.publicFloatDisposition": { $exists: false },
    },
    { $set: { "sovereignMaturityClaim.publicFloatDisposition": disposition, updatedAt: now } }
  );
  const saved = await db
    .collection<Bond>("bonds")
    .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
  const frozen = saved?.sovereignMaturityClaim;
  if (!frozen || frozen.id !== claim.id || !frozen.publicFloatDisposition)
    throw new Error("Sovereign maturity disposition could not be frozen");
  return frozen;
}

async function applyDisposition(
  db: Db,
  bond: Bond,
  claim: MaturityClaim,
  client?: import("mongodb").MongoClient
): Promise<MaturityClaim> {
  const disposition = claim.publicFloatDisposition;
  if (!disposition || disposition.mode !== "novation") return claim;
  if (disposition.status === "applied") {
    const remainingIssued =
      disposition.sourceTotalIssued - disposition.acceptedUnits * BOND_UNIT_FACE_VALUE;
    const remainingFloat = claim.sourcePublicFloat - disposition.acceptedUnits;
    const sourceCurrencyFilter =
      disposition.sourceCurrencyCode === null
        ? { currencyCode: { $exists: false } }
        : { currencyCode: disposition.sourceCurrencyCode };
    const sourceHaircutFilter =
      disposition.sourceRestructureHaircutPercent === null
        ? { restructureHaircutPercent: null }
        : { restructureHaircutPercent: disposition.sourceRestructureHaircutPercent };
    const source = await db.collection<Bond>("bonds").findOne({
      _id: bond._id,
      issuerType: "sovereign",
      countryId: disposition.sourceCountryId,
      issuerName: disposition.sourceIssuerName,
      corporationId: disposition.sourceCorporationId,
      couponRate: disposition.sourceCouponRate,
      ...sourceCurrencyFilter,
      ...sourceHaircutFilter,
      totalIssued: remainingIssued,
      publicFloat: remainingFloat,
      "sovereignMaturityClaim.id": claim.id,
      "sovereignMaturityClaim.publicFloatDisposition.status": "applied",
    });
    if (!source)
      throw new Error(
        "Applied public-float novation source identity changed before maturity payout"
      );
    return claim;
  }
  if (
    disposition.status !== "reserved" ||
    !disposition.replacementBondId ||
    !Number.isFinite(disposition.replacementCouponRate) ||
    !Number.isSafeInteger(disposition.sourceTotalIssued) ||
    !Number.isFinite(disposition.sourceCouponRate) ||
    !Number.isSafeInteger(disposition.novationTurn) ||
    !(disposition.reservedAt instanceof Date) ||
    !disposition.replacementIssuerName ||
    !disposition.replacementCorporationId ||
    !disposition.replacementCountryId ||
    !disposition.sourceCountryId ||
    !disposition.sourceIssuerName ||
    !disposition.sourceCorporationId ||
    !disposition.budgetId ||
    !disposition.budgetCountryId
  )
    return claim;
  const units = disposition.acceptedUnits;
  const face = units * BOND_UNIT_FACE_VALUE;
  const sourceTotalIssued = disposition.sourceTotalIssued;
  const remainingIssued = sourceTotalIssued - face;
  const remainingFloat = claim.sourcePublicFloat - units;
  if (
    !Number.isSafeInteger(units) ||
    units <= 0 ||
    remainingIssued < 0 ||
    remainingFloat < 0 ||
    remainingIssued % BOND_UNIT_FACE_VALUE !== 0
  )
    throw new Error("Frozen public-float novation exceeds source principal");
  const couponDelta =
    ((disposition.replacementCouponRate - disposition.sourceCouponRate) / 100) * face;
  const replacement: Omit<Bond, "_id"> = {
    issuerType: "sovereign",
    corporationId: disposition.replacementCorporationId,
    countryId: disposition.replacementCountryId,
    issuerName: disposition.replacementIssuerName,
    faceValue: BOND_UNIT_FACE_VALUE,
    couponRate: disposition.replacementCouponRate,
    maturityTurns: disposition.replacementMaturityTurns,
    issuedAtTurn: disposition.novationTurn,
    maturityTurn: disposition.novationTurn + disposition.replacementMaturityTurns,
    marketPrice: 1,
    totalIssued: face,
    publicFloat: units,
    holders: [],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    restructureHaircutPercent: null,
    restructureExtendedMaturityTurn: null,
    originalMaturityTurn: null,
    originalTotalIssued: null,
    currencyCode: claim.currencyCode,
    createdAt: disposition.reservedAt,
    updatedAt: disposition.reservedAt,
  };
  try {
    await runRequiredTransaction(
      async (session) => {
        const inserted = await db
          .collection<Bond>("bonds")
          .insertOne({ _id: disposition.replacementBondId!, ...replacement } as Bond, { session });
        void inserted;
        const sourceUpdate = await db.collection<Bond>("bonds").updateOne(
          {
            _id: bond._id,
            issuerType: "sovereign",
            maturityTurn: claim.dueTurn,
            countryId: disposition.sourceCountryId,
            issuerName: disposition.sourceIssuerName,
            corporationId: disposition.sourceCorporationId,
            totalIssued: sourceTotalIssued,
            publicFloat: claim.sourcePublicFloat,
            couponRate: disposition.sourceCouponRate,
            ...(disposition.sourceCurrencyCode === null
              ? { currencyCode: { $exists: false } }
              : { currencyCode: disposition.sourceCurrencyCode }),
            ...(disposition.sourceRestructureHaircutPercent === null
              ? { restructureHaircutPercent: null }
              : { restructureHaircutPercent: disposition.sourceRestructureHaircutPercent }),
            "sovereignMaturityClaim.id": claim.id,
            "sovereignMaturityClaim.publicFloatDisposition.status": "reserved",
          },
          {
            $inc: { totalIssued: -face, publicFloat: -units },
            $set: { updatedAt: disposition.reservedAt },
          },
          { session }
        );
        if (sourceUpdate.matchedCount !== 1)
          throw new Error("Sovereign public-float source changed before novation commit");
        const budgetUpdate = await db.collection<FederalBudget>("federalBudget").updateOne(
          {
            _id: disposition.budgetId,
            countryId: disposition.budgetCountryId,
            ...(disposition.budgetCurrencyCode === null
              ? { currencyCode: { $exists: false } }
              : { currencyCode: disposition.budgetCurrencyCode }),
          },
          {
            $inc: {
              "spending.debtInterest": couponDelta,
              "spending.total": couponDelta,
              surplus: -couponDelta,
            },
            $set: { updatedAt: disposition.reservedAt },
          },
          { session }
        );
        if (budgetUpdate.matchedCount !== 1)
          throw new Error("Sovereign budget disappeared before public-float novation commit");
        const claimUpdate = await db.collection<Bond>("bonds").updateOne(
          {
            _id: bond._id,
            "sovereignMaturityClaim.id": claim.id,
            "sovereignMaturityClaim.publicFloatDisposition.status": "reserved",
          },
          {
            $set: {
              "sovereignMaturityClaim.publicFloatDisposition.status": "applied",
              updatedAt: disposition.reservedAt,
            },
          },
          { session }
        );
        if (claimUpdate.matchedCount !== 1)
          throw new Error("Sovereign public-float disposition changed during transaction");
      },
      { client }
    );
  } catch (error) {
    const latest = await db
      .collection<Bond>("bonds")
      .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
    const latestClaim = latest?.sovereignMaturityClaim;
    if (latestClaim?.id !== claim.id || latestClaim.publicFloatDisposition?.status !== "applied")
      throw error;
  }
  const saved = await db
    .collection<Bond>("bonds")
    .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
  const applied = saved?.sovereignMaturityClaim;
  if (!applied || applied.id !== claim.id || applied.publicFloatDisposition?.status !== "applied")
    throw new Error("Public-float novation receipt did not publish after settlement");
  return applied;
}

/** Reserve and complete the pool-owned stock exchange before ordinary maturity can pay. */
export async function settleSovereignPublicFloatDisposition(
  db: Db,
  bond: Bond,
  claim: MaturityClaim,
  turn: number,
  now: Date,
  allowNovation = true,
  client?: import("mongodb").MongoClient
): Promise<MaturityClaim> {
  const frozen = await freezeDisposition(db, bond, claim, turn, allowNovation, now);
  return applyDisposition(db, bond, frozen, client);
}
