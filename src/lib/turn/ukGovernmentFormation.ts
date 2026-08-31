/**
 * UK Government Formation — seat update phase
 *
 * Thin wrapper around the shared parliamentary government system.
 * Delegates to parliamentaryGovernment.ts with countryId: "UK".
 *
 * The only UK-specific logic is seedGovernmentFormation(), which reads
 * from legacy ukGovernment / parliamentaryGovernments collections.
 * That function runs once (on first update when no doc exists) and is
 * not part of the shared extraction.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character } from "@/lib/db/types";
import type { UKGovernment } from "@/lib/db/types/ukGovernment";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import type { PoliticalParty } from "@/lib/db/types/party";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getTotalUkCommonsSeats } from "@/lib/constants/states";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { lowerChamberMajorityThreshold } from "./lowerChamberSeats";
import {
  resetConfidenceGauge,
  tickConfidenceForGov,
} from "@/lib/uk/confidence/confidenceGaugeStore";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import { tickNhsFromBudget } from "@/lib/uk/nhs/nhsStore";
import { getGameState } from "@/lib/gameState";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calculateFiscalYear } from "@/lib/budget/fiscalYear";
import {
  tallySeatsByParty,
  getLargestParty as sharedGetLargestParty,
  updateParliamentaryGovernmentSeats,
  resetParliamentaryGovernmentAfterElection,
} from "./parliamentaryGovernment";

// ---------------------------------------------------------------------------
// Exported helpers — delegate to shared system, maintain original signatures
// ---------------------------------------------------------------------------

/**
 * Sum seats held by each party from UK Commons officials.
 * Delegates to the shared tallySeatsByParty with countryId: "UK".
 */
export async function tallyCommonsSeatsByParty(db: Db): Promise<Record<string, number>> {
  return tallySeatsByParty(db, "UK");
}

/**
 * Return the party key with the most seats, or null when empty.
 * Re-export of the shared helper.
 */
export function getLargestParty(seatsByParty: Record<string, number>): string | null {
  return sharedGetLargestParty(seatsByParty);
}

// ---------------------------------------------------------------------------
// Per-turn update — delegates to shared system (with seed fallback)
// ---------------------------------------------------------------------------

/**
 * Recalculate UK Commons seat distribution. Seeds the governmentFormations
 * document from legacy collections on first run if it doesn't exist.
 */
export async function updateGovernmentSeats(): Promise<void> {
  const db = await getDb();
  const govCol = getGovernmentFormationsCollection(db);

  const existing = await govCol.findOne({ _id: "UK" });
  if (!existing) {
    // One-time seed from legacy collections — UK-specific
    await seedGovernmentFormation(db);
    return;
  }

  // Delegate to shared system
  await updateParliamentaryGovernmentSeats(db, "UK");
}

// ---------------------------------------------------------------------------
// One-time seed from legacy collections (UK-specific — not shared)
// ---------------------------------------------------------------------------

async function seedGovernmentFormation(db: Db): Promise<void> {
  const govCol = getGovernmentFormationsCollection(db);
  const seatsByParty = await tallyCommonsSeatsByParty(db);
  const now = new Date();
  const totalSeats = getTotalUkCommonsSeats(await getGameStatePreset(db));
  const majorityThreshold = lowerChamberMajorityThreshold(totalSeats);

  const ukGov = await db.collection<UKGovernment>("ukGovernment").findOne({ _id: "current" });
  const parlGov = await db
    .collection<ParliamentaryGovernment>("parliamentaryGovernments")
    .findOne({ _id: "UK" });
  const legacyPmId = ukGov?.pmCharacterId ?? parlGov?.pmCharacterId ?? null;

  const pmChar = legacyPmId
    ? await db.collection<Character>("characters").findOne({ _id: legacyPmId })
    : null;

  if (legacyPmId && pmChar) {
    const pmParty =
      pmChar?.party != null
        ? await db.collection<PoliticalParty>("politicalParties").findOne({
            sequentialId:
              typeof pmChar.party === "number" ? pmChar.party : parseInt(String(pmChar.party), 10),
            countryId: "UK",
          })
        : null;

    const governingPartyId = pmParty?.sequentialId?.toString() ?? null;
    const partySeats = governingPartyId ? (seatsByParty[governingPartyId] ?? 0) : 0;
    const formationType = partySeats >= majorityThreshold ? "majority" : "minority";

    await govCol.updateOne(
      { _id: "UK" },
      {
        $set: {
          _id: "UK",
          countryId: "UK",
          cycle: 1,
          status: "formed",
          formationType,
          lostMajority: false,
          pmCharacterId: legacyPmId,
          pmName: pmChar?.name ?? null,
          governingPartyId,
          coalitionId: null,
          coalitionPartyIds: null,
          totalSeatsSupporting: partySeats,
          majorityThreshold,
          seatsByParty,
          totalSeats,
          activeVoteId: null,
          noConfidenceCooldown: null,
          formedAt: now,
          formedTurn: null,
          collapsedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  } else {
    const governingPartyId = sharedGetLargestParty(seatsByParty);

    await govCol.updateOne(
      { _id: "UK" },
      {
        $set: {
          _id: "UK",
          countryId: "UK",
          cycle: 1,
          status: "pending",
          formationType: null,
          lostMajority: false,
          pmCharacterId: null,
          pmName: null,
          governingPartyId,
          coalitionId: null,
          coalitionPartyIds: null,
          totalSeatsSupporting: governingPartyId ? (seatsByParty[governingPartyId] ?? 0) : 0,
          majorityThreshold,
          seatsByParty,
          totalSeats,
          activeVoteId: null,
          noConfidenceCooldown: null,
          formedAt: null,
          formedTurn: null,
          collapsedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  }

  // Confidence gauge per-turn drift (epic #856): recovers when the government
  // is popular, erodes when it isn't. The broken-promise bleed is added once
  // manifesto-delivery evaluation is wired. Persists the value only — no
  // consequence until UK_CONFIDENCE_GAUGE_DISSOLUTION is enabled.
  const approvalDoc = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ _id: "UK" });
  if (approvalDoc) {
    await tickConfidenceForGov(db, { approval: approvalDoc.approvalRating, now });
  }

  // NHS quality per-turn drift (epic #856): pulled toward the target implied by
  // the current passed Budget's healthcare share. Persists the value only.
  const nhsGameState = await getGameState(db);
  const nhsCurrentTurn = nhsGameState?.currentTurn ?? 1;
  const nhsStartingYear = nhsGameState?.startingYear ?? STARTING_YEAR;
  const nhsCurrentYear =
    nhsGameState?.currentYear ??
    nhsStartingYear + Math.floor((nhsCurrentTurn - 1) / TURNS_PER_YEAR);
  await tickNhsFromBudget(db, {
    fiscalYear: calculateFiscalYear(nhsCurrentYear, nhsCurrentTurn),
    now,
  });
}

// ---------------------------------------------------------------------------
// Post-election refresh — delegates to shared system
// ---------------------------------------------------------------------------

/**
 * Refresh UK government after a Commons election completes.
 * Delegates to shared resetParliamentaryGovernmentAfterElection.
 */
export async function resetGovernmentAfterElection(now: Date): Promise<void> {
  const db = await getDb();
  await resetParliamentaryGovernmentAfterElection(db, "UK", now);
  // Confidence gauge (epic #856): a fresh parliament starts with full
  // confidence. Reset regardless of the dissolution flag — this is the value,
  // not the consequence.
  await resetConfidenceGauge(db, now);
}
