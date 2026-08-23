import { getEraContext } from "@/lib/era/context";
import type { Db, ObjectId, Filter } from "mongodb";
import type { StateBudget } from "@/lib/db/types/budget";
import type { GovernorOfficeState } from "@/lib/db/types/governorOfficeState";
import type { ProspectingSurvey } from "@/lib/db/types/prospectingSurvey";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { getProspectingSurveysCollection } from "@/lib/db/collections/prospectingSurveys";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { emitTx } from "@/lib/financialTxLog/emit";
import { isNationalIssuer, isStateIssuer } from "@/lib/extraction/contractIssuerAuth";
import {
  prospectDurationTurns,
  PROSPECT_MAX_ACTIVE_PER_INITIATOR,
  prospectCostAnchor,
} from "@/lib/constants/prospecting";

export interface GovernmentProspectCosts {
  costAnchor: number;
  costLocal: number;
  currencyCode: CurrencyCode | string;
  priorSuccessCount: number;
}

export type LaunchGovernmentProspectResult =
  | { ok: true; status: 200; survey: ProspectingSurvey; costs: GovernmentProspectCosts }
  | { ok: false; status: number; error: string };

interface Actor {
  characterId: ObjectId;
  userId: string;
  isAdmin: boolean;
}

/**
 * Launch a government-funded geological survey.
 *
 * National level: pay from the federal treasury (rejects if the balance cannot
 * cover the cost). State level: spend 1 gubernatorial action point (atomic
 * guard) and book the cost to the persistent state-budget prospecting spend
 * line (states have no cash SSOT; the AP is the true gating resource).
 *
 * Caller handles auth (requireAuth) and the prospecting feature gate; this
 * command owns issuer authorization, eligibility, charging, tx emit, and insert.
 */
export async function launchGovernmentProspect(
  db: Db,
  args: {
    countryId: CountryId;
    stateId: string;
    resource: ExtractableResource;
    level: "national" | "state";
  },
  actor: Actor,
  turn: number,
  now: Date
): Promise<LaunchGovernmentProspectResult> {
  const { countryId, stateId, resource, level } = args;

  // Resource must be an enabled deposit in a state that belongs to the country.
  const capCol = await getStateResourceCapacityCollection(db);
  const cap = await capCol.findOne({ stateId, countryId });
  if (!cap) {
    return { ok: false, status: 400, error: "That state is not part of this country." };
  }
  if ((cap.resources?.[resource] ?? 0) <= 0) {
    return { ok: false, status: 400, error: "That resource is not extractable in this state." };
  }

  // Issuer authorization.
  const authorized = actor.isAdmin
    ? true
    : level === "national"
      ? await isNationalIssuer(db, countryId, actor.characterId)
      : await isStateIssuer(db, countryId, stateId, actor.characterId);
  if (!authorized) {
    return {
      ok: false,
      status: 403,
      error:
        level === "national"
          ? "Only the head of government or finance minister can fund a national survey."
          : "Only the state's governor can commission a survey.",
    };
  }

  const surveysCol = await getProspectingSurveysCollection(db);
  const initiatorType = level === "national" ? "national_government" : "state_government";

  // Max active surveys per government (national scope = country; state scope = state).
  const activeScope: Filter<ProspectingSurvey> =
    level === "national"
      ? { initiatorType, countryId, status: "active" }
      : { initiatorType, countryId, stateId, status: "active" };
  const activeCount = await surveysCol.countDocuments(activeScope);
  if (activeCount >= PROSPECT_MAX_ACTIVE_PER_INITIATOR) {
    return {
      ok: false,
      status: 409,
      error: `A government can run at most ${PROSPECT_MAX_ACTIVE_PER_INITIATOR} surveys at a time.`,
    };
  }

  // One active survey per (initiator, state, resource).
  const dup = await surveysCol.findOne({
    initiatorType,
    countryId,
    stateId,
    resource,
    status: "active",
  });
  if (dup) {
    return {
      ok: false,
      status: 409,
      error: "A survey for that resource is already underway here.",
    };
  }

  const priorSuccessCount = await surveysCol.countDocuments({
    stateId,
    resource,
    status: "succeeded",
  });
  const costAnchor = prospectCostAnchor(priorSuccessCount);
  const countryCode = COUNTRY_CURRENCY_MAP[countryId] as CurrencyCode | undefined;
  const fxByCurrency = await loadFxRatesByCurrency(db);
  const fxRate = countryCode ? (fxByCurrency.get(countryCode) ?? 1) : 1;
  const costLocal = Math.round(costAnchor * fxRate);

  if (level === "national") {
    // NO pre-check. `treasuryBalance` is the SIGNED national cash position, so
    // a negative balance IS the national debt and `balance < cost` refused every
    // survey for an already-indebted country. `spendFromTreasury` is built to
    // borrow — it splits the spend into fromSurplus and addedToDebt — and the
    // rest of the app spends into debt the same way.
    await spendFromTreasury(db, countryId, costLocal);
  } else {
    // Spend 1 gubernatorial action point atomically.
    const apSpend = await db
      .collection<GovernorOfficeState>("governorOfficeState")
      .updateOne(
        { countryId, stateId, gubernatorialActions: { $gte: 1 } },
        { $inc: { gubernatorialActions: -1 }, $set: { updatedAt: now } }
      );
    if (apSpend.modifiedCount === 0) {
      return { ok: false, status: 402, error: "Insufficient office action points." };
    }
    // Book the spend to the persistent state-budget prospecting line so it
    // survives the annual fiscal recompute (mirror of revenue.resourceRoyalties).
    await db.collection<StateBudget>("stateBudgets").updateOne(
      { _id: stateId, countryId },
      {
        $inc: { "spending.resourceProspecting": costLocal, "spending.total": costLocal },
        $set: { updatedAt: now },
      }
    );
  }

  void emitTx(db, {
    type: "govt_prospecting_cost",
    turn,
    createdAt: now,
    subjectType: "government",
    // countryId only for NATIONAL surveys: the ledger's government account is
    // backed by federalBudget.treasuryBalance (balanceSnapshot.ts), which only
    // the national spendFromTreasury path moves. A state-level survey spends
    // AP + a state-budget line (not ledger-backed), so its row stays in the
    // audit log but is not derived (subjectAccount returns null without
    // countryId) — booking it against the national account would drift the
    // government stock check.
    ...(level === "national" ? { countryId } : {}),
    subjectName: level === "national" ? countryId : stateId,
    amount: -costLocal,
    currencyCode: (countryCode ?? "USD") as CurrencyCode,
    anchorAmount: -costAnchor,
    meta: { stateId, resource, level, countryId },
  });

  const survey: ProspectingSurvey = {
    _id: undefined as never,
    initiatorType,
    initiatorUserId: actor.userId,
    countryId,
    stateId,
    resource,
    startedTurn: turn,
    // Era-scaled: a 1953 survey is paper seismic read over seasons, not a
    // digitally-processed one. Stamped at LAUNCH so a survey already in the
    // ground keeps the duration it was sold with, even if the clock rolls
    // into a new era before it resolves.
    completesTurn: turn + prospectDurationTurns((await getEraContext(db)).year),
    costAnchor,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  const insert = await surveysCol.insertOne(survey);
  survey._id = insert.insertedId;

  return {
    ok: true,
    status: 200,
    survey,
    costs: { costAnchor, costLocal, currencyCode: countryCode ?? "USD", priorSuccessCount },
  };
}
