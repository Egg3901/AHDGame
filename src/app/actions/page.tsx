"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Character, State } from "@/lib/db/types";
import { calculatePoliticalInfluenceDecay } from "@shared/constants/formulas";
import {
  getCampaignActionCost,
  getCampaignFundCost,
  getAdvertiseActionCost,
  getDonorActionCost,
  getAdvertiseFundCost,
  getBuildDonorBaseFundCost,
  fundraiseYieldLocal,
} from "@/lib/actions";
import { getHomeCurrency, getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import { getGdpBaseline } from "@/lib/utils/fundGeneration";
import { notifyCharacterStatsUpdated } from "@/lib/characterStatsSync";
import { fetchJson } from "@/lib/observability/fetchJson";
import { Skeleton } from "@/components/ui";
import { CARDS } from "./actionsConstants";
import type { ActionsViewMode } from "./actionsTypes";
import ActionCard from "./components/ActionCard";
import ActionCardCompact from "./components/ActionCardCompact";
import ActionsHero from "./components/ActionsHero";
import PlayerEventCard from "./components/PlayerEventCard";
import DebateCard from "./components/DebateCard";
import CrisisActionCard from "./components/CrisisActionCard";
import CategoryFilter from "./components/CategoryFilter";
import ViewToggle from "./components/ViewToggle";
import DonorNetworkStats from "./components/DonorNetworkStats";
import { useToast } from "@/contexts/ToastContext";
import { useGameEvents } from "@/hooks/useGameEvents";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { eraIdForYear } from "@/lib/seeds/eraInterpolation";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { getActionImage } from "@/lib/images/actionImages";

const CATEGORIES = ["all", "influence", "money", "research"];

export default function ActionsPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const worldFlags = useWorldFlags();
  const [character, setCharacter] = useState<Character | null>(null);
  const [homeState, setHomeState] = useState<State | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [flash, setFlash] = useState<{
    type: string;
    msg: string;
    ok: boolean;
  } | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [flipflopStep, setFlipflopStep] = useState<"axis" | "direction" | null>(null);
  const [flipflopAxis, setFlipflopAxis] = useState<"economic" | "social" | null>(null);
  const [flipflopDir, setFlipflopDir] = useState<-1 | 1 | null>(null);
  const [convertCashOpen, setConvertCashOpen] = useState(false);
  const [convertCashAmount, setConvertCashAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [portfolioData, setPortfolioData] = useState<{
    totalValue: number;
    totalBondValue: number;
    totalBondIncomePerTurn: number;
    cashOnHand: number;
  } | null>(null);
  const [_mutedTypes, _setMutedTypes] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("mutedSuggestionTypes");
      return stored ? JSON.parse(stored) : [];
    }
    return [];
  });
  const [viewMode, setViewMode] = useState<ActionsViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("actionsViewMode") as ActionsViewMode) || "cards";
    }
    return "cards";
  });

  const handleViewModeChange = useCallback((mode: ActionsViewMode) => {
    setViewMode(mode);
    localStorage.setItem("actionsViewMode", mode);
    fetchJson("/api/settings/actions-view-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionsViewMode: mode }),
      feature: "actions-view-mode",
    }).catch(() => {});
  }, []);

  const fetchCharacter = useCallback(async () => {
    try {
      const [meRes, charRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/auth/character"),
      ]);
      if (meRes.status === 401 || meRes.status === 403) {
        router.push("/login");
        return;
      }
      const meData = await meRes.json();
      // Imperial characters cannot use regular character actions
      if (meData?.user?.isImperial) {
        router.push("/dashboard");
        return;
      }
      // Load user preferences (e.g. actionsViewMode)
      if (meData?.user?.actionsViewMode) {
        setViewMode(meData.user.actionsViewMode);
        localStorage.setItem("actionsViewMode", meData.user.actionsViewMode);
      }
      if (charRes.ok) {
        const char: Character = await charRes.json();
        setCharacter(char);
        // State data is needed to compute accurate GDP-scaled action costs.
        if (char.homeState) {
          try {
            const stateRes = await fetch(
              `/api/state/${encodeURIComponent(char.homeState)}?country=${encodeURIComponent(char.countryId)}`
            );
            if (stateRes.ok) {
              const data = await stateRes.json();
              if (data) setHomeState(data);
            }
          } catch {
            // State data failed — page will use fallback costs
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch character:", err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchCharacter();
  }, [fetchCharacter]);

  // Keep the character snapshot — and therefore the affordability gate — in sync
  // with the StatusBar, which refetches on the same triggers. The turn engine
  // credits campaign-fund income server-side, so a page left open across a turn
  // would otherwise gate actions against the stale page-load balance while the
  // StatusBar shows the fresh (higher) figure. That divergence surfaces as a
  // spurious "Insufficient funds" on actions the player can actually afford
  // (bug #0885). Refetch on turn completion and when the player returns to the tab.
  useGameEvents(
    useCallback(() => {
      void fetchCharacter();
    }, [fetchCharacter]),
    ["turn_complete"]
  );
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchCharacter();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchCharacter]);

  // Fetch portfolio data on mount
  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        const res = await fetch("/api/character/portfolio");
        if (res.ok) {
          const data = await res.json();
          setPortfolioData({
            totalValue: data.totalValue ?? 0,
            totalBondValue: data.totalBondValue ?? 0,
            totalBondIncomePerTurn: data.totalBondIncomePerTurn ?? 0,
            cashOnHand: data.liquidCashWealth ?? data.cashOnHand ?? 0,
          });
        }
      } catch {
        // Silent fail - portfolio data is optional
      }
    };
    fetchPortfolio();
  }, []);

  const execute = async (type: string, count: 1 | 5 | 10 = 1) => {
    if (!character || executing) return;
    const execKey = count === 1 ? type : `${type}:${count}`;
    setExecuting(execKey);
    setFlash(null);
    try {
      const res = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: type,
          ...(count !== 1 ? { count } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCharacter(data.character);
        notifyCharacterStatsUpdated({
          ...data.character,
          // LOCAL home-currency balance (canonical source of truth) — both
          // fields expose the same value during the migration.
          funds: data.character.currencyBalances?.campaign ?? data.character.funds ?? 0,
          campaignFundsStored:
            data.character.currencyBalances?.campaign ?? data.character.funds ?? 0,
          personalHomeLiquid: getTotalPersonalLiquidWealth(
            data.character,
            !!data.character.currencyBalances
          ),
        });
        // The server already formats result messages in the player's local home
        // currency (see makeFundsFormatter), so surface them as-is.
        if (viewMode === "compact") {
          showToast(data.message, "success");
        } else {
          setFlash({ type, msg: data.message, ok: true });
        }
      } else if (viewMode === "compact") {
        showToast(data.error ?? "Action failed.", "error");
      } else {
        setFlash({ type, msg: data.error ?? "Action failed.", ok: false });
      }
    } catch {
      if (viewMode === "compact") {
        showToast("Network error.", "error");
      } else {
        setFlash({ type, msg: "Network error.", ok: false });
      }
    } finally {
      setExecuting(null);
      if (viewMode !== "compact") {
        setTimeout(() => setFlash(null), 4000);
      }
    }
  };

  const executeFlipflop = async (axis: "economic" | "social", direction: -1 | 1) => {
    if (!character || executing) return;
    setExecuting("flipflop");
    setFlash(null);
    try {
      const res = await fetch("/api/settings/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ axis, direction }),
      });
      const data = await res.json();
      if (res.ok && data.stats) {
        const updated = {
          ...character,
          policies: data.stats.policies,
          actions: data.stats.actions,
          infamy: data.stats.infamy,
          politicalInfluence: data.stats.politicalInfluence,
          nationalInfluence: data.stats.nationalInfluence,
        } as Character;
        setCharacter(updated);
        notifyCharacterStatsUpdated({
          ...updated,
          // LOCAL home-currency balance.
          funds: updated.currencyBalances?.campaign ?? updated.funds ?? 0,
          campaignFundsStored: updated.currencyBalances?.campaign ?? updated.funds ?? 0,
          personalHomeLiquid: getTotalPersonalLiquidWealth(updated, !!updated.currencyBalances),
        });
        const axisLabel = axis === "economic" ? "Economic" : "Social";
        const dirLabel = direction === 1 ? "right" : "left";
        if (viewMode === "compact") {
          showToast(
            `${axisLabel} position shifted ${dirLabel}. +5 Infamy, −5% Influence.`,
            "success"
          );
        } else {
          setFlash({
            type: "flipflop",
            msg: `${axisLabel} position shifted ${dirLabel}. +5 Infamy, −5% Influence.`,
            ok: true,
          });
        }
      } else if (viewMode === "compact") {
        showToast(data.error ?? "Shift failed.", "error");
      } else {
        setFlash({ type: "flipflop", msg: data.error ?? "Shift failed.", ok: false });
      }
    } catch {
      if (viewMode === "compact") {
        showToast("Network error.", "error");
      } else {
        setFlash({ type: "flipflop", msg: "Network error.", ok: false });
      }
    } finally {
      setExecuting(null);
      setFlipflopStep(null);
      setFlipflopAxis(null);
      setFlipflopDir(null);
      if (viewMode !== "compact") {
        setTimeout(() => setFlash(null), 4000);
      }
    }
  };

  const executeConvertCash = async (amount: number) => {
    if (!character || executing) return;
    setExecuting("convertCash");
    setFlash(null);
    try {
      const res = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType: "convertCash", convertAmount: amount }),
      });
      const data = await res.json();
      if (res.ok) {
        setCharacter(data.character);
        notifyCharacterStatsUpdated({
          ...data.character,
          // LOCAL home-currency balance (canonical source of truth) — both
          // fields expose the same value during the migration.
          funds: data.character.currencyBalances?.campaign ?? data.character.funds ?? 0,
          campaignFundsStored:
            data.character.currencyBalances?.campaign ?? data.character.funds ?? 0,
          personalHomeLiquid: getTotalPersonalLiquidWealth(
            data.character,
            !!data.character.currencyBalances
          ),
        });
        if (viewMode === "compact") {
          showToast(data.message, "success");
        } else {
          setFlash({ type: "convertCash", msg: data.message, ok: true });
        }
      } else if (viewMode === "compact") {
        showToast(data.error ?? "Conversion failed.", "error");
      } else {
        setFlash({ type: "convertCash", msg: data.error ?? "Conversion failed.", ok: false });
      }
    } catch {
      if (viewMode === "compact") {
        showToast("Network error.", "error");
      } else {
        setFlash({ type: "convertCash", msg: "Network error.", ok: false });
      }
    } finally {
      setExecuting(null);
      setConvertCashOpen(false);
      setConvertCashAmount("");
      if (viewMode !== "compact") {
        setTimeout(() => setFlash(null), 4000);
      }
    }
  };

  const visible = useMemo(
    () => (activeCategory === "all" ? CARDS : CARDS.filter((c) => c.category === activeCategory)),
    [activeCategory]
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: CARDS.length };
    for (const c of CARDS) counts[c.category] = (counts[c.category] ?? 0) + 1;
    return counts;
  }, []);

  // Card art is era- and country-specific: a 1953 US player sees Eisenhower-era
  // American photography, a DD player sees Volkskammer-era East German photography,
  // and anything without bespoke national art falls back to the era-generic set.
  // Resolved from the LIVE year, not the seed preset: the header right below
  // labels this page with `currentYear`, so picking art from the era the world
  // seeded from meant a 1953-seeded world sitting in 1985 read "1985" over
  // Eisenhower-era photography. Art tiers are discrete, which is exactly what
  // `eraIdForYear` is for.
  const era =
    worldFlags.currentYear != null
      ? eraIdForYear(worldFlags.currentYear)
      : eraForPreset(worldFlags.preset);
  const countryId = character?.countryId ?? null;
  // Deliberately not `getEraConfig().label` — that would pull the whole
  // landing-page era config (every era's copy and nation list) into this bundle.
  const eraLabel = String(worldFlags.currentYear ?? era);
  const cardImages = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of CARDS) map[c.type] = getActionImage(c.imageSlug, { era, countryId });
    return map;
  }, [era, countryId]);
  const heroImage = useMemo(() => getActionImage("hero", { era, countryId }), [era, countryId]);

  const influence = character?.politicalInfluence ?? 0;
  const infamy = character?.infamy ?? 0;
  const influenceDecay = calculatePoliticalInfluenceDecay(influence).toFixed(2);

  const actionCosts = useMemo(() => {
    if (!character) return null;
    // Face value in the campaign treasury's own currency, computed by the same
    // helper the server credits with (ticket 1107). Never pass this through the
    // live-forex formatter: campaign funds convert at the frozen base rate.
    const fundraiseAmount = fundraiseYieldLocal(character, !!character.currencyBalances);
    const countryId = character.countryId ?? "US";
    const buildDonorBaseFundCost = homeState
      ? getBuildDonorBaseFundCost(
          character?.donorBaseLevel ?? 0,
          homeState.gdp,
          homeState.population,
          countryId
        )
      : getBuildDonorBaseFundCost(
          character?.donorBaseLevel ?? 0,
          getGdpBaseline(countryId),
          1_000_000,
          countryId
        );
    const donorUpgradeCost = buildDonorBaseFundCost;
    const campaignActionCost = getCampaignActionCost(influence);
    const campaignFundCost = homeState
      ? getCampaignFundCost(influence, homeState.gdp, homeState.population, countryId)
      : 20_000;
    const campaignMaxed = influence >= 100;
    const advertiseActionCost = getAdvertiseActionCost(character?.favorability ?? 0);
    const advertiseFundCost = homeState
      ? getAdvertiseFundCost(
          character?.favorability ?? 0,
          homeState.gdp,
          homeState.population,
          countryId
        )
      : getAdvertiseFundCost(
          character?.favorability ?? 0,
          getGdpBaseline(countryId),
          1_000_000,
          countryId
        );
    const fundraiseActionCost = getDonorActionCost(character?.donorBaseLevel ?? 0, "fundraise");
    const buildDonorBaseActionCost = getDonorActionCost(
      character?.donorBaseLevel ?? 0,
      "buildDonorBase"
    );
    return {
      fundraiseAmount,
      donorUpgradeCost,
      campaignActionCost,
      campaignFundCost,
      campaignMaxed,
      advertiseActionCost,
      advertiseFundCost,
      fundraiseActionCost,
      buildDonorBaseActionCost,
      buildDonorBaseFundCost,
    };
  }, [character, influence, homeState]);

  const forexEnabled = !!character?.currencyBalances;
  // LOCAL home-currency balance — canonical source of truth.
  // The card components convert the ₳ cost to home currency via useCurrency.convert
  // before comparing, so both sides of the check are in the same units.
  // #885: when forex is on, NEVER fall back to the legacy anchor `funds` field —
  // it is USD-scaled and, in a high-denomination currency like NGN, reads as a
  // tiny local balance, producing a false "insufficient funds" if
  // currencyBalances.campaign is momentarily undefined. Fall back to 0 instead.
  const displayCampaignFundsStored = forexEnabled
    ? (character?.currencyBalances?.campaign ?? 0)
    : (character?.funds ?? 0);
  const displayCampaignFunds = displayCampaignFundsStored;
  const displayPersonalWealth = character
    ? getTotalPersonalLiquidWealth(character, forexEnabled)
    : 0;
  const blockGdpScaledCosts = homeState === null;

  // Wait on world flags too: resolving art before the era is known would paint
  // the 2019 fallback set for a frame and then swap it for the 1953 set.
  if (loading || !worldFlags.loaded || !character || !actionCosts) {
    return (
      <div className="min-h-screen bg-background pb-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8">
          {/* Hero skeleton — image area + stats strip */}
          <div className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
            <Skeleton className="h-[175px] sm:h-[220px] w-full rounded-none rounded-t-2xl" />
            <div className="flex flex-wrap border-t border-card-border">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex-1 min-w-[80px] p-4 space-y-1.5">
                  <Skeleton className="h-2.5 w-14" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
              <div className="flex-1 min-w-[160px] p-4 space-y-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="h-2.5 w-10" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <Skeleton className="h-2.5 w-20" />
                    <Skeleton className="h-2.5 w-10" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Filter tabs + view toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-8 w-20 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>

          {/* 9 action cards */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-card-border bg-card overflow-hidden">
                <Skeleton className="h-40 w-full rounded-none" />
                <div className="p-4 space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <div className="flex items-center justify-between pt-1">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-8 w-24 rounded-lg" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Donor Network Stats */}
          <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
            <Skeleton className="h-4 w-40" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-6 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8 overflow-x-hidden">
        {/* Hero Section */}
        <ActionsHero
          character={character}
          imageUrl={heroImage}
          eraLabel={eraLabel}
          campaignFundsDisplay={displayCampaignFundsStored}
          campaignFundsCurrency={getHomeCurrency(character)}
          influence={influence}
          infamy={infamy}
          influenceDecay={influenceDecay}
          portfolioData={portfolioData}
        />

        {/* Pending random event — renders nothing when there is none */}
        <PlayerEventCard />

        {/* Active election debate — renders nothing when there is none */}
        <DebateCard />

        {/* Active crises — renders nothing when there are none */}
        <CrisisActionCard />

        {/* Filter Tabs + View Toggle */}
        <div className="flex items-center justify-between gap-4">
          <CategoryFilter
            categories={CATEGORIES}
            counts={categoryCounts}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
          />
          <ViewToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} />
        </div>

        {/* Action Cards */}
        <div
          className={
            viewMode === "cards"
              ? "grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
              : "flex flex-col gap-2"
          }
        >
          {visible.map((card, index) => {
            const CardComponent = viewMode === "cards" ? ActionCard : ActionCardCompact;
            return (
              <CardComponent
                key={card.type}
                card={card}
                imageUrl={cardImages[card.type]}
                index={index}
                viewMode={viewMode}
                character={character}
                homeState={homeState}
                executing={executing}
                flash={flash}
                flipflopStep={flipflopStep}
                flipflopAxis={flipflopAxis}
                flipflopDir={flipflopDir}
                onExecute={execute}
                onFlipflop={executeFlipflop}
                onFlipflopStepChange={setFlipflopStep}
                onFlipflopAxisChange={setFlipflopAxis}
                onFlipflopDirChange={setFlipflopDir}
                campaignActionCost={actionCosts.campaignActionCost}
                campaignFundCost={actionCosts.campaignFundCost}
                campaignMaxed={actionCosts.campaignMaxed}
                advertiseActionCost={actionCosts.advertiseActionCost}
                advertiseFundCost={actionCosts.advertiseFundCost}
                fundraiseActionCost={actionCosts.fundraiseActionCost}
                buildDonorBaseActionCost={actionCosts.buildDonorBaseActionCost}
                buildDonorBaseFundCost={actionCosts.buildDonorBaseFundCost}
                fundraiseYield={actionCosts.fundraiseAmount}
                campaignCurrency={getHomeCurrency(character)}
                displayCampaignFunds={displayCampaignFunds}
                displayPersonalWealth={displayPersonalWealth}
                blockGdpScaledCosts={blockGdpScaledCosts}
                forexEnabled={forexEnabled}
                convertCashOpen={convertCashOpen}
                convertCashAmount={convertCashAmount}
                onConvertCashOpenChange={setConvertCashOpen}
                onConvertCashAmountChange={setConvertCashAmount}
                onConvertCashExecute={executeConvertCash}
              />
            );
          })}
        </div>

        {/* Donor Network Stats */}
        <DonorNetworkStats
          fundraiseAmount={actionCosts.fundraiseAmount}
          fundraiseCurrency={getHomeCurrency(character)}
          donorUpgradeCost={actionCosts.donorUpgradeCost}
        />
      </main>
    </div>
  );
}
