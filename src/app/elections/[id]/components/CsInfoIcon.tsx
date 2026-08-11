"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Skeleton } from "@/components/ui";

interface CSTooltipData {
  currentCS: number;
  pullbackPerTurn: number;
  pullbackMaxPerTurn?: number;
  changeThisTurn: number;
  topContributors: Array<{
    characterName: string;
    totalAdded: number;
    party: { id: string; name: string; abbr: string; color: string };
  }>;
}

export function CsInfoIcon({ campaignId }: { campaignId: string | undefined | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CSTooltipData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  const handleToggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    // Fetch on click, not in effect
    if (!campaignId || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError("");
    fetch(`/api/campaigns/${campaignId}/campaign-strength/detail`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(j.error);
          setData(null);
        } else {
          setData(j);
        }
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [open, campaignId]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        cardRef.current &&
        !cardRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!campaignId) return null;

  return (
    <>
      <span
        ref={ref}
        onClick={handleToggle}
        className="inline-flex items-center justify-center ml-0.5 h-3.5 w-3.5 rounded-full bg-muted/30 text-muted hover:bg-muted/50 hover:text-foreground cursor-help transition-colors align-middle text-[10px] leading-none font-bold"
        style={{ lineHeight: "14px" }}
      >
        i
      </span>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={cardRef}
            className="fixed z-50 w-80 rounded-xl border border-card-border bg-card shadow-2xl p-4 text-xs"
            style={{
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            {loading ? (
              <div className="min-h-[160px] space-y-3">
                <div className="flex items-center justify-between border-b border-card-border pb-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-5 w-14" />
                </div>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-error text-center py-4">{error}</div>
            ) : data ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-card-border pb-2">
                  <div className="font-semibold text-foreground">Campaign Strength</div>
                  <div className="text-lg font-bold tabular-nums text-primary">
                    {data.currentCS.toFixed(0)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-background p-2.5">
                    <div className="text-muted mb-0.5">Change (this turn)</div>
                    <div
                      className={`font-semibold tabular-nums ${data.changeThisTurn > 0 ? "text-green-400" : data.changeThisTurn < 0 ? "text-red-400" : "text-muted"}`}
                    >
                      {data.changeThisTurn > 0 ? "+" : ""}
                      {data.changeThisTurn.toFixed(1)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-background p-2.5">
                    <div className="text-muted mb-0.5">Leader pullback</div>
                    <div className="font-semibold tabular-nums text-red-400">
                      −{data.pullbackPerTurn.toFixed(1)}/turn
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-muted font-medium mb-1.5">Top Contributors</div>
                  <div className="space-y-1.5">
                    {data.topContributors.length === 0 ? (
                      <div className="text-muted/60 italic">No contributions yet</div>
                    ) : (
                      data.topContributors.map((c, i) => (
                        <div
                          key={c.characterName + i}
                          className="flex items-center justify-between rounded-lg bg-background/50 px-2.5 py-1.5"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: c.party.color }}
                              title={c.party.name}
                            />
                            <span className="truncate text-foreground font-medium">
                              {c.characterName}
                            </span>
                          </div>
                          <span className="tabular-nums text-primary font-semibold shrink-0 ml-2">
                            +{c.totalAdded.toFixed(1)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="text-[10px] text-muted/60 border-t border-card-border pt-2 leading-relaxed">
                  <div>
                    CS boosts vote gain in primaries and generals (diminishing returns after ~50K).
                  </div>
                  <div className="mt-0.5">
                    Leader pullback: −{data.pullbackPerTurn.toFixed(1)}/turn
                    {data.pullbackMaxPerTurn != null ? ` (max −${data.pullbackMaxPerTurn})` : ""}.
                  </div>
                  <div className="mt-0.5">Contribute via the Support button.</div>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
