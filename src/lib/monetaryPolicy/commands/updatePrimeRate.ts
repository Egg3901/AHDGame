import { ObjectId, type Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import type { CentralBank } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import { resolveJurisdiction } from "@/lib/monetaryGovernance/jurisdiction";
import {
  bankToJurisdictionState,
  materializeTransitionSet,
  type RateHistoryAppend,
} from "@/lib/monetaryGovernance/governanceShell";
import { decideGovernance } from "@/lib/monetaryGovernance/rules/machine";
import type { GovernanceActor } from "@/lib/monetaryGovernance/rules/types";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";
import { isNationalIssuer } from "@/lib/extraction/contractIssuerAuth";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { FxRegime } from "@/lib/currency/exchangeRateRegime";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";

type PrimeRateActor = {
  userId: string;
  username?: string | null;
  isAdmin?: boolean;
  character?: {
    _id: ObjectId;
    name?: string | null;
  } | null;
};

export async function updatePrimeRate(params: {
  db: Db;
  countryId: CountryId;
  actor: PrimeRateActor;
  rate: number;
  reason?: string;
  currentTurn: number;
}) {
  const result = await updatePrimeRateInner(params);
  const bankId = getBankId(params.countryId);
  emitBankingAuditEvent(
    {
      kind: "policy.rate_changed",
      command: "monetary.rate.set",
      turn: params.currentTurn,
      outcome: result.ok ? "ok" : "rejected",
      ...(result.ok ? {} : { reason: describeError(result.error) }),
      actorClass: params.actor.isAdmin ? "admin" : "player",
      currency: COUNTRY_CURRENCY_MAP[params.countryId],
      bankId,
      subjectType: "centralBank",
      subjectId: bankId,
      ...(result.ok
        ? { statusBefore: String(result.previousRate), statusAfter: String(result.primeRate) }
        : { statusAfter: String(params.rate) }),
      meta: result.ok
        ? {
            previousRate: result.previousRate,
            newRate: result.primeRate,
            scrutinyApplied: result.scrutinyApplied,
            interferenceApplied: result.interferenceApplied,
          }
        : { requestedRate: params.rate, status: result.status },
    },
    params.db
  );
  return result;
}

function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

async function updatePrimeRateInner(params: {
  db: Db;
  countryId: CountryId;
  actor: PrimeRateActor;
  rate: number;
  reason?: string;
  currentTurn: number;
}) {
  const { db, countryId, actor, rate, reason, currentTurn } = params;
  // Canonical jurisdiction: a shared-currency bank has one authoritative
  // document and the URL's country is only a viewpoint onto it.
  const jurisdiction = await resolveJurisdiction(db, countryId);
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: jurisdiction.institutionId });
  if (!bank) {
    return { ok: false as const, status: 404, error: "Central bank not found" };
  }

  const myChar = actor.character ?? null;
  const isChair = !!myChar && !!bank.chairCharacterId && myChar._id.equals(bank.chairCharacterId);
  const isAdmin = actor.isAdmin === true;

  // Governance keys on the jurisdiction's ANCHOR country (a sterlingized SCO
  // reaches the same BoE doc through its own URL), and authority belongs to
  // that home country's government too.
  const bankHomeCountryId = jurisdiction.anchorCountryId;
  const governmentControlled = await isBankGovernmentControlledLive(bank, bankHomeCountryId);
  const isGovernment =
    governmentControlled && !!myChar && (await isNationalIssuer(db, bankHomeCountryId, myChar._id));

  // B6, the impossible trinity, feeds the machine as plain data. An active
  // intervention band counts as a commitment even when the regime field was
  // never set: the promise to defend a corridor is the commitment.
  let fxCommitment: { regime: "float" | "peg" | "band"; capitalControls: boolean } | null = null;
  if (!isAdmin) {
    const fxDoc = await db
      .collection<ExchangeRate>("exchangeRates")
      .findOne(
        { countryId },
        { projection: { fxRegime: 1, capitalControls: 1, interventionPolicy: 1 } }
      );
    if (fxDoc) {
      const regime: FxRegime = fxDoc.fxRegime ?? (fxDoc.interventionPolicy ? "band" : "float");
      fxCommitment = { regime, capitalControls: fxDoc.capitalControls === true };
    }
  }

  // Thin shell over the governance machine: the machine owns authority,
  // committee and FX gates, grid normalization, caps, cooldown and deltas.
  const machineActor: GovernanceActor = {
    kind: isAdmin ? "admin" : isGovernment ? "government" : isChair ? "chair" : "governor",
    ...(myChar ? { characterId: myChar._id.toString() } : {}),
    countryId: bankHomeCountryId,
  };
  const now = new Date();
  const decision = decideGovernance(
    bankToJurisdictionState(bank, {
      jurisdiction,
      governmentControlled,
      fxCommitment,
      commandEconomy: false,
    }),
    { type: "set_rate", rate, countryId },
    machineActor,
    { turn: currentTurn, now: now.getTime(), currentYear: null }
  );
  if (!decision.allowed) {
    return {
      ok: false as const,
      status: statusForReason(decision.reason),
      error: messageForRefusal({
        reason: decision.reason,
        message: decision.message,
        governmentControlled,
        isChair,
        countryId,
      }),
    };
  }

  const changedByName =
    isAdmin && !isChair
      ? `${myChar?.name ?? actor.username ?? "Admin"} (admin)`
      : (myChar?.name ?? actor.username ?? "Unknown");
  const append = decision.transition.set.rateHistoryAppend as RateHistoryAppend;
  if (append) {
    append.changedBy = myChar ? myChar._id.toString() : actor.userId;
    append.changedByName = changedByName;
    if (reason) append.reason = reason;
    else delete append.reason;
  }
  const set = materializeTransitionSet(bank, decision.transition, now);
  set.updatedAt = now;
  await db.collection<CentralBank>("centralBanks").updateOne({ _id: bank._id }, { $set: set });

  const rateEvent = decision.transition.events.find((e) => e.kind === "policy.rate_changed");
  const previousRate = bank.primeRate;
  return {
    ok: true as const,
    bankId: bank._id,
    previousRate,
    changedByName,
    reason,
    primeRate: decision.next.primeRate,
    scrutinyApplied: rateEvent?.meta?.scrutinyApplied === true,
    interferenceApplied: rateEvent?.meta?.interferenceApplied === true,
  };
}

function statusForReason(reason: string): number {
  if (reason === "not-member" || reason === "not-authorized" || reason === "locked") return 403;
  if (
    reason === "committee-decides" ||
    reason === "fx-committed" ||
    reason === "command-economy" ||
    reason === "government-controlled"
  ) {
    return 409;
  }
  if (reason === "no-such-seat") return 404;
  return 400;
}

function messageForRefusal(params: {
  reason: string;
  message: string;
  governmentControlled: boolean;
  isChair: boolean;
  countryId: CountryId;
}): string {
  // A sidelined chair keeps the message that names the way back: independence
  // takes an act of the legislature.
  if (params.reason === "not-authorized" && params.governmentControlled && params.isChair) {
    const bankName = COUNTRY_CONFIGS[params.countryId]?.centralBank.name ?? "central bank";
    return forbidden(
      `The ${bankName} has no operational independence: the government sets the rate. Independence would take an act of the legislature.`
    ).toJson().error;
  }
  if (params.reason === "not-authorized" && params.governmentControlled) {
    return forbidden(
      "Only the head of government or the finance minister can adjust the rate here."
    ).toJson().error;
  }
  if (params.reason === "not-authorized" || params.reason === "locked") {
    return forbidden(params.message).toJson().error;
  }
  return params.message;
}
