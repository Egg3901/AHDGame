"use client";

import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { CountryId } from "@/lib/constants/countries";
import type { BillWhipPanelData } from "@/lib/congress/billWhipPanelData";
import { partyApiUrl, partyUrl } from "@/lib/urls";

interface BillWhipPanelProps {
  billId: string;
  countryId: CountryId;
  status: string;
  whipPanel: BillWhipPanelData | null;
  onWhipIssued: () => Promise<void> | void;
}

type WhipAudience = "character" | "npp";

const ACTIONABLE_STATUSES = new Set([
  "active",
  "active_other",
  "active_both",
  "veto_override",
  "override_shugiin",
]);

function summarizeWhips(
  existingWhips: Array<{ direction: string; attemptNumber: number; issuedByRole?: string }>
): string {
  return existingWhips
    .slice()
    .sort((left, right) => left.attemptNumber - right.attemptNumber)
    .map((whip) =>
      whip.issuedByRole
        ? `${whip.direction.toUpperCase()} by ${whip.issuedByRole}`
        : whip.direction.toUpperCase()
    )
    .join(", ");
}

export function BillWhipPanel({
  billId,
  countryId,
  status,
  whipPanel,
  onWhipIssued,
}: BillWhipPanelProps) {
  const { showToast } = useToast();
  const [audience, setAudience] = useState<WhipAudience>("character");
  const [whippingId, setWhippingId] = useState<string | null>(null);

  const postBillWhip = async (
    chamberKey: string,
    direction: "for" | "against",
    targetAudience: WhipAudience
  ) => {
    if (!whipPanel) return;

    const busyKey = `${targetAudience}:${chamberKey}:${direction}`;
    setWhippingId(busyKey);

    try {
      const res = await fetch(`${partyApiUrl(countryId, whipPanel.party.id)}/whip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: targetAudience,
          targetType: "bill",
          targetId: billId,
          chamber: chamberKey,
          direction,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to issue whip", "error");
        return;
      }

      showToast(data.message, "success");
      await onWhipIssued();
    } catch {
      showToast("Network error", "error");
    } finally {
      setWhippingId(null);
    }
  };

  if (!ACTIONABLE_STATUSES.has(status) || !whipPanel || whipPanel.chambers.length === 0) {
    return null;
  }

  const maxAttempts = audience === "character" ? 1 : 2;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Whip Panel</h3>
          <p className="text-xs text-muted">
            Issue party whips for this bill here or from the party page. Both stay in sync.
          </p>
        </div>
        <Link
          href={partyUrl(countryId, whipPanel.party.id)}
          className="rounded-full border border-card-border px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          {whipPanel.party.name}
        </Link>
      </div>

      <div
        role="tablist"
        className="flex gap-1 rounded-lg border border-card-border bg-background p-1 w-fit"
      >
        <button
          type="button"
          role="tab"
          aria-selected={audience === "character"}
          onClick={() => setAudience("character")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            audience === "character"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          Player Whip
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={audience === "npp"}
          onClick={() => setAudience("npp")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            audience === "npp"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          NPP Whip
        </button>
      </div>

      <div className="space-y-3">
        {whipPanel.chambers.map((chamber) => {
          const whip = audience === "character" ? chamber.playerWhip : chamber.nppWhip;
          const busyFor = `${audience}:${chamber.chamberKey}:for`;
          const busyAgainst = `${audience}:${chamber.chamberKey}:against`;
          const directionSummary = summarizeWhips(whip.existingWhips);

          return (
            <div
              key={chamber.chamberKey}
              className="rounded-lg border border-card-border bg-background p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">{chamber.chamberLabel}</div>
                  <div className="text-xs text-muted">
                    Whips issued: {whip.existingWhips.length}/{maxAttempts}
                    {directionSummary ? ` - ${directionSummary}` : " - none yet"}
                  </div>
                </div>
                {!whip.canWhip && (
                  <span className="rounded-full border border-card-border px-2 py-0.5 text-[10px] text-muted uppercase tracking-wide">
                    Limit reached
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => postBillWhip(chamber.chamberKey, "for", audience)}
                  disabled={!whip.canWhip || whippingId === busyFor || whippingId === busyAgainst}
                  title={!whip.canWhip ? "Maximum whip attempts reached" : undefined}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-primary/30 bg-primary/10 text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={
                    whip.canWhip
                      ? {
                          backgroundColor: `${whipPanel.party.color}20`,
                          borderColor: `${whipPanel.party.color}66`,
                          color: whipPanel.party.color,
                        }
                      : undefined
                  }
                >
                  {whippingId === busyFor ? "Issuing..." : "Whip FOR"}
                </button>
                <button
                  type="button"
                  onClick={() => postBillWhip(chamber.chamberKey, "against", audience)}
                  disabled={!whip.canWhip || whippingId === busyFor || whippingId === busyAgainst}
                  title={!whip.canWhip ? "Maximum whip attempts reached" : undefined}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-card-border bg-card hover:bg-card-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {whippingId === busyAgainst ? "Issuing..." : "Whip AGAINST"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
