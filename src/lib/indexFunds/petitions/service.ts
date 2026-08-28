/**
 * A7 part 2 service: filing a listing petition, deciding one, and letting the
 * deadline decide the ones nobody answered.
 *
 * The committee is the SAME seat that rules on merger review, resolved through
 * the same `resolveMergerAuthority` query rather than a parallel copy. Two
 * resolvers would eventually disagree about who holds a country's commercial
 * discretion, and the whole point of the seat is that it is one person.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type {
  IndexListingPetition,
  IndexListingPetitionStatus,
} from "@/lib/db/types/indexListingPetition";
import { resolveMergerAuthority } from "@/lib/corporations/mergerReview/authority";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  atomicallyDebitCorpLiquidCapital,
  refundCharacterCash,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { creditTreasuryProceeds } from "@/lib/nationalization/treasury";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { applyListingStandards, isMateriallyInsolvent } from "../listingStandards";
import type { IndexFundCandidate } from "../constituents";
import { isEligibleIndexFundConstituent } from "../constituents";
import {
  decidePetitionAutomatically,
  isWaiverActive,
  PETITION_DECISION_TURNS,
  WAIVER_TURNS,
} from "./rules";

export const INDEX_LISTING_PETITIONS = "indexListingPetitions";

/** Corporations holding a waiver the listing screen must honour this turn. */
export async function loadActiveWaiverIds(db: Db, currentTurn: number): Promise<Set<string>> {
  const granted = await db
    .collection<IndexListingPetition>(INDEX_LISTING_PETITIONS)
    .find(
      { status: "granted", waiverUntilTurn: { $gte: currentTurn } },
      { projection: { corporationId: 1 } }
    )
    .toArray();
  return new Set(granted.map((p) => p.corporationId.toString()));
}

export async function findPendingPetition(
  db: Db,
  corporationId: ObjectId
): Promise<IndexListingPetition | null> {
  return db
    .collection<IndexListingPetition>(INDEX_LISTING_PETITIONS)
    .findOne({ corporationId, status: "pending" });
}

export async function findActiveWaiver(
  db: Db,
  corporationId: ObjectId,
  currentTurn: number
): Promise<IndexListingPetition | null> {
  return db
    .collection<IndexListingPetition>(INDEX_LISTING_PETITIONS)
    .findOne({ corporationId, status: "granted", waiverUntilTurn: { $gte: currentTurn } });
}

export type FilePetitionResult =
  { ok: true; petition: IndexListingPetition } | { ok: false; error: string; status: number };

/**
 * File a petition and pay the lobbying contribution.
 *
 * The money is spent on filing and never refunded on a refusal. Lobbying buys
 * attention, not an outcome, and a contribution that came back when the answer
 * was no would be a free option rather than a political act.
 *
 * When a character holds the seat the money reaches them personally, which is
 * what makes the record worth reading. When the seat is NPP-held or vacant
 * there is no person to pay, so it goes to the country treasury: the spend still
 * happens and still counts toward the automatic rule, but nobody pockets it.
 */
export async function fileListingPetition(opts: {
  db: Db;
  corporation: Corporation;
  filedByCharacterId: ObjectId;
  contributionAnchor: number;
  currentTurn: number;
  currentYear: number | null;
}): Promise<FilePetitionResult> {
  const { db, corporation, filedByCharacterId, contributionAnchor, currentTurn } = opts;

  if (!Number.isFinite(contributionAnchor) || contributionAnchor <= 0) {
    return { ok: false, error: "Contribution must be a positive amount", status: 400 };
  }
  if (corporation.isPrivate) {
    return {
      ok: false,
      error: "A private corporation has no index membership to petition for",
      status: 400,
    };
  }

  const existing = await findPendingPetition(db, corporation._id);
  if (existing) {
    return {
      ok: false,
      error: "This corporation already has a petition before the committee",
      status: 409,
    };
  }
  const waiver = await findActiveWaiver(db, corporation._id, currentTurn);
  if (waiver) {
    return { ok: false, error: "This corporation already holds a listing waiver", status: 409 };
  }

  const authority = await resolveMergerAuthority(
    db,
    corporation.countryId as string,
    opts.currentYear
  );
  if (!authority) {
    return {
      ok: false,
      error: "This country has no index committee, so there is nobody to petition",
      status: 400,
    };
  }

  const debit = await atomicallyDebitCorpLiquidCapital(db, corporation._id, contributionAnchor);
  if (!debit.ok) return { ok: false, error: debit.error, status: 400 };

  const now = new Date();
  const petition: IndexListingPetition = {
    _id: new ObjectId(),
    corporationId: corporation._id,
    countryId: corporation.countryId as CountryId,
    filedByCharacterId,
    filedAtTurn: currentTurn,
    deadlineAtTurn: currentTurn + PETITION_DECISION_TURNS,
    seatId: authority.seatId,
    seatName: authority.seatName,
    contributionAnchor,
    ...(authority.holderCharacterId
      ? { contributionRecipientCharacterId: authority.holderCharacterId }
      : {}),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.collection<IndexListingPetition>(INDEX_LISTING_PETITIONS).insertOne(petition);
  } catch (e) {
    // The debit already happened, so put it back rather than leaving the corp
    // out of pocket for a petition that does not exist.
    await refundCorpLiquidCapital(db, corporation._id, contributionAnchor);
    throw e;
  }

  // Credit through the same helpers every other money movement uses, so the
  // forex-aware balance field and the treasury account stay single-sourced.
  const feeCurrency = (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode;
  if (authority.holderCharacterId) {
    await refundCharacterCash(
      db,
      authority.holderCharacterId,
      feeCurrency,
      contributionAnchor,
      await isForexEnabled()
    );
  } else {
    await creditTreasuryProceeds(db, corporation.countryId as CountryId, contributionAnchor, now);
  }

  // Both legs, so the ledger nets to zero: the corporation pays and either the
  // officeholder or the treasury receives. A one-sided lobbying debit would
  // read as money destroyed.
  await emitTx(db, {
    type: "index_listing_lobbying",
    turn: currentTurn,
    createdAt: now,
    subjectType: "corporation",
    subjectId: corporation._id,
    subjectName: corporation.name,
    amount: -contributionAnchor,
    currencyCode: feeCurrency,
    counterpartyType: authority.holderCharacterId ? "character" : "government",
    ...(authority.holderCharacterId ? { counterpartyId: authority.holderCharacterId } : {}),
    counterpartyName: authority.holderName ?? authority.seatName,
    meta: {
      petitionId: petition._id.toString(),
      seatId: authority.seatId,
      seatName: authority.seatName,
    },
  });
  await emitTx(db, {
    type: "index_listing_lobbying",
    turn: currentTurn,
    createdAt: now,
    ...(authority.holderCharacterId
      ? {
          subjectType: "character" as const,
          subjectId: authority.holderCharacterId,
          subjectName: authority.holderName ?? authority.seatName,
        }
      : {
          subjectType: "government" as const,
          countryId: corporation.countryId as string,
          subjectName: `${corporation.countryId} Treasury`,
        }),
    amount: contributionAnchor,
    currencyCode: feeCurrency,
    counterpartyType: "corporation",
    counterpartyId: corporation._id,
    counterpartyName: corporation.name,
    meta: {
      petitionId: petition._id.toString(),
      seatId: authority.seatId,
      seatName: authority.seatName,
    },
  });

  return { ok: true, petition };
}

/**
 * Measure the petitioner against the standards as they stand right now.
 *
 * Deliberately re-measured at decision time rather than snapshotted at filing:
 * a corporation that fixed its float while the petition sat should not be
 * granted a waiver it no longer needs, and one that got worse should not be
 * judged on how it looked twelve turns ago.
 */
export async function measurePetitioner(
  db: Db,
  petition: IndexListingPetition
): Promise<{
  marketCapAnchor: number;
  worstShortfallRatio: number | null;
  hasUnwaivableFailure: boolean;
} | null> {
  const corps = (await db
    .collection<Corporation>("corporations")
    .find(
      { countryId: petition.countryId, isPrivate: { $ne: true } },
      {
        projection: {
          _id: 1,
          countryId: 1,
          type: 1,
          secondaryType: 1,
          sharePrice: 1,
          totalShares: 1,
          liquidCurrencyCode: 1,
          countryOwnerId: 1,
          isPrivate: 1,
          hiddenFromExchange: 1,
          publicFloat: 1,
          liquidCapital: 1,
        },
      }
    )
    .toArray()) as unknown as IndexFundCandidate[];

  // The pool is that country's broad index: the same peers the size bar would
  // be measured against if a fund rebalanced this turn.
  const pool = corps.filter((c) =>
    isEligibleIndexFundConstituent(c, {
      scope: "country",
      kind: "broad",
      countryId: petition.countryId,
    })
  );

  const verdicts = applyListingStandards(
    pool.map((c) => ({
      corporationId: c._id.toString(),
      marketCapAnchor: (c.sharePrice ?? 0) * (c.totalShares ?? 0),
      freeFloatRatio:
        c.publicFloat !== undefined && (c.totalShares ?? 0) > 0
          ? c.publicFloat / (c.totalShares as number)
          : undefined,
      insolvent: isMateriallyInsolvent(c.liquidCapital, (c.sharePrice ?? 0) * (c.totalShares ?? 0)),
    }))
  );

  const key = petition.corporationId.toString();
  const verdict = verdicts.find((v) => v.corporationId === key);
  const corp = pool.find((c) => c._id.toString() === key);
  if (!verdict || !corp) return null;

  return {
    marketCapAnchor: (corp.sharePrice ?? 0) * (corp.totalShares ?? 0),
    worstShortfallRatio: verdict.worstShortfallRatio,
    hasUnwaivableFailure: verdict.failures.includes("insolvent"),
  };
}

async function closePetition(
  db: Db,
  petition: IndexListingPetition,
  outcome: {
    status: IndexListingPetitionStatus;
    currentTurn: number;
    decidedByCharacterId?: ObjectId;
    decidedAutomatically?: boolean;
  }
): Promise<void> {
  const now = new Date();
  await db.collection<IndexListingPetition>(INDEX_LISTING_PETITIONS).updateOne(
    { _id: petition._id, status: "pending" },
    {
      $set: {
        status: outcome.status,
        decidedAtTurn: outcome.currentTurn,
        ...(outcome.decidedByCharacterId
          ? { decidedByCharacterId: outcome.decidedByCharacterId }
          : {}),
        ...(outcome.decidedAutomatically ? { decidedAutomatically: true } : {}),
        ...(outcome.status === "granted"
          ? { waiverUntilTurn: outcome.currentTurn + WAIVER_TURNS }
          : {}),
        updatedAt: now,
      },
    }
  );
}

/** A seated officeholder rules on a petition. */
export async function decideListingPetition(opts: {
  db: Db;
  petition: IndexListingPetition;
  decidedByCharacterId: ObjectId;
  grant: boolean;
  currentTurn: number;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (opts.petition.status !== "pending") {
    return { ok: false, error: "This petition has already been decided", status: 409 };
  }

  if (opts.grant) {
    // The officeholder's discretion runs over the waivable bars and stops at
    // solvency, exactly as the automatic rule does. A committee cannot vote a
    // corporation solvent.
    const measured = await measurePetitioner(opts.db, opts.petition);
    if (measured?.hasUnwaivableFailure) {
      return {
        ok: false,
        error: "An insolvent corporation cannot be granted a listing waiver",
        status: 400,
      };
    }
  }

  await closePetition(opts.db, opts.petition, {
    status: opts.grant ? "granted" : "refused",
    currentTurn: opts.currentTurn,
    decidedByCharacterId: opts.decidedByCharacterId,
  });
  return { ok: true };
}

/**
 * Let the deadline decide everything nobody answered.
 *
 * Runs in the index-fund turn phase, before the rebalance, so a waiver granted
 * this turn is honoured by this turn's screen rather than the next one.
 */
export async function resolveDueListingPetitions(
  db: Db,
  currentTurn: number
): Promise<{ granted: number; refused: number }> {
  const due = await db
    .collection<IndexListingPetition>(INDEX_LISTING_PETITIONS)
    .find({ status: "pending", deadlineAtTurn: { $lte: currentTurn } })
    .toArray();

  let granted = 0;
  let refused = 0;

  for (const petition of due) {
    const measured = await measurePetitioner(db, petition);
    const decision = decidePetitionAutomatically({
      contributionAnchor: petition.contributionAnchor,
      marketCapAnchor: measured?.marketCapAnchor ?? 0,
      // A petitioner that has left the candidate pool entirely (went private,
      // delisted) is not failing a measurable bar, so there is nothing to waive.
      worstShortfallRatio: measured?.worstShortfallRatio ?? null,
      hasUnwaivableFailure: measured?.hasUnwaivableFailure ?? false,
    });

    await closePetition(db, petition, {
      status: decision.granted ? "granted" : "refused",
      currentTurn,
      decidedAutomatically: true,
    });

    if (decision.granted) granted += 1;
    else refused += 1;
  }

  return { granted, refused };
}

export { isWaiverActive };
