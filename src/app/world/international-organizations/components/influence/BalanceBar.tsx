"use client";

import { useState } from "react";
import { formatShare } from "@/lib/alignment/normalize";
import { POLE_TEXT, ShareBar } from "@/components/alignment/ShareBar";
import type { OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";

type Weighting = "economy" | "nations";

/**
 * The world's standing, as one bar.
 *
 * Two readings ship rather than one being chosen for the player: a bloc can
 * hold most of the map and little of the money, and the gap between those two
 * numbers is itself the story. The caption names which population is being
 * described, because the counts differ whenever a nation has no GDP on record.
 */
export function BalanceBar({ view }: { view: OrgInfluenceView }) {
  const [weighting, setWeighting] = useState<Weighting>("economy");

  // No rows is "no data", not "the world is non-aligned" — so draw nothing.
  if (!view.balance) return null;
  const balance = view.balance;

  const active = weighting === "economy" ? balance.byEconomy : balance.byNations;
  const caption =
    weighting === "economy"
      ? `${balance.economyCount} of ${balance.nationCount} priced`
      : `${balance.nationCount} nations`;

  return (
    <section
      data-testid="balance-bar"
      className="space-y-2 rounded-lg border border-card-border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-foreground">World standing</h3>
        <div className="flex gap-1">
          {(["economy", "nations"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeighting(w)}
              aria-pressed={weighting === w}
              className={`rounded px-2 py-1 text-body-xs transition-colors ${
                weighting === w
                  ? "bg-card-muted text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {w === "economy" ? "by economy" : "by nations"}
            </button>
          ))}
        </div>
      </div>

      <ShareBar
        poles={view.poles}
        shares={active.shares}
        nonAligned={active.nonAligned}
        remainderLabel={view.remainderLabel}
        size="lead"
      />

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body-xs">
        {view.poles.map((p) => (
          <span key={p.id} className={`font-mono tabular-nums ${POLE_TEXT[p.accentToken]}`}>
            {p.label} {formatShare(active.shares[p.id] ?? 0)}
          </span>
        ))}
        <span className="font-mono tabular-nums text-muted">
          {view.remainderLabel} {formatShare(active.nonAligned)}
        </span>
        <span className="ml-auto text-muted">{caption}</span>
      </div>

      {view.channel && (
        <p className="text-body-xs text-muted">
          Plays through this channel pull a nation toward {view.channel.poleLabel}. Whatever no bloc
          persuades stays {view.remainderLabel.toLowerCase()}.
        </p>
      )}
    </section>
  );
}
