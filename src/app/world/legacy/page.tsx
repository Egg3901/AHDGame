import { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { getLegacyLeaderboardData } from "@/lib/world/legacyLeaderboard";
import type { LegacyLeaderboardScope, LegacyRankBy } from "@/lib/world/legacyLeaderboardTypes";
import LegacyLeaderboardClient from "./LegacyLeaderboardClient";

export const metadata: Metadata = publicPageMetadata({
  title: "Hall of Fame | A House Divided",
  description:
    "Every player ranked by their single best-scoring life ever played, across every game iteration.",
  pathname: "/world/legacy",
});

export default async function LegacyLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; rankBy?: string }>;
}) {
  const { scope: scopeParam, rankBy: rankByParam } = await searchParams;
  const scope: LegacyLeaderboardScope = scopeParam === "current" ? "current" : "all";
  const rankBy: LegacyRankBy = rankByParam === "netWorth" ? "netWorth" : "legacy";

  const db = await getDb();
  const authUser = await getAuthUser();
  const data = await getLegacyLeaderboardData(db, authUser ? { userId: authUser.userId } : null, {
    scope,
    rankBy,
  });
  const TOP_N = 50;

  return (
    <LegacyLeaderboardClient
      data={{ ...data, entries: data.entries.slice(0, TOP_N) }}
      total={data.total}
      selfUserId={authUser?.userId ?? null}
      initialScope={scope}
      initialRankBy={rankBy}
    />
  );
}
