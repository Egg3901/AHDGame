/** The founding parallel count freezes list quotas and waits for real constituency runoffs. */
import { BG_1990_CONSTITUENCIES } from "../data/foundingDistricts1990";
import { countBgFoundingLists, type BgFoundingListResult } from "./foundingLists1990";
import { resolveBgFoundingFirstRound, resolveBgFoundingRunoff } from "./foundingMajority1990";
import type { BgFoundingBallots } from "./foundingBallots1990";

export interface BgFoundingCount {
  kind: "pending" | "certified";
  constituencyWinners: Record<string, string | null>;
  unresolved: string[];
  lists: BgFoundingListResult;
}

export function countBgFoundingElection(ballots: BgFoundingBallots): BgFoundingCount {
  const catalog = new Set(BG_1990_CONSTITUENCIES.map((row) => row.id));
  if (
    ballots.constituencies.length !== 200 ||
    new Set(ballots.constituencies.map((row) => row.id)).size !== 200 ||
    ballots.constituencies.some((row) => !catalog.has(row.id))
  )
    throw new Error("Bulgarian founding count needs all200 constituencies");
  const constituencyWinners: Record<string, string | null> = {},
    unresolved: string[] = [];
  for (const row of ballots.constituencies) {
    const result = row.second
      ? resolveBgFoundingRunoff(row.first, row.second)
      : resolveBgFoundingFirstRound(row.first);
    if (result.kind === "elected") constituencyWinners[row.id] = result.personId;
    else {
      constituencyWinners[row.id] = null;
      unresolved.push(row.id);
    }
  }
  const lists = countBgFoundingLists(ballots.lists);
  return {
    kind: unresolved.length || lists.kind !== "allocated" ? "pending" : "certified",
    constituencyWinners,
    unresolved,
    lists,
  };
}
