"use client";

import { useState } from "react";
import { buildSquareCells, netLeanIndicator, POOL_COLORS } from "@/lib/redistricting/cardView";
import type { DistrictSquareView } from "@/lib/redistricting/districtSquareResponse";
import { DistrictLeanBar } from "./DistrictLeanBar";

export interface CampaignContext {
  countryId: string;
  stateId: string;
  partySeqId: string;
}

export function DistrictCard({
  district,
  campaign,
}: {
  district: DistrictSquareView;
  campaign?: CampaignContext;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);

  async function campaignHere() {
    if (!campaign) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/country/${campaign.countryId.toLowerCase()}/region/${campaign.stateId.toLowerCase()}/party/${campaign.partySeqId}/campaign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ districtIndex: district.index }),
        }
      );
      const data = await res.json();
      setMsg(res.ok ? `Boost ${Number(data.boost).toFixed(1)}%` : (data.error ?? "Failed"));
    } catch {
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  const { squares } = district;
  const lean = netLeanIndicator(district.netLean);
  const composition = `${squares.left} left, ${squares.grey} grey, ${squares.right} right`;

  return (
    <div
      className="rounded-lg border border-card-border bg-card overflow-hidden"
      style={{ borderLeftWidth: 3, borderLeftColor: lean.color }}
      aria-label={`${district.cd}: ${composition}, ${
        district.netLean === 0
          ? "even"
          : `net lean ${district.netLean < 0 ? "left" : "right"} ${Math.abs(district.netLean)}`
      }`}
    >
      {/* Header: district name + prominent lean indicator */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-card-border/60 bg-card-muted/30">
        <span className="text-xs font-semibold">{district.cd}</span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
          style={{ backgroundColor: `${lean.color}22`, color: lean.color }}
        >
          {lean.text}
        </span>
      </div>

      {/* Primary: stacked composition bar */}
      <div className="px-3 py-3 space-y-2">
        <DistrictLeanBar squares={squares} />

        <button
          type="button"
          onClick={() => setShowGrid((s) => !s)}
          className="text-[10px] text-muted hover:text-foreground"
          aria-expanded={showGrid}
        >
          {showGrid ? "Hide grid" : "Show grid"}
        </button>

        {showGrid && (
          <div className="grid grid-cols-8 gap-1" aria-hidden="true">
            {buildSquareCells(squares).map((cell, i) => (
              <div
                key={i}
                className="aspect-square rounded-sm"
                style={{ backgroundColor: POOL_COLORS[cell] }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Holder footer */}
      <div className="px-3 py-2 border-t border-card-border/60 text-xs text-muted flex items-center">
        {district.holderName ? (
          <span>
            <span className="text-foreground font-medium">{district.holderName}</span>
            {district.holderParty ? ` · ${district.holderParty}` : ""}
          </span>
        ) : (
          <span className="italic">Awaiting results</span>
        )}
        {campaign && (
          <button
            type="button"
            onClick={campaignHere}
            disabled={busy}
            className="ml-2 rounded border border-card-border px-2 py-0.5 text-[10px] hover:border-primary disabled:opacity-40"
          >
            {busy ? "…" : "Campaign Here"}
          </button>
        )}
        {msg && <span className="ml-2 text-[10px] text-muted">{msg}</span>}
      </div>
    </div>
  );
}
