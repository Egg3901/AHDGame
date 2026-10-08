/**
 * Atomic forced rollover of a matured sovereign bond's pool holding when the
 * Treasury cannot fund the cash claim. The old bond sheds the pool's units and
 * face, a new par bond carries them, and the frozen maturity claim is rebased
 * by the same amount so the ordinary funded payout only settles what remains.
 * Debt principal and Treasury cash are untouched by the exchange itself.
 */
import { type Db } from "mongodb";
import type { Bond, FederalBudget } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, type BondMaturityTurns } from "@/lib/db/types/bond";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { planForcedPoolRollover } from "./rules/forcedSovereignRollover";
import { primaryDocumentId } from "./sovereignPrimarySettlement";

type MaturityClaim = NonNullable<Bond["sovereignMaturityClaim"]>;

export const FORCED_ROLLOVER_MATURITY: BondMaturityTurns = 48;

/**
 * Returns true when this call or an earlier attempt landed the exchange.
 * Replays are safe: the claim carries a one-shot receipt and the replacement
 * id is derived from the claim id.
 */
export async function rollOverUnfundedSovereignPoolFloat(
  db: Db,
  input: {
    bond: Bond;
    claim: MaturityClaim;
    turn: number;
    now: Date;
    couponRate: number;
    budgetId: string;
    client?: import("mongodb").MongoClient;
  }
): Promise<boolean> {
  const { bond, claim, turn, now, couponRate, budgetId, client } = input;
  if (claim.forcedRollover) return true;
  const countryId = bond.countryId;
  const disposition = claim.publicFloatDisposition;
  if (
    !countryId ||
    !bond.issuerName ||
    !bond.corporationId ||
    !Number.isFinite(couponRate) ||
    !Number.isFinite(bond.couponRate) ||
    claim.escrowLocal !== 0 ||
    claim.fundingAttemptTurn !== undefined ||
    claim.paid ||
    (bond.restructureHaircutPercent != null && bond.restructureHaircutPercent !== 0) ||
    (disposition?.mode === "novation" && disposition.status !== "applied")
  )
    return false;

  const novatedUnits = disposition?.mode === "novation" ? disposition.acceptedUnits : 0;
  // A trade after the quote froze would break the payout's stock identity.
  if (bond.publicFloat !== claim.sourcePublicFloat - novatedUnits) return false;
  const poolLegIndex = claim.holderLegs.findIndex(
    (leg) => leg.collection === "bondMarketPools" && String(leg.filter._id) === claim.currencyCode
  );
  if (poolLegIndex < 0) return false;
  const poolLeg = claim.holderLegs[poolLegIndex]!;
  const plan = planForcedPoolRollover({
    liveFloatUnits: bond.publicFloat,
    liveTotalIssued: bond.totalIssued,
    poolLegAmount: poolLeg.amount,
    novatedUnits,
  });
  if (plan.refusal) return false;

  const { units, faceLocal } = plan;
  const sourceCouponRate =
    disposition?.mode === "novation" ? disposition.sourceCouponRate : bond.couponRate;
  const couponDelta = ((couponRate - sourceCouponRate) / 100) * faceLocal;
  const replacementId = primaryDocumentId(`${claim.id}:forced-rollover`);
  const holderLegs = claim.holderLegs.map((leg, index) =>
    index === poolLegIndex ? { ...leg, amount: leg.amount - faceLocal } : leg
  );
  const replacement: Omit<Bond, "_id"> = {
    issuerType: "sovereign",
    corporationId: bond.corporationId,
    countryId,
    issuerName: bond.issuerName,
    faceValue: BOND_UNIT_FACE_VALUE,
    couponRate,
    maturityTurns: FORCED_ROLLOVER_MATURITY,
    issuedAtTurn: turn,
    maturityTurn: turn + FORCED_ROLLOVER_MATURITY,
    marketPrice: 1,
    totalIssued: faceLocal,
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
    createdAt: now,
    updatedAt: now,
  };

  try {
    await runRequiredTransaction(
      async (session) => {
        await db
          .collection<Bond>("bonds")
          .insertOne({ _id: replacementId, ...replacement } as Bond, { session });
        const source = await db.collection<Bond>("bonds").updateOne(
          {
            _id: bond._id,
            issuerType: "sovereign",
            countryId,
            matured: false,
            defaulted: false,
            maturityTurn: claim.dueTurn,
            totalIssued: bond.totalIssued,
            publicFloat: bond.publicFloat,
            "sovereignMaturityClaim.id": claim.id,
            "sovereignMaturityClaim.escrowLocal": 0,
            "sovereignMaturityClaim.fundingAttemptTurn": { $exists: false },
            "sovereignMaturityClaim.forcedRollover": { $exists: false },
          },
          {
            $inc: {
              totalIssued: -faceLocal,
              publicFloat: -units,
              "sovereignMaturityClaim.amountLocal": -faceLocal,
              "sovereignMaturityClaim.sourcePublicFloat": -units,
              ...(disposition?.mode === "novation"
                ? {
                    "sovereignMaturityClaim.publicFloatDisposition.sourceTotalIssued": -faceLocal,
                    "sovereignMaturityClaim.publicFloatDisposition.residualAmountLocal": -faceLocal,
                  }
                : {}),
            },
            $set: {
              "sovereignMaturityClaim.holderLegs": holderLegs,
              "sovereignMaturityClaim.forcedRollover": {
                replacementBondId: replacementId,
                units,
                faceLocal,
                replacementCouponRate: couponRate,
                replacementMaturityTurns: FORCED_ROLLOVER_MATURITY,
                rolledAtTurn: turn,
              },
              updatedAt: now,
            },
          },
          { session }
        );
        if (source.matchedCount !== 1)
          throw new Error("Sovereign bond changed before forced rollover commit");
        const budget = await db.collection<FederalBudget>("federalBudget").updateOne(
          { _id: budgetId, countryId },
          {
            $inc: {
              "spending.debtInterest": couponDelta,
              "spending.total": couponDelta,
              surplus: -couponDelta,
            },
            $set: { updatedAt: now },
          },
          { session }
        );
        if (budget.matchedCount !== 1)
          throw new Error("Sovereign budget disappeared before forced rollover commit");
      },
      { client }
    );
  } catch (error) {
    const latest = await db
      .collection<Bond>("bonds")
      .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
    if (!latest?.sovereignMaturityClaim?.forcedRollover) throw error;
  }
  return true;
}
