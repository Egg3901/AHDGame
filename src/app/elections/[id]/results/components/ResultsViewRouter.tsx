"use client";

import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { PresidentialResultsView } from "./PresidentialResultsView";
import { ParliamentaryResultsView } from "./ParliamentaryResultsView";
import { SingleWinnerResultsView } from "./SingleWinnerResultsView";

/**
 * Picks the layout by what the data supports: president gets the electoral
 * college board; multi-seat chambers (or anything with a national sibling
 * aggregation) get the parliamentary board; everything else is head-to-head.
 */
export function ResultsViewRouter({ data }: { data: ElectionResultsResponse }) {
  if (data.election.electionType === "president") {
    return <PresidentialResultsView data={data} />;
  }
  if (data.election.totalSeats > 1 || data.national) {
    return <ParliamentaryResultsView data={data} />;
  }
  return <SingleWinnerResultsView data={data} />;
}
