"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CORPORATION_TYPES, CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import { regionUrl } from "@/lib/urls";
import type { CorporationType } from "@/lib/constants/corporations";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { type CountryId } from "@/lib/constants/countries";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { CAPACITY_UNIT_LABEL, formatUnits } from "./plantsPresentation";
import {
  facilityPlural,
  facilitySingular,
  facilityVocabulary,
} from "@/lib/constants/facilityVocabulary";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import { useDialogA11y } from "@/components/ui";

interface Competitor {
  corpId: string;
  name: string;
  sequentialId: number | null;
  logoUrl: string | null;
  brandColor: string | null;
  revenue: number;
}

interface Suggestion {
  stateId: string;
  stateName: string;
  countryId: string;
  unownedRevenue: number;
  splitCost: number;
  estimatedRevenueCapture: number;
  canAfford: boolean;
  ownedSectorId: string | null;
  competitors: Competitor[];
  totalCompetitorRevenue: number;
  /** Plants tier: untapped demand in this market, output units per day. */
  headroomUnits?: number | null;
  /** Plants tier: what the starter plant costs to build HERE (₳). */
  starterBuildCostAnchor?: number | null;
  /** Plants tier: entry fee + starter build, the all-in price (₳). */
  foundingTotalAnchor?: number | null;
}

/** Plants-tier founding terms that do not vary by state. */
interface FoundingQuote {
  /** Capacity the starter plant delivers, output units per day. */
  starterUnits: number;
  /** Entry fee: land, permits, licences (₳). */
  foundingFeeAnchor: number;
  /** Turns until the starter plant comes online. */
  foundingBuildTurns: number;
}

interface ExpandMarketModalProps {
  corpId: string;
  primaryType: CorporationType;
  secondaryType?: CorporationType | null;
  liquidCapital: number;
  onClose: () => void;
  /**
   * Plants tier: entering a market means BUILDING your first plant there, so
   * the picker ranks on untapped demand and the detail card quotes the real
   * founding charge instead of a split cost.
   */
  plantsMode?: boolean;
  /** Deep-link: skip type pick and open suggestions for this sector type. */
  initialSectorType?: CorporationType;
  /** Deep-link: focus this state once suggestions load. */
  initialStateId?: string;
}

type Step = "selectType" | "suggestions";
type SuggestionMode = "unowned" | "playerCorp";
type OwnershipFilter = "all" | "owned" | "unowned";

const OWNERSHIP_OPTIONS: { value: OwnershipFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unowned", label: "New markets" },
  { value: "owned", label: "Already in" },
];

export default function ExpandMarketModal({
  corpId,
  primaryType,
  secondaryType,
  liquidCapital,
  onClose,
  plantsMode = false,
  initialSectorType,
  initialStateId,
}: ExpandMarketModalProps) {
  const { dialogProps, titleId } = useDialogA11y(onClose);
  const resolveCountryName = useCountryDisplayName();
  const { formatAmount } = useCurrency();
  const router = useRouter();
  // Any sector type is buildable, so honor an incoming type in either mode and
  // fall back to the corp's primary type when none is supplied.
  const startType = initialSectorType ?? primaryType;
  const [step, setStep] = useState<Step>(
    plantsMode || initialSectorType ? "suggestions" : "selectType"
  );
  const [selectedType, setSelectedType] = useState<CorporationType>(startType);
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>("unowned");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>(
    plantsMode && !initialStateId ? "unowned" : "all"
  );
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fetchedLiquidCapital, setFetchedLiquidCapital] = useState<number>(liquidCapital);
  const [liquidCurrencyCode, setLiquidCurrencyCode] = useState<CurrencyCode | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(
    plantsMode || Boolean(initialSectorType)
  );
  const [suggestionError, setSuggestionError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Multi-select country filter. Empty = all countries (global top markets).
  // Selecting one or more re-queries the server for the top markets WITHIN those
  // countries, so options outside the global top-N are revealed.
  const [countryFilters, setCountryFilters] = useState<Set<string>>(new Set());
  // Every country with a market in this sector — comes from the API (NOT just
  // the countries in the current top-N), so all of them are selectable.
  const [availableCountries, setAvailableCountries] = useState<{ id: string; name: string }[]>([]);
  const [foundingQuote, setFoundingQuote] = useState<FoundingQuote | null>(null);
  // Two-step under plants: pick the market, then read the terms and confirm.
  // Founding now spends real money on a plant that takes turns to arrive, so
  // it should not be one click away from a list.
  const [confirming, setConfirming] = useState(false);
  const [foundingBusy, setFoundingBusy] = useState(false);
  const [foundingError, setFoundingError] = useState("");
  // Prefer the deep-linked state once on the next suggestions load.
  const pendingStateRef = useRef<string | undefined>(initialStateId);

  // A fresh suggestion set re-points the detail card to the deep-linked state
  // when present, otherwise the top row. The fetch path clears confirmation
  // before publishing the new list so this effect cannot undo a fast review click.
  useEffect(() => {
    const want = pendingStateRef.current;
    if (want && suggestions.length > 0) {
      const idx = suggestions.findIndex((s) => s.stateId === want);
      setActiveIndex(idx >= 0 ? idx : 0);
      pendingStateRef.current = undefined;
      return;
    }
    setActiveIndex(0);
  }, [suggestions]);

  async function handleFetchSuggestions(
    type: CorporationType,
    mode: SuggestionMode,
    countries: Set<string>,
    ownership: OwnershipFilter,
    pinStateId?: string
  ) {
    setLoadingSuggestions(true);
    setSuggestionError("");
    try {
      const countryParam =
        countries.size > 0 ? `&country=${encodeURIComponent([...countries].join(","))}` : "";
      const ownershipParam = ownership !== "all" ? `&ownership=${ownership}` : "";
      const stateParam = pinStateId ? `&state=${encodeURIComponent(pinStateId)}` : "";
      const res = await fetch(
        `/api/corporations/${corpId}/expand-suggestions?sectorType=${encodeURIComponent(type)}&mode=${mode}${countryParam}${ownershipParam}${stateParam}`
      );
      const data = await res.json();
      if (!res.ok) {
        setSuggestionError(data.error ?? "Failed to load suggestions");
        return;
      }
      setSuggestions(data.suggestions ?? []);
      setAvailableCountries(
        ((data.availableCountries as string[]) ?? [])
          .map((id) => ({ id, name: resolveCountryName(id as CountryId) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      if (typeof data.liquidCapital === "number") {
        setFetchedLiquidCapital(data.liquidCapital);
      }
      setLiquidCurrencyCode((data.liquidCurrencyCode as CurrencyCode | null) ?? null);
      setFoundingQuote(
        data.plantsMode === true && typeof data.starterUnits === "number"
          ? {
              starterUnits: data.starterUnits as number,
              foundingFeeAnchor: (data.foundingFeeAnchor as number) ?? 0,
              foundingBuildTurns: (data.foundingBuildTurns as number) ?? 0,
            }
          : null
      );
      setConfirming(false);
      setStep("suggestions");
    } catch {
      setSuggestionError("Network error");
    } finally {
      setLoadingSuggestions(false);
    }
  }

  // Plants mode opens on the ranked market list because the buildable type is
  // already known. A state-board deep link also pins its originating state into
  // the top-N (Maryland is not necessarily a global top market).
  useEffect(() => {
    if (!plantsMode && !initialSectorType) return;
    const type = startType;
    const ownership = plantsMode && !initialStateId ? "unowned" : "all";
    void handleFetchSuggestions(type, "unowned", new Set(), ownership, initialStateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial modal route only
  }, []);

  // Toggling a country re-queries the server (top markets within the new
  // selection) rather than filtering the already-fetched top-N client-side.
  const toggleCountry = (id: string) => {
    const next = new Set(countryFilters);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCountryFilters(next);
    void handleFetchSuggestions(selectedType, suggestionMode, next, ownershipFilter);
  };

  const clearCountryFilter = () => {
    if (countryFilters.size === 0) return;
    setCountryFilters(new Set());
    void handleFetchSuggestions(selectedType, suggestionMode, new Set(), ownershipFilter);
  };

  const selectCountry = (id: string) => {
    const next = id ? new Set([id]) : new Set<string>();
    setCountryFilters(next);
    void handleFetchSuggestions(selectedType, suggestionMode, next, ownershipFilter);
  };

  const selectPlantSectorType = (type: CorporationType) => {
    if (type === selectedType) return;
    setSelectedType(type);
    setSuggestionMode("unowned");
    setOwnershipFilter("unowned");
    setCountryFilters(new Set());
    void handleFetchSuggestions(type, "unowned", new Set(), "unowned");
  };

  async function handleModeSwitch(newMode: SuggestionMode) {
    setSuggestionMode(newMode);
    setCountryFilters(new Set());
    await handleFetchSuggestions(selectedType, newMode, new Set(), ownershipFilter);
  }

  // Ownership re-queries the server so the filter applies before the top-N
  // slice (owned/new markets outside the global top-N still surface). Country
  // selection is preserved across the switch.
  async function handleOwnershipSwitch(next: OwnershipFilter) {
    if (next === ownershipFilter) return;
    setOwnershipFilter(next);
    await handleFetchSuggestions(selectedType, suggestionMode, countryFilters, next);
  }

  const activeSuggestion = suggestions[activeIndex] ?? suggestions[0] ?? null;
  const selectedFacility = facilityVocabulary(selectedType);
  const selectedFacilityAction =
    selectedFacility.buildVerb.charAt(0).toUpperCase() + selectedFacility.buildVerb.slice(1);
  const activeMarketCurrency = activeSuggestion
    ? (COUNTRY_CURRENCY_MAP[activeSuggestion.countryId as CountryId] ?? "USD")
    : "USD";
  const formatMarketAmount = (amount: number, currencyCode: CurrencyCode = activeMarketCurrency) =>
    formatAmount(amount, currencyCode);
  const formatTreasuryAmount = (amount: number) =>
    formatAmount(amount, liquidCurrencyCode ?? undefined);
  const marketCurrencyTitle = `Forex-normalized market revenue. Local display mode shows ${activeMarketCurrency}, the target state's home currency; other display modes convert from the same underlying value.`;

  async function handleFoundFirstPlant() {
    if (!activeSuggestion || !activeSuggestion.canAfford) return;
    setFoundingBusy(true);
    setFoundingError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateId: activeSuggestion.stateId,
          sectorType: selectedType,
        }),
      });
      const data = (await res.json()) as { error?: string; sectorId?: string };
      if (!res.ok) {
        setFoundingError(data.error ?? "Could not start this plant");
        return;
      }
      onClose();
      if (data.sectorId) {
        router.push(`/corporation/${corpId}/sector/${data.sectorId}?build=1`);
        router.refresh();
      } else {
        router.push(`/corporation/${corpId}?tab=sectors`);
        router.refresh();
      }
    } catch {
      setFoundingError("Network error");
    } finally {
      setFoundingBusy(false);
    }
  }

  // Any sector type is buildable. Primary and secondary are listed first and
  // badged; the rest carry the off-type margin penalty but are not gated out.
  const orderedTypes: CorporationType[] = [
    primaryType,
    ...(secondaryType ? [secondaryType] : []),
    ...CORPORATION_TYPES.filter((t) => t !== primaryType && t !== secondaryType),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-3 py-4 pb-20 backdrop-blur-sm sm:px-4 sm:py-6 sm:pb-20"
      {...dialogProps}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[calc(100dvh-6rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-card-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-card-border px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2 id={titleId} className="text-base font-bold text-foreground">
              {plantsMode ? "Build a new sector" : "Expand Into New Market"}
            </h2>
            {step === "suggestions" && !plantsMode && (
              <button
                type="button"
                className="text-xs text-muted hover:text-foreground mt-0.5 transition-colors"
                onClick={() => setStep("selectType")}
              >
                Back to sector type selection
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full w-7 h-7 flex items-center justify-center text-muted hover:text-foreground hover:bg-card-elevated transition-colors text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Step 1: Select sector type */}
          {step === "selectType" && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                {plantsMode
                  ? "Choose what you want to make. The next step shows which markets have demand nobody is meeting yet."
                  : "Choose the sector type to find the best split opportunities."}
              </p>

              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {orderedTypes.map((t) => {
                  const isPrimary = t === primaryType;
                  const isSecondary = t === secondaryType;
                  const isSelected = selectedType === t;

                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedType(t)}
                      className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-left transition-colors border ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-card-border bg-card-elevated/40 text-foreground hover:border-primary/40 hover:bg-primary/5"
                      }`}
                    >
                      <span className="font-medium">{CORPORATION_TYPE_LABELS[t]}</span>
                      <span className="flex items-center gap-1.5 shrink-0 ml-2">
                        {isPrimary && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-primary/20 text-primary">
                            Primary
                          </span>
                        )}
                        {isSecondary && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-success/20 text-success">
                            Secondary
                          </span>
                        )}
                        {!isPrimary && !isSecondary && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-warning/10 text-warning">
                            -15% margin
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {suggestionError && <p className="text-sm text-error">{suggestionError}</p>}

              <button
                type="button"
                disabled={loadingSuggestions}
                onClick={() => {
                  setCountryFilters(new Set());
                  void handleFetchSuggestions(
                    selectedType,
                    suggestionMode,
                    new Set(),
                    ownershipFilter
                  );
                }}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loadingSuggestions
                  ? "Loading..."
                  : plantsMode
                    ? "Find Untapped Markets"
                    : "Find Best Opportunities"}
              </button>
            </div>
          )}

          {/* Step 2: Suggestions */}
          {step === "suggestions" && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {plantsMode
                      ? confirming && activeSuggestion
                        ? `Review ${activeSuggestion.stateName}`
                        : "Choose a market"
                      : `${CORPORATION_TYPE_LABELS[selectedType]} markets`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {plantsMode
                      ? `${CORPORATION_TYPE_LABELS[selectedType]} sector · ${formatTreasuryAmount(fetchedLiquidCapital)} available`
                      : suggestionMode === "playerCorp"
                        ? "Sorted by competitor revenue"
                        : "Sorted by revenue capture"}
                  </p>
                </div>
                {plantsMode && confirming && (
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="shrink-0 rounded-md border border-card-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
                  >
                    Back to markets
                  </button>
                )}
              </div>

              {suggestionError && (
                <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                  {suggestionError}
                </p>
              )}

              {/* Mode toggle */}
              <div
                className={`${plantsMode ? "hidden" : "flex"} rounded-lg border border-card-border overflow-hidden text-xs font-medium`}
              >
                <button
                  type="button"
                  onClick={() => suggestionMode !== "unowned" && handleModeSwitch("unowned")}
                  disabled={loadingSuggestions}
                  className={`flex-1 px-3 py-1.5 transition-colors ${
                    suggestionMode === "unowned"
                      ? "bg-primary text-white"
                      : "bg-card-elevated/40 text-muted hover:text-foreground"
                  }`}
                >
                  {plantsMode ? "Untapped Markets" : "Unowned Markets"}
                </button>
                <button
                  type="button"
                  onClick={() => suggestionMode !== "playerCorp" && handleModeSwitch("playerCorp")}
                  disabled={loadingSuggestions}
                  className={`flex-1 px-3 py-1.5 transition-colors border-l border-card-border ${
                    suggestionMode === "playerCorp"
                      ? "bg-primary text-white"
                      : "bg-card-elevated/40 text-muted hover:text-foreground"
                  }`}
                >
                  {loadingSuggestions && suggestionMode === "unowned"
                    ? "Loading..."
                    : "Player Corp Markets"}
                </button>
              </div>

              {/* Ownership filter — hide markets you already operate in, or show only those */}
              <div className={`${plantsMode ? "hidden" : "flex"} items-center gap-1.5 flex-wrap`}>
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  Show
                </span>
                {OWNERSHIP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => void handleOwnershipSwitch(opt.value)}
                    disabled={loadingSuggestions}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors border disabled:opacity-50 ${
                      ownershipFilter === opt.value
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-card-border text-muted hover:text-foreground hover:border-muted"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Available balance banner */}
              <div
                className={`${plantsMode ? "hidden" : "flex"} rounded-lg border border-card-border bg-card-elevated/30 px-3 py-2 items-center justify-between`}
              >
                <span className="text-xs text-muted">Your available capital</span>
                <span className="text-xs font-bold text-foreground">
                  {formatTreasuryAmount(fetchedLiquidCapital)}
                </span>
              </div>

              {plantsMode && !confirming && (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-card-border bg-card-elevated/25 p-3">
                  <label className="col-span-2 space-y-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Sector type
                    </span>
                    <select
                      value={selectedType}
                      disabled={loadingSuggestions}
                      onChange={(event) =>
                        selectPlantSectorType(event.target.value as CorporationType)
                      }
                      className="w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
                    >
                      {orderedTypes.map((t) => {
                        const suffix =
                          t === primaryType
                            ? " (primary)"
                            : t === secondaryType
                              ? " (secondary)"
                              : " (-15% margin)";
                        return (
                          <option key={t} value={t}>
                            {CORPORATION_TYPE_LABELS[t]}
                            {suffix}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Rank by
                    </span>
                    <select
                      value={suggestionMode}
                      disabled={loadingSuggestions}
                      onChange={(event) =>
                        void handleModeSwitch(event.target.value as SuggestionMode)
                      }
                      className="w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
                    >
                      <option value="unowned">Best affordable fit</option>
                      <option value="playerCorp">Largest established</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Show
                    </span>
                    <select
                      value={ownershipFilter}
                      disabled={loadingSuggestions}
                      onChange={(event) =>
                        void handleOwnershipSwitch(event.target.value as OwnershipFilter)
                      }
                      className="w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
                    >
                      <option value="unowned">New markets</option>
                      <option value="all">All markets</option>
                      <option value="owned">Already in</option>
                    </select>
                  </label>
                  {availableCountries.length > 1 && (
                    <label className="col-span-2 space-y-1">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                        Country
                      </span>
                      <select
                        value={countryFilters.size === 1 ? [...countryFilters][0] : ""}
                        disabled={loadingSuggestions}
                        onChange={(event) => selectCountry(event.target.value)}
                        className="w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
                      >
                        <option value="">All countries</option>
                        {availableCountries.map((country) => (
                          <option key={country.id} value={country.id}>
                            {country.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <p className="col-span-2 text-[11px] leading-snug text-muted">
                    {suggestionMode === "unowned"
                      ? "Open demand is customer demand no corporation in that state is serving yet."
                      : "Established markets are ranked by the current revenue of competing corporations."}
                  </p>
                </div>
              )}

              {loadingSuggestions ? (
                <div className="rounded-xl border border-card-border bg-card-elevated/30 p-6 text-center">
                  <p className="text-sm text-muted">Finding the strongest markets...</p>
                </div>
              ) : suggestionError && suggestions.length === 0 ? null : suggestions.length === 0 ? (
                <div className="rounded-xl border border-card-border bg-card-elevated/30 p-6 text-center">
                  <p className="text-sm text-muted">
                    {plantsMode
                      ? suggestionMode === "playerCorp"
                        ? "No established markets found for this sector type."
                        : // Never claim the world is served. This branch means no
                          // candidate market rows came back at all, which is a
                          // different thing, and the old wording told players the
                          // board was closed when it was not (#1162).
                          "No markets found for this sector type yet."
                      : suggestionMode === "playerCorp"
                        ? "No player corporations found in this sector type."
                        : "No available markets found for this sector type."}
                  </p>
                </div>
              ) : (
                <>
                  {/* Country filter — multi-select; empty = all countries */}
                  <div
                    className={`${plantsMode ? "hidden" : "flex"} items-center gap-1.5 flex-wrap`}
                  >
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                      Country
                    </span>
                    <button
                      type="button"
                      onClick={clearCountryFilter}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors border ${
                        countryFilters.size === 0
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-card-border text-muted hover:text-foreground hover:border-muted"
                      }`}
                    >
                      All
                    </button>
                    {availableCountries.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCountry(c.id)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors border ${
                          countryFilters.has(c.id)
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-card-border text-muted hover:text-foreground hover:border-muted"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>

                  {/* Market picker — plants.
                      A chip row can only carry a name, which under plants
                      hides the one number that decides where to build. The
                      picker becomes a short table so untapped demand sits next
                      to the state it belongs to and the rows can be compared
                      down a column rather than by clicking through them. */}
                  {plantsMode && !confirming && (
                    <div className="overflow-hidden rounded-lg border border-card-border">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 border-b border-card-border bg-card-elevated/40 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                        <span>Market</span>
                        <span className="text-right">Room for</span>
                        <span className="text-right">Entry</span>
                      </div>
                      <ul className="list-none divide-y divide-card-border/40">
                        {suggestions.map((s, i) => {
                          const facilityCount = foundingQuote?.starterUnits
                            ? Math.floor((s.headroomUnits ?? 0) / foundingQuote.starterUnits)
                            : 0;
                          const countryName = resolveCountryName(s.countryId as CountryId);

                          return (
                            <li key={s.stateId}>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveIndex(i);
                                  setConfirming(false);
                                }}
                                aria-pressed={activeIndex === i}
                                className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2.5 text-left transition-colors ${
                                  activeIndex === i ? "bg-primary/10" : "hover:bg-card-elevated/50"
                                }`}
                              >
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1.5">
                                    <span
                                      className={`truncate text-xs font-semibold ${activeIndex === i ? "text-primary" : "text-foreground"}`}
                                    >
                                      {s.stateName}
                                    </span>
                                    {i === 0 && suggestionMode === "unowned" && (
                                      <span className="shrink-0 rounded bg-success/15 px-1 py-0.5 text-[9px] font-bold text-success">
                                        {s.canAfford ? "Best fit" : "Most demand"}
                                      </span>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[10px] text-muted">
                                    {countryName}
                                    {s.ownedSectorId
                                      ? " · You operate here"
                                      : s.competitors.length === 0
                                        ? " · No competitors"
                                        : ` · ${s.competitors.length} competitor${s.competitors.length === 1 ? "" : "s"}`}
                                  </span>
                                </span>
                                <span className="text-right text-xs font-semibold tabular-nums text-foreground">
                                  {facilityCount.toLocaleString("en-US")}
                                  <span className="block text-[9px] font-normal text-muted">
                                    {facilityCount === 1
                                      ? facilitySingular(selectedType)
                                      : facilityPlural(selectedType)}
                                  </span>
                                  {/* A market with no unmet demand is still open
                                      to a build, you just start by taking sales
                                      off the incumbents. That was only ever said
                                      at the confirm step, so a board of zeroes
                                      read as "every market is closed" (#1162). */}
                                  {facilityCount === 0 && (
                                    <span className="mt-0.5 block text-[9px] font-normal leading-snug text-warning">
                                      You can still build here
                                    </span>
                                  )}
                                </span>
                                <span
                                  className={`text-right text-xs tabular-nums ${s.canAfford ? "text-foreground" : "text-error"}`}
                                >
                                  {s.foundingTotalAnchor != null
                                    ? formatTreasuryAmount(s.foundingTotalAnchor)
                                    : "Not quoted"}
                                  <span className="block text-[9px] font-normal">
                                    {s.canAfford ? "Affordable" : "Not enough cash"}
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {plantsMode && !confirming && activeSuggestion && (
                    <div className="sticky bottom-0 -mx-4 border-t border-card-border bg-card/95 px-4 pb-1 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {activeSuggestion.stateName}
                          </p>
                          <p className="text-[11px] text-muted">
                            {formatUnits(activeSuggestion.headroomUnits)} {CAPACITY_UNIT_LABEL} open
                            ·{" "}
                            {activeSuggestion.foundingTotalAnchor != null
                              ? formatTreasuryAmount(activeSuggestion.foundingTotalAnchor)
                              : "Price unavailable"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirming(true)}
                          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
                        >
                          Review {facilitySingular(selectedType)}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Toggle tabs */}
                  <div className={`${plantsMode ? "hidden" : "flex"} gap-1.5 flex-wrap`}>
                    {suggestions.map((s, i) => (
                      <button
                        key={s.stateId}
                        type="button"
                        onClick={() => setActiveIndex(i)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors border ${
                          activeIndex === i
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-card-border text-muted hover:text-foreground hover:border-muted"
                        } ${!s.canAfford ? "opacity-50" : ""}`}
                        title={!s.canAfford ? "Insufficient capital" : s.stateName}
                      >
                        {i + 1}. {s.stateName}
                        {!s.canAfford && " *"}
                      </button>
                    ))}
                  </div>

                  {activeSuggestion && (!plantsMode || confirming) && (
                    <div className="rounded-xl border border-card-border bg-card-elevated/30 p-4 space-y-3">
                      {/* State header */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground text-sm">
                            {activeSuggestion.stateName}
                          </p>
                          <p className="text-xs text-muted mt-0.5">
                            {CORPORATION_TYPE_LABELS[selectedType]}
                          </p>
                        </div>
                        {activeSuggestion.ownedSectorId ? (
                          <span className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold bg-success/15 text-success border border-success/20">
                            You operate here
                          </span>
                        ) : (
                          <span className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium bg-muted/10 text-muted border border-card-border">
                            Not entered
                          </span>
                        )}
                      </div>

                      {/* Stats row — plants */}
                      {plantsMode && foundingQuote && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-lg bg-background/60 px-3 py-2 text-center">
                            <p className="text-[10px] text-muted uppercase tracking-wide">
                              In-state demand
                            </p>
                            <p className="text-sm font-bold text-foreground tabular-nums">
                              {formatUnits(activeSuggestion.headroomUnits)}
                            </p>
                            <p className="text-[10px] text-muted">{CAPACITY_UNIT_LABEL}</p>
                          </div>
                          <div className="rounded-lg bg-background/60 px-3 py-2 text-center">
                            <p className="text-[10px] text-muted uppercase tracking-wide">
                              Your first {facilitySingular(selectedType)}
                            </p>
                            <p className="text-sm font-bold text-success tabular-nums">1</p>
                            <p className="text-[10px] text-muted">
                              {formatUnits(foundingQuote.starterUnits)} {CAPACITY_UNIT_LABEL}
                            </p>
                          </div>
                          <div className="rounded-lg bg-background/60 px-3 py-2 text-center">
                            <p className="text-[10px] text-muted uppercase tracking-wide">
                              Comes online
                            </p>
                            <p className="text-sm font-bold text-foreground tabular-nums">
                              {foundingQuote.foundingBuildTurns}
                            </p>
                            <p className="text-[10px] text-muted">
                              turn{foundingQuote.foundingBuildTurns === 1 ? "" : "s"}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Stats row */}
                      <div className={`${plantsMode ? "hidden" : "grid"} grid-cols-3 gap-2`}>
                        <div className="rounded-lg bg-background/60 px-3 py-2 text-center">
                          <p
                            className="text-[10px] text-muted uppercase tracking-wide"
                            title={marketCurrencyTitle}
                          >
                            Unowned pool
                          </p>
                          <p className="text-sm font-bold text-foreground">
                            {activeSuggestion.unownedRevenue > 0
                              ? formatMarketAmount(Math.round(activeSuggestion.unownedRevenue / 24))
                              : "—"}
                          </p>
                          <p className="text-[10px] text-muted">/turn revenue</p>
                        </div>
                        <div className="rounded-lg bg-background/60 px-3 py-2 text-center">
                          <p
                            className="text-[10px] text-muted uppercase tracking-wide"
                            title={marketCurrencyTitle}
                          >
                            Split cost
                          </p>
                          <p
                            className={`text-sm font-bold ${
                              activeSuggestion.unownedRevenue === 0
                                ? "text-muted"
                                : activeSuggestion.canAfford
                                  ? "text-foreground"
                                  : "text-error"
                            }`}
                          >
                            {activeSuggestion.unownedRevenue > 0
                              ? formatMarketAmount(activeSuggestion.splitCost)
                              : "No pool"}
                          </p>
                          {!activeSuggestion.canAfford && activeSuggestion.unownedRevenue > 0 && (
                            <p className="text-[10px] text-error">
                              short{" "}
                              {formatTreasuryAmount(
                                activeSuggestion.splitCost - fetchedLiquidCapital
                              )}
                            </p>
                          )}
                        </div>
                        <div className="rounded-lg bg-background/60 px-3 py-2 text-center">
                          <p
                            className="text-[10px] text-muted uppercase tracking-wide"
                            title={marketCurrencyTitle}
                          >
                            Est. new revenue
                          </p>
                          <p
                            className={`text-sm font-bold ${activeSuggestion.unownedRevenue > 0 ? "text-success" : "text-muted"}`}
                          >
                            {activeSuggestion.unownedRevenue > 0
                              ? formatMarketAmount(
                                  Math.round(activeSuggestion.estimatedRevenueCapture / 24)
                                )
                              : "—"}
                          </p>
                          <p className="text-[10px] text-muted">/turn (pre-margin)</p>
                        </div>
                      </div>

                      {/* Player corp mode: total competitor revenue */}
                      {suggestionMode === "playerCorp" &&
                        activeSuggestion.totalCompetitorRevenue > 0 && (
                          <div className="rounded-lg bg-background/60 px-3 py-2 flex items-center justify-between">
                            <span
                              className="text-[10px] text-muted uppercase tracking-wide"
                              title={marketCurrencyTitle}
                            >
                              Total competitor revenue
                            </span>
                            <span className="text-sm font-bold text-foreground">
                              {formatMarketAmount(
                                Math.round(activeSuggestion.totalCompetitorRevenue / 24)
                              )}
                              /turn
                            </span>
                          </div>
                        )}

                      {/* Revenue vs profit note */}
                      {!plantsMode && activeSuggestion.unownedRevenue > 0 && (
                        <p className="text-[11px] text-muted leading-snug">
                          Capture estimate is new per-turn revenue before your effective margin is
                          applied. Actual profit depends on your margins in this state.
                        </p>
                      )}

                      {/* Competitors */}
                      {activeSuggestion.competitors.length > 0 && (
                        <div>
                          <p className="text-[10px] text-muted uppercase tracking-wide mb-1.5">
                            Competing in this market
                          </p>
                          <div className="space-y-1">
                            {activeSuggestion.competitors.map((c) => (
                              <div
                                key={c.corpId}
                                className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 bg-background/40"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <CorporationLogo
                                    logoUrl={c.logoUrl}
                                    name={c.name}
                                    size="h-6 w-6"
                                    className="rounded"
                                  />
                                  <Link
                                    href={
                                      c.sequentialId != null
                                        ? `/corporation/${c.sequentialId}`
                                        : `/corporation/${c.corpId}`
                                    }
                                    onClick={onClose}
                                    className="text-xs font-medium text-foreground hover:text-primary transition-colors truncate"
                                  >
                                    {c.name}
                                  </Link>
                                </div>
                                <span className="text-xs text-muted shrink-0">
                                  {formatMarketAmount(Math.round(c.revenue / 24))}/turn
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeSuggestion.competitors.length === 0 && (
                        <p className="text-[11px] text-success">
                          No competitors in this state market. Full in-state untapped demand
                          available.
                        </p>
                      )}

                      {/* No unowned pool notice */}
                      {!plantsMode && activeSuggestion.unownedRevenue === 0 && (
                        <p className="text-[11px] text-warning">
                          No unowned revenue pool — this market is fully captured by existing
                          corporations. You cannot split here currently.
                        </p>
                      )}

                      {/* CTA — plants: quote the charge, then send them to build */}
                      {plantsMode && foundingQuote && (
                        <div className="pt-1">
                          {activeSuggestion.ownedSectorId ? (
                            <Link
                              href={`/corporation/${corpId}/sector/${activeSuggestion.ownedSectorId}?build=1`}
                              onClick={onClose}
                              className="block w-full rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-center text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                            >
                              You already have {facilityPlural(selectedType)} here. Build more
                              capacity.
                            </Link>
                          ) : (
                            <div className="space-y-2 rounded-lg border border-card-border bg-background/60 p-3">
                              <p className="text-xs font-semibold text-foreground">
                                {selectedFacilityAction} your first {facilitySingular(selectedType)}{" "}
                                in {activeSuggestion.stateName}
                              </p>
                              <div className="space-y-0.5 text-xs text-muted">
                                <div className="flex justify-between gap-3">
                                  <span>Entry fee (land, permits, licences)</span>
                                  <span className="tabular-nums">
                                    {formatTreasuryAmount(foundingQuote.foundingFeeAnchor)}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span>
                                    First {facilitySingular(selectedType)} (
                                    {formatUnits(foundingQuote.starterUnits)} {CAPACITY_UNIT_LABEL})
                                  </span>
                                  <span className="tabular-nums">
                                    {activeSuggestion.starterBuildCostAnchor != null
                                      ? formatTreasuryAmount(
                                          activeSuggestion.starterBuildCostAnchor
                                        )
                                      : "—"}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3 border-t border-card-border pt-0.5 font-semibold text-foreground">
                                  <span>You pay now</span>
                                  <span className="tabular-nums">
                                    {activeSuggestion.foundingTotalAnchor != null
                                      ? formatTreasuryAmount(activeSuggestion.foundingTotalAnchor)
                                      : "—"}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span>Delivery</span>
                                  <span className="tabular-nums">
                                    {foundingQuote.foundingBuildTurns} turn
                                    {foundingQuote.foundingBuildTurns === 1 ? "" : "s"}
                                  </span>
                                </div>
                              </div>

                              {/* The same demand check the build dialog runs:
                                  is there unmet demand for what this plant will
                                  make? A plant larger than the untapped demand
                                  is not blocked — you can take sales off the
                                  incumbents — but it will run at a low fill
                                  rate while you do, and that is the single most
                                  common way a new corp loses money quietly. */}
                              {(() => {
                                const headroom = activeSuggestion.headroomUnits ?? 0;
                                const enough = headroom >= foundingQuote.starterUnits;
                                return (
                                  <p
                                    className={`rounded-md border px-2 py-1.5 text-[11px] leading-snug ${
                                      enough
                                        ? "border-success/30 bg-success/10 text-success"
                                        : "border-warning/30 bg-warning/10 text-warning"
                                    }`}
                                  >
                                    {enough
                                      ? `${activeSuggestion.stateName} has ${formatUnits(headroom)} ${CAPACITY_UNIT_LABEL} of in-state unmet demand. Your first ${facilitySingular(selectedType)} makes ${formatUnits(foundingQuote.starterUnits)}, so there is room to sell all of it here.`
                                      : `${activeSuggestion.stateName} only has ${formatUnits(headroom)} ${CAPACITY_UNIT_LABEL} of in-state unmet demand and your first ${facilitySingular(selectedType)} makes ${formatUnits(foundingQuote.starterUnits)}. You can still build, but you will have to take sales off corps already in this state, and until you do the plant will run below full.`}
                                  </p>
                                );
                              })()}

                              {!activeSuggestion.canAfford && (
                                <p className="rounded-md border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error">
                                  You do not have enough capital for this build.
                                </p>
                              )}

                              {foundingError && (
                                <p className="rounded-md border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error">
                                  {foundingError}
                                </p>
                              )}

                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setConfirming(false)}
                                  className="flex-1 rounded-lg border border-card-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-card-elevated"
                                >
                                  Back
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleFoundFirstPlant()}
                                  disabled={foundingBusy || !activeSuggestion.canAfford}
                                  className={`flex-1 rounded-lg px-3 py-2 text-center text-xs font-semibold text-white transition-colors ${
                                    activeSuggestion.canAfford
                                      ? "bg-primary hover:bg-primary/90"
                                      : "bg-primary/40"
                                  } disabled:cursor-not-allowed`}
                                >
                                  {foundingBusy ? "Starting..." : `${selectedFacilityAction} it`}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* CTA */}
                      <div className={plantsMode ? "hidden" : "pt-1"}>
                        {activeSuggestion.ownedSectorId ? (
                          <Link
                            href={`/corporation/${corpId}/sector/${activeSuggestion.ownedSectorId}`}
                            onClick={onClose}
                            className="block w-full rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-center text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                          >
                            View your sector and split
                          </Link>
                        ) : (
                          <Link
                            href={`${regionUrl(activeSuggestion.countryId, activeSuggestion.stateId)}?tab=economy&sector=${selectedType}`}
                            onClick={onClose}
                            className="block w-full rounded-lg border border-card-border bg-card-elevated/50 px-4 py-2 text-center text-sm font-medium text-foreground hover:bg-card-elevated transition-colors"
                          >
                            View state economy to split
                          </Link>
                        )}
                      </div>
                    </div>
                  )}

                  {!plantsMode && suggestions.some((s) => !s.canAfford && s.unownedRevenue > 0) && (
                    <p className="text-[11px] text-muted">* Insufficient capital for this split.</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
