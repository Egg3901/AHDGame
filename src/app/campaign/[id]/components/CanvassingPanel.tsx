"use client";

import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { getDemographicCategoriesForCountry } from "@/lib/demographics/countryDemographics";
import { DE_GROUP_EN_LABELS } from "@/lib/seeds/de/deDemographicCategories";

const COST_FUNDS = 100;
const COST_ACTIONS = 1;

interface CanvassingPanelProps {
  countryId?: string;
  characterActions?: number;
  characterFunds?: number;
  onResourcesSpent?: () => void;
}

type EligibilityState =
  | { status: "loading" }
  | { status: "eligible"; stateId: string; source: "home" | "travel" | "primaryCampaign" }
  | { status: "blocked"; reason: "needs_travel" | "needs_primary_campaign"; message: string };

// Mirrors CANVASS_ELIGIBILITY_MESSAGE in src/lib/canvassing/eligibility.ts.
// Duplicated here so the client bundle does not import the server-only resolver.
const ELIGIBILITY_MESSAGE: Record<"needs_travel" | "needs_primary_campaign", string> = {
  needs_travel: "Travel to a state to canvass voters there",
  needs_primary_campaign: "Set your primary campaign state to canvass voters there",
};

const SOURCE_DESCRIPTION: Record<
  "home" | "travel" | "primaryCampaign",
  (isRegionBased: boolean) => string
> = {
  home: (isRegionBased) =>
    `Boost turnout for specific demographics in your home ${isRegionBased ? "region" : "state"}.`,
  travel: () => "Boost turnout for specific demographics in your travel state.",
  primaryCampaign: () => "Boost turnout for specific demographics in your primary campaign state.",
};

function calculateMaxCanvasses(actions: number, funds: number): number {
  const maxByActions = Math.floor(actions / COST_ACTIONS);
  const maxByFunds = Math.floor(funds / COST_FUNDS);
  return Math.min(maxByActions, maxByFunds, 50);
}

export function CanvassingPanel({
  countryId,
  characterActions,
  characterFunds,
  onResourcesSpent,
}: CanvassingPanelProps) {
  const { formatFull } = useCurrency();

  // Country-aware demographic categories (SSOT). US returns multiple categories
  // (race/age/…); voter-group countries (UK/JP/DE/IE/CN/BR) return a single category.
  const categories = getDemographicCategoriesForCountry(countryId);
  const isSingleCategory = categories.length === 1;

  const [selectedCategory, setSelectedCategory] = useState<string>(
    isSingleCategory ? categories[0].key : ""
  );
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [eligibility, setEligibility] = useState<EligibilityState>({ status: "loading" });

  const refreshEligibility = useCallback(async () => {
    try {
      const res = await fetch("/api/canvassing/eligibility");
      if (!res.ok) {
        setEligibility({
          status: "blocked",
          reason: "needs_travel",
          message: "Unable to determine canvass eligibility.",
        });
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setEligibility({ status: "eligible", stateId: data.stateId, source: data.source });
      } else {
        const reason: "needs_travel" | "needs_primary_campaign" =
          data.reason === "needs_primary_campaign" ? "needs_primary_campaign" : "needs_travel";
        setEligibility({
          status: "blocked",
          reason,
          message: ELIGIBILITY_MESSAGE[reason],
        });
      }
    } catch {
      setEligibility({
        status: "blocked",
        reason: "needs_travel",
        message: "Unable to reach the server. Try again shortly.",
      });
    }
  }, []);

  useEffect(() => {
    refreshEligibility();
  }, [refreshEligibility]);

  const activeCategory = categories.find((c) => c.key === selectedCategory) ?? null;

  const hasResources = characterActions != null && characterFunds != null;
  const maxCanvasses = hasResources ? calculateMaxCanvasses(characterActions, characterFunds) : 50;

  const totalFundsCost = COST_FUNDS * count;
  const totalActionsCost = COST_ACTIONS * count;
  const canAfford =
    !hasResources || (characterActions >= totalActionsCost && characterFunds >= totalFundsCost);

  async function handleCanvass() {
    if (eligibility.status !== "eligible") return;
    if (!selectedCategory || !selectedGroup) return;

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/canvassing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateId: eligibility.stateId,
          category: selectedCategory,
          group: selectedGroup,
          count,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        const prefix = data.count > 1 ? `Canvassed ${data.count}x` : "Canvassed";
        setMessage(`${prefix}: ${data.message}`);
        if (data.effect) {
          setMessage(
            (prev) =>
              `${prev}\nTotal boost: ${data.effect.boost}% (New modifier: ${data.effect.newModifier}%)`
          );
        }
        setSelectedGroup("");
        if (!isSingleCategory) setSelectedCategory("");
        setCount(1);
        onResourcesSpent?.();
      } else {
        setMessage(`Error: ${data.error}`);
        if (
          data.error === ELIGIBILITY_MESSAGE.needs_travel ||
          data.error === ELIGIBILITY_MESSAGE.needs_primary_campaign ||
          data.error === "You can only canvass in your active campaign state"
        ) {
          refreshEligibility();
        }
      }
    } catch (error) {
      setMessage("Error: Failed to canvass. Please try again.");
      console.error("Canvassing error:", error);
    } finally {
      setLoading(false);
    }
  }

  const QUANTITY_OPTIONS = [1, 5, 10];

  if (eligibility.status === "loading") {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6">
        <h3 className="text-xl font-bold text-foreground mb-4">Voter Canvassing</h3>
        <div className="min-h-[360px] space-y-4">
          <Skeleton className="h-4 w-3/4" />
          {[1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 w-14 rounded-md" />
              ))}
            </div>
          </div>
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      </div>
    );
  }

  if (eligibility.status === "blocked") {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6">
        <h3 className="text-xl font-bold text-foreground mb-4">Voter Canvassing</h3>
        <p className="text-sm text-muted">{eligibility.message}</p>
      </div>
    );
  }

  const activeStateId = eligibility.stateId;
  const description = SOURCE_DESCRIPTION[eligibility.source](isSingleCategory);

  return (
    <div className="rounded-lg border border-card-border bg-card p-6">
      <h3 className="text-xl font-bold text-foreground mb-4">Voter Canvassing</h3>
      <p className="text-sm text-muted mb-4">
        Canvassing in <span className="font-semibold text-foreground">{activeStateId}</span>.{" "}
        {description}
      </p>

      <div className="space-y-4">
        {/* Category selector — only for multi-category countries (US). */}
        {!isSingleCategory && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Demographic Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setSelectedGroup("");
              }}
              className="w-full rounded-md border border-card-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select category...</option>
              {categories.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Group selector. */}
        {activeCategory && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {isSingleCategory ? "Voter Group" : "Specific Group"}
            </label>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="w-full rounded-md border border-card-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select group...</option>
              {activeCategory.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                  {DE_GROUP_EN_LABELS[group.id] ? ` (${DE_GROUP_EN_LABELS[group.id]})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Quantity selector */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Quantity</label>
          <div className="flex gap-2">
            {QUANTITY_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                disabled={n > maxCanvasses}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  count === n
                    ? "bg-primary text-white"
                    : n > maxCanvasses
                      ? "bg-muted/20 text-muted cursor-not-allowed"
                      : "bg-card-muted text-foreground hover:bg-primary/20"
                }`}
              >
                {n}x
              </button>
            ))}
            <button
              onClick={() => setCount(maxCanvasses)}
              disabled={maxCanvasses < 1}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                count === maxCanvasses && !QUANTITY_OPTIONS.includes(maxCanvasses)
                  ? "bg-primary text-white"
                  : maxCanvasses < 1
                    ? "bg-muted/20 text-muted cursor-not-allowed"
                    : "bg-card-muted text-foreground hover:bg-primary/20"
              }`}
            >
              Max ({maxCanvasses})
            </button>
          </div>
          <div className="mt-2 text-xs text-muted">
            Total cost: {totalActionsCost} action{totalActionsCost !== 1 ? "s" : ""},{" "}
            {formatFull(totalFundsCost)}
          </div>
        </div>

        {/* Canvass button */}
        <button
          onClick={handleCanvass}
          disabled={!selectedGroup || loading || !canAfford}
          className="w-full bg-primary hover:bg-primary-dark disabled:bg-muted/50 text-white font-medium py-3 px-4 rounded-md transition-colors disabled:cursor-not-allowed"
        >
          {loading
            ? "Canvassing..."
            : `Canvass Voters${count > 1 ? ` (${count}x)` : ""} — ${totalActionsCost} action${totalActionsCost !== 1 ? "s" : ""}, ${formatFull(totalFundsCost)}`}
        </button>

        {/* Message */}
        {message && (
          <div className="rounded-md bg-card-muted p-3 text-sm text-foreground whitespace-pre-line">
            {message}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-md bg-info/10 p-4">
        <p className="text-sm text-foreground">
          <strong>How Canvassing Works:</strong>
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted">
          <li>Effectiveness scales with your alignment to the demographic</li>
          <li>2x more effective during active campaign season (4 turns before election)</li>
          <li>Boosts turnout for this demographic in {activeStateId}</li>
          <li>Modifiers decay 2% per turn toward baseline</li>
          <li>Diminishing returns apply — each successive canvass is slightly less effective</li>
        </ul>
      </div>
    </div>
  );
}
