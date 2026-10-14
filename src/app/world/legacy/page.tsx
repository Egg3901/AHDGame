import { redirect } from "next/navigation";

/** Preserve old bookmarks while keeping contests and rankings in one place. */
export default async function LegacyLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; rankBy?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ view: "rankings" });
  if (params.scope === "current") query.set("scope", "current");
  if (params.rankBy === "netWorth") query.set("rankBy", "netWorth");
  redirect(`/contests?${query}`);
}
