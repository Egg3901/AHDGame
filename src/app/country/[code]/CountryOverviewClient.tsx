"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import BackButton from "@/components/BackButton";
import { HeroImage } from "@/components/HeroImage";
import { Avatar } from "@/components/Avatar";
import { SectionLabel, Skeleton } from "@/components/ui";
import type { CountryAvailability } from "@/lib/countryAvailability";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getCountryDisplayName,
  getHeadOfStateOfficeType,
  type CountryId,
} from "@/lib/constants/countries";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { useRuntimeCountryConfig } from "@/hooks/useRuntimeCountryConfig";
import type { SpeakerDisplay, SenateLeaderDisplay } from "@/lib/congress/types";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import { BondMarketDemandWidget } from "@/components/country/BondMarketDemandWidget";
import { SovereignCrisisDecisionPanel } from "@/components/country/SovereignCrisisDecisionPanel";
import { SovereignRecoveryProgressPanel } from "@/components/country/SovereignRecoveryProgressPanel";
import { RegimeStabilityPanel } from "@/components/country/RegimeStabilityPanel";
import ImperialHeadOfState from "@/components/imperial/ImperialHeadOfState";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import {
  executiveApiUrl,
  legislatureApiUrl,
  approvalUrl,
  approvalApiUrl,
  nationalAxesApiUrl,
  overviewCountsApiUrl,
} from "@/lib/urls";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import type { OverviewCounts } from "@/lib/country/overviewCounts";
import { fetchJson } from "@/lib/observability/fetchJson";
import { NationalIdeologyBand, type NationalAxesData } from "./components/NationalIdeologyBand";
import { ExploreDirectory, type DirectoryGroup } from "./components/ExploreDirectory";
import { buildCountryDirectory } from "./components/countryDirectory";

function BetaBanner({ countryName }: { countryName: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-warning"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <div>
        <p className="text-sm font-semibold text-warning">{countryName} — Beta</p>
        <p className="mt-0.5 text-xs text-muted">
          The {countryName} simulation is under active development. Core game mechanics — elections,
          parliament, and party politics — are being built. Check Discord for updates.
        </p>
      </div>
    </div>
  );
}

// ── Approval color helper ─────────────────────────────────────────────────────

function approvalHex(pct: number): string {
  if (pct >= 55) return "#22c55e";
  if (pct >= 40) return "#f59e0b";
  return "#ef4444";
}

// ── National ideology + directory figures ───────────────────────────────────

function useNationalAxesData(countryId: CountryId): {
  data: NationalAxesData | null;
  loading: boolean;
} {
  const [data, setData] = useState<NationalAxesData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchJson<NationalAxesData | null>(nationalAxesApiUrl(countryId), {
      feature: "country-overview-axes",
    })
      .catch(() => null)
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);
  return { data, loading };
}

function useOverviewCounts(countryId: CountryId): OverviewCounts | null {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchJson<OverviewCounts | null>(overviewCountsApiUrl(countryId), {
      feature: "country-overview-counts",
    })
      .catch(() => null)
      .then((json) => {
        if (!cancelled) setCounts(json);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);
  return counts;
}

// ── Live leadership + approval data ──────────────────────────────────────────

interface LeaderInfo {
  characterId: string | null;
  characterName: string;
  avatarUrl?: string;
  sequentialId?: number;
  borderKey?: string | null;
  tintColor?: string | null;
}

interface CountryLeadershipData {
  president: LeaderInfo | null;
  /** Ceremonial head of state for non-monarchy parliamentary / one-party systems
   * (e.g. CN President of the PRC). Monarchies render via ImperialHeadOfState. */
  headOfState: LeaderInfo | null;
  pm: LeaderInfo | null;
  sml: SenateLeaderDisplay | null;
  speaker: SpeakerDisplay | null;
  approval: number | null;
  approvalBase: number | null;
  approvalModifiers: ActiveModifier[];
}

function useCountryLeadershipData(countryId: CountryId): {
  data: CountryLeadershipData | null;
  loading: boolean;
} {
  const [data, setData] = useState<CountryLeadershipData | null>(null);
  const [loading, setLoading] = useState(true);
  // Runtime governmentType so a post-Stage-4 conversion fetches the
  // correct system's leadership endpoints. Falls back to seed via the
  // useMemo path in the hook so pre-conversion countries see no flash.
  const { config: runtime } = useRuntimeCountryConfig(countryId);
  const isPresidential =
    (runtime?.governmentType ?? COUNTRY_CONFIGS[countryId].governmentType) === "presidential";
  // The US congress leadership routes (/api/whitehouse, /api/congress/*) are
  // hardcoded to US data. Other presidential systems (NG, …) resolve their
  // president + presiding officers from country-scoped endpoints instead.
  const isUS = countryId === COUNTRY_CONFIGS.US.id;

  useEffect(() => {
    // Guard against a slow fetch for a previous country resolving after the
    // component has re-rendered for a new one (same [code] route segment, so
    // this client component re-renders rather than remounting on navigation).
    let cancelled = false;
    const fetches: Promise<unknown>[] = [
      // Canonical approval + conditions from the lightweight approval API (not the
      // heavy national metrics route) — matches the Executive/Approval pages.
      fetchJson<unknown>(approvalApiUrl(countryId), {
        feature: "country-overview-approval",
      }).catch(() => null),
    ];
    if (isPresidential && isUS) {
      fetches.push(
        fetchJson<unknown>("/api/whitehouse", {
          feature: "country-overview-whitehouse",
        }).catch(() => null),
        fetchJson<unknown>("/api/congress/senate-leadership", {
          feature: "country-overview-senate-leadership",
        }).catch(() => null),
        fetchJson<unknown>("/api/congress/speaker", {
          feature: "country-overview-speaker",
        }).catch(() => null)
      );
    } else if (isPresidential) {
      fetches.push(
        fetchJson<unknown>(executiveApiUrl(countryId), {
          feature: "country-overview-executive",
        }).catch(() => null),
        fetchJson<unknown>(`${legislatureApiUrl(countryId)}/presiding-officers`, {
          feature: "country-overview-presiding-officers",
        }).catch(() => null)
      );
    } else {
      fetches.push(
        fetchJson<unknown>(executiveApiUrl(countryId), {
          feature: "country-overview-executive",
        }).catch(() => null)
      );
    }
    void Promise.all(fetches).then(([metricsData, secondData, thirdData, fourthData]) => {
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = metricsData as any;
      // secondData: whitehouse (US) OR country executive (NG president / non-presidential head of state).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = secondData as any;
      // thirdData: US senate-leadership OR country presiding-officers ({ speaker, senatePresident }).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const third = thirdData as any;
      // fourthData: US speaker route (US only).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fourth = fourthData as any;
      const isUSPresidential = isPresidential && isUS;
      setData({
        president: isPresidential ? (d?.president ?? null) : null,
        headOfState: !isPresidential ? (d?.headOfState ?? null) : null,
        pm: !isPresidential ? (d?.primeMinister ?? null) : null,
        sml: !isPresidential
          ? null
          : isUSPresidential
            ? (third?.majorityLeader?.current ?? null)
            : (third?.senatePresident ?? null),
        speaker: !isPresidential
          ? null
          : isUSPresidential
            ? (fourth?.currentSpeaker ?? null)
            : (third?.speaker ?? null),
        approval: m?.governmentApproval ?? null,
        approvalBase: null, // canonical approval isn't a base+modifiers sum
        approvalModifiers: m?.modifiers ?? [],
      });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isPresidential, isUS, countryId]);

  return { data, loading };
}

// ── Leader mini-card for stats strip ─────────────────────────────────────────

function LeaderStatItem({
  label,
  leader,
  loading = false,
}: {
  label: string;
  leader: {
    characterId: string | null;
    sequentialId?: number | null;
    characterName: string;
    avatarUrl?: string;
    isNPP?: boolean;
    borderKey?: string | null;
    tintColor?: string | null;
  } | null;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col px-5 py-3 min-w-max">
      <span className="text-[10px] uppercase tracking-widest text-muted font-medium">{label}</span>
      {loading ? (
        // Silhouette of the loaded avatar + name row so the card doesn't pop
        // from an em-dash to content. Same 22px avatar + text-sm line height.
        <div className="mt-1 flex items-center gap-1.5" aria-hidden>
          <Skeleton className="h-[22px] w-[22px] rounded-full shrink-0" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ) : !leader ? (
        <span className="mt-1 text-sm font-bold text-muted italic">Vacant</span>
      ) : leader.characterId ? (
        <Link
          href={
            leader.isNPP
              ? `/politicians/npp/${leader.sequentialId ?? leader.characterId}`
              : `/character/${leader.sequentialId ?? leader.characterId}`
          }
          className="flex items-center gap-1.5 mt-1 group hover:text-primary transition-colors"
        >
          <Avatar
            url={leader.avatarUrl}
            name={leader.characterName}
            size="h-[22px] w-[22px]"
            borderKey={leader.borderKey}
            tintColor={leader.tintColor}
          />
          <span className="text-sm font-semibold truncate max-w-[120px] group-hover:text-primary transition-colors">
            {leader.characterName}
          </span>
        </Link>
      ) : (
        <div className="flex items-center gap-1.5 mt-1">
          <Avatar
            url={leader.avatarUrl}
            name={leader.characterName}
            size="h-[22px] w-[22px]"
            borderKey={leader.borderKey}
            tintColor={leader.tintColor}
          />
          <span className="text-sm font-semibold truncate max-w-[120px]">
            {leader.characterName}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CountryOverviewClient({
  countryId,
  availability,
  activePresidentElection,
}: {
  countryId: CountryId;
  availability: CountryAvailability;
  activePresidentElection?: { id: string; seatId?: string; status: string } | null;
}) {
  const config = COUNTRY_CONFIGS[countryId];
  const activePreset = useActivePreset();
  const name = getCountryDisplayName(countryId, activePreset);
  const isPresidential = config.governmentType === "presidential";
  // Whether this country HAS a head of state as an office at all. Distinct from
  // whether one is currently seated — the executive route returns null for both, and
  // conflating them is what produced a permanent false "Vacant".
  //
  // Resolved against the ACTIVE PRESET, because eras override `officeTypes`: Greece
  // has a president in the base config and no head-of-state office at all in 1953.
  // Reading the base config here would render the row for a country whose office does
  // not exist this era, and the route — which is preset-aware — would answer null,
  // reproducing the very "Vacant" this is meant to remove.
  const hasHeadOfStateOffice =
    getHeadOfStateOfficeType(getCountryConfig(countryId, activePreset)) !== null;
  const isUS = countryId === COUNTRY_CONFIGS.US.id;
  const { data: leadershipData, loading: leadershipLoading } = useCountryLeadershipData(countryId);
  const { data: axesData, loading: axesLoading } = useNationalAxesData(countryId);
  const counts = useOverviewCounts(countryId);
  const bannerImage = config.overviewHeroImage ?? config.heroImage;

  // Registration pill over the hero photo (always-dark backdrop, so the dark
  // translucent shell is photo-anchored, not theme-surface-anchored).
  const pill =
    availability.displayState === "econ-only"
      ? { border: "border-secondary/40", text: "text-secondary", dot: "bg-secondary" }
      : availability.tone === "active"
        ? { border: "border-success/40", text: "text-success", dot: "bg-success" }
        : availability.tone === "beta"
          ? { border: "border-warning/40", text: "text-warning", dot: "bg-warning" }
          : { border: "border-white/20", text: "text-white/80", dot: "bg-white/60" };

  // N2 grouped directory — rows from country config, live figures from the
  // batched counts route; every figure degrades per-row to a plain chevron.
  // Composition lives in `buildCountryDirectory` so the ordering and the gating
  // can be tested without mounting the page.
  const groups: DirectoryGroup[] = buildCountryDirectory({
    countryId,
    preset: activePreset,
    counts,
    lawCount: axesData?.axes.lawCount ?? null,
    approval: leadershipData?.approval ?? null,
    activePresidentElection,
  });

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Reading order is the design: identity and vital signs first, then the
          directory into everything this country contains, then the detail.
          The hero is deliberately short so the directory starts above the fold
          on a phone. */}
      <main className="mx-auto max-w-7xl min-w-0 overflow-x-hidden px-6 py-8 sm:py-12 sm:px-8 lg:px-12 space-y-8">
        {/* Hero header */}
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          {/* Hero image */}
          <div className="relative h-[130px] w-full sm:h-[170px]">
            {bannerImage && (
              <HeroImage
                src={bannerImage}
                alt={name}
                fill
                className="object-cover object-center"
                sizes="(max-width: 1280px) 100vw, 1280px"
                priority
              />
            )}
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
              aria-hidden
            />
            <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
              <div className="flex items-start gap-3">
                <BackButton iconOnly />
                {/* Registration pill — replaces the stats-strip Registration tile.
                    ml-auto keeps it right-aligned even when BackButton renders nothing. */}
                <span
                  className={`ml-auto inline-flex items-center gap-2 rounded-full border bg-black/45 px-3.5 py-1.5 backdrop-blur-sm ${pill.border}`}
                >
                  <span className={`relative flex h-1.5 w-1.5`}>
                    <span
                      className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${pill.dot}`}
                    />
                    <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                  </span>
                  <span className={`text-xs font-semibold ${pill.text}`}>{availability.label}</span>
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-white/80 drop-shadow italic mb-1">
                  {config.regionLabelPlural}
                </p>
                <div className="flex items-center gap-3">
                  {config.heroImage && (
                    <Image
                      src={config.heroImage}
                      alt={`${name} flag`}
                      width={56}
                      height={40}
                      className="object-cover rounded shrink-0"
                      unoptimized={bypassNextImageOptimization(config.heroImage)}
                    />
                  )}
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl lg:text-4xl leading-tight">
                      {name}
                    </h1>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
            {/* Executive */}
            <LeaderStatItem
              label={config.executiveTitle}
              leader={
                isPresidential ? (leadershipData?.president ?? null) : (leadershipData?.pm ?? null)
              }
              loading={leadershipLoading}
            />

            {/* Presidential systems: upper-chamber leader + Speaker + Approval.
                US resolves these from the congress leadership routes; other
                presidential countries (NG, …) from country-scoped presiding
                officers (Senate President + House Speaker). */}
            {isPresidential && (
              <>
                <LeaderStatItem
                  label={isUS ? "Senate Leader" : "Senate President"}
                  leader={leadershipData?.sml ?? null}
                  loading={leadershipLoading}
                />
                <LeaderStatItem
                  label="Speaker"
                  leader={leadershipData?.speaker ?? null}
                  loading={leadershipLoading}
                />
                <div className="flex flex-col px-5 py-3 min-w-max">
                  <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                    Approval
                  </span>
                  {leadershipLoading ? (
                    <span className="text-base font-bold text-muted">—</span>
                  ) : leadershipData?.approval != null ? (
                    <span
                      className="text-base font-bold tabular-nums"
                      style={{ color: approvalHex(leadershipData.approval) }}
                    >
                      <ApprovalTooltip
                        summary
                        approval={leadershipData.approval}
                        modifiers={leadershipData.approvalModifiers}
                        href={approvalUrl(countryId)}
                      />
                    </span>
                  ) : (
                    <span className="text-base font-bold text-muted">—</span>
                  )}
                </div>
              </>
            )}

            {/* Head of State + PM + Approval. Monarchies (UK/JP) render the
                imperial head of state; other non-presidential systems (CN
                President of the PRC, IE Uachtarán, the Warsaw Pact council
                chairmanships) render their office-based ceremonial head of state.

                A country with NO head-of-state office renders no row at all. It
                used to fall through to "Vacant", which asserted a vacancy in an
                office that does not exist — a player asked why East Germany's head
                of state was vacant when its ruling party plainly had a chair. */}
            {!isPresidential && (
              <>
                {config.governmentType === "parliamentaryMonarchy" ? (
                  <ImperialHeadOfState countryId={countryId} />
                ) : hasHeadOfStateOffice ? (
                  <LeaderStatItem
                    label="Head of State"
                    leader={leadershipData?.headOfState ?? null}
                    loading={leadershipLoading}
                  />
                ) : null}
                <div className="flex flex-col px-5 py-3 min-w-max">
                  <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                    Approval
                  </span>
                  {leadershipLoading ? (
                    <span className="text-base font-bold text-muted">—</span>
                  ) : leadershipData?.approval != null ? (
                    <span
                      className="text-base font-bold tabular-nums"
                      style={{ color: approvalHex(leadershipData.approval) }}
                    >
                      <ApprovalTooltip
                        summary
                        approval={leadershipData.approval}
                        modifiers={leadershipData.approvalModifiers}
                        href={approvalUrl(countryId)}
                      />
                    </span>
                  ) : (
                    <span className="text-base font-bold text-muted">—</span>
                  )}
                </div>
              </>
            )}

            {/* Government Type */}
            <div className="flex flex-col px-5 py-3 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Government Type
              </span>
              <span className="text-base font-bold text-foreground">
                {config.governmentTypeLabel}
              </span>
            </div>
          </div>
        </header>

        {/* Beta banner, kept directly under the hero, because it changes how
            everything below it should be read. */}
        {availability.displayState === "beta-access" && <BetaBanner countryName={name} />}

        {/* Explore directory, the reason the page exists. Everything a country
            contains is one tap from here, each entry carrying a live figure so
            the list answers "anything happening?" as well as "where do I go?" */}
        <div>
          <SectionLabel className="mb-4">Explore {name}</SectionLabel>
          <ExploreDirectory groups={groups} />
        </div>

        {/* Descriptor blurb */}
        <p className="text-lg text-muted max-w-3xl leading-relaxed">{config.descriptor}</p>

        {/* National Ideology band: equal-weight axes over implemented national laws */}
        <NationalIdeologyBand countryId={countryId} data={axesData} loading={axesLoading} />

        {/* One-party-state regime stability — short-circuits to null for
            countries whose runtime governmentType isn't onePartyState. */}
        <div>
          <RegimeStabilityPanel countryCode={countryId} />
        </div>

        {/* Sovereign debt market signal — Phase 2 read-only validation surface.
            Phase 9 will polish placement / styling alongside the full
            sovereign-default UI surface. */}
        <div>
          <SectionLabel className="mb-4">Sovereign Debt</SectionLabel>
          <div className="space-y-3">
            <SovereignCrisisDecisionPanel countryCode={countryId} />
            <SovereignRecoveryProgressPanel countryCode={countryId} />
            <BondMarketDemandWidget countryCode={countryId} />
          </div>
        </div>

        {/* Footer nav */}
        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-card-border/40">
          <Link
            href="/world"
            className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            ← Back to World
          </Link>
          {countryId === COUNTRY_CONFIGS.US.id && (
            <Link
              href="/dashboard"
              className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              Go to Dashboard →
            </Link>
          )}
          {countryId === COUNTRY_CONFIGS.UK.id && (
            <a
              href="https://discord.gg/DmF8zJJuqN"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              Follow UK Updates on Discord →
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
