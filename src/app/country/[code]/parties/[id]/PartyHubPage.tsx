"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getMessageStyle } from "@/lib/utils/formatters";
import { MAJOR_DEMOTION_GRACE_TURNS } from "@/lib/parties/partyTier";
import { CardSkeleton, HeroStatsStrip, Skeleton } from "@/components/ui";
import { PartyLogo } from "@/components/PartyLogo";
import { PartyRegimeBadge } from "@/components/parties/PartyRegimeBadge";
import { RegimeOffersInbox } from "@/components/parties/RegimeOffersInbox";
import { AgendaBannerWithEdit } from "@/components/party-hub/AgendaBannerWithEdit";
import { COUNTRY_CONFIGS, CountryId } from "@/lib/constants/countries";
import { parseCountryParam } from "@/lib/db/partyLookup";
import { partyApiUrl, partyUrl, regionPartyApiUrl, regionPartyUrl, regionUrl } from "@/lib/urls";
import { PositionLabel } from "@/components/PositionLabel";
import { contrastTextColor } from "@/lib/utils/colorContrast";
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
    <div className="mt-3 inline-flex rounded-lg border border-card-border bg-background/60 p-1">
      <Link
        href={nationalHref}
        className={`rounded-md px-3 py-1.5 text-body-xs font-semibold transition-colors ${
          isNational ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground"
        }`}
      >
        National
      </Link>
      {regionHref ? (
        <Link
          href={regionHref}
          className={`rounded-md px-3 py-1.5 text-body-xs font-semibold transition-colors ${
            !isNational ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground"
          }`}
        >
          {regionLabel}
        </Link>
      ) : (
        <span className="rounded-md px-3 py-1.5 text-body-xs font-semibold text-muted/50 cursor-not-allowed">
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
  headerEyebrow: string;
  title: string;
  partyColor: string;
  partyAbbreviation: string;
  logoPartyId: string;
  logoUrl?: string | null;
  countryId: CountryId | string;
  regimeStatus?: "ruling" | "approved" | "banned" | null;
  tierBadge?: ReactNode;
  headerExtra?: ReactNode;
  headerActions?: ReactNode;
  modViewBanner?: ReactNode;
  statsStrip: ReactNode;
  msg: string;
  defunctBanner?: ReactNode;
  agendaBanner: ReactNode;
  tabs: { id: string; label: string; className?: string }[];
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
  headerEyebrow,
  title,
  partyColor,
  partyAbbreviation,
  logoPartyId,
  logoUrl,
  countryId,
  regimeStatus,
  tierBadge,
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
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        {breadcrumb}
        {backLink}

        <header className="mb-6 overflow-hidden rounded-xl border border-card-border bg-card shadow-panel">
          <div
            className="relative border-b-4 px-4 py-6 sm:px-7 sm:py-8"
            style={{
              backgroundColor: `${partyColor}18`,
              borderBottomColor: partyColor,
            }}
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <PartyLogo
                  partyId={logoPartyId}
                  partyColor={partyColor}
                  logoUrl={logoUrl}
                  size="h-16 w-16"
                  countryId={countryId as CountryId}
                />
                <div className="min-w-0">
                  <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
                    {headerEyebrow}
                  </p>
                  <h1 className="mt-1 text-display font-extrabold tracking-tight">{title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-body-sm font-bold" style={{ color: partyColor }}>
                      {partyAbbreviation}
                    </span>
                    <PartyRegimeBadge regimeStatus={regimeStatus} />
                    {tierBadge}
                  </div>
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
            {modViewBanner}
          </div>
          {statsStrip}
        </header>

        {msg ? (
          <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(msg)}`}>{msg}</div>
        ) : null}
        {defunctBanner}
        <div className="mb-4">{agendaBanner}</div>

        <div className="mb-6 rounded-xl border border-card-border bg-card p-2 shadow-card">
          <nav aria-label="Party sections" className="flex gap-1 overflow-x-auto scrollbar-hide">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                aria-pressed={activeTab === t.id}
                className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-center text-body-sm font-semibold transition-colors ${
                  activeTab === t.id
                    ? t.id === "admin"
                      ? "border-error/40 bg-error/10 text-error"
                      : "border-primary/40 bg-primary/10 text-primary"
                    : (t.className ??
                      "border-transparent text-muted hover:border-card-border hover:bg-card-elevated hover:text-foreground")
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

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
        setMsg(`✗ ${payload?.error ?? "Failed to enable Mod View"}`);
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

  const apiPost = async (url: string, body: object, onOk?: () => void) => {
    setMsg("");
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      setMsg(r.ok ? `✓ ${d.message}` : `✗ ${d.error}`);
      if (r.ok) {
        fetchParty();
        onOk?.();
      }
    } catch {
      setMsg("✗ Network error");
    }
  };

  const handleJoin = async () => {
    setJoining(true);
    await apiPost(`${partyApiUrl(requestedCountry?.toLowerCase() ?? "us", id)}/join`, {});
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

  const MAIN_TABS: { id: NationalMainTab; label: string; className?: string }[] =
    canViewExtendedTabs
      ? [
          { id: "overview", label: "Overview" },
          { id: "analytics", label: "Analytics" },
          { id: "committee", label: "Committee" },
          { id: "caucuses", label: "Caucuses" },
          { id: "whip-room", label: "Whip Room" },
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
                  label: isActingChair ? "Chair Office (acting)" : "Chair Office",
                },
              ]
            : []),
          ...(user?.isAdmin
            ? [{ id: "admin" as NationalMainTab, label: "Admin", className: "text-error" }]
            : []),
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
          className="mb-4 inline-flex items-center gap-2 text-body-sm font-semibold text-muted transition-colors hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          All Parties
        </Link>
      }
      headerEyebrow="National headquarters"
      title={party.name}
      partyColor={party.color}
      partyAbbreviation={party.abbreviation}
      logoPartyId={party.id}
      logoUrl={party.logoUrl}
      countryId={party.countryId}
      regimeStatus={party.regimeStatus}
      tierBadge={
        (party.tier ?? (party.isDefault ? "major" : "minor")) === "major" ? (
          <span className="rounded-full border border-card-border bg-background/60 px-2 py-0.5 text-body-xs capitalize text-muted">
            Major Party
          </span>
        ) : (
          <span className="rounded-full border border-card-border bg-background/60 px-2 py-0.5 text-body-xs capitalize text-muted">
            Minor Party
          </span>
        )
      }
      headerExtra={
        party.majorDemotionWarning ? (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-body-xs text-warning">
            <span className="font-semibold">Major Party status at risk.</span> Org has fallen below
            10% in two-thirds of regions. Regain 20% Org in at least a third of regions within{" "}
            <span className="font-semibold tabular-nums">
              {Math.max(
                0,
                party.majorDemotionWarning.startedTurn + MAJOR_DEMOTION_GRACE_TURNS - currentTurn
              )}
            </span>{" "}
            turns or this party will be demoted to Minor.
          </div>
        ) : null
      }
      headerActions={
        user?.hasCharacter ? (
          isInParty ? (
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="rounded-lg border border-error/40 bg-error/10 px-4 py-2 text-body-sm font-semibold text-error transition-colors hover:bg-error/20 disabled:opacity-50"
            >
              {leaving ? "Leaving…" : "Leave Party"}
            </button>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              className="rounded-lg px-4 py-2 text-body-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                backgroundColor: party.color,
                color: contrastTextColor(party.color),
              }}
            >
              {joining ? "Joining…" : "Join Party"}
            </button>
          )
        ) : null
      }
      modViewBanner={
        !user?.isAdmin && user?.isModerator && !isInParty ? (
          <div className="mt-5 rounded-lg border border-info/30 bg-info/10 p-4 text-body-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-foreground">Moderator View</p>
                <p className="text-muted">
                  Unlock member-only party tabs in read-only mode. Each unlock is written to the
                  moderator audit log.
                </p>
              </div>
              {modViewEnabled ? (
                <span className="w-fit rounded-full border border-info/40 bg-info/15 px-3 py-1 text-body-xs font-semibold uppercase tracking-wide text-info">
                  Mod View Active
                </span>
              ) : (
                <button
                  type="button"
                  onClick={enableModView}
                  disabled={modViewLoading}
                  className="w-fit rounded-lg border border-info/40 bg-info/15 px-4 py-2 font-semibold text-info transition-colors hover:bg-info/20 disabled:opacity-50"
                >
                  {modViewLoading ? "Enabling..." : "Mod View"}
                </button>
              )}
            </div>
          </div>
        ) : null
      }
      statsStrip={
        <HeroStatsStrip layout="grid">
          <div className="min-w-0 p-4">
            <span className="text-body-xs font-bold uppercase tracking-widest text-muted">
              Political Strength
            </span>
            <span className="text-heading font-bold text-info tabular-nums">
              {(party.politicalStrength ?? 0).toFixed(1)}
              <span className="ml-0.5 text-body-xs font-normal text-muted">
                /{party.effectivePsCap}
              </span>
            </span>
          </div>
          <div className="min-w-0 p-4">
            <span className="text-body-xs font-bold uppercase tracking-widest text-muted">
              Members
            </span>
            <span className="text-heading font-bold text-foreground tabular-nums">
              {party.memberCount}
            </span>
          </div>
          <div className="min-w-0 p-4">
            <span className="text-body-xs font-bold uppercase tracking-widest text-muted">
              Treasury
            </span>
            <span className="block truncate text-heading font-bold text-warning tabular-nums">
              {nationalFmt(party.treasury, party.countryId)}
            </span>
          </div>
          <div className="min-w-0 p-4">
            <span className="text-body-xs font-bold uppercase tracking-widest text-muted">
              Economic
            </span>
            <PositionLabel
              value={party.economicPosition}
              axis="economic"
              className="text-body-sm font-bold"
            />
          </div>
          <div className="min-w-0 p-4">
            <span className="text-body-xs font-bold uppercase tracking-widest text-muted">
              Social
            </span>
            <PositionLabel
              value={party.socialPosition}
              axis="social"
              className="text-body-sm font-bold"
            />
          </div>
          <div className="min-w-0 p-4">
            <span className="text-body-xs font-bold uppercase tracking-widest text-muted">
              Bonus Actions
            </span>
            <span className="text-heading font-bold text-primary tabular-nums">
              +{party.totalBonusActions}
              <span className="ml-1 text-body-xs font-normal text-muted">/turn</span>
            </span>
          </div>
        </HeroStatsStrip>
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
        <div className="space-y-6">
          <PartyOverviewPanel party={party} />
          <RegimeOffersInbox countryCode={backCountry} partySequentialId={String(party.id)} />
          {canViewExtendedTabs && (
            <div className="grid gap-6 md:grid-cols-2">
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
        <div className="space-y-6">
          <div className="rounded-xl border border-card-border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">
              {getPartyRoleLabel(party.countryId, "committee")}
            </h2>
            <p className="text-sm text-muted mb-4">
              {`The ${getPartyRoleLabel(party.countryId, "committee")} consists of up to 6 elected members who help guide party policy and strategy.`}
            </p>
            {committeeData?.committeeMembers && committeeData.committeeMembers.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {committeeData.committeeMembers.map((member, idx) => (
                  <div
                    key={member.id}
                    className="rounded-lg border border-card-border bg-background p-4"
                  >
                    <div className="text-xs text-muted mb-1">Seat {idx + 1}</div>
                    <Link
                      href={`/character/${member.sequentialId ?? member.id}`}
                      className="font-medium text-primary hover:underline text-sm"
                    >
                      {member.name}
                    </Link>
                  </div>
                ))}
                {Array.from({
                  length:
                    (committeeData?.committeeSize || 6) - committeeData.committeeMembers.length,
                }).map((_, idx) => (
                  <div
                    key={`empty-${idx}`}
                    className="rounded-lg border border-card-border bg-background p-4"
                  >
                    <div className="text-xs text-muted mb-1">
                      Seat {committeeData.committeeMembers.length + idx + 1}
                    </div>
                    <span className="text-muted italic text-sm">Vacant</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {Array.from({ length: committeeData?.committeeSize || 6 }).map((_, idx) => (
                  <div
                    key={`empty-${idx}`}
                    className="rounded-lg border border-card-border bg-background p-4"
                  >
                    <div className="text-xs text-muted mb-1">Seat {idx + 1}</div>
                    <span className="text-muted italic text-sm">Vacant</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
        <div className="space-y-6">
          <div className="rounded-xl border border-card-border bg-card p-6">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">
              Party Resources
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Treasury</span>
                <span className="text-lg font-bold text-warning">
                  {nationalFmt(party.treasury, party.countryId)}
                </span>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted">Action Points</span>
                  <span className="text-lg font-bold tabular-nums text-primary">
                    {party.nppActionPoints} / {party.nppActionPointCap}
                  </span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-background">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{
                      width: `${party.nppActionPointCap > 0 ? Math.min(100, (party.nppActionPoints / party.nppActionPointCap) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 text-xs text-muted">
                  +{party.nppActionPointRegen}/turn · spent on NPP recruitment &amp; management
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-1 rounded-lg border border-card-border bg-background p-1 w-fit overflow-x-auto max-w-full">
            {(
              (canUsePartyInfluence ? ["recruitment", "management"] : ["management"]) as NppSubTab[]
            ).map((sub) => (
              <button
                key={sub}
                onClick={() => setNppSubTab(sub)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  effectiveNppSubTab === sub
                    ? "bg-card text-foreground shadow-sm"
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
        <div className="space-y-5">
          <div className="flex gap-1 p-1 rounded-lg bg-background border border-card-border w-fit overflow-x-auto max-w-full">
            {(["national", "committee", "state"] as ElectionSubTab[]).map((sub) => (
              <button
                key={sub}
                onClick={() => setElectionSubTab(sub)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  electionSubTab === sub
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {sub === "national"
                  ? "National Leadership"
                  : sub === "committee"
                    ? getPartyRoleLabel(party?.countryId ?? "US", "committee")
                    : `${COUNTRY_CONFIGS[(party?.countryId ?? "US") as CountryId]?.regionLabelPlural ?? "State Parties"}`}
              </button>
            ))}
          </div>
          {electionSubTab === "national" && (
            <>
              <p className="text-xs text-muted/70 italic">
                Each election runs 96 turns. Members may vote and change their vote anytime before
                it closes. Ties broken by earliest declaration.
              </p>
              {!electionData ? (
                <div className="text-muted text-sm">Loading elections…</div>
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
            <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
              <strong>Acting Chair.</strong> The chair seat is vacant; you have inherited chair
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

  const MAIN_TABS: { id: StateMainTab; label: string; className?: string }[] = canViewExtendedTabs
    ? [
        { id: "overview", label: "Overview" },
        { id: "analytics", label: "Analytics" },
        ...(canInfluence ? [{ id: "whip-room" as StateMainTab, label: "Whip Room" }] : []),
        { id: "slate", label: "Slate" },
        ...(canInfluence ? [{ id: "actions" as StateMainTab, label: "NPPs" }] : []),
        { id: "elections", label: "Elections" },
        { id: "treasury", label: "Treasury" },
        { id: "members", label: `Members (${stateParty.memberCount})` },
        { id: "discussion", label: "Discussion" },
        ...(user?.isAdmin
          ? [{ id: "admin" as StateMainTab, label: "Admin", className: "text-error" }]
          : []),
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
        <div className="mb-6 flex items-center gap-2 text-sm text-muted">
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
      headerEyebrow={`${regionAdjective} party`}
      title={`${regionAdjective} ${stateParty.partyName}`}
      partyColor={stateParty.partyColor}
      partyAbbreviation={stateParty.partyAbbreviation}
      logoPartyId={stateParty.partyId}
      logoUrl={stateParty.partyLogoUrl}
      countryId={stateParty.countryId}
      regimeStatus={stateParty.regimeStatus}
      tierBadge={
        isMember ? (
          <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-body-xs text-success">
            Member
          </span>
        ) : null
      }
      headerExtra={
        <span className="mt-2 inline-block text-body-sm text-muted">
          {stateParty.stateName} electorate:{" "}
          <span className={`font-semibold ${leanLabel.color}`}>{leanLabel.label}</span>
        </span>
      }
      statsStrip={
        /* Every label is `block`. Without it the label and its value ran
           together on one line ("ORGANIZATION29.1%"); Treasury was the only
           cell that read correctly because it was the only one whose value
           carried `block`. */
        <HeroStatsStrip layout="grid">
          <div className="min-w-0 p-4">
            <span className="block text-body-xs font-bold uppercase tracking-widest text-muted">
              Organization
            </span>
            <span className={`block text-heading font-bold tabular-nums ${orgLabel.color}`}>
              {stateParty.organization.toFixed(1)}%
            </span>
            <span className={`block text-body-xs ${orgLabel.color}`}>{orgLabel.label}</span>
          </div>
          <div className="min-w-0 p-4">
            <span className="block text-body-xs font-bold uppercase tracking-widest text-muted">
              Treasury
            </span>
            <span className="block truncate text-heading font-bold text-warning tabular-nums">
              {stateFmt(stateParty.treasury, stateParty.countryId)}
            </span>
          </div>
          <div className="min-w-0 p-4">
            <span className="block text-body-xs font-bold uppercase tracking-widest text-muted">
              Political Strength
            </span>
            <span className="block text-heading font-bold text-info tabular-nums">
              {stateParty.politicalStrength.toFixed(1)}
              <span className="ml-0.5 text-body-xs font-normal text-muted">
                /{stateParty.effectivePsCap ?? STATE_PS_CAP_DEFAULT}
              </span>
            </span>
            {stateParty.politicalStrength < (stateParty.effectivePsCap ?? STATE_PS_CAP_DEFAULT) ? (
              <span className="block text-body-xs text-muted">
                ~+{STATE_PASSIVE_PS_PER_TURN}/turn
              </span>
            ) : (
              <span className="block text-body-xs text-muted">at cap</span>
            )}
          </div>
          <div className="min-w-0 p-4">
            <span className="block text-body-xs font-bold uppercase tracking-widest text-muted">
              Members
            </span>
            <span className="block text-heading font-bold text-foreground tabular-nums">
              {stateParty.memberCount}
            </span>
          </div>
          {/* This is the ELECTORATE's partisan lean, not the party's. Labelled
              "Lean" on a party page it read as "this party leans Republican",
              which on a Democratic party page is exactly backwards. */}
          <div className="min-w-0 p-4">
            <span className="block text-body-xs font-bold uppercase tracking-widest text-muted">
              {stateParty.stateName} electorate
            </span>
            <span className={`block text-body-sm font-bold ${leanLabel.color}`}>
              {leanLabel.label}
            </span>
          </div>
        </HeroStatsStrip>
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
