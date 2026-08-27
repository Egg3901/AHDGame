import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COUNTRY_CONFIGS, getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import { getCountryAccess } from "@/lib/countryAccess";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getGameState } from "@/lib/gameState";
import { getDb } from "@/lib/mongodb";
import { loadCountryWarNotice } from "@/lib/military/countryAtWar";
import { WartimeBanner } from "./WartimeBanner";
import { PeaceBanner } from "./PeaceBanner";
import { loadCountryPeaceNotice } from "@/lib/military/countryPeaceNotice";

interface Props {
  params: Promise<{ code: string }>;
  children: React.ReactNode;
}

// Every /country/* page is a client-rendered stat surface: the server HTML is a
// ~46-word shell, which search and ad-review classifiers read as auto-generated
// thin content. Keep the tree crawlable (robots.ts must NOT disallow it, or the
// noindex is never seen) but out of the index, so the site is judged on its
// editorial pages. Child pages inherit this; none of them set their own robots.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function CountryLayout({ params, children }: Props) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];

  if (!config) notFound();

  // Parallelize independent DB lookups
  const [access, user, gameState, war] = await Promise.all([
    getCountryAccess(countryId),
    getAuthUserWithCharacter(),
    getGameState(),
    // One indexed read against a collection that holds a handful of documents.
    // Joined to the batch above rather than awaited after it, so the banner costs
    // no extra round trip on any country page.
    getDb().then((db) => loadCountryWarNotice(db, countryId)),
  ]);

  // NOT in the batch above, because it needs the viewer resolved: the peace strip is
  // seat gated and there is nobody to check until `getAuthUserWithCharacter` has
  // returned. Skipped entirely in peacetime, so the common case costs nothing.
  const peace = war
    ? await getDb().then((db) =>
        loadCountryPeaceNotice(
          db,
          countryId,
          user?.character?._id ?? null,
          gameState?.currentTurn ?? 0
        )
      )
    : null;

  // Null in peacetime, which renders nothing. Declared once and used by all three
  // viewable branches below: a war is a fact about the COUNTRY, so which of them a
  // given reader lands in must not change whether they are told about it.
  const wartime = war ? <WartimeBanner notice={war} /> : null;

  const isAdmin = user?.isAdmin === true;
  // Era-aware display name (e.g. "West Germany" in 1979) for the banners/headings.
  const name = getCountryDisplayName(countryId, gameState?.preset);

  // Declared here with the war strip and used by all three viewable branches below,
  // for the same reason: which branch a reader lands in must not change whether they
  // are told a decision is waiting on them.
  const peacetime = peace ? <PeaceBanner notice={peace} countryName={name} /> : null;

  // Admins always see everything — just show a banner when the country is not
  // yet enabled for regular players.
  if (isAdmin) {
    const showAdminBanner = !access.enabledForPlayers;
    return (
      <>
        {wartime}
        {peacetime}
        {showAdminBanner && (
          <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 text-center text-sm text-warning">
            {access.econOnly
              ? "Econ-only nation — players can view every page here, but cannot act."
              : "This country is not registered. Only admins can see this."}
          </div>
        )}
        {children}
      </>
    );
  }

  // Fully enabled — render normally, save for the war strip.
  if (access.enabledForPlayers) {
    return (
      <>
        {wartime}
        {peacetime}
        {children}
      </>
    );
  }

  // Econ-only nation: a registered country that is not open for play. Every page
  // renders READ-ONLY, political ones included, so a player can see the parties,
  // the legislature, and the elections behind the economy they are investing in.
  // Actions stay blocked by the per-action APIs, which require citizenship or
  // office. Deliberately independent of the NPP autonomy dial: turning autonomy
  // down must not silently re-close half the world.
  if (access.econOnly) {
    return (
      <>
        {wartime}
        {peacetime}
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 text-center text-sm text-primary">
          {name} is an econ-only nation. You can view every page here, but you cannot run for
          office, join a party, or vote.
        </div>
        {children}
      </>
    );
  }

  // Unregistered — no seeded world behind it. Show Under Development.
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <CountryFlag country={countryId} width={60} height={40} />
      <h1 className="text-2xl font-bold text-foreground">{name}</h1>
      <p className="max-w-md text-muted">
        This country is currently under development. Check back soon!
      </p>
    </div>
  );
}
