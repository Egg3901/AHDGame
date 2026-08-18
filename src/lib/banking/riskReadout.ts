/**
 * What the bank console has to tell a CEO BEFORE the bank dies.
 *
 * The console used to report state after the fact: a confidence number, a
 * coloured band, a reserves figure. None of it said which number was the
 * dangerous one, how close it was to the edge, or which way it was moving. A
 * simulated bank went from confidence 0.806 on turn 1 to failed on turn 8 with
 * nothing on screen naming the threshold it was walking into.
 *
 * These are the three things a player actually needs, and all three are derived
 * from figures the engine already computes:
 *
 *  - **Reserve cover** against the line where a run kills you, so the gauge has
 *    a marked edge rather than being a bare ratio.
 *  - **Which confidence term is dragging**, because "0.39" is not actionable
 *    but "your reserve cover is contributing 0.02 of a possible 0.45" is.
 *  - **Whether the band is about to turn**, since red is what arms the run test
 *    and one turn of notice is the difference between a decision and a
 *    post-mortem.
 *
 * Pure. No database, no imports from the turn engine.
 */

import {
  CONFIDENCE_ASSET_QUALITY_WEIGHT,
  CONFIDENCE_BAND_AMBER_MIN,
  CONFIDENCE_BAND_GREEN_MIN,
  CONFIDENCE_CAPITAL_WEIGHT,
  CONFIDENCE_RESERVE_WEIGHT,
  confidenceCovers,
} from "@/lib/banking/confidence";
import {
  RUN_FAILURE_COVER_FRACTION,
  requiredReserves as computeRequiredReserves,
} from "@/lib/banking/balanceSheet";

export { RUN_FAILURE_COVER_FRACTION };

export type ConfidenceTerm = {
  key: "reserves" | "capital" | "assetQuality";
  label: string;
  /** Points this term is contributing to confidence right now. */
  contribution: number;
  /** The most this term can contribute. */
  max: number;
  /** One line naming what moves it. */
  lever: string;
};

export type BankRiskReadout = {
  /** Cash the bank holds against its cash-backed deposit base. */
  cashReserves: number;
  requiredReserves: number;
  /** Cash below this fails the bank once its published band is red. */
  runFailureThreshold: number;
  /** cash / required, uncapped. 1.0 means exactly meeting the requirement. */
  reserveCoverRatio: number;
  /** Distance to the run line: negative means already under it. */
  headroomToFailure: number;
  /** True when only the published band (not the cash) is holding failure off. */
  oneBandFromFailure: boolean;
  terms: ConfidenceTerm[];
  confidence: number;
  band: "green" | "amber" | "red";
  /** Plain sentence for the console. Never empty. */
  verdict: string;
};

function finite(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export function buildRiskReadout(input: {
  cashReserves: number;
  /** Cash-backed deposits only; player pointer deposits are excluded. */
  cashBackedDeposits: number;
  totalLoans: number;
  reserveRatioRequired: number;
  arrearsOutstanding?: number;
  defaultsLastTurn?: number;
  confidence: number;
  band: "green" | "amber" | "red";
}): BankRiskReadout {
  const cash = Math.max(0, finite(input.cashReserves));
  const deposits = Math.max(0, finite(input.cashBackedDeposits));
  const loans = Math.max(0, finite(input.totalLoans));
  const ratio = Math.max(0, finite(input.reserveRatioRequired));

  const requiredReserves = computeRequiredReserves({ npcDeposits: deposits }, ratio);
  const runFailureThreshold = RUN_FAILURE_COVER_FRACTION * requiredReserves;
  const reserveCoverRatio = requiredReserves > 0 ? cash / requiredReserves : 1;
  const headroomToFailure = cash - runFailureThreshold;

  // The SAME arithmetic computeConfidence scores with, not a second copy of it.
  // This module used to re-derive the terms with its own literal penalty
  // constants, so the console could explain a score the engine no longer gave.
  const covers = confidenceCovers({
    cashReserves: cash,
    cashBackedDeposits: deposits,
    totalLoans: loans,
    reserveRatioRequired: ratio,
    arrearsOutstanding: input.arrearsOutstanding,
    defaultsLastTurn: input.defaultsLastTurn,
  });

  const terms: ConfidenceTerm[] = [
    {
      key: "reserves",
      label: "Reserve cover",
      contribution: CONFIDENCE_RESERVE_WEIGHT * Math.min(1, covers.reserveCover),
      max: CONFIDENCE_RESERVE_WEIGHT,
      lever: "Hold more cash, or take fewer deposits by shrinking the branch network.",
    },
    {
      key: "capital",
      label: "Capital cover",
      contribution: CONFIDENCE_CAPITAL_WEIGHT * covers.capitalCover,
      max: CONFIDENCE_CAPITAL_WEIGHT,
      lever: "Move capital into the bank, or lend less against the cash you hold.",
    },
    {
      key: "assetQuality",
      label: "Asset quality",
      contribution: CONFIDENCE_ASSET_QUALITY_WEIGHT * covers.assetQuality,
      max: CONFIDENCE_ASSET_QUALITY_WEIGHT,
      lever: "Lend to better credit bands; arrears and defaults both bite here.",
    },
  ];

  // Failure needs BOTH a red band and thin cash. Saying which of the two is
  // currently missing is the difference between a warning and a number.
  const cashUnderRunLine = cash < runFailureThreshold;
  const oneBandFromFailure = cashUnderRunLine && input.band !== "red";

  let verdict: string;
  if (input.band === "red" && cashUnderRunLine) {
    verdict = "Failing: the band is red and cash is under the run line. Post capital now.";
  } else if (oneBandFromFailure) {
    verdict =
      "One band from failure. Cash is already under the run line; if confidence turns red the bank fails.";
  } else if (input.band === "red") {
    verdict = "Red band, but cash is above the run line. Confidence must recover before it falls.";
  } else if (input.band === "amber") {
    verdict = "Amber. Depositors are leaving each turn, which shrinks the book you earn on.";
  } else if (reserveCoverRatio < 1.25) {
    verdict = "Green, but reserve cover is thin. Lending further will push it down.";
  } else {
    verdict = "Green and comfortably reserved.";
  }

  return {
    cashReserves: cash,
    requiredReserves,
    runFailureThreshold,
    reserveCoverRatio,
    headroomToFailure,
    oneBandFromFailure,
    terms,
    confidence: finite(input.confidence),
    band: input.band,
    verdict,
  };
}

/** Band a confidence score falls in. Mirrors `computeConfidence`. */
export function bandFor(confidence: number): "green" | "amber" | "red" {
  if (confidence >= CONFIDENCE_BAND_GREEN_MIN) return "green";
  if (confidence >= CONFIDENCE_BAND_AMBER_MIN) return "amber";
  return "red";
}
