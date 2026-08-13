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
import { useTranslations } from "next-intl";
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
type TFunc = ReturnType<typeof useTranslations>;

const blocMeta = (t: TFunc): Record<BlocId, { label: string; badge: "info" | "primary" }> => ({
  western: { label: t("landing.blocs.western"), badge: "info" },
  eastern: { label: t("landing.blocs.eastern"), badge: "primary" },
});

/** Playability remains a secondary cue on each chip; primary grouping is bloc. */
const tierChip = (
  t: TFunc
): Record<EraNation["tier"], { label: string; title: string; className: string }> => ({
  player: {
    label: t("landing.tiers.playable"),
    title: t("landing.tiers.playableTitle"),
    className: "text-success",
  },
  econ: {
    label: t("landing.tiers.economy"),
    title: t("landing.tiers.economyTitle"),
    className: "text-info",
  },
  npp: {
    label: t("landing.tiers.soon"),
    title: t("landing.tiers.soonTitle"),
    className: "text-muted",
  },
});

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

const footerNav = (t: TFunc) =>
  [
    {
      heading: t("landing.footer.game"),
      links: [
        { href: "/world", label: t("landing.footer.worldMap") },
        { href: "/news", label: t("landing.footer.newsWire") },
        { href: "/changelog", label: t("landing.footer.whatsNew") },
        { href: "/register", label: t("landing.footer.createAccount") },
      ],
    },
    {
      heading: t("landing.footer.learn"),
      links: [
        { href: "/guides", label: t("landing.footer.guides") },
        { href: "/wiki", label: t("landing.footer.wiki") },
        { href: "/faq", label: t("landing.footer.faq") },
        { href: "/about", label: t("landing.footer.about") },
      ],
    },
    {
      heading: t("landing.footer.legal"),
      links: [
        { href: "/privacy", label: t("landing.footer.privacy") },
        { href: "/terms", label: t("landing.footer.terms") },
        { href: "/contact", label: t("landing.footer.contact") },
      ],
    },
  ] as const;

const learnLinks = (t: TFunc) =>
  [
    {
      href: "/guides",
      title: t("landing.learnLinks.guidesTitle"),
      body: t("landing.learnLinks.guidesBody"),
      cta: t("landing.learnLinks.guidesCta"),
    },
    {
      href: "/wiki",
      title: t("landing.learnLinks.wikiTitle"),
      body: t("landing.learnLinks.wikiBody"),
      cta: t("landing.learnLinks.wikiCta"),
    },
    {
      href: "/news",
      title: t("landing.learnLinks.newsTitle"),
      body: t("landing.learnLinks.newsBody"),
      cta: t("landing.learnLinks.newsCta"),
    },
    {
      href: "/faq",
      title: t("landing.learnLinks.faqTitle"),
      body: t("landing.learnLinks.faqBody"),
      cta: t("landing.learnLinks.faqCta"),
    },
  ] as const;

/**
 * Era-neutral tile copy. Anything an era does not override falls back to these,
 * so a new preset can never inherit another decade's politics by accident (a
 * 1953 world used to advertise "the post-Watergate trust deficit").
 */
const defaultTileBodies = (t: TFunc): Record<EraTileKey, string> => ({
  stateMetrics: t("landing.tiles.stateMetricsBody"),
  ballot: t("landing.tiles.ballotBody"),
  bills: t("landing.tiles.billsBody"),
  industrial: t("landing.tiles.industrialBody"),
  markets: t("landing.tiles.marketsBody"),
  newsroom: t("landing.tiles.newsroomBody"),
  centralBanks: t("landing.tiles.centralBanksBody"),
});

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
  enterLabel,
}: {
  index: number;
  title: string;
  body: string;
  href: string;
  imageSlug: string;
  className?: string;
  enterLabel: string;
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
          {enterLabel}
          <span aria-hidden="true">→</span>
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
  const t = useTranslations("auth");
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

  const tileBodies = useMemo(() => defaultTileBodies(t), [t]);
  const tileBody = (key: EraTileKey): string => eraConfig.tileBodies?.[key] ?? tileBodies[key];
  const bloc = useMemo(() => blocMeta(t), [t]);
  const tier = useMemo(() => tierChip(t), [t]);
  const footer = useMemo(() => footerNav(t), [t]);
  const learn = useMemo(() => learnLinks(t), [t]);

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
                  {t("landing.backToDashboard")}
                  <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <>
                  <Link href="/register" className={PRIMARY_BUTTON_CLASSES}>
                    {t("landing.signUp")}
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link href="/login" className={SECONDARY_BUTTON_CLASSES}>
                    {t("landing.signIn")}
                  </Link>
                </>
              )}
              <Link href={l.secondary} className={SECONDARY_BUTTON_CLASSES}>
                {t("landing.explore")}
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
                {t("landing.newBadge")}
              </span>
              <span className="text-muted">{t("landing.promoPill")}</span>
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
            {t("landing.scrollCue")}
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
          <SectionLabel as="h2">{t("landing.hallsOfPower")}</SectionLabel>
          <p className="mb-8 max-w-2xl text-body-lg leading-relaxed text-muted">
            {eraConfig.playSectionDek}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BentoTile
              index={1}
              title={t("landing.tiles.stateMetrics")}
              body={tileBody("stateMetrics")}
              href={l.tiles.stateMetrics}
              imageSlug={TILE_IMAGES.stateMetrics}
              className="lg:row-span-2"
              enterLabel={t("landing.enter")}
            />
            <BentoTile
              index={2}
              title={t("landing.tiles.ballot")}
              body={tileBody("ballot")}
              href={l.tiles.ballot}
              imageSlug={TILE_IMAGES.ballot}
              enterLabel={t("landing.enter")}
            />
            <BentoTile
              index={3}
              title={t("landing.tiles.bills")}
              body={tileBody("bills")}
              href={l.tiles.bills}
              imageSlug={TILE_IMAGES.bills}
              enterLabel={t("landing.enter")}
            />
            <BentoTile
              index={4}
              title={t("landing.tiles.industrial")}
              body={tileBody("industrial")}
              href={l.tiles.industrial}
              imageSlug={TILE_IMAGES.industrial}
              enterLabel={t("landing.enter")}
            />
            <BentoTile
              index={5}
              title={t("landing.tiles.markets")}
              body={tileBody("markets")}
              href={l.tiles.markets}
              imageSlug={TILE_IMAGES.markets}
              enterLabel={t("landing.enter")}
            />
            <BentoTile
              index={6}
              title={t("landing.tiles.newsroom")}
              body={tileBody("newsroom")}
              href={l.tiles.newsroom}
              imageSlug={TILE_IMAGES.newsroom}
              enterLabel={t("landing.enter")}
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
                    {t("landing.worldInYear", { year: eraConfig.year })}
                  </h3>
                </div>
                <p className="mb-4 text-body leading-relaxed text-muted">
                  {eraConfig.worldSectionDek}
                </p>
                <div className="space-y-3">
                  {visibleBlocs.map((blocId) => {
                    const meta = bloc[blocId];
                    const countries = countriesByBloc[blocId];
                    const isDimmed = hoveredBloc !== null && hoveredBloc !== blocId;
                    return (
                      <div
                        key={blocId}
                        className={`transition-opacity duration-200 ${
                          isDimmed ? "opacity-40" : "opacity-100"
                        }`}
                        onMouseEnter={() => setHoveredBloc(blocId)}
                        onMouseLeave={() => setHoveredBloc(null)}
                      >
                        <div className="mb-1.5 flex items-center gap-2">
                          <Badge color={meta.badge} variant="subtle">
                            {meta.label}
                          </Badge>
                          <span className="text-body-xs text-muted">
                            {t("landing.nationCount", { count: countries.length })}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {countries.map((c) => {
                            const tierMeta = tier[c.tier];
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
                                  title={tierMeta.title}
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
              title={t("landing.tiles.centralBanks")}
              body={tileBody("centralBanks")}
              href={l.tiles.centralBanks}
              imageSlug={TILE_IMAGES.centralBanks}
              className="lg:col-start-4 lg:row-start-2"
              enterLabel={t("landing.enter")}
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
            <SectionLabel as="h2">
              {t("landing.worldInYear", { year: eraConfig.year })}
            </SectionLabel>
            <p className="mb-8 max-w-2xl text-body-lg leading-relaxed text-muted">
              {t("landing.carouselDek")}
            </p>
            <FlavorCardCarousel staticCards={getEraFlavorCards(era)} crises={crises} />
          </div>
        </section>

        {/* Learn the game */}
        <section className="border-t border-card-border">
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
            <SectionLabel as="h2">{t("landing.learnHeading")}</SectionLabel>
            <p className="mb-8 max-w-2xl text-body-lg leading-relaxed text-muted">
              {t("landing.learnDek")}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {learn.map((item) => (
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
                {isSignedIn ? t("landing.backToDashboard") : eraConfig.closingCta}
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
                {t("landing.getApp")}
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        </section>

        {/* Footer: site navigation + tagline + image attributions */}
        <footer className="border-t border-card-border bg-card-muted/30">
          <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
            <nav
              aria-label={t("landing.footer.navLabel")}
              className="mx-auto mb-8 grid max-w-3xl grid-cols-2 gap-8 text-left sm:grid-cols-3"
            >
              {footer.map((col) => (
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
                    {col.heading === t("landing.footer.legal") && (
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
              <span>{t("landing.byLakeside")}</span>
            </a>
            <p className="mx-auto mt-3 max-w-3xl text-body-xs leading-relaxed text-muted/70">
              {t("landing.attribution")}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
