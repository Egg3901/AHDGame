/**
 * The general-election screen's newsroom headline.
 *
 * Proposal D sets a Lora headline over the live tally ("Vance clears 270 as the
 * belt turns"). That is editorial prose, so it is generated here from the
 * standing rather than invented per render: a fixed phrase set, every number
 * taken from the tally, and no claim the figures do not support.
 *
 * Pure and display-only. Nothing here feeds resolution — and that is exactly
 * why the wording matters. This screen renders only while a race is RUNNING;
 * a concluded one gets the results screen instead. So every figure it reports
 * is a projection from the votes banked so far, and none of it is won. The
 * phrases below used the vocabulary of a finished count ("clears", "banked"),
 * which on a race with half its turns left reads as a called result.
 */

export interface GeneralHeadlineInput {
  /** Leading ticket's name. Null before any votes are counted. */
  leaderName: string | null;
  leaderEv: number;
  runnerUpEv: number;
  /** Electoral-vote majority for the live apportionment, not a fixed 270. */
  threshold: number;
  /** Electoral votes not yet allocated to any ticket. */
  outstandingEv: number;
  /** Popular-vote margin between the top two, in percentage points. */
  popularMarginPp: number;
}

export interface GeneralHeadlineResult {
  headline: string;
  standfirst: string;
}

function pp(value: number): string {
  return Math.abs(value).toFixed(1);
}

export function buildGeneralHeadline(input: GeneralHeadlineInput): GeneralHeadlineResult {
  const { leaderName, leaderEv, runnerUpEv, threshold, outstandingEv, popularMarginPp } = input;

  // ── Headline ──────────────────────────────────────────────────────────────
  let headline: string;
  if (!leaderName || (leaderEv === 0 && runnerUpEv === 0)) {
    headline = "Counting begins, no votes banked yet";
  } else if (leaderEv === runnerUpEv) {
    headline = `The college projects deadlocked at ${leaderEv}`;
  } else if (leaderEv >= threshold) {
    headline = `${leaderName} projected past ${threshold}`;
  } else {
    const shortBy = threshold - leaderEv;
    headline = `${leaderName} leads on ${leaderEv}, short of ${threshold} by ${shortBy}`;
  }

  // ── Standfirst ────────────────────────────────────────────────────────────
  const parts: string[] = [];

  if (outstandingEv > 0) {
    // Not "outstanding" as in uncounted: these are states with no projected
    // leader yet. Nothing on this screen has been counted to a conclusion.
    parts.push(
      `${outstandingEv} electoral vote${outstandingEv === 1 ? "" : "s"} not yet projected.`
    );
  }

  if (!leaderName || (leaderEv === 0 && runnerUpEv === 0)) {
    parts.push("No ticket is projected to carry a state yet.");
  } else if (Math.abs(popularMarginPp) < 2) {
    parts.push(`Popular vote inside two points at ${pp(popularMarginPp)}.`);
  } else {
    parts.push(`Popular vote margin ${pp(popularMarginPp)} points.`);
  }

  return { headline, standfirst: parts.join(" ") };
}
