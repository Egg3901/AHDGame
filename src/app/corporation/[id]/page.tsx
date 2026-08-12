"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import BackButton from "@/components/BackButton";
import { useToast } from "@/contexts/ToastContext";
import { getExchangeForCountry } from "@/lib/constants/exchangeRegistry";
import type { MoneyPeriod } from "@/lib/constants/moneyTimescale";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { CorporationHero } from "@/components/corporation/CorporationHero";
import { HostileTakeoverCard } from "@/components/corporation/HostileTakeoverCard";
import { SubsidiaryManagementCard } from "@/components/corporation/SubsidiaryManagementCard";
import { PrivatizationVotePanel } from "@/components/corporation/PrivatizationVotePanel";
import { ManagePrivateShareholdersPanel } from "@/components/corporation/ManagePrivateShareholdersPanel";
import PrivateSalePanel from "@/components/corporation/shares/PrivateSalePanel";
import { NationalizationStatusCard } from "@/components/corporation/NationalizationStatusCard";
import { NewFeatureBadge } from "@/components/ui";
import { useFeatureSeen } from "@/hooks/useFeatureSeen";
import { CORP_PAGE_FEATURE_KEYS } from "@/lib/ui/corpPageFeatureKeys";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import {
  CORP_TABS,
  CEO_TAB,
  DEALS_TAB,
  STRUCTURE_TAB,
} from "@/components/corporation/CorporationPageConstants";
import { SuperTabNav, resolveSuperTabs } from "@/components/nav/SuperTabNav";
import {
  ALL_CORP_TABS,
  CORP_LEGACY_TAB_MAP,
  buildCorpNavTabs,
  corpNavLocation,
  corpTabIdFor,
} from "@/components/corporation/CorporationTabGroups";
import FinancialsTab from "@/components/corporation/FinancialsTab";
import { NationalCorporationView } from "@/components/national/NationalCorporationView";
import {
  TabFallback,
  SectorsTab,
  SharesTab,
  CreditRatingTab,
  BondsTab,
  ChartsTab,
  SnapshotTab,
  CeoOfficeTab,
  OverviewTab,
  TechTab,
  CommoditiesTab,
  DealsTab,
  CorporationContractsTab,
  DefenceContractsTab,
  SupplyAgreementsSection,
  IndustrialRelationsSection,
  DefaultedBondCrisisModal,
} from "@/components/corporation/CorporationPageTabs";
import { BankConsoleTab } from "./bank/BankConsoleTab";
import type {
  CorporationDetail,
  CEO,
  Financials,
  SectorDetail,
  BalanceSheet,
  BondInfo,
  CorpTabId,
  CorporationDefenceView,
  FinancialFogMeta,
} from "@/components/corporation/CorporationPageTypes";

export default function CorporationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { showToast } = useToast();
  const id = params.id as string;

  const [corporation, setCorporation] = useState<CorporationDetail | null>(null);
  const [ceo, setCeo] = useState<CEO | null>(null);
  const [financials, setFinancials] = useState<Financials | null>(null);
  const [sectors, setSectors] = useState<SectorDetail[]>([]);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null);
  const [financialFogOfWar, setFinancialFogOfWar] = useState<FinancialFogMeta | null>(null);
  // Sibling of `corporation` in the payload, not a field on it.
  const [defenceContracts, setDefenceContracts] = useState<CorporationDefenceView | null>(null);
  const [ceoIsInactive, setCeoIsInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isCeo, setIsCeo] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [modViewEnabled, setModViewEnabled] = useState(false);
  const [modViewLoading, setModViewLoading] = useState(false);
  const [myCharacterId, setMyCharacterId] = useState<string | null>(null);
  const [myCashOnHand, setMyCashOnHand] = useState<number>(0);
  const [myCurrencyBalances, setMyCurrencyBalances] = useState<Partial<Record<string, number>>>({});
  const [myHomeCurrency, setMyHomeCurrency] = useState<string>("USD");
  const [myAutoConvertEnabled, setMyAutoConvertEnabled] = useState(true);
  const [myCorporation, setMyCorporation] = useState<{
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
  } | null>(null);
  const [isPendingCeo, setIsPendingCeo] = useState(false);
  const hasLoaded = useRef(false);

  // Bond/credit rating state
  const [bondInfo, setBondInfo] = useState<BondInfo | null>(null);
  const [bondDefaultModalOpen, setBondDefaultModalOpen] = useState(false);
  const bondInfoLoadedRef = useRef(false);
  const bondInfoPromiseRef = useRef<Promise<void> | null>(null);
  const [showBankTab, setShowBankTab] = useState(false);

  // Sectors state
  const [abandoningSectorId, setAbandoningSectorId] = useState<string | null>(null);
  const [sectorsMessage, setSectorsMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  // Tab state — URL-driven, grouped two-level nav (same pattern as the state
  // page). `?tab=` is the super-tab (group) and `?sub=` is the sub-tab; the old
  // flat `?tab=<tabId>` deep links resolve through CORP_LEGACY_TAB_MAP.
  //
  // This resolution deliberately uses the ungated tab list: it runs before the
  // corporation payload has said what this viewer may see, and it only drives
  // data prefetching. The rendered nav below uses the gated list.
  const groupResolved = resolveSuperTabs(
    buildCorpNavTabs(ALL_CORP_TABS),
    searchParams.get("tab"),
    searchParams.get("sub"),
    CORP_LEGACY_TAB_MAP,
    "overview"
  );
  const activeTab: CorpTabId =
    corpTabIdFor(ALL_CORP_TABS, groupResolved.superTab, groupResolved.subTab) ?? "overview";
  const commoditiesTabDiscovery = useFeatureSeen(CORP_PAGE_FEATURE_KEYS.commoditiesTab);
  const { isNew: commoditiesTabIsNew, markSeen: markCommoditiesTabSeen } = commoditiesTabDiscovery;

  const corpIsPrivate = !!corporation?.isPrivate;

  /**
   * Jump to a tab by its (stable) tab id — used by in-page links such as the
   * Overview tab's shortcuts into Sectors, Shares, and Credit.
   */
  const setTab = (tabId: CorpTabId) => {
    const target = corpNavLocation(ALL_CORP_TABS, tabId);
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", target.superTab);
    if (target.subTab) {
      p.set("sub", target.subTab);
    } else {
      p.delete("sub");
    }
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  // Dismiss the commodities "New" badge when landing via URL (bookmark / deep link).
  useEffect(() => {
    if (activeTab === "commodities") {
      markCommoditiesTabSeen();
    }
  }, [activeTab, markCommoditiesTabSeen]);

  const makeCorpApiUrl = useCallback(
    (suffix = "") => {
      const base = `/api/corporations/${id}${suffix}`;
      return modViewEnabled ? `${base}${base.includes("?") ? "&" : "?"}modView=1` : base;
    },
    [id, modViewEnabled]
  );

  const resetViewerContext = useCallback(() => {
    setMyCharacterId(null);
    setMyCashOnHand(0);
    setMyCurrencyBalances({});
    setMyHomeCurrency("USD");
    setMyAutoConvertEnabled(true);
    setMyCorporation(null);
    setIsCeo(false);
    setIsPendingCeo(false);
  }, []);

  const fetchCorporation = useCallback(async () => {
    try {
      // Only show the full-page skeleton on the initial load; refreshes update data silently
      // so that local subtab state (e.g. CEO Office subtab) is not reset on save.
      if (!hasLoaded.current) setLoading(true);
      const res = await fetch(makeCorpApiUrl());
      const data = await res.json();
      if (res.ok) {
        setError("");
        setCorporation(data.corporation);
        setCeo(data.ceo);
        setFinancials(data.financials);
        setSectors(data.sectors);
        setBalanceSheet(data.balanceSheet);
        setFinancialFogOfWar(data.financialFogOfWar ?? null);
        setDefenceContracts(data.defenceContracts ?? null);
        setCeoIsInactive(data.ceoIsInactive === true);
      } else if (!hasLoaded.current) {
        // Only set page-level error on initial load — refresh failures should not
        // destroy the entire page when we already have valid data displayed.
        setError(data.error || "Corporation not found");
      } else {
        showToast(data.error || "Failed to refresh corporation data", "error");
      }
    } catch {
      if (!hasLoaded.current) {
        setError("Network error");
      } else {
        showToast("Failed to refresh corporation data", "error");
      }
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [makeCorpApiUrl, showToast]);

  useEffect(() => {
    fetchCorporation();
  }, [fetchCorporation]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/banking/corporation/${id}`)
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { visible?: boolean };
        if (!cancelled) setShowBankTab(json.visible === true);
      })
      .catch(() => {
        if (!cancelled) setShowBankTab(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const fetchViewerContext = useCallback(async () => {
    try {
      const [characterRes, authRes] = await Promise.all([
        fetch("/api/character/me"),
        fetch("/api/auth/me"),
      ]);
      if (!characterRes.ok) {
        if (characterRes.status === 401) {
          resetViewerContext();
        }
      } else {
        const data = (await characterRes.json()) as {
          character?: {
            _id: string;
            cashOnHand?: number;
            currencyBalances?: { personal?: Partial<Record<string, number>> };
            homeCurrency?: string;
            autoConvertEnabled?: boolean;
          } | null;
          corporation?: {
            _id: string;
            name: string;
            liquidCapital?: number;
            liquidCurrencyCode?: string;
            isNationalCorp?: boolean;
          } | null;
        };
        if (!data.character) {
          resetViewerContext();
        } else {
          setMyCharacterId(data.character._id);
          // Post-Phase-8: prefer the per-currency personal balance in the
          // character's home currency; fall back to the legacy cashOnHand field
          // for any pre-migration clients.
          const homeCurrency = data.character.homeCurrency ?? "USD";
          setMyCashOnHand(
            data.character.currencyBalances?.personal?.[homeCurrency] ??
              data.character.cashOnHand ??
              0
          );
          setMyCurrencyBalances(data.character.currencyBalances?.personal ?? {});
          setMyHomeCurrency(homeCurrency);
          setMyAutoConvertEnabled(data.character.autoConvertEnabled ?? true);

          if (data.corporation && data.corporation._id !== id && !data.corporation.isNationalCorp) {
            setMyCorporation({
              id: data.corporation._id,
              name: data.corporation.name,
              liquidCapital: data.corporation.liquidCapital ?? 0,
              liquidCurrencyCode: data.corporation.liquidCurrencyCode,
            });
          } else {
            setMyCorporation(null);
          }
        }
      }
      if (authRes.ok) {
        const authData = (await authRes.json()) as {
          user?: { isModerator?: boolean; isAdmin?: boolean } | null;
        };
        const admin = Boolean(authData.user?.isAdmin);
        setIsAdmin(admin);
        setIsModerator(Boolean(authData.user?.isModerator) && !admin);
      } else {
        setIsModerator(false);
        setIsAdmin(false);
      }
    } catch {
      // Preserve the current viewer state on transient failures.
    }
  }, [id, resetViewerContext]);
  const enableModView = useCallback(async () => {
    if (!corporation) return;
    setModViewLoading(true);
    try {
      const res = await fetch("/api/moderator/mod-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "corporation",
          targetId: corporation._id,
          targetName: corporation.name,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error || "Failed to enable Mod View");
        return;
      }
      setModViewEnabled(true);
      setError("");
    } catch {
      setError("Failed to enable Mod View");
    } finally {
      setModViewLoading(false);
    }
  }, [corporation]);

  useEffect(() => {
    void fetchViewerContext();
  }, [fetchViewerContext]);

  // Legacy ?tab=portfolio — corporate holdings now live on the shared portfolio page.
  useEffect(() => {
    if (searchParams.get("tab") !== "portfolio" || !corporation || corporation.countryOwnerId) {
      return;
    }
    const pathSeg =
      corporation.sequentialId != null ? String(corporation.sequentialId) : corporation._id;
    router.replace(`/portfolio/corporation/${pathSeg}`);
  }, [searchParams, corporation, router]);

  useEffect(() => {
    if (!corporation || !myCharacterId) {
      setIsCeo(false);
      setIsPendingCeo(false);
      return;
    }

    setIsCeo(!corporation.ceoVacant && ceo?.characterId === myCharacterId);
    setIsPendingCeo(
      Boolean(
        corporation.pendingCeoCharacterId && corporation.pendingCeoCharacterId === myCharacterId
      )
    );
  }, [ceo, corporation, myCharacterId]);

  // CEO bond-default crisis modal (non-national corps only)
  useEffect(() => {
    if (!isCeo || !corporation || corporation.countryOwnerId) return;
    async function checkBondDefault() {
      try {
        const res = await fetch(`/api/corporations/${id}/bond-default`);
        if (!res.ok) return;
        const j = await res.json();
        if (j.active) setBondDefaultModalOpen(true);
      } catch {
        // ignore
      }
    }
    void checkBondDefault();
  }, [isCeo, corporation, id]);

  // Fetch bond info for credit rating, bonds, and financials tabs
  useEffect(() => {
    bondInfoLoadedRef.current = false;
    bondInfoPromiseRef.current = null;
    setBondInfo(null);
  }, [id]);

  const fetchBondInfo = useCallback(
    async (options?: { force?: boolean }) => {
      if (bondInfoPromiseRef.current) {
        if (!options?.force) return bondInfoPromiseRef.current;
        await bondInfoPromiseRef.current;
      }
      if (bondInfoLoadedRef.current && !options?.force) return;

      const request = (async () => {
        try {
          const res = await fetch(makeCorpApiUrl("/bonds"));
          if (res.ok) {
            const data = await res.json();
            setBondInfo(data);
            bondInfoLoadedRef.current = true;
          }
        } catch {
          // ignore
        }
      })();

      bondInfoPromiseRef.current = request.finally(() => {
        bondInfoPromiseRef.current = null;
      });

      return bondInfoPromiseRef.current;
    },
    [makeCorpApiUrl]
  );

  useEffect(() => {
    if (activeTab === "overview" || activeTab === "credit" || activeTab === "financials") {
      void fetchBondInfo();
    }
  }, [activeTab, fetchBondInfo]);

  useEffect(() => {
    if (isCeo && corporation && !corporation.countryOwnerId) {
      void fetchBondInfo();
    }
  }, [isCeo, corporation, fetchBondInfo]);

  async function handleAcceptCeo() {
    try {
      const res = await fetch(`/api/corporations/${id}/ceo/accept`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setIsPendingCeo(false);
        setIsCeo(true);
        void fetchCorporation();
        void fetchViewerContext();
      } else {
        setError(data.error || "Failed to accept CEO position");
      }
    } catch {
      setError("Network error");
    }
  }

  async function handleDeclineCeo() {
    try {
      const res = await fetch(`/api/corporations/${id}/ceo/decline`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setIsPendingCeo(false);
        void fetchCorporation();
        void fetchViewerContext();
      } else {
        setError(data.error || "Failed to decline CEO position");
      }
    } catch {
      setError("Network error");
    }
  }

  const [periodView, setPeriodView] = useState<MoneyPeriod>("daily");

  const [strategyUpdatingSectorId, setStrategyUpdatingSectorId] = useState<string | null>(null);

  async function handleSectorStrategyChange(sectorId: string, strategyId: string) {
    setStrategyUpdatingSectorId(sectorId);
    setSectorsMessage(null);
    try {
      const res = await fetch(`/api/corporations/${id}/sectors/${sectorId}/strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId }),
      });
      const data = await res.json();
      if (res.ok) {
        setSectorsMessage({
          type: "success",
          text: `Strategy changed to ${data.strategyName}. Transition begins (${data.transitionTurns} turns).`,
        });
        fetchCorporation();
      } else {
        setSectorsMessage({ type: "error", text: data.error || "Failed to change strategy" });
      }
    } catch {
      setSectorsMessage({ type: "error", text: "Network error" });
    } finally {
      setStrategyUpdatingSectorId(null);
    }
  }

  const [cancelTransitionSectorId, setCancelTransitionSectorId] = useState<string | null>(null);

  async function handleCancelTransition(sectorId: string) {
    setCancelTransitionSectorId(sectorId);
    setSectorsMessage(null);
    try {
      const res = await fetch(`/api/corporations/${id}/sectors/${sectorId}/strategy/cancel`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setSectorsMessage({ type: "success", text: "Transition cancelled — reversing now." });
        fetchCorporation();
      } else {
        setSectorsMessage({ type: "error", text: data.error || "Failed to cancel transition" });
      }
    } catch {
      setSectorsMessage({ type: "error", text: "Network error" });
    } finally {
      setCancelTransitionSectorId(null);
    }
  }

  const [growthUpdatingSectorId, setGrowthUpdatingSectorId] = useState<string | null>(null);
  // Debounce rapid growth clicks: accumulate the latest rate, then fire one request after a short pause
  const growthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const growthPendingRef = useRef<{ sectorId: string; newRate: number } | null>(null);

  function handleGrowthChange(sectorId: string, newRate: number) {
    growthPendingRef.current = { sectorId, newRate };
    setGrowthUpdatingSectorId(sectorId);
    setSectorsMessage(null);

    if (growthTimerRef.current) clearTimeout(growthTimerRef.current);
    growthTimerRef.current = setTimeout(async () => {
      const pending = growthPendingRef.current;
      if (!pending) return;
      growthPendingRef.current = null;
      try {
        const res = await fetch(`/api/corporations/${id}/sectors/${pending.sectorId}/growth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetGrowthRate: pending.newRate }),
        });
        const data = await res.json();
        if (res.ok) {
          fetchCorporation();
        } else {
          setSectorsMessage({ type: "error", text: data.error || "Failed to update growth rate" });
        }
      } catch {
        setSectorsMessage({ type: "error", text: "Network error" });
      } finally {
        setGrowthUpdatingSectorId(null);
      }
    }, 400); // 400ms debounce — fast enough to feel responsive, slow enough to batch rapid clicks
  }

  async function handleAbandonSector(sectorId: string) {
    if (
      !confirm(
        "Abandon this sector? Its revenue will return to the unowned pool. This cannot be undone."
      )
    ) {
      return;
    }
    setAbandoningSectorId(sectorId);
    setSectorsMessage(null);
    try {
      const res = await fetch(`/api/corporations/${id}/sectors/${sectorId}/abandon`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setSectorsMessage({ type: "success", text: data.message });
        fetchCorporation();
      } else {
        setSectorsMessage({ type: "error", text: data.error || "Failed to abandon sector" });
      }
    } catch {
      setSectorsMessage({ type: "error", text: "Network error" });
    } finally {
      setAbandoningSectorId(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8 overflow-x-hidden">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-3 rounded-sm" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-3 rounded-sm" />
            <Skeleton className="h-4 w-40" />
          </div>

          {/* Corporation hero card */}
          <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
            {/* Brand accent bar */}
            <div className="h-1.5 w-full bg-card-border animate-pulse" />
            <div className="p-5 sm:p-6 space-y-5">
              {/* Logo + name + CEO row */}
              <div className="flex items-start gap-4">
                <Skeleton className="h-16 w-16 rounded-xl shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-7 w-64" />
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-36" />
                </div>
                <Skeleton className="h-8 w-20 rounded-lg shrink-0" />
              </div>
              {/* Stats strip */}
              <div className="flex flex-wrap gap-6 border-t border-card-border pt-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="space-y-1 min-w-[80px]">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tab navigation */}
          <div className="border-b border-card-border">
            <div className="flex gap-6 pb-px overflow-x-auto">
              {["Overview", "Financials", "Sectors", "Shares", "Credit & Bonds", "Charts"].map(
                (label) => (
                  <Skeleton key={label} className="h-9 w-20 shrink-0" />
                )
              )}
            </div>
          </div>

          {/* Tab content — same skeleton the dynamic() tab imports show */}
          <TabFallback />
        </main>
      </div>
    );
  }

  // State-owned corps render the distinct state-instrument page (spec §17), not the
  // private/market chrome. Branch before the financials-based error guard so a
  // National Corporation always routes to its own view regardless of fog state.
  if (corporation?.countryOwnerId) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          {/* CEO appointment offer — the appoint-ceo flow sets pendingCeoCharacterId
              and the nominee accepts here (the state-instrument view has no other
              accept surface). */}
          {isPendingCeo && (
            <div className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-4">
              <div className="mb-1 text-sm font-semibold text-warning">
                You&apos;ve been appointed CEO of {corporation.name}
              </div>
              <p className="mb-3 text-xs text-muted">
                The treasury has nominated you to lead this National Corporation. You may only hold
                one CEO position at a time.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleAcceptCeo}
                  className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/90"
                >
                  Accept Position
                </button>
                <button
                  onClick={handleDeclineCeo}
                  className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Decline
                </button>
              </div>
              {error && <p className="mt-3 text-xs text-error">{error}</p>}
            </div>
          )}
          <NationalCorporationView corpId={id} />
        </main>
      </div>
    );
  }

  if (error || !corporation || (!financials && !corporation.isPrivate)) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
            <h2 className="text-lg font-semibold text-error">{error || "Corporation not found"}</h2>
            <BackButton />
          </div>
        </main>
      </div>
    );
  }

  const isNationalCorp = !!corporation.countryOwnerId;
  const isPrivateCorp = !!corporation.isPrivate && !isCeo && !modViewEnabled;
  const isPrivateCorpModView = !!corporation.isPrivate && !isCeo && modViewEnabled;
  const baseTabs = isNationalCorp
    ? CORP_TABS.filter((t) => t.id === "overview" || t.id === "financials" || t.id === "sectors")
    : isPrivateCorpModView
      ? CORP_TABS.filter((t) => t.id !== "shares")
      : isPrivateCorp
        ? CORP_TABS.filter((t) => t.id === "overview" || t.id === "sectors")
        : CORP_TABS;
  // The Tech tab only appears when the sector-tech-trees feature gate is on.
  const gatedBaseTabs0 = corporation.techTreesEnabled
    ? baseTabs
    : baseTabs.filter((t) => t.id !== "tech");
  // The Contracts tab only appears for extraction corps when contractIssuanceEnabled.
  const isExtractionCorp =
    corporation.type === "extraction" || corporation.secondaryType === "extraction";
  const gatedBaseTabs =
    corporation.contractIssuanceEnabled && isExtractionCorp
      ? gatedBaseTabs0
      : gatedBaseTabs0.filter((t) => t.id !== "contracts");
  // The Defence tab only appears for corps that actually build materiel — defence as the
  // primary or the secondary focus. A corp with no defence line can never hold a
  // procurement contract, so the tab would be permanently empty.
  const isDefenceCorp = corporation.type === "defense" || corporation.secondaryType === "defense";
  const gatedTabs = isDefenceCorp ? gatedBaseTabs : gatedBaseTabs.filter((t) => t.id !== "defence");
  // Structure (subsidiary relationships + private supply agreements) is only
  // offered when at least one of its panels has something to render — the
  // subsidiary card self-hides otherwise.
  const showSubsidiaryPanel =
    !!corporation.isFormalizedSubsidiary ||
    !!corporation.canFormalizeAsSubsidiary ||
    !!corporation.canManageAsParent ||
    !!corporation.canSpinOff;
  const showSupplyAgreements = isCeo && !isNationalCorp && !!corporation.supplyAgreementsEnabled;
  const showStructureTab = showSubsidiaryPanel || showSupplyAgreements;

  const visibleTabs = [
    ...gatedTabs,
    ...(isCeo && !isNationalCorp ? [DEALS_TAB] : []),
    ...(showStructureTab ? [STRUCTURE_TAB] : []),
    ...(isCeo && !isNationalCorp ? [CEO_TAB] : []),
  ];
  const bankVisible = showBankTab || sectors.some((s) => s.sectorType === "financial");
  const navTabs = [
    ...buildCorpNavTabs(visibleTabs, {
      badges: {
        commodities: commoditiesTabIsNew ? <NewFeatureBadge /> : undefined,
      },
    }),
    ...(bankVisible
      ? [
          {
            id: "bank",
            label: "Bank",
            tooltip: "Bank charter, rates, blacklist, and loan book",
            icon: (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"
                />
              </svg>
            ),
          },
        ]
      : []),
  ];

  const brandHex = corporation.brandColor ?? "#3b82f6";

  // A country with no configured venue links to the global market rather than
  // claiming a NYSE listing it does not have.
  const exchangeName = corporation.countryId
    ? getExchangeForCountry(corporation.countryId)
    : undefined;
  const exchange = exchangeName ? corporation.countryId! : "global";
  const exchangeLabel = exchangeName ?? "Global";

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8 overflow-x-hidden">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
          <Link
            href={`/stockmarket/${exchange}?tab=stocks`}
            className="hover:text-foreground transition-colors"
          >
            {exchangeLabel}
          </Link>
          <span aria-hidden>/</span>
          <Link
            href={`/stockmarket/${exchange}?tab=stocks`}
            className="hover:text-foreground transition-colors"
          >
            Corporations
          </Link>
          <span aria-hidden>/</span>
          <span className="text-foreground font-medium truncate">{corporation.name}</span>
        </nav>

        <CorporationHero
          corporation={corporation}
          ceo={ceo}
          brandHex={brandHex}
          isCeo={isCeo}
          onRefresh={fetchCorporation}
          exchangeLabel={exchangeLabel}
          corpId={id}
          creditRating={corporation.creditRatingSnapshot ?? bondInfo?.creditRating?.rating}
          sectorCount={sectors.length}
          stateCount={new Set(sectors.map((s) => s.stateId)).size}
          income={
            financials != null
              ? (financials.realizedIncome ?? financials.income) - financials.dividendDistribution
              : null
          }
          periodView={periodView}
          financialFogOfWar={financialFogOfWar}
          ceoIsInactive={ceoIsInactive}
        />

        <NationalizationStatusCard corpId={id} />

        {corporation.isPrivate && !isCeo && (isModerator || isAdmin) && (
          <div className="rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">Moderator View</p>
                <p className="text-muted">
                  Unlock private-corporation financial screens in read-only mode. Each unlock is
                  written to the moderator audit log.
                </p>
              </div>
              {modViewEnabled ? (
                <span className="rounded-full border border-info/40 bg-info/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-info">
                  Mod View Active
                </span>
              ) : (
                <button
                  type="button"
                  onClick={enableModView}
                  disabled={modViewLoading}
                  className="rounded-lg border border-info/40 bg-info/15 px-4 py-2 text-sm font-medium text-info transition-colors hover:bg-info/20 disabled:opacity-50"
                >
                  {modViewLoading ? "Enabling..." : "Mod View"}
                </button>
              )}
            </div>
          </div>
        )}

        {corporation.isPrivate &&
          corporation.countryId &&
          (() => {
            // Surface the private-share invitation flow for close-corp legal
            // structures (e.g. S-Corp, capped at 100). Hidden for CEO-only
            // private structures and for public corps.
            const legalStructure = getLegalStructureForCorp({
              countryId: corporation.countryId as import("@/lib/constants/countries").CountryId,
              legalStructure: corporation.legalStructure as
                import("@/lib/constants/legalStructures").LegalStructureId | undefined,
              isPrivate: corporation.isPrivate === true,
            });
            const cap = legalStructure.maxShareholders ?? 1;
            if (cap <= 1) return null;
            const currentCount = (corporation.shareholders ?? []).filter(
              (sh) => (sh.shares ?? 0) > 0
            ).length;
            return (
              <ManagePrivateShareholdersPanel
                corporationId={corporation._id}
                corporationName={corporation.name}
                isCeo={isCeo}
                maxShareholders={cap}
                currentShareholderCount={currentCount}
                viewerCharacterId={myCharacterId}
                onChange={() => fetchCorporation()}
              />
            );
          })()}

        {/* Private-sale listings, buyer view. The shares tab is hidden from
            non-CEO viewers of a private corp (tab guards above), so without
            this panel a prospective buyer could never see open listings or
            submit an offer and the seller would never get one. CEO-only
            controls stay on the shares tab; the panel's seller actions are
            scoped to the viewer's own listings server-side (isMySelling). */}
        {corporation.isPrivate && !isCeo && myCharacterId && (
          <div className="rounded-xl border border-card-border bg-card px-6 py-5">
            <h2 className="text-base font-bold text-foreground">Private Sale</h2>
            <p className="mt-0.5 mb-4 text-xs text-muted">
              Open share listings from current owners. Submitting an offer escrows the funds until
              the seller accepts.
            </p>
            <PrivateSalePanel
              corporation={corporation}
              myCharacterId={myCharacterId}
              corpId={id}
              myShares={
                corporation.shareholders.find((sh) => sh.characterId === myCharacterId)?.shares ?? 0
              }
              onToast={showToast}
              forceOpen
            />
          </div>
        )}

        {corporation.openPrivatizationVoteId && (
          <PrivatizationVotePanel
            corporationId={corporation._id}
            voteId={corporation.openPrivatizationVoteId}
            isCeo={isCeo}
            viewerCharacterId={myCharacterId}
            viewerHoldsShares={
              !!myCharacterId &&
              corporation.shareholders.some((s) => s.characterId === myCharacterId && s.shares > 0)
            }
            currentTurn={corporation.currentTurn ?? 0}
            onResolved={() => fetchCorporation()}
          />
        )}

        {corporation.hostileTakeoverEligibility && (
          <HostileTakeoverCard
            corporation={corporation}
            parentCorporationId={corporation.hostileTakeoverEligibility.parentCorporationId}
            ownershipPct={corporation.hostileTakeoverEligibility.ownershipPct}
            outstandingBonds={corporation.hostileTakeoverEligibility.outstandingBonds}
            outstandingBondDebt={corporation.hostileTakeoverEligibility.outstandingBondDebt}
            parentLiquidCapital={corporation.hostileTakeoverEligibility.parentLiquidCapital}
            parentLiquidCurrencyCode={
              corporation.hostileTakeoverEligibility.parentLiquidCurrencyCode
            }
            onMerged={() => {
              const pid = corporation.hostileTakeoverEligibility?.parentCorporationId;
              if (pid) {
                router.push(`/corporation/${pid}`);
              } else {
                fetchCorporation();
              }
            }}
            onBondPayoff={() => {
              fetchCorporation();
            }}
          />
        )}

        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        {isCeo &&
          !corporation.countryOwnerId &&
          bondInfo?.bonds?.some((b) => b.defaulted) &&
          !bondDefaultModalOpen && (
            <div className="mb-6 rounded-xl border border-error/40 bg-error/10 p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-body-sm text-foreground">
                This corporation is in{" "}
                <span className="font-semibold text-error">bond default</span>. Open the resolution
                panel to pay, refinance, or dissolve.
              </p>
              <button
                type="button"
                onClick={() => setBondDefaultModalOpen(true)}
                className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 transition-colors shrink-0"
              >
                Open resolution
              </button>
            </div>
          )}

        {/* Pending CEO offer banner */}
        {isPendingCeo && (
          <div className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <div className="text-sm font-semibold text-warning mb-1">
              You&apos;ve been offered the CEO position at {corporation.name}
            </div>
            <p className="text-xs text-muted mb-3">
              Shareholders have voted you as their top choice for CEO. You may only hold one CEO
              position at a time.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleAcceptCeo}
                className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90 transition-colors"
              >
                Accept Position
              </button>
              <button
                onClick={handleDeclineCeo}
                className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Grouped two-level tabs — the shared nav the state/region page uses.
            Twelve-plus top-level tabs used to overflow into a sideways-scrolling
            row; they are now five groups, each with its own sub-tab row. */}
        <SuperTabNav
          tabs={navTabs}
          legacyMap={CORP_LEGACY_TAB_MAP}
          defaultSuperId="overview"
          renderContent={(superId, subId) => {
            if (superId === "bank") {
              return <BankConsoleTab corporationId={id} isCeo={isCeo} />;
            }
            const tab = corpTabIdFor(visibleTabs, superId, subId) ?? "overview";
            return (
              <div className="space-y-8">
                {tab === "overview" && financials && (
                  <OverviewTab
                    corporation={corporation}
                    financials={financials}
                    balanceSheet={balanceSheet}
                    bondInfo={bondInfo}
                    sectors={sectors}
                    periodView={periodView}
                    onTabChange={setTab}
                    isNationalCorp={isNationalCorp}
                    financialFogOfWar={financialFogOfWar}
                  />
                )}
                {tab === "overview" && !financials && (
                  <div className="rounded-xl border border-card-border bg-card p-6 text-center space-y-2">
                    <p className="text-sm font-semibold text-foreground">Private Corporation</p>
                    <p className="text-sm text-muted">
                      This corporation is privately held. Detailed financials are not publicly
                      disclosed.
                    </p>
                  </div>
                )}

                {tab === "financials" && financials && (
                  <FinancialsTab
                    corporation={corporation}
                    financials={financials}
                    balanceSheet={balanceSheet}
                    bondInfo={bondInfo}
                    corpId={id}
                    periodView={periodView}
                    onPeriodViewChange={setPeriodView}
                    sectors={sectors}
                    financialFogOfWar={financialFogOfWar}
                  />
                )}

                {tab === "sectors" && (
                  <SectorsTab
                    sectors={sectors}
                    isCeo={isCeo}
                    corpId={id}
                    corporationType={corporation.type}
                    corporationSecondaryType={corporation.secondaryType}
                    liquidCapital={corporation.liquidCapital}
                    liquidCurrencyCode={corporation.liquidCurrencyCode}
                    logisticsStrength={corporation.logisticsStrength}
                    onAbandonSector={handleAbandonSector}
                    abandoningSectorId={abandoningSectorId}
                    sectorsMessage={sectorsMessage}
                    onStrategyChange={handleSectorStrategyChange}
                    strategyUpdatingSectorId={strategyUpdatingSectorId}
                    onCancelTransition={handleCancelTransition}
                    cancelTransitionSectorId={cancelTransitionSectorId}
                    onGrowthChange={handleGrowthChange}
                    growthUpdatingSectorId={growthUpdatingSectorId}
                    currentTurn={corporation?.currentTurn ?? 0}
                    periodView={periodView}
                    onPeriodViewChange={setPeriodView}
                    plantsMode={corporation.plantsMode === true}
                    expandOnMount={searchParams.get("expand") === "1"}
                    expandSectorType={
                      CORPORATION_TYPES.includes(searchParams.get("sectorType") as CorporationType)
                        ? (searchParams.get("sectorType") as CorporationType)
                        : undefined
                    }
                    expandStateId={searchParams.get("state") ?? undefined}
                    onExpandDeepLinkConsumed={() => {
                      const p = new URLSearchParams(searchParams.toString());
                      p.delete("expand");
                      p.delete("state");
                      p.delete("sectorType");
                      const qs = p.toString();
                      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
                    }}
                  />
                )}

                {tab === "commodities" && (
                  <CommoditiesTab corpId={id} isCeo={isCeo} modViewEnabled={modViewEnabled} />
                )}

                {/* Render-time guard, not just the tab-reset effect above: a ?tab=shares
            deep link on a private corp mounts SharesTab on the FIRST render with
            the redacted payload (totalShares etc. stripped for non-CEO viewers)
            and crashes before the effect can fall back (GlitchTip AHD-A1). */}
                {tab === "shares" && !(corpIsPrivate && !isCeo) && (
                  <SharesTab
                    corporation={corporation}
                    myCharacterId={myCharacterId}
                    myCashOnHand={myCashOnHand}
                    myCurrencyBalances={myCurrencyBalances}
                    myHomeCurrency={myHomeCurrency}
                    autoConvertEnabled={myAutoConvertEnabled}
                    onAutoConvertChange={setMyAutoConvertEnabled}
                    isCeo={isCeo}
                    myCorporation={myCorporation}
                    corpId={id}
                    onRefresh={() => {
                      void fetchCorporation();
                      void fetchViewerContext();
                    }}
                  />
                )}

                {tab === "credit" &&
                  (() => {
                    const creditPanel = (
                      <CreditRatingTab
                        bondInfo={bondInfo}
                        bondLoading={!bondInfo && tab === "credit"}
                        corporation={corporation}
                        corpId={id}
                        modViewEnabled={modViewEnabled}
                        bondsAbove={isCeo}
                      />
                    );
                    const bondsPanel = financials ? (
                      <div id="corp-bonds" className="scroll-mt-24 space-y-3">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-muted">
                          Bonds &amp; issuance
                        </h2>
                        <BondsTab
                          bondInfo={bondInfo}
                          bondLoading={!bondInfo && tab === "credit"}
                          corpId={id}
                          corporation={corporation}
                          financials={financials}
                          onRefresh={() => {
                            void fetchBondInfo({ force: true });
                            void fetchCorporation();
                          }}
                        />
                      </div>
                    ) : null;

                    // The CEO is the only one who can issue bonds, so lead with the
                    // interactable issuance controls for them; everyone else sees the
                    // credit-rating readout first. A divider sits between the two panels.
                    const panels = (
                      isCeo ? [bondsPanel, creditPanel] : [creditPanel, bondsPanel]
                    ).filter(Boolean);

                    return (
                      <div className="space-y-8">
                        {panels.map((panel, i) => (
                          <div
                            key={i}
                            className={i > 0 ? "border-t border-card-border pt-6" : undefined}
                          >
                            {panel}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                {tab === "charts" && (
                  <ChartsTab
                    corpId={id}
                    brandColor={corporation.brandColor}
                    modViewEnabled={modViewEnabled}
                    ownerView={isCeo || modViewEnabled}
                  />
                )}

                {tab === "snapshot" && (
                  <SnapshotTab
                    corpId={id}
                    brandColor={corporation.brandColor}
                    modViewEnabled={modViewEnabled}
                  />
                )}

                {tab === "tech" && corporation.techTreesEnabled && (
                  <TechTab corporationId={id} isCeo={isCeo} />
                )}

                {tab === "contracts" && corporation.contractIssuanceEnabled && isExtractionCorp && (
                  <CorporationContractsTab corpId={id} isCeo={isCeo} />
                )}

                {tab === "defence" && isDefenceCorp && (
                  <DefenceContractsTab
                    corpId={id}
                    defence={defenceContracts ?? undefined}
                    isCeo={isCeo}
                    onUpdate={fetchCorporation}
                  />
                )}

                {tab === "deals" && (
                  <DealsTab
                    corpId={id}
                    isCeo={isCeo}
                    canSponsorFund={
                      corporation.type === "financial" ||
                      corporation.secondaryType === "financial" ||
                      sectors.some((s) => s.sectorType === "financial")
                    }
                  />
                )}

                {tab === "structure" && (
                  <div className="space-y-6">
                    <SubsidiaryManagementCard
                      corporation={corporation}
                      sectorOptions={Object.entries(
                        sectors.reduce<Record<string, number>>((acc, sec) => {
                          acc[sec.sectorType] = (acc[sec.sectorType] ?? 0) + 1;
                          return acc;
                        }, {})
                      ).map(([type, count]) => ({ type, count }))}
                      onChanged={() => fetchCorporation()}
                    />
                    {/* Private supply agreements — CEO-only, gated on the global feature flag. */}
                    {showSupplyAgreements && (
                      <SupplyAgreementsSection
                        corpId={corporation._id}
                        countryId={corporation.countryId}
                      />
                    )}
                  </div>
                )}

                {tab === "ceo" && isCeo && financials && (
                  <div className="space-y-6">
                    <IndustrialRelationsSection corpId={id} />
                    <CeoOfficeTab
                      corporation={corporation}
                      financials={financials}
                      sectors={sectors}
                      corpId={id}
                      currentTurn={corporation.currentTurn ?? 0}
                      onRefresh={fetchCorporation}
                      myCashOnHand={myCashOnHand}
                      myCurrencyBalances={myCurrencyBalances}
                    />
                  </div>
                )}
              </div>
            );
          }}
        />

        <BackButton />

        {isCeo && !corporation.countryOwnerId && (
          <DefaultedBondCrisisModal
            corpId={id}
            open={bondDefaultModalOpen}
            onClose={() => setBondDefaultModalOpen(false)}
            onResolved={() => {
              void fetchBondInfo({ force: true });
              void fetchCorporation();
            }}
          />
        )}
      </main>
    </div>
  );
}
