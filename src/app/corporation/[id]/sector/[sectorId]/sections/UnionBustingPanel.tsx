"use client";

import { useState } from "react";
import {
  BUSTING_BACKFIRE_UNIONIZATION_SPIKE,
  BUSTING_COOLDOWN_TURNS,
  BUSTING_SUCCESS_UNIONIZATION_DROP,
  calculateUnionBustingSuccessChance,
  unionBustingCashCost,
} from "@/lib/labour/unionBusting";
import type { SectorData } from "../types";

interface UnionBustingPanelProps {
  sector: SectorData;
  isCeo: boolean;
  corpId: string;
  sectorId: string;
  /** Called after a busting attempt resolves, to refetch the sector (unionization/cooldown may have changed). */
  onBusted: () => void;
}

/**
 * v3 Phase 7a (code-review fix #4): union-busting had a fully-built backend
 * (command, route, tests) but no UI anywhere in the app — a CEO could only
 * use it via a hand-crafted authenticated request. This is the first real
 * UI surface for it, modeled on WageLevelPanel.tsx's shape.
 */
export default function UnionBustingPanel({
  sector,
  isCeo,
  corpId,
  sectorId,
  onBusted,
}: UnionBustingPanelProps) {
  const [busting, setBusting] = useState(false);
  const [message, setMessage] = useState("");
  // Track success explicitly instead of parsing the message string, so copy
  // changes can never flip the colour to the wrong state.
  const [succeeded, setSucceeded] = useState<boolean | null>(null);

  const unionization = sector.unionization ?? 0;
  const inCooldown = sector.bustingCooldownUntilTurn != null && sector.bustingCooldownUntilTurn > 0;

  // Client-side estimates so the CEO sees the odds and the price BEFORE spending.
  // These mirror the server formulae exactly (same pure helpers).
  const successChance = calculateUnionBustingSuccessChance(unionization).finalChance;
  const estCost = unionBustingCashCost(sector.revenue ?? 0);

  async function handleBust() {
    setBusting(true);
    setMessage("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/union-busting`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setSucceeded(!!data.bustingSucceeded);
        setMessage(
          data.bustingSucceeded
            ? `It worked. Unionization fell to ${data.unionization.toFixed(1)}%.`
            : `It backfired. Unionization climbed to ${data.unionization.toFixed(1)}%.`
        );
        onBusted();
      } else {
        setSucceeded(false);
        setMessage(data.error ?? "Failed to attempt union-busting");
      }
    } catch {
      setSucceeded(false);
      setMessage("Network error");
    } finally {
      setBusting(false);
    }
  }

  if (!isCeo) return null;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="mb-1 text-lg font-bold text-foreground">Union-Busting</h2>
      <p className="text-xs text-muted mb-4">
        Spend cash to try to break this sector&apos;s organizing drive. It is a gamble: succeed and
        unionization drops by about {BUSTING_SUCCESS_UNIONIZATION_DROP} points; fail and it{" "}
        <span className="text-error">rises</span> by about {BUSTING_BACKFIRE_UNIONIZATION_SPIKE}{" "}
        points instead. Either outcome locks the sector out of another attempt for{" "}
        {BUSTING_COOLDOWN_TURNS} turns.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4">
        <span
          className="text-xs text-muted"
          title="How organized this sector's workers are, 0-100%. Higher unionization is harder to break."
        >
          Unionization:{" "}
          <span className="text-foreground font-medium">{unionization.toFixed(1)}%</span>
        </span>
        <span
          className="text-xs text-muted"
          title="Estimated chance this attempt succeeds. Falls as unionization rises."
        >
          Est. success:{" "}
          <span className="text-foreground font-medium">{Math.round(successChance)}%</span>
        </span>
        <span
          className="text-xs text-muted"
          title="Estimated up-front cash cost, scaling with the sector's daily revenue (minimum applies)."
        >
          Est. cost:{" "}
          <span className="text-foreground font-medium">
            ~{Math.round(estCost).toLocaleString("en-US")}
          </span>
        </span>
        {sector.strikeActive && (
          <span className="rounded-md bg-error/15 px-2 py-0.5 text-xs font-medium text-error">
            Sector is currently striking
          </span>
        )}
        {inCooldown && (
          <span
            className="rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning"
            title="You recently attempted a bust here. You must wait until this turn before trying again."
          >
            On cooldown until turn {sector.bustingCooldownUntilTurn}
          </span>
        )}
      </div>
      <button
        onClick={handleBust}
        disabled={busting || inCooldown}
        className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 transition-colors disabled:opacity-50"
      >
        {busting ? "Attempting…" : "Bust the Union"}
      </button>
      {message && (
        <p className={`mt-2 text-xs font-medium ${succeeded ? "text-success" : "text-error"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
