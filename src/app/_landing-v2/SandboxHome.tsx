"use client";

/**
 * Full-bleed, globe-behind-a-drawer landing design.
 *
 * Design intent:
 *   - Globe is `fixed inset-0 z-0` — always in the background viewport layer,
 *     unaffected by parent overflow constraints that break `sticky`.
 *   - A first-viewport hero div (transparent, h-100svh) overlays the globe.
 *     It is `pointer-events-none` so drag/zoom fall through to the fixed globe.
 *   - The opaque drawer below slides up over the globe as the user scrolls,
 *     covering it once the drawer fills the viewport.
 *   - The real game Navbar (from NavbarWrapper in layout.tsx) renders on top
 *     at z-50; the globe and hero sit behind it.
 */
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cdnStatic, CDN_WORLD_GEO_URL } from "@/lib/images/cdnUrls";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Badge } from "@/components/ui";
import { getEraConfig } from "@/components/landing/eraThemes";
import { buildStarfield } from "@/components/landing/globeEnhancements";
import { getEraFlavorCards } from "@/components/landing/flavorCards";
import {
  battlegroundFeatureIdsForEra,
  economicPowerFeatureIdsForEra,
} from "@/components/landing/countryTierRosters";
import { CookieSettingsLink } from "@/components/CookieSettingsLink";
import { CrtCountdown, useCrtCountdown } from "./CrtCountdown";
import type { GovernmentType } from "@/lib/constants/countries";
import type { EraNation, EraTileKey } from "@/components/landing/eraThemes";
import type { DiscordInviteStats } from "@/lib/discord/inviteStats";

export type LandingCrisis = {
  _id: string;
  name: string;
  description: string;
  heroImage?: string;
  scope: "global" | "country" | "region";
  countryIds: string[];
};

// d3-geo relies on browser APIs; skip server render.
const LandingGlobe = dynamic(
  () => import("@/components/LandingGlobe").then((m) => m.LandingGlobe),
  {
    ssr: false,
    loading: () => <div className="h-full w-full" />,
  }
);

// Below-the-fold, client-only: split out of the initial hero bundle.
const FlavorCardCarousel = dynamic(() =>
  import("@/components/landing/FlavorCardCarousel").then((m) => m.FlavorCardCarousel)
);
const CommunitySupportSection = dynamic(() =>
  import("@/components/landing/CommunitySupportSection").then((m) => m.CommunitySupportSection)
);

/* -------------------------------------------------------------------------- */
/* Shared styles + links                                                       */
/* -------------------------------------------------------------------------- */

type BlocId = "western" | "eastern";

const BLOC_META: Record<BlocId, { label: string; badge: "info" | "primary" }> = {
  western: { label: "Western Market Economies", badge: "info" },
  eastern: { label: "Eastern Bloc", badge: "primary" },
};

/** Playability remains a secondary cue on each chip; primary grouping is bloc. */
const TIER_CHIP: Record<EraNation["tier"], { label: string; className: string }> = {
  player: { label: "Playable", className: "text-success" },
  econ: { label: "Economy", className: "text-info" },
  npp: { label: "Soon", className: "text-muted" },
};

/** Only one-party/command systems land in Eastern Bloc — never default unknowns there. */
function isEasternBloc(governmentType: GovernmentType | undefined): boolean {
  return governmentType === "onePartyState";
}

const PRIMARY_BUTTON_CLASSES =
  "pointer-events-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4.5 h-11 text-sm font-semibold text-white transition-all duration-150 hover:bg-primary-dark hover:shadow-lg hover:shadow-primary/25 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const SECONDARY_BUTTON_CLASSES =
  "pointer-events-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-card-border bg-card/80 px-4.5 h-11 text-sm font-medium text-foreground backdrop-blur-sm transition-all duration-150 hover:bg-card hover:border-muted/40 active:scale-[0.98]";

const GHOST_BUTTON_CLASSES =
  "pointer-events-auto inline-flex items-center justify-center gap-1.5 rounded-lg px-4.5 h-11 text-sm font-medium text-muted backdrop-blur-sm transition-all duration-150 hover:text-foreground active:scale-[0.98]";

/** Public sideload mirror for the Android beta build;  */
const ANDROID_BETA_APK_URL = "https://ops.lakesidegames.net/downloads/a-house-divided-0.3.1.apk";

function links(isSignedIn: boolean) {
  return {
    primary: isSignedIn ? "/dashboard" : "/register",
    secondary: "/world",
    closing: isSignedIn ? "/dashboard" : "/register",
    tiles: {
      stateMetrics: isSignedIn ? "/dashboard" : "/login",
      ballot: isSignedIn ? "/elections" : "/login",
      bills: isSignedIn ? "/legislation" : "/login",
      industrial: isSignedIn ? "/sectors" : "/login",
      markets: isSignedIn ? "/stockmarket/global" : "/login",
      newsroom: isSignedIn ? "/news" : "/login",
      centralBanks: isSignedIn ? "/world" : "/login",
    },
  };
}

const FOOTER_NAV = [
  {
    heading: "Game",
    links: [
      { href: "/world", label: "World map" },
      { href: "/news", label: "News wire" },
      { href: "/changelog", label: "What's new" },
      { href: "/register", label: "Create account" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { href: "/guides", label: "Guides" },
      { href: "/wiki", label: "Wiki" },
      { href: "/faq", label: "FAQ" },
      { href: "/about", label: "About" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
      { href: "/contact", label: "Contact" },
    ],
  },
] as const;

const LEARN_LINKS = [
  {
    href: "/guides",
    title: "Player guides",
    body: "Step-by-step guides to running for office, founding corporations, and trading bonds, forex, and commodities.",
    cta: "Browse the guides",
  },
  {
    href: "/wiki",
    title: "Game wiki",
    body: "The full reference: elections, legislation, parties, central banks, and every country in the simulation.",
    cta: "Open the wiki",
  },
  {
    href: "/news",
    title: "News wire",
    body: "Player-written headlines, campaign coverage, and policy editorials straight from the live world.",
    cta: "Read the wire",
  },
  {
    href: "/faq",
    title: "FAQ & about",
    body: "How the hourly game clock works, what it costs (nothing), and who builds A House Divided.",
    cta: "Get answers",
  },
] as const;

/**
 * Era-neutral tile copy. Anything an era does not override falls back to these,
 * so a new preset can never inherit another decade's politics by accident (a
 * 1953 world used to advertise "the post-Watergate trust deficit").
 */
const DEFAULT_TILE_BODIES: Record<EraTileKey, string> = {
  stateMetrics:
    "Track demographics, unemployment, and the institutional trust every incumbent is spending down.",
  ballot:
    "Run for House, Senate, Governor, or the state legislature. Primaries first, then the general.",
  bills: "Draft bills, whip votes, and trade amendments to get your programme through the chamber.",
  industrial: "Found corporations, grow sectors, and pay dividends out of what you build.",
  markets: "Trade commodities and currencies against every other economy in the world.",
  newsroom: "Follow every bill, crisis, and cabinet shuffle through the in-game wire and wiki.",
  centralBanks: "Set the prime rate and manage a line of credit for a whole national economy.",
};

const TILE_IMAGES = {
  stateMetrics: "state-metrics",
  ballot: "ballot-box",
  bills: "legislative-combat",
  industrial: "industrial-empires",
  markets: "global-markets",
  newsroom: "newsroom",
  centralBanks: "central-banks",
  world: "world-1979",
} as const;

/**
 * Bento tile with a frosted CDN hover image behind the content.
 */
function BentoTile({
  index,
  title,
  body,
  href,
  imageSlug,
  className,
}: {
  index: number;
  title: string;
  body: string;
  href: string;
  imageSlug: string;
  className?: string;
}) {
  // This art is decorative (aria-hidden) and only ever visible on hover/focus,
  // so it is mounted on first hover instead of at page load. The six tile
  // images total ~888KB — on a touch device, where hover never fires, that was
  // the largest single block of bytes on the page and nothing was ever shown
  // for it. Desktop still gets the effect; the fade-in covers decode time.
  // Perf audit 2026-07-26.
  const [showArt, setShowArt] = useState(false);

  return (
    <Link
      href={href}
      onMouseEnter={() => setShowArt(true)}
      onFocus={() => setShowArt(true)}
      className={`group relative flex flex-col overflow-hidden rounded-lg border border-card-border bg-card p-5 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-muted/40 hover:shadow-lg ${className ?? ""}`}
    >
      {/* unoptimized: static Cloudflare CDN art — routing through the Railway image optimizer would add egress */}
      {showArt ? (
        <Image
          src={cdnStatic("landing", imageSlug)}
          alt=""
          aria-hidden="true"
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          loading="lazy"
          unoptimized={bypassNextImageOptimization(cdnStatic("landing", imageSlug))}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="pointer-events-none object-cover opacity-0 blur-[3px] transition-opacity duration-300 group-hover:opacity-100"
        />
      ) : null}
      <div
        className="absolute inset-0 bg-background/55 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        aria-hidden="true"
      />
      <div className="relative z-10">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-body-xs text-primary">
            {String(index).padStart(2, "0")}
          </span>
          <h3 className="text-heading-sm font-semibold text-foreground">{title}</h3>
        </div>
        <p className="text-body leading-relaxed text-muted">{body}</p>
        <span className="mt-3 inline-flex items-center gap-1 text-body-sm font-medium text-primary transition-transform group-hover:translate-x-0.5">
          Enter<span aria-hidden="true">→</span>
        </span>
      </div>
    </Link>
  );
}

export function SandboxHome({
  isSignedIn,
  era = "1979",
  crises = [],
  playerCounts = {},
  governmentTypes = {},
  discordStats = null,
}: {
  isSignedIn: boolean;
  era?: string | number;
  crises?: LandingCrisis[];
  playerCounts?: Record<string, number>;
  /** Live-or-static governmentType per country id (from countryState + COUNTRY_CONFIGS). */
  governmentTypes?: Record<string, GovernmentType>;
  /** Server-fetched Discord member/online counts for the community section. */
  discordStats?: DiscordInviteStats | null;
}) {
  const eraConfig = getEraConfig(era);
  const [hoveredBloc, setHoveredBloc] = useState<BlocId | null>(null);
  // True while the globe is idling through its historical-crisis showcase —
  // fades the hero copy out of the way so the story reads without clutter.
  const [showcaseActive, setShowcaseActive] = useState(false);
  // Non-null only while the promo countdown is still running. It doubles as the
  // pause switch for the globe's idle crisis tour: the countdown owns the hero
  // until the deadline, after which both revert to normal behaviour with no
  // deploy needed.
  const countdown = useCrtCountdown();
  // Deferred hover art for the wide world tile — see BentoTile.
  const [showWorldArt, setShowWorldArt] = useState(false);
  const l = links(isSignedIn);

  // Signal-field star scatter: a full-viewport layer independent of the
  // globe's own tiny SVG canvas, so density/twinkle never depend on how much
  // of that canvas the oversized background crop happens to show on-screen.
  // Distinct seed from the globe's own starfield so the two patterns don't echo.
  const signalFieldStars = useMemo(
    () => buildStarfield({ width: 100, height: 100, count: 64, seed: 8420 }),
    []
  );

  const countriesByBloc = useMemo(() => {
    const western: EraNation[] = [];
    const eastern: EraNation[] = [];
    for (const nation of eraConfig.nations) {
      if (isEasternBloc(governmentTypes[nation.id])) {
        eastern.push(nation);
      } else {
        western.push(nation);
      }
    }
    return { western, eastern };
  }, [eraConfig, governmentTypes]);

  const visibleBlocs = useMemo(
    () => (["western", "eastern"] as BlocId[]).filter((bloc) => countriesByBloc[bloc].length > 0),
    [countriesByBloc]
  );

  const tileBody = (key: EraTileKey): string =>
    eraConfig.tileBodies?.[key] ?? DEFAULT_TILE_BODIES[key];

  const wireframeColor = eraConfig.wireframeColor ?? undefined;
  // Sphere / conflict / crisis theatres for this era, mirroring the world
  // entity manifest. Stable module-level array, so the globe memoises on it.
  const battlegroundFeatureIds = battlegroundFeatureIdsForEra(eraConfig.id);
  const economicPowerFeatureIds = economicPowerFeatureIdsForEra(eraConfig.id);

  return (
    <div className="relative bg-background text-foreground">
      {/* ── Fixed globe — always in the background viewport layer ──────────── */}
      {/* `fixed` bypasses parent overflow-x-hidden on <main> that breaks sticky. */}
      <div className="fixed inset-0 z-0" aria-hidden="true">
        {wireframeColor && (
          <div
            className="pointer-events-none absolute inset-0 z-[1]"
            style={{
              background:
                "repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px)",
            }}
          />
        )}
        {wireframeColor && (
          <>
            {/* ── Signal field: phosphor ground glow, star scatter, drifting scan beam ── */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(circle at 60% 48%, ${wireframeColor}14, transparent 46%)`,
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              style={{
                WebkitMaskImage: "radial-gradient(85% 85% at 60% 48%, #000 20%, transparent 92%)",
                maskImage: "radial-gradient(85% 85% at 60% 48%, #000 20%, transparent 92%)",
              }}
            >
              {signalFieldStars.map((s, i) => {
                const size = 1.2 + s.r * 2;
                const alphaHex = Math.round(s.opacity * 255)
                  .toString(16)
                  .padStart(2, "0");
                return (
                  <div
                    key={s.id}
                    className="ahd-star-twinkle absolute rounded-full"
                    style={{
                      left: `${s.cx}%`,
                      top: `${s.cy}%`,
                      width: `${size}px`,
                      height: `${size}px`,
                      background: `${wireframeColor}${alphaHex}`,
                      animationDelay: `${s.twinkleDelay}s`,
                      animationDuration: `${3.6 + (i % 4) * 0.6}s`,
                    }}
                  />
                );
              })}
            </div>
            <div
              className="ahd-scan-drift pointer-events-none absolute inset-x-0 top-[-18vmax]"
              style={{
                height: "18vmax",
                background: `linear-gradient(to bottom, transparent, ${wireframeColor}2e, transparent)`,
                WebkitMaskImage: "radial-gradient(85% 85% at 60% 48%, #000 20%, transparent 92%)",
                maskImage: "radial-gradient(85% 85% at 60% 48%, #000 20%, transparent 92%)",
              }}
            />
          </>
        )}
        <div
          className="absolute left-[60%] top-[48%] h-[130vmax] w-[130vmax] -translate-x-1/2 -translate-y-1/2"
          style={
            wireframeColor ? { filter: `drop-shadow(0 0 18px ${wireframeColor}55)` } : undefined
          }
        >
          <LandingGlobe
            bare
            enhanced
            hideLiveIndicator
            gameDate={eraConfig.gameDate}
            countryAccess={eraConfig.accessMap}
            geoUrl={CDN_WORLD_GEO_URL}
            initialRotation={[-12, -38, 0]}
            initialZoom={1.05}
            wireframeColor={wireframeColor}
            playerCounts={playerCounts}
            battlegroundFeatureIds={battlegroundFeatureIds}
            economicPowerFeatureIds={economicPowerFeatureIds}
            onShowcaseActiveChange={setShowcaseActive}
            showcasePaused={countdown !== null}
          />
        </div>

        {/* Radial vignette fades globe into page background at edges. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(125%_125%_at_68%_42%,transparent_38%,var(--background)_86%)]" />
        {/* Left scrim keeps hero copy legible against the globe. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-full bg-gradient-to-r from-background via-background/70 to-transparent sm:w-3/4 lg:w-3/5" />
        {/* Bottom fade blends into the drawer's rounded top. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
      </div>

      {/* ── First-viewport hero — transparent, globe shows through ─────────── */}
      {/* pointer-events-none lets drag/zoom fall through to the fixed globe. */}
      <div
        id="top"
        className="pointer-events-none relative z-10 flex h-[100svh] min-h-[560px] flex-col justify-center"
      >
        {/* Hero copy — fades out of the way during the idle crisis showcase,
            back in the instant the user drags/scrolls/clicks. */}
        <div
          className={`mx-auto w-full max-w-7xl px-5 transition-opacity duration-700 ease-out sm:px-8 ${
            showcaseActive ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
          }`}
        >
          <div className="max-w-xl">
            <CrtCountdown remaining={countdown} />
            <h1 className="font-display text-display font-bold leading-tight tracking-tight text-foreground">
              {eraConfig.heroHeadline}
            </h1>
            <p className="mt-5 max-w-lg text-body-lg leading-relaxed text-muted">
              {eraConfig.heroDek}
            </p>
            {/* Three actions, one shape each: create an account, come back to
                one, or look around first. The app download lives in the drawer
                below — it is not a way into the game. */}
            <div className="mt-7 flex flex-wrap items-center gap-3">
              {isSignedIn ? (
                <Link href={l.primary} className={PRIMARY_BUTTON_CLASSES}>
                  Back to dashboard
                  <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <>
                  <Link href="/register" className={PRIMARY_BUTTON_CLASSES}>
                    Sign up
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link href="/login" className={SECONDARY_BUTTON_CLASSES}>
                    Sign in
                  </Link>
                </>
              )}
              <Link href={l.secondary} className={SECONDARY_BUTTON_CLASSES}>
                Explore
              </Link>
            </div>
            {/* Full-width pill under the actions: a link out to the 1953 world
                report, not a fourth call to action. */}
            <a
              href="https://ops.ahousedividedgame.com/p/1953"
              target="_blank"
              rel="noopener noreferrer"
              className="pointer-events-auto mt-5 flex w-full max-w-lg items-center gap-2.5 rounded-full border border-card-border bg-card/70 py-1.5 pl-1.5 pr-3.5 text-body-xs font-medium text-foreground backdrop-blur-sm transition-colors hover:border-primary/50 hover:bg-card"
            >
              <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-[0.65rem] font-bold uppercase tracking-wider text-white">
                New
              </span>
              <span className="text-muted">v1.0.0 · Explore the 1953 World</span>
              <span aria-hidden="true" className="ml-auto text-primary">
                →
              </span>
            </a>
          </div>
        </div>

        {/* Scroll cue */}
        <div
          className={`absolute inset-x-0 bottom-6 flex flex-col items-center gap-1.5 transition-opacity duration-700 ease-out ${
            showcaseActive ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="text-body-xs uppercase tracking-widest text-muted">
            Drag the globe · scroll to enter
          </span>
          <span className="block h-5 w-[1px] animate-pulse bg-muted/60" />
        </div>
      </div>

      {/* ── Drawer — opaque, rises over the fixed globe as you scroll ──────── */}
      <div className="relative z-10 -mt-[12vh] rounded-t-[2rem] border-t border-card-border bg-background shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.45)]">
        {/* Grabber handle */}
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-12 rounded-full bg-muted/40" aria-hidden="true" />
        </div>

        {/* The halls of power */}
        <section id="play" className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
          <SectionLabel as="h2">The halls of power</SectionLabel>
          <p className="mb-8 max-w-2xl text-body-lg leading-relaxed text-muted">
            {eraConfig.playSectionDek}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BentoTile
              index={1}
              title="State metrics"
              body={tileBody("stateMetrics")}
              href={l.tiles.stateMetrics}
              imageSlug={TILE_IMAGES.stateMetrics}
              className="lg:row-span-2"
            />
            <BentoTile
              index={2}
              title="The ballot box"
              body={tileBody("ballot")}
              href={l.tiles.ballot}
              imageSlug={TILE_IMAGES.ballot}
            />
            <BentoTile
              index={3}
              title="Legislative combat"
              body={tileBody("bills")}
              href={l.tiles.bills}
              imageSlug={TILE_IMAGES.bills}
            />
            <BentoTile
              index={4}
              title="Industrial empires"
              body={tileBody("industrial")}
              href={l.tiles.industrial}
              imageSlug={TILE_IMAGES.industrial}
            />
            <BentoTile
              index={5}
              title="Global markets"
              body={tileBody("markets")}
              href={l.tiles.markets}
              imageSlug={TILE_IMAGES.markets}
            />
            <BentoTile
              index={6}
              title="The newsroom"
              body={tileBody("newsroom")}
              href={l.tiles.newsroom}
              imageSlug={TILE_IMAGES.newsroom}
            />
            {/* Wide world tile with inline tier chips */}
            <div
              id="world"
              onMouseEnter={() => setShowWorldArt(true)}
              onFocus={() => setShowWorldArt(true)}
              className="group relative overflow-hidden rounded-lg border border-card-border bg-card p-5 shadow-card sm:col-span-2 lg:col-span-2"
            >
              {/* unoptimized: static Cloudflare CDN art — routing through the Railway image optimizer would add egress */}
              {/* Hover-only decorative art — deferred to first hover, same as
                  BentoTile above. Perf audit 2026-07-26. */}
              {showWorldArt ? (
                <Image
                  src={cdnStatic("landing", TILE_IMAGES.world)}
                  alt=""
                  aria-hidden="true"
                  fill
                  sizes="(max-width: 640px) 100vw, 66vw"
                  loading="lazy"
                  unoptimized={bypassNextImageOptimization(cdnStatic("landing", TILE_IMAGES.world))}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                  className="pointer-events-none object-cover opacity-0 blur-[3px] transition-opacity duration-300 group-hover:opacity-100"
                />
              ) : null}
              <div
                className="absolute inset-0 bg-background/55 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                aria-hidden="true"
              />
              <div className="relative z-10">
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-mono text-body-xs text-primary">07</span>
                  <h3 className="text-heading-sm font-semibold text-foreground">
                    The world in {eraConfig.year}
                  </h3>
                </div>
                <p className="mb-4 text-body leading-relaxed text-muted">
                  {eraConfig.worldSectionDek}
                </p>
                <div className="space-y-3">
                  {visibleBlocs.map((bloc) => {
                    const meta = BLOC_META[bloc];
                    const countries = countriesByBloc[bloc];
                    const isDimmed = hoveredBloc !== null && hoveredBloc !== bloc;
                    return (
                      <div
                        key={bloc}
                        className={`transition-opacity duration-200 ${
                          isDimmed ? "opacity-40" : "opacity-100"
                        }`}
                        onMouseEnter={() => setHoveredBloc(bloc)}
                        onMouseLeave={() => setHoveredBloc(null)}
                      >
                        <div className="mb-1.5 flex items-center gap-2">
                          <Badge color={meta.badge} variant="subtle">
                            {meta.label}
                          </Badge>
                          <span className="text-body-xs text-muted">
                            {countries.length} nation{countries.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {countries.map((c) => {
                            const tierMeta = TIER_CHIP[c.tier];
                            return (
                              <span
                                key={c.id}
                                className={`inline-flex items-center gap-1.5 rounded-full border border-card-border bg-background px-2 py-0.5 text-body-xs text-muted ${
                                  c.tier === "npp" ? "opacity-70" : ""
                                }`}
                              >
                                {c.name}
                                <span
                                  className={`font-medium ${tierMeta.className}`}
                                  title={
                                    c.tier === "player"
                                      ? "Playable"
                                      : c.tier === "econ"
                                        ? "Economy preview"
                                        : "Coming soon"
                                  }
                                >
                                  · {tierMeta.label}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <BentoTile
              index={8}
              title="Central banks"
              body={tileBody("centralBanks")}
              href={l.tiles.centralBanks}
              imageSlug={TILE_IMAGES.centralBanks}
              className="lg:col-start-4 lg:row-start-2"
            />
          </div>
        </section>

        {/* Flavor cards carousel */}
        <section className="border-t border-card-border bg-card-muted/20">
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
            {/* The carousel is leaders PLUS whatever crises are live in the
                world right now, so it cannot be headed "Leaders of the era":
                on a world mid-crisis the section promised portraits and
                delivered freight reroutes. */}
            <SectionLabel as="h2">The world in {eraConfig.year}</SectionLabel>
            <p className="mb-8 max-w-2xl text-body-lg leading-relaxed text-muted">
              The people in charge, and the crises running live right now. Swipe or use arrow keys
              to browse.
            </p>
            <FlavorCardCarousel staticCards={getEraFlavorCards(era)} crises={crises} />
          </div>
        </section>

        {/* Learn the game */}
        <section className="border-t border-card-border">
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
            <SectionLabel as="h2">Learn the game</SectionLabel>
            <p className="mb-8 max-w-2xl text-body-lg leading-relaxed text-muted">
              Guides, a living wiki, and the in-character news wire — everything you need before
              your first campaign, no account required.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {LEARN_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex flex-col rounded-lg border border-card-border bg-card p-5 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-muted/40 hover:shadow-lg"
                >
                  <h3 className="mb-2 text-heading-sm font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="text-body leading-relaxed text-muted">{item.body}</p>
                  <span className="mt-3 text-body-sm font-medium text-primary">
                    {item.cta} <span aria-hidden="true">→</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <CommunitySupportSection initialStats={discordStats} />

        {/* Closing CTA */}
        <section className="border-t border-card-border">
          <div className="mx-auto max-w-7xl px-5 py-16 text-center sm:px-8 sm:py-24">
            <h2 className="font-display text-heading-lg font-semibold tracking-tight text-foreground sm:text-display">
              {eraConfig.closingHeadline}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-body-lg text-muted">{eraConfig.closingDek}</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href={l.closing} className={PRIMARY_BUTTON_CLASSES}>
                {isSignedIn ? "Back to dashboard" : eraConfig.closingCta}
                <span aria-hidden="true">→</span>
              </Link>
              {/* Moved out of the hero: the Android build is for people already
                  sold on the game, so it belongs at the bottom of the read. */}
              <a
                href={ANDROID_BETA_APK_URL}
                download
                target="_blank"
                rel="noopener noreferrer"
                className={GHOST_BUTTON_CLASSES}
              >
                Get the app (beta)
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        </section>

        {/* Footer: site navigation + tagline + image attributions */}
        <footer className="border-t border-card-border bg-card-muted/30">
          <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
            <nav
              aria-label="Footer"
              className="mx-auto mb-8 grid max-w-3xl grid-cols-2 gap-8 text-left sm:grid-cols-3"
            >
              {FOOTER_NAV.map((col) => (
                <div key={col.heading}>
                  <h3 className="mb-2 text-body-xs font-semibold uppercase tracking-widest text-muted/80">
                    {col.heading}
                  </h3>
                  <ul className="space-y-1.5">
                    {col.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="text-body-sm text-muted transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                    {col.heading === "Legal" && (
                      <li>
                        <CookieSettingsLink
                          hideOnPrivacyPage
                          className="text-body-sm text-muted transition-colors hover:text-foreground"
                        />
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
          <div className="mx-auto max-w-7xl border-t border-card-border/60 px-5 py-8 text-center sm:px-8">
            <p className="text-body-sm text-muted">{eraConfig.footerTagline}</p>
            <a
              href="https://lakesidegames.net"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-body-sm text-muted transition-colors hover:text-foreground"
            >
              <Image
                src="/lakeside-mark.svg"
                alt="Lakeside Games"
                width={20}
                height={20}
                className="opacity-80"
              />
              <span>a Lakeside Games game</span>
            </a>
            <p className="mx-auto mt-3 max-w-3xl text-body-xs leading-relaxed text-muted/70">
              Landing imagery via Wikimedia Commons. CC BY 4.0: &ldquo;1977 Israeli legislative
              election&rdquo; — Danny Gotfried / Israel Press and Photo Agency (Dan Hadani
              collection, National Library of Israel). CC BY-SA 2.0: &ldquo;Berlin — Checkpoint
              Charlie&rdquo; — Roger Wollstadt. All other landing images are public domain (NARA /
              EPA DOCUMERICA / White House / Library of Congress / Federal Reserve / FSA-OWI).
              Leader portraits via Wikimedia Commons, public domain: George H.W. Bush — David Valdez
              / White House; John Major — PFC Tracey L. Hall-Leahy, U.S. Army; Deng Xiaoping —
              public domain.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
