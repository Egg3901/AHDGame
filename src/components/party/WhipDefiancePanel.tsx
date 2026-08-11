"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import type { WhipDefianceItem, WhipDefianceSnapshot } from "@/lib/partyWhips/whipDefiance";

function formatIssuedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function roleLabel(role: string) {
  switch (role) {
    case "chair":
      return "Chair";
    case "viceChair":
      return "Vice Chair";
    default:
      return "Admin";
  }
}

function toneForMode(mode: "soft" | "hard") {
  return mode === "hard" ? "error" : "warning";
}

function DefianceRow({ item }: { item: WhipDefianceItem }) {
  return (
    <div className="rounded-lg border border-card-border bg-card-muted/50 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={item.voterHref}
              className="text-sm font-semibold text-foreground hover:text-primary"
            >
              {item.voterName}
            </Link>
            <Badge color={toneForMode(item.mode)}>{item.mode === "hard" ? "Hard" : "Soft"}</Badge>
            <Badge color="secondary">{item.chamber}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{item.targetLabel}</p>
          <p className="mt-1 text-xs text-muted">
            Wanted {item.whipDirection.toUpperCase()} · Current {item.currentVoteLabel} · Issued by{" "}
            {roleLabel(item.issuerRole)}
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          {item.voterState ? <p>{item.voterState}</p> : null}
          {item.voterOffice ? <p>{item.voterOffice}</p> : null}
          <p className="mt-1">{formatIssuedAt(item.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}

export function WhipDefiancePanel({ defianceUrl }: { defianceUrl: string }) {
  const [data, setData] = useState<WhipDefianceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<"players" | "npps">("players");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(defianceUrl, { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Failed to load whip defiance");
        }
        const body = (await response.json()) as WhipDefianceSnapshot;
        if (!cancelled) {
          setData(body);
          if (body.playerCount === 0 && body.nppCount > 0) {
            setAudience("npps");
          }
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error ? fetchError.message : "Failed to load whip defiance"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [defianceUrl]);

  const activeItems = useMemo<WhipDefianceItem[]>(() => {
    if (!data) return [];
    return audience === "players" ? data.players : data.npps;
  }, [audience, data]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-card-border bg-card px-4 py-3">
        <p className="text-sm text-muted">
          Active defiance only appears here. If a player or NPP changes their vote back into line,
          the row clears automatically.
        </p>
      </div>

      {loading ? (
        <div className="rounded-lg border border-card-border bg-card p-4 text-sm text-muted">
          Loading active defiance...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-body-sm text-muted">Active Defiance</p>
              <p className="mt-2 text-heading-sm font-bold tabular-nums text-foreground">
                {data.activeCount}
              </p>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-body-sm text-muted">Players Defying</p>
              <p className="mt-2 text-heading-sm font-bold tabular-nums text-warning">
                {data.playerCount}
              </p>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-4">
              <p className="text-body-sm text-muted">NPPs Defying</p>
              <p className="mt-2 text-heading-sm font-bold tabular-nums text-error">
                {data.nppCount}
              </p>
            </div>
          </div>

          <div
            role="tablist"
            className="flex gap-1 w-fit rounded-lg border border-card-border bg-background p-1"
          >
            {(
              [
                { key: "players", label: `Players (${data.playerCount})` },
                { key: "npps", label: `NPPs (${data.nppCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={audience === tab.key}
                onClick={() => setAudience(tab.key)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  audience === tab.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {activeItems.length === 0 ? (
              <div className="rounded-lg border border-card-border bg-card p-4 text-sm text-muted">
                No active {audience === "players" ? "player" : "NPP"} defiance right now.
              </div>
            ) : (
              activeItems.map((item) => (
                <DefianceRow key={`${item.whipId}:${item.voterId}`} item={item} />
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
