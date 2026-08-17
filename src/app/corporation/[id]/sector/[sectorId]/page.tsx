"use client";

import { useEffect, useCallback, useState } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import BackButton from "@/components/BackButton";
import { getExchangeForCountry } from "@/lib/constants/exchangeRegistry";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { regionApiSubUrl, regionUrl } from "@/lib/urls";
import type { StateResources, ExtractionCapacityRow, ResourceOpportunity } from "./types";
import { MAX_GROWTH_RATE, MIN_GROWTH_RATE } from "@/lib/constants/corporations";
import { useSectorPageState } from "./useSectorPageState";
import HeroCard from "./components/HeroCard";
import FinancialVisibilityNotice from "./components/FinancialVisibilityNotice";
import FinancialsPanel from "./sections/FinancialsPanel";
import StrategyPanel from "./sections/StrategyPanel";
import MarginsPanel from "./sections/MarginsPanel";
import CommoditiesPanel from "./sections/CommoditiesPanel";
import MarketPositionPanel from "./sections/MarketPositionPanel";
import AttackPanel from "./sections/AttackPanel";
import ProductionPolicyPanel from "./sections/ProductionPolicyPanel";
import WageLevelPanel from "./sections/WageLevelPanel";
import PricingPanel from "./sections/PricingPanel";
import CapitalPanel from "./sections/CapitalPanel";
import MarketRewardBanner from "./sections/MarketRewardBanner";
import UnionBustingPanel from "./sections/UnionBustingPanel";
import { OrganizeSectorAction } from "@/components/unions/OrganizeSectorAction";
import ManagementPanel from "./sections/ManagementPanel";
import AbandonPanel from "./sections/AbandonPanel";
import ForSalePanel from "./sections/ForSalePanel";
import ResourceCapacityPanel from "./sections/ResourceCapacityPanel";
import PlantPanel from "./sections/PlantPanel";
import MarketMoneyPanel from "./sections/MarketMoneyPanel";
import InputsOutputsPanel from "./sections/InputsOutputsPanel";
import BuildCapacityDialog from "./components/BuildCapacityDialog";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import {
  ArrowLeft,
  BarChart3,
  BriefcaseBusiness,
  Factory,
  Settings2,
  UsersRound,
} from "lucide-react";

type WorkspaceTab = "overview" | "operations" | "market" | "people" | "management";

export default function SectorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const corpId = params.id as string;
  const sectorId = params.sectorId as string;
  const gameTurn = useGameTurnStatus();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  // Plants tier: capacity commands (build / cancel / mothball / reactivate) all
  // hit one endpoint, so they share one in-flight flag and one error slot.
  // `?build=1` opens the dialog on arrival. Every "build capacity" affordance
  // elsewhere in the app (sectors table row menu, CEO build summary, the
  // ministry CEO panel, the expand-market flow) links here rather than
  // reimplementing the pricing, so the dialog has to be reachable by URL.
  // Built by `sectorBuildUrl` in components/corporation/plantsPresentation.
  const searchParams = useSearchParams();
  const [buildOpen, setBuildOpen] = useState(searchParams.get("build") === "1");
  const [capacityBusy, setCapacityBusy] = useState(false);
  const [capacityMessage, setCapacityMessage] = useState("");

  const [state, dispatch] = useSectorPageState();
  const {
    sector,
    corporation,
    ceo,
    margins,
    financials,
    financialVisibility,
    market,
    commodities,
    pricing,
    capital,
    plants,
    plantsEnabled,
    isCeo,
    strategy,
    loading,
    error,
    growthUpdating,
    growthMessage,
    strategyUpdating,
    cancelTransitionLoading,
    abandonConfirm,
    abandoning,
    attackInfo,
    attacking,
    attackMsg,
    attackError,
    splitting,
    splitMsg,
    splitError,
    policyDraft,
    policySaving,
    policyMessage,
    labourEnabled,
    labourFullEnabled,
    prospectingEnabled,
    wageDraft,
    wageSaving,
    wageMessage,
    wageError,
    nameDraft,
    nameSaving,
    nameMessage,
    stateResources,
    extractionCapacity,
    extractionOpportunities,
    forexEnabled,
    exchangeRates,
    forSaleInfo,
    listingForSale,
    unlistingForSale,
    buyingSector,
    forSaleMessage,
  } = state;

  const fetchData = useCallback(async () => {
    try {
      dispatch({ type: "SET_LOADING", value: true });
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}`);
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "SET_SECTOR", value: data.sector });
        dispatch({ type: "SET_NAME_DRAFT", value: data.sector.displayName ?? "" });
        dispatch({ type: "SET_POLICY_DRAFT", value: data.sector.productionPolicy ?? 0 });
        dispatch({ type: "SET_LABOUR_ENABLED", value: data.labourEnabled ?? false });
        dispatch({ type: "SET_LABOUR_FULL_ENABLED", value: data.labourFullEnabled ?? false });
        dispatch({ type: "SET_PROSPECTING_ENABLED", value: data.prospectingEnabled ?? false });
        dispatch({ type: "SET_WAGE_DRAFT", value: data.sector.wageLevel ?? 1 });
        dispatch({ type: "SET_CORPORATION", value: data.corporation });
        dispatch({ type: "SET_CEO", value: data.ceo });
        dispatch({ type: "SET_MARGINS", value: data.margins });
        dispatch({ type: "SET_FINANCIALS", value: data.financials });
        dispatch({
          type: "SET_FINANCIAL_VISIBILITY",
          value: data.financialVisibility ?? { hidden: false, reason: "visible" },
        });
        dispatch({ type: "SET_MARKET", value: data.market });
        dispatch({ type: "SET_COMMODITIES", value: data.commodities ?? null });
        dispatch({ type: "SET_PRICING", value: data.pricing ?? null });
        dispatch({ type: "SET_CAPITAL", value: data.capital ?? null });
        dispatch({ type: "SET_PLANTS", value: data.plants ?? null });
        dispatch({ type: "SET_PLANTS_ENABLED", value: data.plantsEnabled === true });
        dispatch({ type: "SET_STRATEGY", value: data.strategy ?? null });
        dispatch({ type: "SET_IS_CEO", value: data.isCeo ?? false });
        dispatch({ type: "SET_ATTACK_INFO", value: data.attackInfo ?? null });
        dispatch({
          type: "SET_STATE_RESOURCES",
          value: (data.stateResources as StateResources) ?? null,
        });
        dispatch({
          type: "SET_EXTRACTION_CAPACITY",
          value: (data.extractionCapacity as ExtractionCapacityRow[]) ?? null,
        });
        dispatch({
          type: "SET_EXTRACTION_OPPORTUNITIES",
          value: (data.extractionOpportunities as ResourceOpportunity[]) ?? null,
        });
        dispatch({ type: "SET_FOR_SALE_INFO", value: data.forSaleInfo ?? null });
      } else {
        dispatch({ type: "SET_ERROR", value: data.error || "Sector not found" });
      }
    } catch {
      dispatch({ type: "SET_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_LOADING", value: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpId, sectorId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;

    async function loadForex() {
      try {
        const [statusRes, ratesRes] = await Promise.all([
          fetch("/api/game/turn/status"),
          fetch("/api/forex/rates"),
        ]);
        const [status, ratesJson] = await Promise.all([
          statusRes.json() as Promise<{ forexEnabled?: boolean }>,
          ratesRes.ok
            ? (ratesRes.json() as Promise<{
                rates?: Partial<Record<CurrencyCode, number>>;
              }>)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;

        const enabled = statusRes.ok && status.forexEnabled === true;
        dispatch({ type: "SET_FOREX_ENABLED", value: enabled });
        if (!enabled) {
          dispatch({ type: "SET_EXCHANGE_RATES", value: {} });
          return;
        }

        if (!cancelled) {
          dispatch({ type: "SET_EXCHANGE_RATES", value: ratesJson?.rates ?? {} });
        }
      } catch {
        if (!cancelled) {
          dispatch({ type: "SET_FOREX_ENABLED", value: false });
          dispatch({ type: "SET_EXCHANGE_RATES", value: {} });
        }
      }
    }

    void loadForex();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Every capacity command posts the same shape to the same route, so one
   * handler covers build / cancel / mothball / reactivate. Refetches on success
   * because a build changes capital, CIP and the queue at once.
   */
  const runCapacityAction = useCallback(
    async (body: Record<string, unknown>) => {
      setCapacityBusy(true);
      setCapacityMessage("");
      try {
        const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setBuildOpen(false);
          await fetchData();
          return true;
        }
        setCapacityMessage((data as { error?: string }).error ?? "That did not work. Try again.");
        return false;
      } catch {
        setCapacityMessage("Network error. Nothing was changed.");
        return false;
      } finally {
        setCapacityBusy(false);
      }
    },
    [corpId, sectorId, fetchData]
  );

  const handleSavePolicy = async () => {
    dispatch({ type: "SET_POLICY_SAVING", value: true });
    dispatch({ type: "SET_POLICY_MESSAGE", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionPolicy: policyDraft }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "SET_POLICY_MESSAGE", value: `Target set to ${data.productionPolicy}%` });
        fetchData();
      } else {
        dispatch({
          type: "SET_POLICY_MESSAGE",
          value: (data as { error?: string }).error ?? "Failed to save",
        });
      }
    } catch {
      dispatch({ type: "SET_POLICY_MESSAGE", value: "Network error" });
    } finally {
      dispatch({ type: "SET_POLICY_SAVING", value: false });
    }
  };

  const handleSaveWage = async () => {
    dispatch({ type: "SET_WAGE_SAVING", value: true });
    dispatch({ type: "SET_WAGE_MESSAGE", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/wage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wageLevel: wageDraft }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({
          type: "SET_WAGE_MESSAGE",
          value: `Wage set to ${Number(data.wageLevel).toFixed(2)}×`,
          error: false,
        });
        fetchData();
      } else {
        dispatch({
          type: "SET_WAGE_MESSAGE",
          value: (data as { error?: string }).error ?? "Failed to save",
          error: true,
        });
      }
    } catch {
      dispatch({ type: "SET_WAGE_MESSAGE", value: "Network error", error: true });
    } finally {
      dispatch({ type: "SET_WAGE_SAVING", value: false });
    }
  };

  const handleSaveName = async () => {
    dispatch({ type: "SET_NAME_SAVING", value: true });
    dispatch({ type: "SET_NAME_MESSAGE", value: "" });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: nameDraft.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({
          type: "SET_NAME_MESSAGE",
          value: data.displayName ? "Sector name saved." : "Sector name cleared.",
        });
        await fetchData();
      } else {
        dispatch({ type: "SET_NAME_MESSAGE", value: data.error || "Failed to save sector name." });
      }
    } catch {
      dispatch({ type: "SET_NAME_MESSAGE", value: "Network error" });
    } finally {
      dispatch({ type: "SET_NAME_SAVING", value: false });
    }
  };

  const handleGrowthChange = async (delta: number) => {
    if (!sector || growthUpdating) return;
    // Defensive: treat undefined/null as 0 (default growth rate)
    const previousTarget = sector.targetGrowthRate ?? 0;
    const newRate = Math.round((previousTarget + delta) * 10) / 10;
    const clamped = Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, newRate));
    if (clamped === previousTarget) return;

    dispatch({ type: "SET_GROWTH_UPDATING", value: true });
    dispatch({ type: "SET_GROWTH_MESSAGE", value: "" });
    // Optimistic update so the slider reads the new target immediately, 
    // otherwise rapid clicks feel like nothing is happening while the request
    // is in flight.
    dispatch({ type: "UPDATE_SECTOR_PARTIAL", patch: { targetGrowthRate: clamped } });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/growth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetGrowthRate: clamped }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        dispatch({
          type: "UPDATE_SECTOR_PARTIAL",
          patch: {
            targetGrowthRate: data.targetGrowthRate ?? clamped,
            currentGrowthCost: data.currentGrowthCost ?? sector?.currentGrowthCost,
          },
        });
        await fetchData();
      } else {
        // Revert optimistic update and surface the server's reason.
        dispatch({ type: "UPDATE_SECTOR_PARTIAL", patch: { targetGrowthRate: previousTarget } });
        dispatch({
          type: "SET_GROWTH_MESSAGE",
          value: (data as { error?: string }).error ?? "Failed to update growth target.",
        });
      }
    } catch {
      dispatch({ type: "UPDATE_SECTOR_PARTIAL", patch: { targetGrowthRate: previousTarget } });
      dispatch({
        type: "SET_GROWTH_MESSAGE",
        value: "Network error, growth target was not updated.",
      });
    } finally {
      dispatch({ type: "SET_GROWTH_UPDATING", value: false });
    }
  };

  const handleStrategyChange = async (newStrategyId: string) => {
    if (!strategy || strategyUpdating) return;
    if (newStrategyId === strategy.currentStrategyId) return;

    dispatch({ type: "SET_STRATEGY_UPDATING", value: true });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId: newStrategyId }),
      });
      if (res.ok) {
        await fetchData();
      } else {
        const data = await res.json();
        dispatch({ type: "SET_ERROR", value: data.error || "Failed to change strategy" });
      }
    } catch {
      /* silent */
    } finally {
      dispatch({ type: "SET_STRATEGY_UPDATING", value: false });
    }
  };

  const handleCancelTransition = async () => {
    if (cancelTransitionLoading) return;
    dispatch({ type: "SET_CANCEL_TRANSITION_LOADING", value: true });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/strategy/cancel`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchData();
      } else {
        const data = await res.json();
        dispatch({ type: "SET_ERROR", value: data.error || "Failed to cancel transition" });
      }
    } catch {
      /* silent */
    } finally {
      dispatch({ type: "SET_CANCEL_TRANSITION_LOADING", value: false });
    }
  };

  const handleAbandon = async () => {
    dispatch({ type: "SET_ABANDONING", value: true });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/abandon`, {
        method: "POST",
      });
      if (res.ok) {
        router.push(`/corporation/${corpId}`);
      }
    } catch {
      /* silent */
    } finally {
      dispatch({ type: "SET_ABANDONING", value: false });
      dispatch({ type: "SET_ABANDON_CONFIRM", value: false });
    }
  };

  const handleAttackSector = async () => {
    if (!attackInfo || !sector) return;
    dispatch({ type: "SET_ATTACKING", value: true });
    dispatch({ type: "SET_ATTACK_ERROR", value: "" });
    dispatch({ type: "SET_ATTACK_MSG", value: "" });
    // attackInfo.countryId is already the correct CountryId value; fall back to "US" for legacy records
    const attackCountryId = attackInfo.countryId ?? "US";
    try {
      const res = await fetch(
        regionApiSubUrl(attackCountryId, attackInfo.stateId, "economy/attack-sector"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectorId }),
        }
      );
      const result = await res.json();
      if (res.ok) {
        dispatch({ type: "SET_ATTACK_MSG", value: result.message });
        fetchData();
      } else {
        dispatch({ type: "SET_ATTACK_ERROR", value: result.error || "Attack failed" });
      }
    } catch {
      dispatch({ type: "SET_ATTACK_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_ATTACKING", value: false });
    }
  };

  const handleListForSale = async () => {
    dispatch({ type: "SET_LISTING_FOR_SALE", value: true });
    dispatch({ type: "SET_FOR_SALE_MESSAGE", value: null });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/list`, {
        method: "POST",
      });
      const result = await res.json();
      if (res.ok) {
        dispatch({
          type: "SET_FOR_SALE_MESSAGE",
          value: { type: "success", text: "Listed for sale." },
        });
        await fetchData();
      } else {
        dispatch({
          type: "SET_FOR_SALE_MESSAGE",
          value: { type: "error", text: result.error || "Failed to list sector" },
        });
      }
    } catch {
      dispatch({ type: "SET_FOR_SALE_MESSAGE", value: { type: "error", text: "Network error" } });
    } finally {
      dispatch({ type: "SET_LISTING_FOR_SALE", value: false });
    }
  };

  const handleUnlistForSale = async () => {
    dispatch({ type: "SET_UNLISTING_FOR_SALE", value: true });
    dispatch({ type: "SET_FOR_SALE_MESSAGE", value: null });
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/unlist`, {
        method: "POST",
      });
      const result = await res.json();
      if (res.ok) {
        dispatch({
          type: "SET_FOR_SALE_MESSAGE",
          value: { type: "success", text: "Listing removed." },
        });
        await fetchData();
      } else {
        dispatch({
          type: "SET_FOR_SALE_MESSAGE",
          value: { type: "error", text: result.error || "Failed to unlist sector" },
        });
      }
    } catch {
      dispatch({ type: "SET_FOR_SALE_MESSAGE", value: { type: "error", text: "Network error" } });
    } finally {
      dispatch({ type: "SET_UNLISTING_FOR_SALE", value: false });
    }
  };

  const handleBuySector = async () => {
    if (!forSaleInfo) return;
    dispatch({ type: "SET_BUYING_SECTOR", value: true });
    dispatch({ type: "SET_FOR_SALE_MESSAGE", value: null });
    try {
      trackAction("corporation.sector-buy", { corpId, sectorId });
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerCorporationId: forSaleInfo.viewerCorporationId }),
      });
      const result = await res.json();
      if (res.ok) {
        // Sector ownership changed, redirect to the buyer's corp page so the
        // viewer lands on a page that still exists for them.
        router.push(`/corporation/${forSaleInfo.viewerCorporationId}?tab=sectors`);
      } else {
        dispatch({
          type: "SET_FOR_SALE_MESSAGE",
          value: { type: "error", text: result.error || "Purchase failed" },
        });
      }
    } catch {
      dispatch({ type: "SET_FOR_SALE_MESSAGE", value: { type: "error", text: "Network error" } });
    } finally {
      dispatch({ type: "SET_BUYING_SECTOR", value: false });
    }
  };

  const handleSplitSector = async (strength: "full" | "half" = "full") => {
    if (!attackInfo || !sector) return;
    dispatch({ type: "SET_SPLITTING", value: true });
    dispatch({ type: "SET_SPLIT_ERROR", value: "" });
    dispatch({ type: "SET_SPLIT_MSG", value: "" });
    try {
      // attackInfo.countryId is already the correct CountryId value; fall back to "US" for legacy records
      const splitCountryId = attackInfo.countryId ?? "US";
      const res = await fetch(
        regionApiSubUrl(splitCountryId, attackInfo.stateId, "economy/attack"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectorType: sector.sectorType,
            splitStrength: strength,
          }),
        }
      );
      const result = await res.json();
      if (res.ok) {
        dispatch({ type: "SET_SPLIT_MSG", value: result.message });
        fetchData();
      } else {
        dispatch({ type: "SET_SPLIT_ERROR", value: result.error || "Split failed" });
      }
    } catch {
      dispatch({ type: "SET_SPLIT_ERROR", value: "Network error" });
    } finally {
      dispatch({ type: "SET_SPLITTING", value: false });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  if (error || !sector || !corporation || !market) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
          <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
            <h2 className="text-lg font-semibold text-error">{error || "Sector not found"}</h2>
            <BackButton />
          </div>
        </main>
      </div>
    );
  }

  // sector.countryId is already the correct CountryId value; fall back to "US" for legacy records
  const sectorCountryId = (sector.countryId ?? "US") as CountryId;
  const stateHref = regionUrl(sectorCountryId, sector.stateId);
  // A country with no configured venue links to the global market rather than
  // claiming a NYSE listing it does not have.
  const exchangeName = sector.countryId ? getExchangeForCountry(sector.countryId) : undefined;
  const exchange = exchangeName ? sector.countryId! : "global";
  const exchangeLabel = exchangeName ?? "Global";
  const corpHref = `/corporation/${corporation.sequentialId ?? corporation._id}`;
  const sectorCurrencyCode = COUNTRY_CURRENCY_MAP[sectorCountryId] ?? "USD";

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <nav
          className="mb-4 flex flex-wrap items-center justify-between gap-3"
          aria-label="Sector navigation"
        >
          <Link
            href={`${corpHref}?tab=sectors`}
            className="inline-flex items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-card-elevated"
          >
            <ArrowLeft className="h-4 w-4 text-primary" />
            All {corporation.name} sectors
          </Link>
          <Link
            href={`/stockmarket/${exchange}?tab=stocks`}
            className="text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Listed on {exchangeLabel}
          </Link>
        </nav>

        {/* Hero card */}
        <HeroCard
          sector={sector}
          corporation={corporation}
          ceo={ceo}
          financials={financials}
          margins={margins}
          financialVisibility={financialVisibility}
          market={market}
          corpHref={corpHref}
          stateHref={stateHref}
        />

        <div className="sticky top-0 z-20 mb-6 -mx-4 border-y border-card-border bg-background/95 px-4 py-2 shadow-sm backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-card/95">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Sector workspace">
            {(
              [
                ["overview", "Overview", BarChart3],
                ["operations", "Operations", Factory],
                ["market", "Market & supply", BriefcaseBusiness],
                ["people", "People", UsersRound],
                ...(isCeo ? [["management", "Manage", Settings2]] : []),
              ] as [WorkspaceTab, string, typeof BarChart3][]
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted hover:bg-card-elevated hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "overview" && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div className="space-y-6">
              {/* When the money figures are withheld, the plant/money panels and
                  the FinancialsPanel below all fall away (their data is null),
                  leaving an unexplained gap that reads as "this sector is
                  broken". This notice fills that gap with the reason. Never
                  shown to the owner or an admin (hidden === false for them). */}
              {financialVisibility.hidden && (
                <FinancialVisibilityNotice reason={financialVisibility.reason} />
              )}
              {/* Plants tier: capacity is the sector, so the plant panel and the
                  market/money chain replace the capital + financials pair. Below
                  plants this branch never runs and the page is unchanged. */}
              {plantsEnabled && plants && (
                <>
                  <PlantPanel
                    plants={plants}
                    sectorType={sector.sectorType}
                    unionId={sector.unionId}
                    unionName={sector.unionName}
                    averageWageLevel={sector.wageLevel ?? 1}
                    isCeo={isCeo}
                    busy={capacityBusy}
                    message={capacityMessage}
                    onOpenBuild={() => {
                      setCapacityMessage("");
                      setBuildOpen(true);
                    }}
                    onCancelOrder={(orderIndex) =>
                      runCapacityAction({ action: "cancel", orderIndex })
                    }
                    onMothball={() => runCapacityAction({ action: "mothball" })}
                    onReactivate={() => runCapacityAction({ action: "reactivate" })}
                  />
                  <MarketMoneyPanel
                    plants={plants}
                    sectorType={sector.sectorType}
                    financials={financials}
                    corporation={corporation}
                  />
                </>
              )}
              {!plantsEnabled && margins && financials && (
                <FinancialsPanel
                  sector={sector}
                  financials={financials}
                  margins={margins}
                  corporation={corporation}
                  isCeo={isCeo}
                  capitalEnabled={!!capital}
                  growthUpdating={growthUpdating}
                  growthMessage={growthMessage}
                  onGrowthChange={handleGrowthChange}
                />
              )}
            </div>
            <div className="space-y-6 lg:sticky lg:top-20">
              <MarketPositionPanel
                market={market}
                sector={sector}
                corporation={corporation}
                financials={financials}
                capitalEnabled={!!capital}
                clearingEnabled={!!pricing}
                compact
              />
              {!isCeo && sector.forSale && forSaleInfo && (
                <ForSalePanel
                  sector={sector}
                  corporation={corporation}
                  isCeo={false}
                  forSaleInfo={forSaleInfo}
                  listing={listingForSale}
                  unlisting={unlistingForSale}
                  buying={buyingSector}
                  message={forSaleMessage}
                  onList={handleListForSale}
                  onUnlist={handleUnlistForSale}
                  onBuy={handleBuySector}
                />
              )}
              {/* Splitting is retired under plants (capacity is the growth
                  lever there); attacking survives as the PVP. With split gone
                  the panel is worth rendering only when attack is available,
                  otherwise a CEO viewing their own sector gets an empty card. */}
              {attackInfo && (!isCeo || (!plantsEnabled && attackInfo.splitCost > 0)) && (
                <AttackPanel
                  attackInfo={attackInfo}
                  showAttack={!isCeo && !corporation.isStateOwned}
                  showSplit={!plantsEnabled}
                  attacking={attacking}
                  attackError={attackError}
                  attackMsg={attackMsg}
                  onAttack={handleAttackSector}
                  splitting={splitting}
                  splitError={splitError}
                  splitMsg={splitMsg}
                  onSplit={handleSplitSector}
                  sectorCurrencyCode={sectorCurrencyCode}
                  targetCurrencyCode={
                    (corporation.liquidCurrencyCode as CurrencyCode | null) ?? null
                  }
                />
              )}
            </div>
          </div>
        )}

        {activeTab === "operations" && (
          <div className="mx-auto max-w-3xl space-y-6" role="tabpanel">
            <div>
              <h2 className="text-xl font-bold text-foreground">Run the sector</h2>
              <p className="mt-1 text-sm text-muted">
                Set strategy, output, investment and pricing from one workspace.
              </p>
            </div>
            {strategy && (
              <StrategyPanel
                strategy={strategy}
                sector={sector}
                corporation={corporation}
                isCeo={isCeo}
                strategyUpdating={strategyUpdating}
                cancelTransitionLoading={cancelTransitionLoading}
                onStrategyChange={handleStrategyChange}
                onCancelTransition={handleCancelTransition}
                stateResources={stateResources}
                financials={financials}
                margins={margins}
                plantsCapacityUnits={plantsEnabled ? (plants?.capacityUnits ?? null) : null}
              />
            )}

            {sector.sectorType === "extraction" && stateResources !== null && (
              <ResourceCapacityPanel
                stateResources={stateResources}
                capacityRows={extractionCapacity}
                opportunities={extractionOpportunities}
                stateId={sector.stateId}
                countryId={sectorCountryId}
                isCeo={isCeo}
                corpId={corpId}
                rdScore={corporation?.rdScore ?? 0}
                liquidCurrencyCode={corporation?.liquidCurrencyCode}
                currentTurn={gameTurn?.currentTurn ?? 0}
                prospectingEnabled={prospectingEnabled}
              />
            )}

            <ProductionPolicyPanel
              sector={sector}
              isCeo={isCeo}
              policyDraft={policyDraft}
              policySaving={policySaving}
              policyMessage={policyMessage}
              onPolicyChange={(v) => dispatch({ type: "SET_POLICY_DRAFT", value: v })}
              onSave={handleSavePolicy}
            />

            {(pricing || capital) && (
              <MarketRewardBanner hasPricing={!!pricing} hasCapital={!!capital} />
            )}

            {pricing && (
              <PricingPanel
                corporationId={corpId}
                sectorId={sectorId}
                isCeo={isCeo}
                pricing={pricing}
              />
            )}

            {/* Under plants the plant panel on Overview is the capacity surface;
                the capital panel would restate a haircut model that no longer
                describes how this sector works. */}
            {capital && !plantsEnabled && <CapitalPanel capital={capital} />}
          </div>
        )}

        {activeTab === "market" && (
          <div className="mx-auto max-w-3xl space-y-6" role="tabpanel">
            <div>
              <h2 className="text-xl font-bold text-foreground">Market & supply chain</h2>
              <p className="mt-1 text-sm text-muted">
                Trace margin pressure from inputs through to competitors.
              </p>
            </div>
            <MarketPositionPanel
              market={market}
              sector={sector}
              corporation={corporation}
              financials={financials}
              capitalEnabled={!!capital}
              clearingEnabled={!!pricing}
            />
            {margins && (
              <MarginsPanel
                margins={margins}
                inputLabels={commodities?.demands.map((d) => d.label) ?? []}
                fillAdjustedMarginPct={plants?.truth?.fillAdjustedMarginPct ?? null}
              />
            )}
            {commodities &&
              (plantsEnabled && plants ? (
                <InputsOutputsPanel
                  commodities={commodities}
                  plants={plants}
                  countryId={sectorCountryId}
                  capacityRows={sector.sectorType === "extraction" ? extractionCapacity : null}
                  isExtraction={sector.sectorType === "extraction"}
                  forexEnabled={forexEnabled}
                  exchangeRates={exchangeRates}
                />
              ) : (
                <CommoditiesPanel
                  commodities={commodities}
                  countryId={sectorCountryId}
                  capacityRows={sector.sectorType === "extraction" ? extractionCapacity : null}
                  forexEnabled={forexEnabled}
                  exchangeRates={exchangeRates}
                />
              ))}
          </div>
        )}

        {activeTab === "people" && (
          <div className="mx-auto max-w-3xl space-y-6" role="tabpanel">
            <div>
              <h2 className="text-xl font-bold text-foreground">People</h2>
              <p className="mt-1 text-sm text-muted">
                Workforce policy and labour relations, without the financial noise.
              </p>
            </div>
            {!labourEnabled && (
              <div className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted">
                Workforce controls are not enabled in this game.
              </div>
            )}
            {labourEnabled && (
              <WageLevelPanel
                sector={sector}
                isCeo={isCeo}
                wageDraft={wageDraft}
                wageSaving={wageSaving}
                wageMessage={wageMessage}
                wageError={wageError}
                onWageChange={(v) => dispatch({ type: "SET_WAGE_DRAFT", value: v })}
                onSave={handleSaveWage}
              />
            )}
            {labourFullEnabled && (
              <UnionBustingPanel
                sector={sector}
                isCeo={isCeo}
                corpId={corpId}
                sectorId={sectorId}
                onBusted={fetchData}
              />
            )}
            {labourFullEnabled && (
              <OrganizeSectorAction
                countryId={sectorCountryId}
                sectorType={sector.sectorType}
                sectorId={sectorId}
                representingUnionId={sector.representingUnionId}
                representingUnionName={sector.representingUnionName}
                onOrganized={fetchData}
              />
            )}
          </div>
        )}

        {/* Management section, CEO only, collapsible */}
        {isCeo && activeTab === "management" && (
          <div className="mx-auto max-w-3xl" role="tabpanel">
            <ManagementPanel>
              {/* Sector Name editor */}
              <div>
                <label className="block text-sm font-semibold text-foreground">Sector Name</label>
                <p className="mt-1 text-xs text-muted">
                  Give this sector a custom display name. Leave blank to use the default type label.
                </p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => dispatch({ type: "SET_NAME_DRAFT", value: e.target.value })}
                    maxLength={40}
                    placeholder={sector.sectorLabel}
                    className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    disabled={nameSaving}
                    className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                  >
                    {nameSaving ? "Saving..." : "Save Name"}
                  </button>
                </div>
                {nameMessage && <p className="mt-3 text-sm text-muted">{nameMessage}</p>}
              </div>

              {/* Sell on the secondary market */}
              <ForSalePanel
                sector={sector}
                corporation={corporation}
                isCeo
                forSaleInfo={null}
                listing={listingForSale}
                unlisting={unlistingForSale}
                buying={false}
                message={forSaleMessage}
                onList={handleListForSale}
                onUnlist={handleUnlistForSale}
                onBuy={handleBuySector}
              />

              {/* Abandon sector */}
              <AbandonPanel
                sector={sector}
                financials={financials}
                corporation={corporation}
                abandonConfirm={abandonConfirm}
                abandoning={abandoning}
                onConfirm={handleAbandon}
                onCancel={() => dispatch({ type: "SET_ABANDON_CONFIRM", value: false })}
                onShowConfirm={() => dispatch({ type: "SET_ABANDON_CONFIRM", value: true })}
              />
            </ManagementPanel>
          </div>
        )}

        {plantsEnabled && plants && isCeo && (
          <BuildCapacityDialog
            open={buildOpen}
            onClose={() => setBuildOpen(false)}
            plants={plants}
            sectorType={sector.sectorType}
            sectorLabel={sector.displayName || sector.sectorLabel}
            submitting={capacityBusy}
            errorMessage={capacityMessage}
            onSubmit={(units) => runCapacityAction({ action: "build", units })}
          />
        )}
      </main>
    </div>
  );
}
