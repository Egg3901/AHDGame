"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiErrorText } from "@/lib/errors/catalog";
import { fetchJson } from "@/lib/observability/fetchJson";
import { formatStatePresenceCost, statePresenceNextCost } from "@/lib/campaigns/statePresenceCost";
import { BLEND, BLEND_LABEL, FONT } from "@/components/blend/tokens";

interface PresenceRow {
  stateId: string;
  level: number;
  nextCost: number;
  builtThisTurn?: boolean;
}

export interface MyCampaign {
  campaignId: string | null;
  color: string;
  /** Campaign Presence level per state. */
  levels: Record<string, number>;
  rows: Record<string, PresenceRow>;
  canBuild: boolean;
  busy: string | null;
  error: string | null;
  build: (stateId: string) => Promise<void>;
}

/**
 * The reader's own presidential campaign, for the map: Campaign Presence by
 * state and the action to build it, from the same routes the Political
 * Operations tab uses. Null when the reader is not running in this race.
 */
export function useMyCampaign(args: {
  enabled: boolean;
  campaignId: string | null;
  color: string;
}): MyCampaign | null {
  const { enabled, campaignId, color } = args;
  const [rows, setRows] = useState<Record<string, PresenceRow>>({});
  const [canBuild, setCanBuild] = useState(false);
  const [fxRate, setFxRate] = useState<number>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchJson<{ canBuild?: boolean; fxRate?: number; states?: PresenceRow[] }>(
      "/api/political-operations/state-org/list",
      { signal: controller.signal, feature: "presidential-map-presence" }
    )
      .then((body) => {
        setCanBuild(Boolean(body.canBuild));
        if (typeof body.fxRate === "number") setFxRate(body.fxRate);
        setRows(Object.fromEntries((body.states ?? []).map((r) => [r.stateId, r])));
      })
      .catch((err: unknown) => {
        // fetchJson reports the failure; the map just shows no presence layer.
        if ((err as { name?: string }).name !== "AbortError")
          setError("Could not load your campaign.");
      });
    return () => controller.abort();
  }, [enabled]);

  const build = useCallback(
    async (stateId: string) => {
      setBusy(stateId);
      setError(null);
      try {
        const res = await fetch("/api/political-operations/state-org/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stateId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(apiErrorText(body, "Build failed"));
          return;
        }
        setRows((cur) => ({
          ...cur,
          [stateId]: {
            stateId,
            level: body.level,
            builtThisTurn: true,
            nextCost: statePresenceNextCost(body.level, fxRate),
          },
        }));
      } catch {
        setError("Network error. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [fxRate]
  );

  if (!enabled) return null;
  return {
    campaignId,
    color,
    levels: Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.level])),
    rows,
    canBuild,
    busy,
    error,
    build,
  };
}

/** "Your campaign here": presence in this state, building it, and a field office. */
export function MyCampaignStateBlock({ mine, stateId }: { mine: MyCampaign; stateId: string }) {
  const row = mine.rows[stateId];
  const level = row?.level ?? 0;
  return (
    <section
      style={{
        marginTop: 16,
        padding: 12,
        border: `1px solid ${BLEND.hairlineStrong}`,
        background: BLEND.inset,
      }}
    >
      <div style={BLEND_LABEL}>Your campaign here</div>
      <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 22, fontWeight: 600, color: mine.color }}>
          {level}
        </span>
        <span style={{ fontSize: 12.5, color: BLEND.muted }}>Campaign Presence level</span>
      </div>
      {mine.canBuild && row ? (
        <button
          type="button"
          disabled={mine.busy === stateId || row.builtThisTurn}
          onClick={() => void mine.build(stateId)}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "8px 10px",
            cursor: mine.busy === stateId || row.builtThisTurn ? "not-allowed" : "pointer",
            font: "inherit",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: BLEND.accent,
            border: "none",
            opacity: row.builtThisTurn ? 0.5 : 1,
          }}
        >
          {mine.busy === stateId
            ? "Building..."
            : row.builtThisTurn
              ? "Built this turn"
              : `Build presence to level ${level + 1} (${formatStatePresenceCost(row.nextCost)})`}
        </button>
      ) : null}
      {mine.error ? (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 12.5, color: BLEND.negative }}>
          {mine.error}
        </p>
      ) : null}
      {mine.campaignId ? (
        <Link
          href={`/campaign/${mine.campaignId}?tab=field&region=${stateId}`}
          className="hover:underline"
          style={{
            marginTop: 10,
            display: "block",
            fontSize: 13,
            color: BLEND.accentInk,
            textDecoration: "none",
          }}
        >
          Open a field office in this state
        </Link>
      ) : null}
    </section>
  );
}
