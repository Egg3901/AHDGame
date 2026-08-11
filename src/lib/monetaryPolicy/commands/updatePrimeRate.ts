import { ObjectId, type Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import type { CentralBank } from "@/lib/db/types";
import {
  MAX_RATE_CHANGE_DELTA,
  MAX_RATE_CUT_DELTA,
  AGGRESSIVE_CUT_SCRUTINY,
  RATE_CHANGE_COOLDOWN_TURNS,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";
import { isNationalIssuer } from "@/lib/extraction/contractIssuerAuth";

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
  const { db, countryId, actor, rate, reason, currentTurn } = params;
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: getBankId(countryId) });
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
  // Governance keys on the bank's HOME country (a sterlingized SCO reaches the
  // same BoE doc through its own URL), and authority belongs to that home
  // country's government too.
  const bankHomeCountryId = (bank.countryId ?? countryId) as CountryId;
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

  const previousRate = bank.primeRate;
  if (rate === previousRate) {
    return { ok: false as const, status: 400, error: "New rate is the same as the current rate" };
  }

  const rawDelta = rate - previousRate; // positive = hike, negative = cut

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
  const newInfamy =
    scrutinyApplied && !governmentControlled
      ? Math.min(100, (bank.chairInfamy ?? 0) + AGGRESSIVE_CUT_SCRUTINY)
      : undefined;

  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bank._id },
    {
      $set: {
        primeRate: rate,
        updatedAt: now,
        lastRateChangeTurn: currentTurn,
        ...(newInfamy !== undefined ? { chairInfamy: newInfamy } : {}),
      },
      $push: {
        rateHistory: {
          $each: [
            {
              previousRate,
              newRate: rate,
              changedBy,
              changedByName,
              changedAt: now,
              ...(reason ? { reason } : {}),
            },
          ],
          $slice: -50,
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
    primeRate: rate,
    scrutinyApplied,
  };
}
