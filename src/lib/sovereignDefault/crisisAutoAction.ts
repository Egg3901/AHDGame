/**
 * Sovereign default — crisis auto-action timer.
 *
 * When a player-controlled executive has not proposed a resolution within the
 * 12-hour window (EXECUTIVE_DECISION_HOURS), `crisisAutoActionAt` is set on
 * the federalBudget document at crisis-fire time. This module is called each
 * bond turn to detect expired timers and auto-trigger Repudiate as the safety
 * net — keeping countries from getting permanently stuck in `crisisPending`.
 *
 * Design reference: docs/plans/archive/2026-05/2026-05-04-sovereign-default-design.md
 * Section 6.1 (auto-repudiate fallback).
 */

import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { applyRepudiateResolution } from "./resolution/repudiate";
import type { CountryId } from "@/lib/constants/countries";

export interface CrisisAutoActionReport {
  countriesChecked: number;
  autoRepudiated: string[];
}

/**
 * For every player-enabled country that is still in `crisisPending` with an
 * expired `crisisAutoActionAt` timestamp, auto-trigger Repudiate.
 *
 * Called once per bond turn (before legislative processing) so the timer
 * fires even when no legislative phases are open.
 */
export async function processCrisisAutoActions(
  db: Db,
  realtimeMs: number,
  currentTurn: number
): Promise<CrisisAutoActionReport> {
  const report: CrisisAutoActionReport = {
    countriesChecked: 0,
    autoRepudiated: [],
  };

  // Find all federalBudget rows in crisisPending with an expired timer.
  // Disabled countries are gated from entering crisisPending (crisisDetection.ts
  // access guard), so scanning all is safe.
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({
      sovereignCrisisState: "crisisPending",
      // Turn-first expiry (freezes on pause) with a wall-clock fallback for any
      // crisis fired before `crisisAutoActionAt.turn` existed.
      $or: [
        { "crisisAutoActionAt.turn": { $lte: currentTurn } },
        {
          "crisisAutoActionAt.turn": { $exists: false },
          "crisisAutoActionAt.realtimeMs": { $lte: realtimeMs },
        },
      ],
    })
    .toArray();

  report.countriesChecked = budgets.length;

  for (const budget of budgets) {
    const countryCode = budget.countryId as CountryId;

    // Find the open SovereignCrisisDecision for this country.
    const decision = await db
      .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
      .findOne({ countryCode, state: "open" });

    if (!decision) {
      // Decision row is missing or already in a terminal state — clear the timer
      // so we don't attempt again next turn.
      await db
        .collection<FederalBudget>("federalBudget")
        .updateOne(
          { _id: getNationalBudgetId(countryCode) },
          { $set: { crisisAutoActionAt: null } }
        );
      console.warn(
        `[crisisAutoAction] ${countryCode}: crisisAutoActionAt expired but no open decision found — cleared timer`
      );
      continue;
    }

    console.log(
      `[crisisAutoAction] ${countryCode}: executive window expired, auto-triggering Repudiate (decision ${decision._id})`
    );

    try {
      const result = await applyRepudiateResolution(db, {
        countryCode,
        currentTurn,
        realtimeMs,
        decisionId: decision._id,
        executiveCharacterId: null,
        // applyRepudiateResolution will update the decision row (state → "ratified",
        // executiveChoice → "repudiate"). We do NOT set skipDecisionUpdate here
        // because the decision row is still "open" — the orchestrator owns it.
      });

      if (result.ok) {
        report.autoRepudiated.push(countryCode);
        console.log(
          `[crisisAutoAction] ${countryCode}: auto-Repudiate complete (${result.bondsAffected} bonds affected)`
        );
      } else {
        console.error(
          `[crisisAutoAction] ${countryCode}: applyRepudiateResolution returned not-ok: ${result.reason}`
        );
      }
    } catch (err) {
      console.error(`[crisisAutoAction] ${countryCode}: auto-Repudiate threw:`, err);
    }
  }

  return report;
}
