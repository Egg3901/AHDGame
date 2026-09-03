import { ObjectId, type Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import type { CentralBank } from "@/lib/db/types";
import {
  MAX_RATE_CHANGE_DELTA,
  MAX_RATE_CUT_DELTA,
  AGGRESSIVE_CUT_SCRUTINY,
  RATE_CHANGE_COOLDOWN_TURNS,
  RATE_CHANGES_PER_TERM,
  RATE_HISTORY_MAX,
} from "@/lib/db/types";
import { snapToPrimeRateGrid } from "@/lib/db/types/centralBank";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import { resolveJurisdiction } from "@/lib/monetaryGovernance/jurisdiction";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";
import { isNationalIssuer } from "@/lib/extraction/contractIssuerAuth";
import { INTERFERENCE_SCRUTINY } from "@/lib/centralBank/credibility";
import { boardCanCarryMotions } from "@/lib/centralBank/fomc";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import { rateChangeRefusal, type FxRegime } from "@/lib/currency/exchangeRateRegime";
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
  const chairLocked = bank.chairControlsLocked === true;
  const isAdmin = actor.isAdmin === true;

  // Government-controlled banks (the pre-1997 Bank of England): the rate is
  // set by the head of government or the finance seat, and the bank's own
  // chair has no rate authority. Independent banks: chair only, as before.
  // Governance keys on the jurisdiction's ANCHOR country (a sterlingized SCO
  // reaches the same BoE doc through its own URL), and authority belongs to
  // that home country's government too.
  const bankHomeCountryId = jurisdiction.anchorCountryId;
  const governmentControlled = await isBankGovernmentControlledLive(bank, bankHomeCountryId);
  if (governmentControlled) {
    const isGovernment = !!myChar && (await isNationalIssuer(db, bankHomeCountryId, myChar._id));
    if (!isAdmin && !isGovernment) {
      const bankName = COUNTRY_CONFIGS[countryId]?.centralBank.name ?? "central bank";
      return {
        ok: false as const,
        status: 403,
        error: forbidden(
          isChair
            ? `The ${bankName} has no operational independence: the government sets the rate. Independence would take an act of the legislature.`
            : "Only the head of government or the finance minister can adjust the rate here."
        ).toJson().error,
      };
    }
  } else if (!isAdmin && (!isChair || chairLocked)) {
    return {
      ok: false as const,
      status: 403,
      error: forbidden(
        chairLocked && isChair
          ? "Chair controls are locked by an administrator"
          : "Only the current chair can adjust the prime rate"
      ).toJson().error,
    };
  }

  // A seated committee is the rate authority: a board that can still carry a
  // motion leaves the rate to committee vote, so the chair's direct control is
  // gone and the card must send players to the committee room instead of a dead
  // POST. Admins keep the override for operational repair. But a board that has
  // decayed below the carry-a-motion threshold (fewer seated members than a
  // strict majority of the full board) is structurally dead: no motion can ever
  // pass, so the chair's direct authority returns until nominations restore a
  // working board (ticket #1238 follow-up).
  //
  // A government-controlled bank is exempt: its committee is dormant (the MPC
  // was created BY the independence grant, so a board doc on a government-
  // controlled bank is a leftover from before independence was revoked), and
  // `fomcMeetingTurn` already skips it for exactly that reason. Without the
  // exemption the Treasury would be refused here and sent to a committee tab
  // that `CentralBankClient` hides for government-controlled banks — a dead end
  // with no way back.
  const hasCommittee = (bank.fomcBoard?.length ?? 0) > 0;
  const boardFunctional = hasCommittee && boardCanCarryMotions(bank.fomcBoard ?? []);
  if (hasCommittee && boardFunctional && !governmentControlled && !isAdmin) {
    return {
      ok: false as const,
      status: 409,
      error:
        "This central bank has a seated committee: the rate moves by committee vote, not by chair decree. Table a motion in the committee room.",
    };
  }

  // B6 — the impossible trinity. A currency committed to a rate (peg or band)
  // with an open capital account has no independent monetary policy: the rate
  // is whatever defending the commitment requires. The refusal names both ways
  // out, because both are moves the chair can make this turn.
  //
  // Admins keep the override, as they do for the committee gate above.
  if (!isAdmin) {
    const fxDoc = await db
      .collection<ExchangeRate>("exchangeRates")
      .findOne(
        { countryId },
        { projection: { fxRegime: 1, capitalControls: 1, interventionPolicy: 1 } }
      );
    if (fxDoc) {
      // An active intervention band counts as a commitment even when the
      // regime field was never set — the promise to defend a corridor is the
      // commitment, not the label on it.
      const regime: FxRegime = fxDoc.fxRegime ?? (fxDoc.interventionPolicy ? "band" : "float");
      const refusal = rateChangeRefusal(regime, fxDoc.capitalControls === true);
      if (refusal) {
        return { ok: false as const, status: 409, error: refusal };
      }
    }
  }

  // Normalize both sides onto the quarter-point grid before validating: a
  // stored off-grid rate (from a continuous writer) must never lock out the
  // next valid on-grid action.
  const previousRate = bank.primeRate;
  const storedOnGrid = snapToPrimeRateGrid(previousRate);
  const requestedOnGrid = snapToPrimeRateGrid(rate);
  if (requestedOnGrid === storedOnGrid) {
    return { ok: false as const, status: 400, error: "New rate is the same as the current rate" };
  }

  const rawDelta = requestedOnGrid - storedOnGrid; // positive = hike, negative = cut

  if (!isAdmin) {
    if (rawDelta > MAX_RATE_CHANGE_DELTA + 1e-9) {
      return {
        ok: false as const,
        status: 400,
        error: `Rate hikes are limited to +${MAX_RATE_CHANGE_DELTA.toFixed(2)}% per adjustment`,
      };
    }
    if (rawDelta < -(MAX_RATE_CUT_DELTA + 1e-9)) {
      return {
        ok: false as const,
        status: 400,
        error: `Rate cuts are limited to -${MAX_RATE_CUT_DELTA.toFixed(2)}% per adjustment`,
      };
    }

    const lastChange = bank.lastRateChangeTurn;
    if (typeof lastChange === "number") {
      const turnsSince = currentTurn - lastChange;
      if (turnsSince < RATE_CHANGE_COOLDOWN_TURNS) {
        const wait = RATE_CHANGE_COOLDOWN_TURNS - turnsSince;
        return {
          ok: false as const,
          status: 400,
          error: `Rate changes are limited to one every ${RATE_CHANGE_COOLDOWN_TURNS} turns. ${wait} more turn${wait === 1 ? "" : "s"} until you can change the rate again.`,
        };
      }
    }
  }

  const changedByName =
    isAdmin && !isChair
      ? `${myChar?.name ?? actor.username ?? "Admin"} (admin)`
      : (myChar?.name ?? actor.username ?? "Unknown");
  const changedBy = myChar?._id ?? new ObjectId(actor.userId);
  const now = new Date();

  const scrutinyApplied = !isAdmin && rawDelta < -(MAX_RATE_CHANGE_DELTA + 1e-9);
  // Aggressive-cut scrutiny lands on the chair's standing; when the government
  // sets the rate the chair had no hand in it, so their infamy stays put.
  //
  // Government interference is a separate, INSTITUTIONAL cost: a rate set by the
  // finance seat rather than the bank is exactly the event that makes a market
  // stop believing the bank's next announcement. Without this, seizing the rate
  // is free and the credibility model has no political teeth.
  const interferenceApplied = governmentControlled && !isAdmin;
  const scrutinyFromCut = scrutinyApplied && !governmentControlled ? AGGRESSIVE_CUT_SCRUTINY : 0;
  const scrutinyFromInterference = interferenceApplied ? INTERFERENCE_SCRUTINY : 0;
  const scrutinyAdded = scrutinyFromCut + scrutinyFromInterference;
  const newInfamy =
    scrutinyAdded > 0 ? Math.min(100, (bank.chairInfamy ?? 0) + scrutinyAdded) : undefined;

  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bank._id },
    {
      $set: {
        primeRate: requestedOnGrid,
        updatedAt: now,
        lastRateChangeTurn: currentTurn,
        ...(newInfamy !== undefined ? { chairInfamy: newInfamy } : {}),
        // An admin override on a committee bank, and a chair's emergency set on
        // a board too vacant to carry a motion, still consume one of the term's
        // moves, so the override cannot be used to hand the committee free
        // changes once it is seated again.
        ...(hasCommittee && (isAdmin || !boardFunctional)
          ? {
              rateChangesThisTerm: Math.min(
                RATE_CHANGES_PER_TERM,
                (bank.rateChangesThisTerm ?? 0) + 1
              ),
            }
          : {}),
      },
      $push: {
        rateHistory: {
          $each: [
            {
              previousRate,
              newRate: requestedOnGrid,
              changedBy,
              changedByName,
              changedAt: now,
              ...(reason ? { reason } : {}),
            },
          ],
          // Was -50 while the committee path sliced at 96, so whichever writer
          // moved the rate last silently truncated the other's records. One
          // shared cap, so the published history means the same on every bank.
          $slice: -RATE_HISTORY_MAX,
        },
      },
    }
  );

  return {
    ok: true as const,
    bankId: bank._id,
    previousRate,
    changedByName,
    reason,
    primeRate: requestedOnGrid,
    scrutinyApplied,
    interferenceApplied,
  };
}
