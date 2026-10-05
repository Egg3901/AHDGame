"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import BackButton from "@/components/BackButton";
import { HeroImage } from "@/components/HeroImage";
import { Avatar } from "@/components/Avatar";
import { Skeleton } from "@/components/ui";
import type { CountryAvailability, CountryAvailabilityState } from "@/lib/countryAvailability";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getHeadOfStateOfficeType,
  type CountryId,
  type GovernmentType,
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
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

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
        <p className="text-body font-semibold text-warning">{countryName} is in beta</p>
        <p className="mt-0.5 text-body-sm text-muted">
          The {countryName} simulation is under active development. Core game mechanics, including
          elections, parliament and party politics, are still being built. Check Discord for
          updates.
        </p>
      </div>
    </div>
  );
}

/** The country's status as one plain word, the same vocabulary as the world page. */
const STATUS_WORD: Record<CountryAvailabilityState, string> = {
  playable: "Active",
  "beta-access": "Beta access",
  "econ-only": "Econ-only",
  hidden: "Under development",
};

const SECTION_HEADING = "text-heading-lg font-semibold tracking-tight text-foreground";
const NAV_BUTTON =
  "rounded-md border border-card-border px-4 py-2 text-body font-medium text-foreground transition-colors hover:bg-card-elevated";

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

// ── Header figures ───────────────────────────────────────────────────────────

/** One figure in the header: a small muted label over a larger value. */
function HeaderStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-max flex-col">
      <span className="text-body-sm text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

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
    <HeaderStat label={label}>
      {loading ? (
        // Silhouette of the loaded avatar + name row so the figure doesn't pop
        // from a placeholder to content.
        <div className="flex h-7 items-center gap-2" aria-hidden>
          <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      ) : !leader ? (
        <span className="text-body-lg text-muted">Vacant</span>
      ) : leader.characterId ? (
        <Link
          href={
            leader.isNPP
              ? `/politicians/npp/${leader.sequentialId ?? leader.characterId}`
              : `/character/${leader.sequentialId ?? leader.characterId}`
          }
          className="group flex items-center gap-2"
        >
          <Avatar
            url={leader.avatarUrl}
            name={leader.characterName}
            size="h-6 w-6"
            borderKey={leader.borderKey}
            tintColor={leader.tintColor}
          />
          <span className="max-w-[180px] truncate text-body-lg font-semibold text-foreground underline-offset-4 group-hover:underline">
            {leader.characterName}
          </span>
        </Link>
      ) : (
        <div className="flex items-center gap-2">
          <Avatar
            url={leader.avatarUrl}
            name={leader.characterName}
            size="h-6 w-6"
            borderKey={leader.borderKey}
            tintColor={leader.tintColor}
          />
          <span className="max-w-[180px] truncate text-body-lg font-semibold text-foreground">
            {leader.characterName}
          </span>
        </div>
      )}
    </HeaderStat>
  );
}

/** Government approval. Red only below 40%, where a government is in trouble. */
function ApprovalStat({
  countryId,
  data,
  loading,
}: {
  countryId: CountryId;
  data: CountryLeadershipData | null;
  loading: boolean;
}) {
  return (
    <HeaderStat label="Approval">
      {loading ? (
        <Skeleton className="h-6 w-14" aria-hidden />
      ) : data?.approval != null ? (
        <span
          className={`text-body-lg font-semibold tabular-nums ${
            data.approval < 40 ? "text-error" : "text-foreground"
          }`}
        >
          <ApprovalTooltip
            summary
            approval={data.approval}
            modifiers={data.approvalModifiers}
            href={approvalUrl(countryId)}
          />
        </span>
      ) : (
        <span className="text-body-lg text-muted">No data</span>
      )}
    </HeaderStat>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CountryOverviewClient({
  countryId,
  availability,
  activePresidentElection,
  identity,
}: {
  countryId: CountryId;
  availability: CountryAvailability;
  activePresidentElection?: { id: string; seatId?: string; status: string } | null;
  /**
   * Name and system resolved SERVER-side against runtime state.
   *
   * Optional so nothing that renders this without it breaks; absent, the compiled
   * config answers, which is right for every country no runtime event has changed.
   * It is wrong for one that has — a reunified Germany read as "West Germany", a
   * "Parliamentary Republic", long after both had stopped being true.
   */
  identity?: {
    name: string;
    governmentTypeLabel: string;
    /**
     * The LIVE system, which decides which executive this page renders. The
     * leadership hook above already resolves this at runtime; reading the
     * compiled value here instead is how the two came to disagree.
     */
    governmentType?: GovernmentType;
  } | null;
}) {
  const countryName = useCountryDisplayName();
  const config = COUNTRY_CONFIGS[countryId];
  const activePreset = useActivePreset();
  const name = identity?.name ?? countryName(countryId);
  const governmentTypeLabel = identity?.governmentTypeLabel ?? config.governmentTypeLabel;
  // RUNTIME, to agree with `useCountryLeadershipData`, which has always resolved
  // the system at runtime. While this read the compiled config the two could
  // disagree for a converted country: the hook fetched the head of state and prime
  // minister of a one-party state, and the markup below asked for a `president`
  // the hook had deliberately set to null -- rendering "Vacant" for an office that
  // was filled, in a system the country no longer had.
  const governmentType = identity?.governmentType ?? config.governmentType;
  const isPresidential = governmentType === "presidential";
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

  // N2 grouped directory: rows from country config, live figures from the
  // batched counts route; a row whose figure is missing shows just its link.
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
          The photo is deliberately short so the directory starts high on a
          phone. */}
      <main className="mx-auto min-w-0 max-w-7xl space-y-12 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="space-y-3">
          <BackButton />

          {/* Header band: the page's one surface change. */}
          <header className="overflow-hidden rounded-xl border border-card-border bg-card">
            {bannerImage && (
              <div className="relative h-[96px] w-full sm:h-[150px]">
                <HeroImage
                  src={bannerImage}
                  alt={name}
                  fill
                  className="object-cover object-center"
                  sizes="(max-width: 1280px) 100vw, 1280px"
                  priority
                />
              </div>
            )}

            <div className="px-5 pt-5 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                {config.heroImage && (
                  <Image
                    src={config.heroImage}
                    alt={`${name} flag`}
                    width={48}
                    height={32}
                    className="shrink-0 rounded-sm object-cover"
                    unoptimized={bypassNextImageOptimization(config.heroImage)}
                  />
                )}
                <h1 className="min-w-0 break-words text-display font-bold tracking-tight text-foreground sm:text-[2.25rem] sm:leading-tight">
                  {name}
                </h1>
              </div>
              <p className="mt-1 text-body text-muted">
                {governmentTypeLabel} · {STATUS_WORD[availability.displayState]}
              </p>
            </div>

            {/* Leadership and approval. One row that scrolls sideways on a
                phone, so the header stays short there. */}
            <div className="mt-5 flex gap-x-10 gap-y-4 overflow-x-auto border-t border-card-border px-5 py-4 sm:flex-wrap sm:overflow-visible sm:px-6">
              <LeaderStatItem
                label={config.executiveTitle}
                leader={
                  isPresidential
                    ? (leadershipData?.president ?? null)
                    : (leadershipData?.pm ?? null)
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
                    label={isUS ? "Senate leader" : "Senate president"}
                    leader={leadershipData?.sml ?? null}
                    loading={leadershipLoading}
                  />
                  <LeaderStatItem
                    label="Speaker"
                    leader={leadershipData?.speaker ?? null}
                    loading={leadershipLoading}
                  />
                </>
              )}

              {/* Head of state for non-presidential systems. Monarchies (UK/JP)
                  render the imperial head of state; other non-presidential
                  systems (CN President of the PRC, IE Uachtarán, the Warsaw Pact
                  council chairmanships) render their office-based ceremonial head
                  of state.

                  A country with NO head-of-state office renders no figure at all.
                  It used to fall through to "Vacant", which asserted a vacancy in
                  an office that does not exist: a player asked why East Germany's
                  head of state was vacant when its ruling party plainly had a
                  chair. */}
              {!isPresidential &&
                (governmentType === "parliamentaryMonarchy" ? (
                  <ImperialHeadOfState countryId={countryId} />
                ) : hasHeadOfStateOffice ? (
                  <LeaderStatItem
                    label="Head of state"
                    leader={leadershipData?.headOfState ?? null}
                    loading={leadershipLoading}
                  />
                ) : null)}

              <ApprovalStat
                countryId={countryId}
                data={leadershipData}
                loading={leadershipLoading}
              />
            </div>
          </header>
        </div>

        {/* Beta banner, kept directly under the header, because it changes how
            everything below it should be read. */}
        {availability.displayState === "beta-access" && <BetaBanner countryName={name} />}

        {/* Explore directory, the reason the page exists. Everything a country
            contains is one tap from here, each entry carrying a live figure so
            the list answers "anything happening?" as well as "where do I go?" */}
        <section>
          <h2 className={`${SECTION_HEADING} mb-4`}>Explore {name}</h2>
          <ExploreDirectory groups={groups} />
        </section>

        {/* Descriptor blurb */}
        <p className="max-w-3xl text-body-lg leading-relaxed text-muted">{config.descriptor}</p>

        {/* National ideology: equal-weight axes over implemented national laws */}
        <NationalIdeologyBand countryId={countryId} data={axesData} loading={axesLoading} />

        {/* One-party-state regime stability. Renders nothing for countries
            whose runtime governmentType isn't onePartyState. */}
        <div>
          <RegimeStabilityPanel countryCode={countryId} />
        </div>

        {/* Sovereign debt market signal: the read-only validation surface for
            the sovereign-default system. */}
        <section>
          <h2 className={`${SECTION_HEADING} mb-4`}>Sovereign debt</h2>
          <div className="space-y-3">
            <SovereignCrisisDecisionPanel countryCode={countryId} />
            <SovereignRecoveryProgressPanel countryCode={countryId} />
            <BondMarketDemandWidget countryCode={countryId} />
          </div>
        </section>

        {/* Footer nav */}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/world" className={NAV_BUTTON}>
            Back to world
          </Link>
          {countryId === COUNTRY_CONFIGS.US.id && (
            <Link href="/dashboard" className={NAV_BUTTON}>
              Go to dashboard
            </Link>
          )}
          {countryId === COUNTRY_CONFIGS.UK.id && (
            <a
              href="https://discord.gg/DmF8zJJuqN"
              target="_blank"
              rel="noopener noreferrer"
              className={NAV_BUTTON}
            >
              Follow UK updates on Discord
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
