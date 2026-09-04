"use client";

import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { getDemographicCategoriesForCountry } from "@/lib/demographics/countryDemographics";
import { DE_GROUP_EN_LABELS } from "@/lib/seeds/de/deDemographicCategories";
import { BLEND, FONT } from "@/components/blend/tokens";
import { blendButtonStyle, BlendLabel, BlendSelect } from "@/components/blend/BlendControls";

const COST_FUNDS = 100;
const COST_ACTIONS = 1;

interface CanvassingPanelProps {
  countryId?: string;
  characterActions?: number;
  characterFunds?: number;
  onResourcesSpent?: () => void;
  /**
   * "blend" renders the panel in the Proposal D treatment used by the campaign
   * manager. The standalone /actions/canvass page keeps the default card.
   */
  variant?: "default" | "blend";
}

type CanvassSource = "home" | "travel" | "primaryCampaign" | "runningMateSurrogate";

type EligibilityState =
  | { status: "loading" }
  | { status: "eligible"; stateId: string; source: CanvassSource }
  | { status: "blocked"; reason: "needs_travel" | "needs_primary_campaign"; message: string };

// Mirrors CANVASS_ELIGIBILITY_MESSAGE in src/lib/canvassing/eligibility.ts.
// Duplicated here so the client bundle does not import the server-only resolver.
const ELIGIBILITY_MESSAGE: Record<"needs_travel" | "needs_primary_campaign", string> = {
  needs_travel: "Travel to a state to canvass voters there",
  needs_primary_campaign: "Set your primary campaign state to canvass voters there",
};

const SOURCE_DESCRIPTION: Record<CanvassSource, (isRegionBased: boolean) => string> = {
  home: (isRegionBased) =>
    `Boost turnout for specific demographics in your home ${isRegionBased ? "region" : "state"}.`,
  travel: () => "Boost turnout for specific demographics in your travel state.",
  primaryCampaign: () => "Boost turnout for specific demographics in your primary campaign state.",
  runningMateSurrogate: () =>
    "Boost turnout for the ticket in the state you are campaigning in as running mate. Spends a shared surrogate action.",
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
  variant = "default",
}: CanvassingPanelProps) {
  const { formatFull } = useCurrency();
  const blend = variant === "blend";

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

  // ── Shell + heading, per variant ──────────────────────────────────────────
  const shellStyle: React.CSSProperties | undefined = blend ? { marginBottom: 0 } : undefined;
  const shellClass = blend ? "" : "rounded-lg border border-card-border bg-card p-6";

  const heading = blend ? (
    <h3 style={{ margin: "0 0 8px", fontFamily: FONT.serif, fontSize: 17, fontWeight: 600 }}>
      Voter canvassing
    </h3>
  ) : (
    <h3 className="text-xl font-bold text-foreground mb-4">Voter Canvassing</h3>
  );

  if (eligibility.status === "loading") {
    return (
      <div className={shellClass} style={shellStyle}>
        {heading}
        <div className="min-h-[360px] space-y-4">
          <Skeleton className="h-4 w-3/4" />
          {[1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      </div>
    );
  }

  if (eligibility.status === "blocked") {
    return (
      <div className={shellClass} style={shellStyle}>
        {heading}
        {blend ? (
          <p style={{ margin: 0, fontFamily: FONT.serif, fontSize: 13.5, color: BLEND.muted }}>
            {eligibility.message}
          </p>
        ) : (
          <p className="text-sm text-muted">{eligibility.message}</p>
        )}
      </div>
    );
  }

  const activeStateId = eligibility.stateId;
  const description = SOURCE_DESCRIPTION[eligibility.source](isSingleCategory);
  const costSuffix = `${totalActionsCost} action${totalActionsCost !== 1 ? "s" : ""}, ${formatFull(totalFundsCost)}`;

  function quantityStyle(active: boolean, enabled: boolean): React.CSSProperties {
    return {
      border: `1px solid ${active ? BLEND.accent : BLEND.hairlineStrong}`,
      background: active ? "rgba(220,38,38,.12)" : "transparent",
      color: !enabled ? BLEND.mutedDimmer : active ? BLEND.accentInk : BLEND.ink,
      padding: "7px 13px",
      font: "inherit",
      fontFamily: FONT.mono,
      fontSize: 12,
      fontWeight: 600,
      cursor: enabled ? "pointer" : "not-allowed",
    };
  }

  if (blend) {
    return (
      <div style={shellStyle}>
        {heading}
        <p
          style={{
            margin: "0 0 14px",
            fontFamily: FONT.serif,
            fontSize: 13.5,
            lineHeight: 1.55,
            color: BLEND.muted,
          }}
        >
          Canvassing in <span style={{ color: BLEND.ink, fontWeight: 600 }}>{activeStateId}</span>.{" "}
          {description}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 460 }}>
          {!isSingleCategory && (
            <div>
              <BlendLabel>Demographic category</BlendLabel>
              <div style={{ marginTop: 6 }}>
                <BlendSelect
                  value={selectedCategory}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value);
                    setSelectedGroup("");
                  }}
                >
                  <option value="">Select category…</option>
                  {categories.map((cat) => (
                    <option key={cat.key} value={cat.key}>
                      {cat.label}
                    </option>
                  ))}
                </BlendSelect>
              </div>
            </div>
          )}

          {activeCategory && (
            <div>
              <BlendLabel>{isSingleCategory ? "Voter group" : "Specific group"}</BlendLabel>
              <div style={{ marginTop: 6 }}>
                <BlendSelect
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                >
                  <option value="">Select group…</option>
                  {activeCategory.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                      {DE_GROUP_EN_LABELS[group.id] ? ` (${DE_GROUP_EN_LABELS[group.id]})` : ""}
                    </option>
                  ))}
                </BlendSelect>
              </div>
            </div>
          )}

          <div>
            <BlendLabel>Quantity</BlendLabel>
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {QUANTITY_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  disabled={n > maxCanvasses}
                  style={quantityStyle(count === n, n <= maxCanvasses)}
                >
                  {n}x
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCount(maxCanvasses)}
                disabled={maxCanvasses < 1}
                style={quantityStyle(
                  count === maxCanvasses && !QUANTITY_OPTIONS.includes(maxCanvasses),
                  maxCanvasses >= 1
                )}
              >
                Max ({maxCanvasses})
              </button>
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: FONT.mono,
                fontSize: 10.5,
                color: BLEND.mutedDim,
              }}
            >
              TOTAL COST: {costSuffix}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCanvass}
            disabled={!selectedGroup || loading || !canAfford}
            style={blendButtonStyle("primary", !!selectedGroup && !loading && canAfford, true)}
          >
            {loading
              ? "Canvassing"
              : `Canvass voters${count > 1 ? ` (${count}x)` : ""} · ${costSuffix}`}
          </button>

          {message && (
            <div
              style={{
                padding: "11px 14px",
                borderLeft: `2px solid ${BLEND.hairlineStrong}`,
                background: "rgba(255,255,255,.02)",
                fontFamily: FONT.serif,
                fontSize: 13,
                lineHeight: 1.55,
                color: BLEND.ink,
                whiteSpace: "pre-line",
              }}
            >
              {message}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: `1px solid ${BLEND.hairline}`,
          }}
        >
          <div
            style={{
              fontFamily: FONT.mono,
              fontSize: 9.5,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: BLEND.mutedDimmer,
            }}
          >
            How canvassing works
          </div>
          <ul
            style={{
              margin: "8px 0 0",
              paddingLeft: 18,
              fontFamily: FONT.serif,
              fontSize: 13,
              lineHeight: 1.6,
              color: BLEND.muted,
            }}
          >
            <li>Effectiveness scales with your alignment to the demographic</li>
            <li>
              Twice as effective during active campaign season, the 4 turns before an election
            </li>
            <li>Boosts turnout for this demographic in {activeStateId}</li>
            <li>Modifiers decay 2% per turn toward baseline</li>
            <li>
              Diminishing returns apply, so each successive canvass is slightly less effective
            </li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {heading}
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
          <div className="mt-2 text-xs text-muted">Total cost: {costSuffix}</div>
        </div>

        {/* Canvass button */}
        <button
          onClick={handleCanvass}
          disabled={!selectedGroup || loading || !canAfford}
          className="w-full bg-primary hover:bg-primary-dark disabled:bg-muted/50 text-white font-medium py-3 px-4 rounded-md transition-colors disabled:cursor-not-allowed"
        >
          {loading
            ? "Canvassing..."
            : `Canvass Voters${count > 1 ? ` (${count}x)` : ""} · ${costSuffix}`}
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
          <li>Diminishing returns apply, so each successive canvass is slightly less effective</li>
        </ul>
      </div>
    </div>
  );
}
