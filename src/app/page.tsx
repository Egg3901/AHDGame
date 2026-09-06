import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAuthUser } from "@/lib/auth";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { getCachedLandingData } from "@/lib/landing/cachedLandingData";
import { buildGovernmentTypeMap } from "@/lib/landing/governmentTypeMap";
import { fetchDiscordInviteStats } from "@/lib/discord/inviteStats";
import type { DiscordInviteStats } from "@/lib/discord/inviteStats";
import { SandboxHome } from "./_landing-v2/SandboxHome";
import { isSingleplayer } from "@/lib/singleplayer";
import { getDb } from "@/lib/mongodb";
import { singleplayerStatus } from "@/lib/singleplayerServer";

// Auth redirect must stay per-request. Mongo marketing data is served from a
// short in-process TTL cache (see getCachedLandingData) so anonymous stampedes
// do not each pay 5+ fresh DB round-trips.
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return publicPageMetadata({
    title: t("landing.metaTitle"),
    description: t("landing.metaDescription"),
    pathname: "/",
  });
}

export default async function LandingPage() {
  if (isSingleplayer()) {
    const status = await singleplayerStatus(await getDb());
    if (!status.hasWorld) redirect("/singleplayer");
    if (status.mode === "worldsim") redirect("/singleplayer/worldsim");
    if (!status.hasCharacter) redirect("/create-character");
    redirect("/profile");
  }

  const user = await getAuthUser();
  if (user) {
    redirect("/profile");
  }

  // Discord invite stats already have a 5-minute in-process TTL; fetch in
  // parallel with the cached Mongo snapshot so the community section paints
  // without a post-hydration waterfall. Failures are isolated so a DB outage
  // does not block Discord counts (and vice versa).
  const [snapshot, discordStats] = await Promise.all([
    getCachedLandingData().catch(() => null),
    fetchDiscordInviteStats().catch(() => null as DiscordInviteStats | null),
  ]);

  const seedYear = snapshot?.seedYear ?? 1979;
  const crises = snapshot?.crises ?? [];
  const playerCounts = snapshot?.playerCounts ?? {};
  const governmentTypes = snapshot?.governmentTypes ?? buildGovernmentTypeMap();

  return (
    <SandboxHome
      isSignedIn={false}
      era={seedYear}
      crises={crises}
      playerCounts={playerCounts}
      governmentTypes={governmentTypes}
      discordStats={discordStats}
    />
  );
}
