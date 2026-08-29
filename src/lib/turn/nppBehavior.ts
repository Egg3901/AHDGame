// src/lib/turn/nppBehavior.ts
/**
 * Unified NPP Turn Behavior
 *
 * Consolidates all NPP turn-based behavior:
 * - Election entry (deterministic, priority-based)
 * - Bill voting (ideology + whip)
 * - Slate follow-through plus endorsement cleanup
 *
 * All data loaded upfront into shared context for consistency.
 */

import { loadNPPContext } from "./npp/context";
import { processElectionEntry } from "./npp/electionEntry";
import { processNppEndorsements } from "./npp/endorsements";
import { processBillVoting } from "./npp/billVoting";
import { processStateBillVoting } from "./npp/stateBillVoting";
import { processSlateResponses, syncPersistentSlateAssignments } from "./npp/slateResponses";

// ─── Main Export ───────────────────────────────────────────────────────────────

export async function processNPPTurn(
  now: Date,
  options?: {
    billDeadlineNow?: Date;
    currentTurn?: number;
  }
): Promise<{
  entered: number;
  votescast: number;
  speakerVotes: number;
  slateResponses: number;
}> {
  console.log("[Turn] NPP behavior processing started");

  // Env-gated sub-step timing (SIM_CORP_TIMING=1), same mechanism as
  // processCorporationTurn — zero-cost when off, used to find which of this
  // phase's steps dominate its per-turn cost.
  const timingOn = process.env.SIM_CORP_TIMING === "1";
  const timings: Array<[string, number]> = [];
  let _tPrev = timingOn ? Date.now() : 0;
  const mark = (label: string): void => {
    if (!timingOn) return;
    const nowMs = Date.now();
    timings.push([label, nowMs - _tPrev]);
    _tPrev = nowMs;
  };

  const ctx = await loadNPPContext(now, {
    billDeadlineNow: options?.billDeadlineNow,
    currentTurn: options?.currentTurn,
  });
  mark("loadNPPContext");

  const materialized = await syncPersistentSlateAssignments(ctx);
  mark("syncPersistentSlateAssignments");
  console.log(
    `[Turn] Slate persistence sync: ${materialized} races hydrated from prior-cycle assignments`
  );

  // Run slate responses BEFORE election entry so accepted rows are ready for
  // the filing pass inside election entry. Incumbent defenders still file
  // first, but accepted slate challengers can then join the same primary.
  const slateSummary = await processSlateResponses(ctx);
  const slateResponses = slateSummary.accepted + slateSummary.declined;
  mark("processSlateResponses");
  console.log(
    `[Turn] NPP slate responses: ${slateSummary.accepted} accepted, ${slateSummary.declined} declined`
  );

  const entered = await processElectionEntry(ctx);
  mark("processElectionEntry");
  console.log(`[Turn] NPP election entry: ${entered} NPPs entered primaries`);

  // Endorsements are now manual-only from the player-to-NPP panel. The turn
  // pass only withdraws stale or legacy endorsements so resolved campaigns do
  // not carry support forward into the next race.
  const endorsementSummary = await processNppEndorsements(ctx);
  mark("processNppEndorsements");
  console.log(
    `[Turn] NPP endorsements: ${endorsementSummary.withdrawn} withdrawn, ${endorsementSummary.reevaluated} reviewed`
  );

  const federalVotesCast = await processBillVoting(ctx);
  mark("processBillVoting");
  const localVotesCast = await processStateBillVoting(ctx);
  mark("processStateBillVoting");
  const votescast = federalVotesCast + localVotesCast;
  console.log(
    `[Turn] NPP bill voting: ${federalVotesCast} federal votes cast, ${localVotesCast} local votes cast`
  );

  if (timingOn) {
    const total = timings.reduce((s, [, ms]) => s + ms, 0);
    console.log(`[npp-timing] total=${total}ms ${JSON.stringify(timings)}`);
  }

  // Kept for backward-compatible turn summaries after congressional
  // leadership voting became player-only for NPPs.
  const speakerVotes = 0;

  return { entered, votescast, speakerVotes, slateResponses };
}
