"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getMessageStyle } from "@/lib/utils/formatters";
import { MAJOR_DEMOTION_GRACE_TURNS } from "@/lib/parties/partyTier";
import { Button, CardSkeleton, Skeleton } from "@/components/ui";
import { PartyLogo } from "@/components/PartyLogo";
import { RegimeOffersInbox } from "@/components/parties/RegimeOffersInbox";
import { AgendaBannerWithEdit } from "@/components/party-hub/AgendaBannerWithEdit";
import { COUNTRY_CONFIGS, CountryId } from "@/lib/constants/countries";
import { parseCountryParam } from "@/lib/db/partyLookup";
import { partyApiUrl, partyUrl, regionPartyApiUrl, regionPartyUrl, regionUrl } from "@/lib/urls";
import { PlainPositionLabel } from "@/components/party/PlainPositionLabel";
import {
  PARTY_PAGE_TITLE_CLASS,
  PARTY_SECTION_HEADING_CLASS,
  PARTY_VALUE_CLASS,
  PartyStat,
  PartyStatsRow,
  PartySwatch,
  partyTabClass,
  regimeStatusLabel,
} from "@/components/party/partyPageStyles";
import { getStateLeanLabel } from "@/lib/utils/politics";
import type { PartyAnalyticsPayload } from "@/lib/partyAnalytics/types";
import { UK_REGIONS } from "@/lib/constants/uk";
import {
  STATE_PS_CAP_DEFAULT,
  STATE_PASSIVE_PS_PER_TURN,
} from "@/lib/politicalStrength/strengthConstants";

import type {
  UserData as NationalUserData,
  PartyData,
  NationalElectionsState,
  CommitteeData,
} from "./components/types";
import { POSITIONS, fmt as nationalFmt } from "./components/helpers";
import { PartyPageSkeleton } from "./PartyPageSkeleton";
import { resolveTreasuryPermissions } from "./treasuryPermissions";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { resolveScopeSwitcherRegionId } from "./resolveScopeSwitcherRegion";

import { useStatePartyData } from "../../region/[id]/party/[partyId]/components/useStatePartyData";
import { useStatePartyTreasuryActions } from "../../region/[id]/party/[partyId]/components/useStatePartyTreasuryActions";
import { StatePartyHubBody } from "../../region/[id]/party/[partyId]/components/StatePartyHubBody";
import { getOrgLabel, fmt as stateFmt } from "../../region/[id]/party/[partyId]/components/helpers";
import type { MainTab as StateMainTab } from "../../region/[id]/party/[partyId]/components/types";
import type { StatePartyAnalyticsPayload } from "@/lib/partyAnalytics";
import { apiErrorText } from "@/lib/errors/catalog";

export type PartyHubScope =
  | { kind: "national"; countryCode: string; partyId: string }
  | {
      kind: "state";
      countryCode: string;
      partyId: string;
      stateId: string;
      regionId: string;
    };

export function PartyHubPage({ scope }: { scope: PartyHubScope }) {
  if (scope.kind === "national") {
    return <NationalPartyHub scope={scope} />;
  }
  return <StatePartyHub scope={scope} />;
}

const PanelFallback = () => (
  <CardSkeleton className="min-h-[240px] space-y-4">
    <Skeleton className="h-5 w-36" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-4 w-1/2" />
  </CardSkeleton>
);

const NppRecruitmentPanel = dynamic(
  () =>
    import("@/components/party/NppRecruitmentPanel").then((m) => ({
      default: m.NppRecruitmentPanel,
    })),
  { loading: PanelFallback }
);
const NationalPartyInfluencePanel = dynamic(
  () =>
    import("@/components/NationalPartyInfluencePanel").then((m) => ({
      default: m.NationalPartyInfluencePanel,
    })),
  { loading: PanelFallback }
);
const PartyOverviewPanel = dynamic(
  () =>
    import("./components/PartyOverviewPanel").then((m) => ({
      default: m.PartyOverviewPanel,
    })),
  { loading: PanelFallback }
);
const PartyAnalyticsTab = dynamic(
  () => import("./components/PartyAnalyticsTab").then((m) => ({ default: m.PartyAnalyticsTab })),
  { loading: PanelFallback }
);
const NationalElectionPanel = dynamic(
  () =>
    import("./components/NationalElectionPanel").then((m) => ({
      default: m.NationalElectionPanel,
    })),
  { loading: PanelFallback }
);
const NationalCommitteeElectionPanel = dynamic(
  () =>
    import("./components/NationalCommitteeElectionPanel").then((m) => ({
      default: m.NationalCommitteeElectionPanel,
    })),
  { loading: PanelFallback }
);
const StatePartyLinksTab = dynamic(
  () =>
    import("./components/StatePartyLinksTab").then((m) => ({
      default: m.StatePartyLinksTab,
    })),
  { loading: PanelFallback }
);
const TreasuryPanel = dynamic(
  () => import("./components/TreasuryPanel").then((m) => ({ default: m.TreasuryPanel })),
  { loading: PanelFallback }
);
const MembersPanel = dynamic(
  () => import("./components/MembersPanel").then((m) => ({ default: m.MembersPanel })),
  { loading: PanelFallback }
);
const NationalPartyAdminTab = dynamic(
  () =>
    import("./components/NationalPartyAdminTab").then((m) => ({
      default: m.NationalPartyAdminTab,
    })),
  { loading: PanelFallback }
);
const LeadershipPanel = dynamic(
  () =>
    import("./components/LeadershipPanel").then((m) => ({
      default: m.LeadershipPanel,
    })),
  { loading: PanelFallback }
);
const ConferencePanel = dynamic(
  () =>
    import("./components/ConferencePanel").then((m) => ({
      default: m.ConferencePanel,
    })),
  { loading: PanelFallback }
);
const ChairOfficeTab = dynamic(
  () => import("./components/ChairOfficeTab").then((m) => ({ default: m.ChairOfficeTab })),
  { loading: PanelFallback }
);
const CaucusesTab = dynamic(
  () => import("./components/CaucusesTab").then((m) => ({ default: m.CaucusesTab })),
  { loading: PanelFallback }
);
const WhipRoomTab = dynamic(
  () => import("./components/WhipRoomTab").then((m) => ({ default: m.WhipRoomTab })),
  { loading: PanelFallback }
);
const SlateTab = dynamic(
  () => import("./components/SlateTab").then((m) => ({ default: m.SlateTab })),
  { loading: PanelFallback }
);
const TreasuryTransactionLog = dynamic(
  () =>
    import("./components/TreasuryTransactionLog").then((m) => ({
      default: m.TreasuryTransactionLog,
    })),
  { loading: PanelFallback }
);
const PendingTreasuryTransactionsCard = dynamic(
  () =>
    import("./components/PendingTreasuryTransactionsCard").then((m) => ({
      default: m.PendingTreasuryTransactionsCard,
    })),
  { loading: PanelFallback }
);
const RequestFundsCard = dynamic(
  () =>
    import("./components/RequestFundsCard").then((m) => ({
      default: m.RequestFundsCard,
    })),
  { loading: PanelFallback }
);
const DisciplineWatchCard = dynamic(
  () =>
    import("./components/DisciplineWatchCard").then((m) => ({
      default: m.DisciplineWatchCard,
    })),
  { loading: PanelFallback }
);
const RecentActivityCard = dynamic(
  () =>
    import("./components/RecentActivityCard").then((m) => ({
      default: m.RecentActivityCard,
    })),
  { loading: PanelFallback }
);
const CommitteeProposalsSection = dynamic(
  () =>
    import("./components/CommitteeProposalsSection").then((m) => ({
      default: m.CommitteeProposalsSection,
    })),
  { loading: PanelFallback }
);
const DiscussionTab = dynamic(
  () => import("@/components/party/DiscussionTab").then((m) => ({ default: m.DiscussionTab })),
  { loading: PanelFallback }
);

type NationalMainTab =
  | "overview"
  | "analytics"
  | "committee"
  | "caucuses"
  | "whip-room"
  | "slate"
  | "actions"
  | "elections"
  | "treasury"
  | "members"
  | "discussion"
  | "chair-office"
  | "leadership"
  | "conference"
  | "admin";
type ElectionSubTab = "national" | "committee" | "state";
type NppSubTab = "recruitment" | "management";

interface ScopeSwitcherProps {
  scope: PartyHubScope;
  countryCode: string;
  partyId: string;
  regionId: string | null;
  regionLabel: string;
}

function ScopeSwitcher({ scope, countryCode, partyId, regionId, regionLabel }: ScopeSwitcherProps) {
  const nationalHref = partyUrl(countryCode, partyId);
  const regionHref = regionId ? regionPartyUrl(countryCode, regionId, partyId) : null;
  const isNational = scope.kind === "national";

  return (
    <div className="mt-4 inline-flex rounded-lg border border-card-border p-1">
      <Link
        href={nationalHref}
        aria-current={isNational ? "page" : undefined}
        className={`rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors ${
          isNational ? "bg-card-elevated text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        National
      </Link>
      {regionHref ? (
        <Link
          href={regionHref}
          aria-current={!isNational ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors ${
            !isNational ? "bg-card-elevated text-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {regionLabel}
        </Link>
      ) : (
        <span className="cursor-not-allowed rounded-md px-3 py-1.5 text-body-sm font-medium text-muted/50">
          {regionLabel}
        </span>
      )}
    </div>
  );
}

interface PartyHubChromeProps {
  scope: PartyHubScope;
  countryCode: string;
  partyId: string;
  switcherRegionId: string | null;
  switcherRegionLabel: string;
  breadcrumb?: ReactNode;
  backLink?: ReactNode;
  /** Plain words after the abbreviation, naming which office this hub is. */
  headerContext: string;
  title: string;
  partyColor: string;
  partyAbbreviation: string;
  logoPartyId: string;
  logoUrl?: string | null;
  countryId: CountryId | string;
  regimeStatus?: "ruling" | "approved" | "banned" | null;
  /** Extra plain words for the identity line, such as the party tier. */
  tierLabel?: string | null;
  headerExtra?: ReactNode;
  headerActions?: ReactNode;
  modViewBanner?: ReactNode;
  statsStrip: ReactNode;
  msg: string;
  defunctBanner?: ReactNode;
  agendaBanner: ReactNode;
  tabs: { id: string; label: string }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: ReactNode;
}

function PartyHubChrome({
  scope,
  countryCode,
  partyId,
  switcherRegionId,
  switcherRegionLabel,
  breadcrumb,
  backLink,
  headerContext,
  title,
  partyColor,
  partyAbbreviation,
  logoPartyId,
  logoUrl,
  countryId,
  regimeStatus,
  tierLabel,
  headerExtra,
  headerActions,
  modViewBanner,
  statsStrip,
  msg,
  defunctBanner,
  agendaBanner,
  tabs,
  activeTab,
  onTabChange,
  children,
}: PartyHubChromeProps) {
  const regimeLabel = regimeStatusLabel(regimeStatus);

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        {breadcrumb}
        {backLink}

        <header className="mb-10 overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="px-4 py-6 sm:px-7 sm:py-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <PartyLogo
                  partyId={logoPartyId}
                  partyColor={partyColor}
                  logoUrl={logoUrl}
                  size="h-16 w-16"
                  className="shrink-0"
                  countryId={countryId as CountryId}
                />
                <div className="min-w-0">
                  <h1 className={PARTY_PAGE_TITLE_CLASS}>{title}</h1>
                  <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body text-muted">
                    <PartySwatch color={partyColor} />
                    <span className="font-medium text-foreground">{partyAbbreviation}</span>
                    <span aria-hidden>·</span>
                    <span>{headerContext}</span>
                    {regimeLabel ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>
                          <span className="sr-only">Regime status: </span>
                          {regimeLabel}
                        </span>
                      </>
                    ) : null}
                    {tierLabel ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{tierLabel}</span>
                      </>
                    ) : null}
                  </p>
                  <ScopeSwitcher
                    scope={scope}
                    countryCode={countryCode}
                    partyId={partyId}
                    regionId={switcherRegionId}
                    regionLabel={switcherRegionLabel}
                  />
                  {headerExtra}
                </div>
              </div>
              {headerActions ? (
                <div className="flex shrink-0 items-center gap-3">{headerActions}</div>
              ) : null}
            </div>
          </div>
          {modViewBanner}
          {statsStrip}
          {/* Scrolls sideways when the tabs outrun the width; the faded right
              edge and the trailing space show there is more past the edge. */}
          <nav
            aria-label="Party sections"
            className="flex gap-6 overflow-x-auto border-t border-card-border px-4 scrollbar-hide [mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)] after:block after:w-6 after:shrink-0 after:content-[''] sm:px-7"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                aria-pressed={activeTab === t.id}
                className={partyTabClass(activeTab === t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {msg ? (
          <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(msg)}`}>{msg}</div>
        ) : null}
        {defunctBanner}
        <div className="mb-8 empty:hidden">{agendaBanner}</div>

        {children}
      </main>
    </div>
  );
}

function NationalPartyHub({ scope }: { scope: Extract<PartyHubScope, { kind: "national" }> }) {
  const { countryCode, partyId: id } = scope;
  const searchParams = useSearchParams();
  const requestedCountry = parseCountryParam(countryCode?.toLowerCase() ?? null);
  const [user, setUser] = useState<NationalUserData | null>(null);
  const [party, setParty] = useState<PartyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [electionData, setElectionData] = useState<NationalElectionsState | null>(null);
  const [committeeData, setCommitteeData] = useState<CommitteeData | null>(null);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [activeTab, setActiveTab] = useState<NationalMainTab>("overview");
  const [electionSubTab, setElectionSubTab] = useState<ElectionSubTab>("national");
  const [nppSubTab, setNppSubTab] = useState<NppSubTab>("recruitment");
  const [eligibleStates, setEligibleStates] = useState<Array<{ id: string; name: string }>>([]);
  const [linkedStateIds, setLinkedStateIds] = useState<string[]>([]);
  const [analyticsData, setAnalyticsData] = useState<PartyAnalyticsPayload | null>(null);
  const [msg, setMsg] = useState("");
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [modViewEnabled, setModViewEnabled] = useState(false);
  const [modViewLoading, setModViewLoading] = useState(false);

  const backCountry =
    (party?.countryId ? parseCountryParam(party.countryId.toLowerCase()) : null)?.toLowerCase() ??
    requestedCountry?.toLowerCase() ??
    "us";
  const partiesListHref = `/country/${backCountry}/parties`;

  const fetchUser = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (r.ok) {
        const d = await r.json();
        setUser(d.user);
      }
    } catch {}
  }, []);

  const fetchParty = useCallback(async () => {
    try {
      const url = partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id);
      const r = await fetch(url, { credentials: "same-origin" });
      if (r.ok) {
        const d = await r.json();
        setParty(d);
        const memberStates = [
          ...new Set(
            (d.members ?? [])
              .map((m: { homeState?: string }) => m.homeState)
              .filter(Boolean) as string[]
          ),
        ];
        setLinkedStateIds(memberStates);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [id, requestedCountry]);

  const fetchLinkedStates = useCallback(async () => {
    try {
      const r = await fetch(
        `${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/state-parties`,
        { credentials: "same-origin" }
      );
      if (r.ok) {
        const d = await r.json();
        const ids = (d.rows ?? [])
          .filter((row: { hasPresence?: boolean }) => row.hasPresence)
          .map((row: { regionId: string }) => row.regionId);
        if (ids.length > 0) setLinkedStateIds(ids);
      }
    } catch {}
  }, [id, requestedCountry]);

  const fetchElections = useCallback(async () => {
    try {
      const r = await fetch(
        `${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/election`,
        { credentials: "same-origin" }
      );
      if (r.ok) setElectionData(await r.json());
    } catch {}
  }, [id, requestedCountry]);

  const fetchCommittee = useCallback(async () => {
    try {
      const r = await fetch(
        `${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/committee`,
        { credentials: "same-origin" }
      );
      if (r.ok) setCommitteeData(await r.json());
    } catch {}
  }, [id, requestedCountry]);

  const fetchEligibleStates = useCallback(async () => {
    try {
      const res = await fetch(
        `${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/npp-influence-states`,
        { credentials: "same-origin" }
      );
      if (res.ok) {
        const data = await res.json();
        setEligibleStates(data.states ?? []);
      }
    } catch {}
  }, [id, requestedCountry]);

  const fetchAnalytics = useCallback(async () => {
    try {
      const analyticsUrl = modViewEnabled
        ? `${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/analytics?modView=1`
        : `${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/analytics`;
      const response = await fetch(analyticsUrl, { credentials: "same-origin" });
      if (!response.ok) return;
      const payload = (await response.json()) as PartyAnalyticsPayload;
      setAnalyticsData(payload);
    } catch {}
  }, [id, requestedCountry, modViewEnabled]);

  useEffect(() => {
    setLoading(true);
    setParty(null);
    fetchUser();
    fetchParty();
    fetchElections();
    fetchCommittee();
    fetchJson<{ currentTurn?: number }>("/api/game/turn/status", {
      credentials: "same-origin",
      feature: "party-detail-turn-status",
    })
      .then((d) => {
        if (d?.currentTurn) setCurrentTurn(d.currentTurn);
      })
      .catch(() => {});
  }, [id, fetchUser, fetchParty, fetchElections, fetchCommittee]);

  const hasCharEarly = !!user?.character?.id;
  const isChairEarly = hasCharEarly && !!party?.chair?.id && user?.character?.id === party.chair.id;
  const isViceChairEarly =
    hasCharEarly && !!party?.viceChair?.id && user?.character?.id === party.viceChair.id;
  const isChairVacant = !party?.chair?.id;
  const canActAsChairEarly = isChairEarly || (isChairVacant && isViceChairEarly);
  const isInPartyEarly =
    hasCharEarly &&
    !!party &&
    user?.character?.party === id &&
    user?.character?.countryId === party.countryId;
  const canUsePartyInfluenceEarly = user?.isAdmin || isChairEarly || isViceChairEarly;
  // Committee-confirmed campaigners reach NPP Management but not Recruitment
  // or the other chair/VC surfaces (suggestion #269), so this is a separate
  // predicate rather than a widening of `canUsePartyInfluence`.
  const isCampaignerEarly =
    hasCharEarly && !!party?.campaigners?.some((c) => c.id === user?.character?.id);
  const canManageNppsEarly = canUsePartyInfluenceEarly || isCampaignerEarly;
  const canViewExtendedTabsEarly = user?.isAdmin || isInPartyEarly || modViewEnabled;

  useEffect(() => {
    if (canViewExtendedTabsEarly) {
      fetchAnalytics();
      fetchLinkedStates();
    }
  }, [canViewExtendedTabsEarly, fetchAnalytics, fetchLinkedStates]);

  useEffect(() => {
    if (canUsePartyInfluenceEarly) {
      fetchEligibleStates();
    }
  }, [canUsePartyInfluenceEarly, fetchEligibleStates]);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (!tabParam || !party) return;
    const allowed = canViewExtendedTabsEarly
      ? new Set<NationalMainTab>([
          "overview",
          "analytics",
          "committee",
          "caucuses",
          "whip-room",
          "slate",
          "elections",
          "treasury",
          "members",
          "discussion",
        ])
      : new Set<NationalMainTab>(["overview", "members"]);
    if (canViewExtendedTabsEarly && canManageNppsEarly) allowed.add("actions");
    if (canViewExtendedTabsEarly && canActAsChairEarly) allowed.add("chair-office");
    // UK party-leadership removal (#861): national hub only, UK parties only.
    if (canViewExtendedTabsEarly && party?.countryId === "UK") allowed.add("leadership");
    // UK party conferences (#862): national hub only, UK parties only.
    if (canViewExtendedTabsEarly && party?.countryId === "UK") allowed.add("conference");
    if (canViewExtendedTabsEarly && user?.isAdmin) allowed.add("admin");
    if (allowed.has(tabParam as NationalMainTab)) {
      setActiveTab(tabParam as NationalMainTab);
    }
    const subParam = searchParams.get("sub");
    if (tabParam === "elections" && subParam) {
      const allowedElectionSubTabs = new Set<ElectionSubTab>(["national", "committee", "state"]);
      if (allowedElectionSubTabs.has(subParam as ElectionSubTab)) {
        setElectionSubTab(subParam as ElectionSubTab);
      }
    }
    if (tabParam === "actions" && subParam) {
      const allowedNppSubTabs = new Set<NppSubTab>(["recruitment", "management"]);
      if (allowedNppSubTabs.has(subParam as NppSubTab)) {
        setNppSubTab(subParam as NppSubTab);
      }
    }
  }, [
    searchParams,
    party,
    canManageNppsEarly,
    canViewExtendedTabsEarly,
    canActAsChairEarly,
    user?.isAdmin,
  ]);

  const enableModView = useCallback(async () => {
    if (!party) return;
    setModViewLoading(true);
    try {
      const response = await fetch("/api/moderator/mod-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "party",
          targetId: id,
          targetName: party.name,
          countryId: party.countryId,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setMsg(`✗ ${apiErrorText(payload, "Failed to enable Mod View")}`);
        return;
      }
      setModViewEnabled(true);
      setMsg(`✓ Mod View enabled for ${party.name}`);
    } catch {
      setMsg("✗ Failed to enable Mod View");
    } finally {
      setModViewLoading(false);
    }
  }, [id, party]);

  const apiPost = async (
    url: string,
    body: object,
    onOk?: (data: { pending?: boolean }) => void
  ) => {
    setMsg("");
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      setMsg(r.ok ? `✓ ${d.message}` : `✗ ${apiErrorText(d, "Request failed")}`);
      if (r.ok) {
        fetchParty();
        onOk?.(d);
      }
    } catch {
      setMsg("✗ Network error");
    }
  };

  // Growth frontier: a party can only be joined from a region it already
  // reaches or borders. `frontierRegions === null` means the party has no
  // presence anywhere and is open to all, mirroring the server's fail-open
  // branch. A character with no home region is also allowed through, as the
  // server does. The server remains the real gate; this only explains it.
  const viewerHomeState = user?.character?.homeState ?? null;
  const joinFrontierRegions = party?.frontierRegions ?? null;
  const canJoinFromHomeRegion =
    joinFrontierRegions == null ||
    !viewerHomeState ||
    joinFrontierRegions.includes(viewerHomeState);

  const handleJoin = async () => {
    setJoining(true);
    await apiPost(
      `${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/join`,
      {},
      (data) => {
        if (data.pending) return;
        void import("@/lib/analytics/capture")
          .then(({ captureProductEvent }) => captureProductEvent("party_joined"))
          .catch(() => {});
      }
    );
    fetchUser();
    setJoining(false);
  };
  const handleLeave = async () => {
    if (!confirm("Leave this party? You will become Independent.")) return;
    setLeaving(true);
    await apiPost(`${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/leave`, {});
    fetchUser();
    setLeaving(false);
  };

  const switcherRegionId = useMemo(
    () =>
      resolveScopeSwitcherRegionId(
        scope,
        id,
        user?.character?.homeState,
        user?.character?.party,
        linkedStateIds
      ),
    [scope, id, user?.character?.homeState, user?.character?.party, linkedStateIds]
  );

  const regionLabel =
    COUNTRY_CONFIGS[(party?.countryId ?? "US") as CountryId]?.regionLabel ?? "Region";

  if (loading) return <PartyPageSkeleton />;
  if (!party) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted">Party not found.</div>
      </div>
    );
  }

  const hasChar = !!user?.character?.id;
  const isInParty =
    hasChar && user?.character?.party === id && user?.character?.countryId === party.countryId;
  const isChair = hasChar && !!party.chair?.id && user?.character?.id === party.chair.id;
  const isViceChair =
    hasChar && !!party.viceChair?.id && user?.character?.id === party.viceChair.id;
  const canActAsChair = isChair || (!party.chair?.id && isViceChair);
  const isActingChair = !party.chair?.id && isViceChair;
  const isTreasurer =
    hasChar && !!party.treasurer?.id && user?.character?.id === party.treasurer.id;
  const isTreasurerSeatVacant = !party.treasurer?.id;
  const { canManageTreasury, canManageTreasuryPlan, canManageTax, canManageBudgets } =
    resolveTreasuryPermissions({
      isAdmin: !!user?.isAdmin,
      isChair,
      isViceChair,
      isTreasurer,
      isTreasurerSeatVacant,
    });
  const canUsePartyInfluence = user?.isAdmin || isChair || isViceChair;
  const isCampaigner = hasChar && !!party.campaigners?.some((c) => c.id === user?.character?.id);
  const canManageNpps = canUsePartyInfluence || isCampaigner;
  // Campaigners only get the Management sub-tab, so the stored "recruitment"
  // default has to collapse to it rather than rendering an empty panel.
  const effectiveNppSubTab: NppSubTab = canUsePartyInfluence ? nppSubTab : "management";
  const canViewExtendedTabs = user?.isAdmin || isInParty || modViewEnabled;
  const sortedMembers = [...party.members].sort((a, b) => a.name.localeCompare(b.name));
  const candidatePositions = POSITIONS.filter((p) => electionData?.isCandidate[p]);

  const MAIN_TABS: { id: NationalMainTab; label: string }[] = canViewExtendedTabs
    ? [
        { id: "overview", label: "Overview" },
        { id: "analytics", label: "Analytics" },
        { id: "committee", label: "Committee" },
        { id: "caucuses", label: "Caucuses" },
        { id: "whip-room", label: "Whip room" },
        { id: "slate", label: "Slate" },
        ...(canManageNpps ? [{ id: "actions" as NationalMainTab, label: "NPPs" }] : []),
        { id: "elections", label: "Elections" },
        { id: "treasury", label: "Treasury" },
        { id: "members", label: `Members (${party.memberCount})` },
        { id: "discussion", label: "Discussion" },
        ...(canActAsChair
          ? [
              {
                id: "chair-office" as NationalMainTab,
                label: isActingChair ? "Chair office (acting)" : "Chair office",
              },
            ]
          : []),
        ...(party.countryId === "UK"
          ? [{ id: "leadership" as NationalMainTab, label: "Leadership" }]
          : []),
        ...(party.countryId === "UK"
          ? [{ id: "conference" as NationalMainTab, label: "Conference" }]
          : []),
        ...(user?.isAdmin ? [{ id: "admin" as NationalMainTab, label: "Admin" }] : []),
      ]
    : [
        { id: "overview", label: "Overview" },
        { id: "members", label: `Members (${party.memberCount})` },
      ];

  return (
    <PartyHubChrome
      scope={scope}
      countryCode={backCountry}
      partyId={id}
      switcherRegionId={switcherRegionId}
      switcherRegionLabel={regionLabel}
      backLink={
        <Link
          href={partiesListHref}
          className="mb-4 inline-flex items-center gap-2 text-body font-medium text-muted transition-colors hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          All parties
        </Link>
      }
      headerContext="National headquarters"
      title={party.name}
      partyColor={party.color}
      partyAbbreviation={party.abbreviation}
      logoPartyId={party.id}
      logoUrl={party.logoUrl}
      countryId={party.countryId}
      regimeStatus={party.regimeStatus}
      tierLabel={
        (party.tier ?? (party.isDefault ? "major" : "minor")) === "major"
          ? "Major party"
          : "Minor party"
      }
      headerExtra={
        party.majorDemotionWarning ? (
          <p className="mt-3 max-w-xl text-body-sm text-muted">
            <span className="font-semibold text-warning">Major party status at risk.</span> Org has
            fallen below 10% in two-thirds of regions. Regain 20% Org in at least a third of regions
            within{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {Math.max(
                0,
                party.majorDemotionWarning.startedTurn + MAJOR_DEMOTION_GRACE_TURNS - currentTurn
              )}
            </span>{" "}
            turns or this party will be demoted to Minor.
          </p>
        ) : null
      }
      headerActions={
        user?.hasCharacter ? (
          isInParty ? (
            <button
              type="button"
              onClick={handleLeave}
              disabled={leaving}
              className="h-9 rounded-lg border border-error/40 px-3.5 text-body font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
            >
              {leaving ? "Leaving…" : "Leave party"}
            </button>
          ) : (
            <Button
              onClick={handleJoin}
              disabled={joining || !canJoinFromHomeRegion}
              title={
                canJoinFromHomeRegion
                  ? undefined
                  : `${party.name} is not established in or next to your home region.`
              }
            >
              {joining ? "Joining…" : "Join party"}
            </Button>
          )
        ) : null
      }
      modViewBanner={
        !user?.isAdmin && user?.isModerator && !isInParty ? (
          <div className="flex flex-col gap-3 border-t border-card-border px-4 py-4 text-body sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <p className="font-semibold text-foreground">Moderator view</p>
              <p className="text-muted">
                Unlock member-only party tabs in read-only mode. Each unlock is written to the
                moderator audit log.
              </p>
            </div>
            {modViewEnabled ? (
              <span className="shrink-0 font-medium text-foreground">Mod view active</span>
            ) : (
              <Button
                variant="secondary"
                onClick={enableModView}
                disabled={modViewLoading}
                className="w-fit shrink-0"
              >
                {modViewLoading ? "Enabling..." : "Mod view"}
              </Button>
            )}
          </div>
        ) : null
      }
      statsStrip={
        <PartyStatsRow>
          <PartyStat
            label="Political strength"
            detail="Spent on party actions such as building organization; capped"
          >
            <span className={PARTY_VALUE_CLASS}>{(party.politicalStrength ?? 0).toFixed(1)}</span>
            <span className="ml-1 text-body-sm text-muted">of {party.effectivePsCap}</span>
          </PartyStat>
          <PartyStat label="Members">
            <span className={PARTY_VALUE_CLASS}>{party.memberCount}</span>
          </PartyStat>
          <PartyStat label="Treasury">
            <span className={`block truncate ${PARTY_VALUE_CLASS}`}>
              {nationalFmt(party.treasury, party.countryId)}
            </span>
          </PartyStat>
          <PartyStat label="Economic">
            <PlainPositionLabel
              value={party.economicPosition}
              axis="economic"
              className="text-body-lg font-semibold text-foreground"
            />
          </PartyStat>
          <PartyStat label="Social">
            <PlainPositionLabel
              value={party.socialPosition}
              axis="social"
              className="text-body-lg font-semibold text-foreground"
            />
          </PartyStat>
          <PartyStat
            label="Bonus actions"
            detail="Extra actions for members, from their influence and how close they are to the party"
          >
            <span className={PARTY_VALUE_CLASS}>+{party.totalBonusActions}</span>
            <span className="ml-1 text-body-sm text-muted">per turn</span>
          </PartyStat>
        </PartyStatsRow>
      }
      msg={msg}
      defunctBanner={
        party.isDefunct ? (
          <div className="mb-4 rounded-lg border border-error/40 bg-error/10 p-3 text-body-sm text-error">
            This party has been dissolved
            {party.defunctAtTurn ? ` (turn ${party.defunctAtTurn})` : ""} and is no longer active.
          </div>
        ) : null
      }
      agendaBanner={
        <AgendaBannerWithEdit
          countryCode={countryCode}
          partyId={id}
          partyAbbreviation={party.abbreviation}
          partyColor={party.color}
          canEdit={!!(isChair || isViceChair || user?.isAdmin)}
        />
      }
      tabs={MAIN_TABS}
      activeTab={activeTab}
      onTabChange={(tabId) => setActiveTab(tabId as NationalMainTab)}
    >
      {activeTab === "overview" && (
        <div className="space-y-12">
          <PartyOverviewPanel party={party} />
          <RegimeOffersInbox countryCode={backCountry} partySequentialId={String(party.id)} />
          {canViewExtendedTabs && (
            <div className="grid gap-x-12 gap-y-12 md:grid-cols-2">
              <DisciplineWatchCard countryCode={backCountry} partyId={String(party.id)} />
              <RecentActivityCard countryCode={backCountry} partyId={String(party.id)} />
            </div>
          )}
        </div>
      )}

      {activeTab === "analytics" && (
        <PartyAnalyticsTab
          countryCode={backCountry}
          partyId={String(party.id)}
          initialData={analyticsData}
        />
      )}

      {activeTab === "caucuses" && (
        <CaucusesTab
          countryCode={backCountry}
          partyId={String(party.id)}
          viewerCharacterId={user?.character?.id ?? null}
          currentTurn={currentTurn}
          isNationalParty={true}
          viewerInParty={isInParty}
          eligibleStates={eligibleStates}
          initialSelectedSlug={searchParams.get("caucus")}
        />
      )}

      {activeTab === "whip-room" && (
        <WhipRoomTab
          countryId={party.countryId}
          partyId={String(party.id)}
          partyColor={party.color}
          canUsePartyInfluence={!!canUsePartyInfluence}
          eligibleStates={eligibleStates}
        />
      )}

      {activeTab === "slate" && (
        <SlateTab
          countryCode={backCountry}
          countryId={party.countryId}
          partyId={String(party.id)}
          partyColor={party.color}
          canManageSlate={!!canUsePartyInfluence}
          partyMembers={party.members}
          initialSelectedState={searchParams.get("state")}
        />
      )}

      {activeTab === "committee" && (
        <div className="space-y-12">
          <section aria-labelledby="committee-title">
            <h2 id="committee-title" className={PARTY_SECTION_HEADING_CLASS}>
              {getPartyRoleLabel(party.countryId, "committee")}
            </h2>
            <p className="mt-1 max-w-2xl text-body text-muted">
              {`The ${getPartyRoleLabel(party.countryId, "committee")} consists of up to 6 elected members who help guide party policy and strategy.`}
            </p>
            <ol className="mt-4 grid border-t border-card-border sm:grid-cols-2 sm:gap-x-12 md:grid-cols-3">
              {Array.from({
                length: Math.max(
                  committeeData?.committeeSize || 6,
                  committeeData?.committeeMembers?.length ?? 0
                ),
              }).map((_, idx) => {
                const member = committeeData?.committeeMembers?.[idx];
                return (
                  <li
                    key={member ? member.id : `empty-${idx}`}
                    className="flex items-baseline justify-between gap-3 border-b border-card-border py-3"
                  >
                    <span className="text-body-sm tabular-nums text-muted">Seat {idx + 1}</span>
                    {member ? (
                      <Link
                        href={`/character/${member.sequentialId ?? member.id}`}
                        className="min-w-0 truncate text-body font-medium text-foreground hover:underline"
                      >
                        {member.name}
                      </Link>
                    ) : (
                      <span className="text-body text-muted">Vacant</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
          <CommitteeProposalsSection
            country={backCountry}
            countryCode={countryCode}
            partyId={id}
            characterId={user?.character?.id ?? null}
            isChair={isChair}
          />
        </div>
      )}

      {activeTab === "actions" && (
        <div className="space-y-8">
          <section aria-labelledby="party-resources-title">
            <h2 id="party-resources-title" className={PARTY_SECTION_HEADING_CLASS}>
              Party resources
            </h2>
            <dl className="mt-4 grid max-w-2xl gap-6 sm:grid-cols-2">
              <div>
                <dt className="text-body-sm text-muted">Treasury</dt>
                <dd className={PARTY_VALUE_CLASS}>
                  {nationalFmt(party.treasury, party.countryId)}
                </dd>
              </div>
              <div>
                <dt className="text-body-sm text-muted">Action points</dt>
                <dd className={PARTY_VALUE_CLASS}>
                  {party.nppActionPoints} / {party.nppActionPointCap}
                </dd>
                <dd className="mt-2 h-1.5 overflow-hidden rounded-full bg-card-border" aria-hidden>
                  <div
                    className="h-full rounded-full bg-foreground/70 transition-all duration-300"
                    style={{
                      width: `${party.nppActionPointCap > 0 ? Math.min(100, (party.nppActionPoints / party.nppActionPointCap) * 100) : 0}%`,
                    }}
                  />
                </dd>
                <dd className="mt-1.5 text-body-sm text-muted">
                  +{party.nppActionPointRegen} per turn, spent on NPP recruitment and management
                </dd>
              </div>
            </dl>
          </section>
          <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-card-border p-1">
            {(
              (canUsePartyInfluence ? ["recruitment", "management"] : ["management"]) as NppSubTab[]
            ).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setNppSubTab(sub)}
                className={`whitespace-nowrap rounded-md px-4 py-1.5 text-body font-medium transition-colors ${
                  effectiveNppSubTab === sub
                    ? "bg-card-elevated text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {sub === "recruitment" ? "Recruitment" : "Management"}
              </button>
            ))}
          </div>
          {effectiveNppSubTab === "recruitment" ? (
            <NppRecruitmentPanel partyId={party.id} countryId={party.countryId} isNational={true} />
          ) : (
            <NationalPartyInfluencePanel
              partyId={party.id}
              partyColor={party.color}
              country={backCountry}
              onPartyRefresh={fetchParty}
            />
          )}
        </div>
      )}

      {activeTab === "elections" && (
        <div className="space-y-6">
          <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-card-border p-1">
            {(["national", "committee", "state"] as ElectionSubTab[]).map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setElectionSubTab(sub)}
                className={`whitespace-nowrap rounded-md px-4 py-1.5 text-body font-medium transition-colors ${
                  electionSubTab === sub
                    ? "bg-card-elevated text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {sub === "national"
                  ? "National leadership"
                  : sub === "committee"
                    ? getPartyRoleLabel(party?.countryId ?? "US", "committee")
                    : `${COUNTRY_CONFIGS[(party?.countryId ?? "US") as CountryId]?.regionLabelPlural ?? "State parties"}`}
              </button>
            ))}
          </div>
          {electionSubTab === "national" && (
            <>
              <p className="text-body-sm text-muted">
                Each election runs 96 turns. Members may vote and change their vote anytime before
                it closes. Ties broken by earliest declaration.
              </p>
              {!electionData ? (
                <div className="text-body text-muted">Loading elections…</div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  {POSITIONS.map((pos) => (
                    <NationalElectionPanel
                      key={pos}
                      election={electionData.elections[pos]}
                      position={pos}
                      partyColor={party.color}
                      partyId={id}
                      country={backCountry}
                      canVote={electionData.canVote}
                      canRun={electionData.canRun}
                      runCooldownUntil={electionData.runCooldownUntil}
                      electionMethod={electionData.leadershipElectionMethod}
                      userVote={electionData.userVotes[pos]}
                      isCandidate={electionData.isCandidate[pos]}
                      isCandidateElsewhere={
                        candidatePositions.length > 0 && !candidatePositions.includes(pos)
                      }
                      currentTurn={currentTurn}
                      onRefresh={fetchElections}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {electionSubTab === "committee" && (
            <NationalCommitteeElectionPanel
              election={committeeData?.election ?? null}
              partyColor={party.color}
              partyId={id}
              country={backCountry}
              canVote={committeeData?.canVote ?? false}
              canRun={committeeData?.canRun ?? false}
              runCooldownUntil={committeeData?.runCooldownUntil ?? null}
              userVotes={committeeData?.userVotes ?? []}
              isCandidate={committeeData?.isCandidate ?? false}
              currentTurn={currentTurn}
              onRefresh={fetchCommittee}
            />
          )}
          {electionSubTab === "state" && (
            <StatePartyLinksTab
              partyId={id}
              partyColor={party.color}
              countryId={party.countryId}
              canManage={canUsePartyInfluence}
              canSpendPs={canUsePartyInfluence}
              nationalPoliticalStrength={party.politicalStrength ?? 0}
              nationalTreasury={party.treasury ?? 0}
              onNationalPsSpent={fetchParty}
            />
          )}
        </div>
      )}

      {activeTab === "treasury" && (
        <div className="space-y-6">
          <TreasuryPanel
            party={party}
            partyId={id}
            countryId={party.countryId}
            modViewEnabled={modViewEnabled}
            canManageTreasury={canManageTreasury}
            canManageTreasuryPlan={!!canManageTreasuryPlan}
            canManageTax={!!canManageTax}
            canManageBudgets={!!canManageBudgets}
            isInParty={isInParty}
            isAdmin={!!user?.isAdmin}
            sortedMembers={sortedMembers}
            onPartyRefresh={fetchParty}
            onUserRefresh={fetchUser}
            user={user}
          />
          {isInParty && (
            <RequestFundsCard party={party} countryCode={backCountry} onRequested={fetchParty} />
          )}
          <PendingTreasuryTransactionsCard
            countryCode={backCountry}
            partyId={String(party.id)}
            onActed={fetchParty}
          />
          <TreasuryTransactionLog countryCode={backCountry} partyId={String(party.id)} />
        </div>
      )}

      {activeTab === "members" && <MembersPanel party={party} />}

      {activeTab === "discussion" && (
        <DiscussionTab
          apiBasePath={`${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/discussion`}
          isModerator={!!(user?.isModerator || user?.isAdmin)}
        />
      )}

      {activeTab === "chair-office" && canActAsChair && (
        <>
          {isActingChair && (
            <div className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-body text-warning">
              <strong>Acting chair.</strong> The chair seat is vacant; you have inherited chair
              authority as Vice-Chair. This access reverts once a new chair is elected or
              admin-appointed.
            </div>
          )}
          <ChairOfficeTab
            party={party}
            countryId={backCountry}
            characterId={user?.character?.id ?? ""}
            onUpdate={fetchParty}
          />
        </>
      )}

      {activeTab === "leadership" && party.countryId === "UK" && (
        <LeadershipPanel countryCode={backCountry} partyId={id} />
      )}

      {activeTab === "conference" && party.countryId === "UK" && (
        <ConferencePanel countryCode={backCountry} partyId={id} />
      )}

      {activeTab === "admin" && user?.isAdmin && (
        <NationalPartyAdminTab party={party} onUpdate={fetchParty} />
      )}
    </PartyHubChrome>
  );
}

function StatePartyHub({ scope }: { scope: Extract<PartyHubScope, { kind: "state" }> }) {
  const { countryCode: code, partyId, regionId } = scope;
  const countryCode = code.toUpperCase();
  const stateId = scope.stateId.toUpperCase();
  const searchParams = useSearchParams();

  const {
    user,
    stateParty,
    currentTurn,
    loading,
    fetchUser,
    fetchStateParty,
    taxRate,
    setTaxRate,
    gotvPercent,
    setGotvPercent,
    gotvCategory,
    setGotvCategory,
    gotvGroup,
    setGotvGroup,
    suppressionPercent,
    setSuppressionPercent,
    suppressionCategory,
    setSuppressionCategory,
    suppressionGroup,
    setSuppressionGroup,
    transferReserveAmount,
    setTransferReserveAmount,
    memberSupportReserveAmount,
    setMemberSupportReserveAmount,
    nppRecruitmentReserveAmount,
    setNppRecruitmentReserveAmount,
    treasuryPreset,
    setTreasuryPreset,
    psInvestmentBudget,
    setPsInvestmentBudget,
  } = useStatePartyData(countryCode, stateId, partyId);

  const [activeTab, setActiveTab] = useState<StateMainTab>("overview");
  const [nppSubtab, setNppSubtab] = useState<"recruitment" | "management">("recruitment");
  const [msg, setMsg] = useState("");
  const [analyticsData, setAnalyticsData] = useState<StatePartyAnalyticsPayload | null>(null);

  const treasury = useStatePartyTreasuryActions({
    countryCode,
    stateId,
    partyId,
    countryId: stateParty?.countryId,
    taxRate,
    gotvPercent,
    gotvCategory,
    gotvGroup,
    suppressionPercent,
    suppressionCategory,
    suppressionGroup,
    transferReserveAmount,
    memberSupportReserveAmount,
    nppRecruitmentReserveAmount,
    treasuryPreset,
    psInvestmentBudget,
    fetchStateParty,
    fetchUser,
    setMsg,
  });

  const hasCharEarly = !!user?.character?.id;
  const isChairEarly =
    hasCharEarly && !!stateParty?.chair?.id && stateParty.chair.id === user?.character?.id;
  const isViceChairEarly =
    hasCharEarly && !!stateParty?.viceChair?.id && stateParty.viceChair.id === user?.character?.id;
  const isNatChairEarly =
    hasCharEarly &&
    !!stateParty?.nationalChairId &&
    stateParty.nationalChairId === user?.character?.id;
  const isNatViceChairEarly =
    hasCharEarly &&
    !!stateParty?.nationalViceChairId &&
    stateParty.nationalViceChairId === user?.character?.id;
  const isMemberEarly =
    hasCharEarly &&
    user?.character?.party === stateParty?.partyId &&
    user?.character?.homeState === stateId.toUpperCase();
  const canInfluenceEarly = user?.isAdmin || isChairEarly || isViceChairEarly;
  const canViewExtendedTabsEarly =
    user?.isAdmin || isMemberEarly || isNatChairEarly || isNatViceChairEarly;

  useEffect(() => {
    if (!canViewExtendedTabsEarly) return;
    let cancelled = false;
    async function loadAnalytics() {
      try {
        const response = await fetch(
          `${regionPartyApiUrl(countryCode, stateId, partyId)}/analytics`
        );
        if (!response.ok) return;
        const body = (await response.json()) as StatePartyAnalyticsPayload;
        if (!cancelled) setAnalyticsData(body);
      } catch {
        if (!cancelled) setAnalyticsData(null);
      }
    }
    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [canViewExtendedTabsEarly, countryCode, stateId, partyId]);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (!tabParam || !stateParty) return;
    const allowedTabs = canViewExtendedTabsEarly
      ? new Set<StateMainTab>([
          "overview",
          "analytics",
          "whip-room",
          "slate",
          "elections",
          "treasury",
          "members",
          "discussion",
        ])
      : new Set<StateMainTab>(["overview", "members"]);
    if (canViewExtendedTabsEarly && canInfluenceEarly) allowedTabs.add("actions");
    if (canViewExtendedTabsEarly && user?.isAdmin) allowedTabs.add("admin");
    const subParam = searchParams.get("sub");
    queueMicrotask(() => {
      if (allowedTabs.has(tabParam as StateMainTab)) {
        setActiveTab(tabParam as StateMainTab);
      }
      if (tabParam === "actions" && subParam) {
        const allowedNppSubTabs = new Set(["recruitment", "management"]);
        if (allowedNppSubTabs.has(subParam)) {
          setNppSubtab(subParam as "recruitment" | "management");
        }
      }
    });
  }, [searchParams, stateParty, canInfluenceEarly, canViewExtendedTabsEarly, user?.isAdmin]);

  const switcherRegionId = useMemo(
    () =>
      resolveScopeSwitcherRegionId(
        scope,
        partyId,
        user?.character?.homeState,
        user?.character?.party,
        [regionId]
      ),
    [scope, partyId, user?.character?.homeState, user?.character?.party, regionId]
  );

  const regionLabel =
    COUNTRY_CONFIGS[(stateParty?.countryId ?? countryCode) as CountryId]?.regionLabel ?? "Region";

  if (loading) return <PartyPageSkeleton />;
  if (!stateParty) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted">State party not found.</div>
      </div>
    );
  }

  const hasChar = !!user?.character?.id;
  const isChair = hasChar && !!stateParty?.chair?.id && stateParty.chair.id === user?.character?.id;
  const isViceChair =
    hasChar && !!stateParty?.viceChair?.id && stateParty.viceChair.id === user?.character?.id;
  const isTreasurer =
    hasChar && !!stateParty?.treasurer?.id && stateParty.treasurer.id === user?.character?.id;
  const isNatChair =
    hasChar && !!stateParty?.nationalChairId && stateParty.nationalChairId === user?.character?.id;
  const isNatViceChair =
    hasChar &&
    !!stateParty?.nationalViceChairId &&
    stateParty.nationalViceChairId === user?.character?.id;
  const isMember =
    hasChar &&
    user?.character?.party === stateParty?.partyId &&
    user?.character?.homeState === stateId.toUpperCase();
  const canManageLead = user?.isAdmin || isNatChair;
  const canManageTreas = user?.isAdmin || isNatChair || isChair || isViceChair || isTreasurer;
  const canManageTreasuryPlan =
    user?.isAdmin ||
    isTreasurer ||
    (!stateParty?.treasurer?.id && (isNatChair || isChair || isViceChair));
  const canChangeTax = canManageTreas;
  const canInfluence = user?.isAdmin || isChair || isViceChair;
  const isStateCampaigner =
    hasChar && !!user?.character?.id && stateParty?.campaigner?.id === user.character.id;
  const isNatCampaigner =
    hasChar &&
    !!user?.character?.id &&
    !!stateParty?.nationalCampaignerIds?.includes(user.character.id);
  const canBuildOrg =
    user?.isAdmin ||
    isChair ||
    isViceChair ||
    isNatChair ||
    isNatViceChair ||
    isStateCampaigner ||
    isNatCampaigner;
  const canAssignCampaigner = !!(user?.isAdmin || isChair || isNatChair);
  const canManageSlate = user?.isAdmin || isNatChair || isNatViceChair || isChair || isViceChair;
  const canViewExtendedTabs = user?.isAdmin || isMember || isNatChair || isNatViceChair;

  const regionAdjective = (() => {
    if (countryCode !== "UK") return stateParty.stateName;
    const region = UK_REGIONS.find((r) => r.id === stateId);
    return region?.adjective ?? stateParty.stateName;
  })();

  const orgLabel = getOrgLabel(stateParty.organization);
  const leanLabel = getStateLeanLabel(stateParty.politicalLean);

  const MAIN_TABS: { id: StateMainTab; label: string }[] = canViewExtendedTabs
    ? [
        { id: "overview", label: "Overview" },
        { id: "analytics", label: "Analytics" },
        ...(canInfluence ? [{ id: "whip-room" as StateMainTab, label: "Whip room" }] : []),
        { id: "slate", label: "Slate" },
        ...(canInfluence ? [{ id: "actions" as StateMainTab, label: "NPPs" }] : []),
        { id: "elections", label: "Elections" },
        { id: "treasury", label: "Treasury" },
        { id: "members", label: `Members (${stateParty.memberCount})` },
        { id: "discussion", label: "Discussion" },
        ...(user?.isAdmin ? [{ id: "admin" as StateMainTab, label: "Admin" }] : []),
      ]
    : [
        { id: "overview", label: "Overview" },
        { id: "members", label: `Members (${stateParty.memberCount})` },
      ];

  return (
    <PartyHubChrome
      scope={scope}
      countryCode={countryCode}
      partyId={partyId}
      switcherRegionId={switcherRegionId}
      switcherRegionLabel={regionLabel}
      breadcrumb={
        <div className="mb-6 flex flex-wrap items-center gap-2 text-body text-muted">
          <Link href={regionUrl(countryCode, regionId)} className="hover:text-foreground">
            {stateParty.stateName}
          </Link>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <Link
            href={partyUrl(stateParty.countryId ?? countryCode, stateParty.partyId)}
            className="hover:text-foreground"
          >
            {stateParty.partyName}
          </Link>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-foreground">
            {regionAdjective} {stateParty.partyName}
          </span>
        </div>
      }
      headerContext={`${regionAdjective} party`}
      title={`${regionAdjective} ${stateParty.partyName}`}
      partyColor={stateParty.partyColor}
      partyAbbreviation={stateParty.partyAbbreviation}
      logoPartyId={stateParty.partyId}
      logoUrl={stateParty.partyLogoUrl}
      countryId={stateParty.countryId}
      regimeStatus={stateParty.regimeStatus}
      tierLabel={isMember ? "Member" : null}
      headerExtra={
        <p className="mt-3 text-body text-muted">
          {stateParty.stateName} electorate:{" "}
          <span className="font-medium text-foreground">{leanLabel.label}</span>
        </p>
      }
      statsStrip={
        <PartyStatsRow>
          <PartyStat label="Organization" detail={orgLabel.label}>
            <span className={PARTY_VALUE_CLASS}>{stateParty.organization.toFixed(1)}%</span>
          </PartyStat>
          <PartyStat label="Treasury">
            <span className={`block truncate ${PARTY_VALUE_CLASS}`}>
              {stateFmt(stateParty.treasury, stateParty.countryId)}
            </span>
          </PartyStat>
          <PartyStat
            label="Political strength"
            detail={
              stateParty.politicalStrength < (stateParty.effectivePsCap ?? STATE_PS_CAP_DEFAULT)
                ? `~+${STATE_PASSIVE_PS_PER_TURN} per turn`
                : "at cap"
            }
          >
            <span className={PARTY_VALUE_CLASS}>{stateParty.politicalStrength.toFixed(1)}</span>
            <span className="ml-1 text-body-sm text-muted">
              of {stateParty.effectivePsCap ?? STATE_PS_CAP_DEFAULT}
            </span>
          </PartyStat>
          <PartyStat label="Members">
            <span className={PARTY_VALUE_CLASS}>{stateParty.memberCount}</span>
          </PartyStat>
          {/* This is the ELECTORATE's partisan lean, not the party's. Labelled
              "Lean" on a party page it read as "this party leans Republican",
              which on a Democratic party page is exactly backwards. */}
          <PartyStat label={`${stateParty.stateName} electorate`}>
            <span className="text-body-lg font-semibold text-foreground">{leanLabel.label}</span>
          </PartyStat>
        </PartyStatsRow>
      }
      msg={msg}
      agendaBanner={
        <AgendaBannerWithEdit
          countryCode={countryCode}
          partyId={stateParty.partyId}
          partyAbbreviation={stateParty.partyAbbreviation}
          partyColor={stateParty.partyColor}
          canEdit={!!(isNatChair || isNatViceChair || user?.isAdmin)}
        />
      }
      tabs={MAIN_TABS}
      activeTab={activeTab}
      onTabChange={(tabId) => {
        setActiveTab(tabId as StateMainTab);
        if (tabId !== "actions") setNppSubtab("recruitment");
      }}
    >
      <StatePartyHubBody
        countryCode={countryCode}
        stateId={stateId}
        partyId={partyId}
        activeTab={activeTab}
        nppSubtab={nppSubtab}
        setNppSubtab={setNppSubtab}
        stateParty={stateParty}
        user={user}
        currentTurn={currentTurn}
        analyticsData={analyticsData}
        fetchStateParty={fetchStateParty}
        treasury={treasury}
        msg={msg}
        canInfluence={canInfluence}
        canViewExtendedTabs={canViewExtendedTabs}
        canBuildOrg={canBuildOrg}
        canAssignCampaigner={canAssignCampaigner}
        canManageLead={canManageLead}
        canManageTreas={canManageTreas}
        canManageTreasuryPlan={!!canManageTreasuryPlan}
        canChangeTax={canChangeTax}
        canManageSlate={canManageSlate}
        isMember={isMember}
        taxRate={taxRate}
        setTaxRate={setTaxRate}
        gotvPercent={gotvPercent}
        setGotvPercent={setGotvPercent}
        gotvCategory={gotvCategory}
        setGotvCategory={setGotvCategory}
        gotvGroup={gotvGroup}
        setGotvGroup={setGotvGroup}
        suppressionPercent={suppressionPercent}
        setSuppressionPercent={setSuppressionPercent}
        suppressionCategory={suppressionCategory}
        setSuppressionCategory={setSuppressionCategory}
        suppressionGroup={suppressionGroup}
        setSuppressionGroup={setSuppressionGroup}
        transferReserveAmount={transferReserveAmount}
        setTransferReserveAmount={setTransferReserveAmount}
        memberSupportReserveAmount={memberSupportReserveAmount}
        setMemberSupportReserveAmount={setMemberSupportReserveAmount}
        nppRecruitmentReserveAmount={nppRecruitmentReserveAmount}
        setNppRecruitmentReserveAmount={setNppRecruitmentReserveAmount}
        treasuryPreset={treasuryPreset}
        setTreasuryPreset={setTreasuryPreset}
        psInvestmentBudget={psInvestmentBudget}
        setPsInvestmentBudget={setPsInvestmentBudget}
      />
    </PartyHubChrome>
  );
}
