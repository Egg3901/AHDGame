"use client";

import { useEffect, useState } from "react";
import type { ModTabId } from "./ModeratorTabsConfig";

type Severity = "high" | "medium" | "low";
type SeverityFilter = Severity | "all";
type SeverityCounts = { high: number; medium: number; low: number };

const SEVERITY_FILTERS: { id: SeverityFilter; label: string }[] = [
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
  { id: "all", label: "All" },
];

interface SuspiciousFlagSummary {
  type: string;
  severity: "low" | "medium" | "high";
  detail: string;
  detectedAt: string;
}

interface SuspiciousEntry {
  _id: string;
  characterId: string;
  characterName: string;
  userId: string;
  username: string;
  countryId: string;
  flags: SuspiciousFlagSummary[];
  flagCount: number;
  highestSeverity: "low" | "medium" | "high";
  lastUpdated: string;
  dismissed: boolean;
}

interface PendingWikiPage {
  _id: string;
  slug: string;
  title: string;
  submitterName?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ModeratorPriorityTabProps {
  onJump: (tab: ModTabId, sub?: string) => void;
}

const SEV_TONE: Record<"high" | "medium" | "low", string> = {
  high: "text-error",
  medium: "text-warning",
  low: "text-info",
};

const SEV_DOT: Record<"high" | "medium" | "low", string> = {
  high: "bg-error",
  medium: "bg-warning",
  low: "bg-info",
};

function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return "—";
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ModeratorPriorityTab({ onJump }: ModeratorPriorityTabProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("high");
  const [suspiciousLoading, setSuspiciousLoading] = useState(true);
  const [suspiciousCounts, setSuspiciousCounts] = useState<SeverityCounts>({
    high: 0,
    medium: 0,
    low: 0,
  });
  const [suspiciousEntries, setSuspiciousEntries] = useState<SuspiciousEntry[]>([]);
  const [suspiciousError, setSuspiciousError] = useState<string | null>(null);

  const [wikiLoading, setWikiLoading] = useState(true);
  const [wikiPending, setWikiPending] = useState<PendingWikiPage[]>([]);
  const [wikiError, setWikiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSuspiciousLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams({ limit: "10" });
        if (severityFilter !== "all") params.set("severity", severityFilter);
        const res = await fetch(`/api/moderator/suspicious?${params.toString()}`, {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setSuspiciousCounts(data.counts ?? { high: 0, medium: 0, low: 0 });
        setSuspiciousEntries(Array.isArray(data.entries) ? data.entries : []);
        setSuspiciousError(null);
      } catch (err) {
        if (!cancelled) setSuspiciousError(err instanceof Error ? err.message : "load failed");
      } finally {
        if (!cancelled) setSuspiciousLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [severityFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/wiki/review-queue", {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setWikiPending(Array.isArray(data.pending) ? data.pending : []);
        setWikiError(null);
      } catch (err) {
        if (!cancelled) setWikiError(err instanceof Error ? err.message : "load failed");
      } finally {
        if (!cancelled) setWikiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalSuspicious = suspiciousCounts.high + suspiciousCounts.medium + suspiciousCounts.low;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-block h-6 w-1 rounded-full bg-info" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold sm:text-lg">Priority queue</h2>
            <p className="mt-1 text-xs text-muted sm:text-sm">
              Highest-severity items pulled from existing moderation surfaces. Drill in for the full
              toolset on each tab.
            </p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <PriorityStat
          label="High-severity flags"
          value={suspiciousLoading ? "…" : suspiciousCounts.high.toLocaleString("en-US")}
          sub={
            suspiciousLoading
              ? "loading"
              : suspiciousCounts.high > 0
                ? "needs review now"
                : "queue clear"
          }
          tone={suspiciousCounts.high > 0 ? "urgent" : "ok"}
          onClick={() => onJump("players", "suspicious")}
        />
        <PriorityStat
          label="Medium flags"
          value={suspiciousLoading ? "…" : suspiciousCounts.medium.toLocaleString("en-US")}
          sub="open in suspicious"
          tone={suspiciousCounts.medium > 0 ? "warn" : "ok"}
          onClick={() => onJump("players", "suspicious")}
        />
        <PriorityStat
          label="Low flags"
          value={suspiciousLoading ? "…" : suspiciousCounts.low.toLocaleString("en-US")}
          sub="for triage"
          tone="neutral"
          onClick={() => onJump("players", "suspicious")}
        />
        <PriorityStat
          label="Wiki review queue"
          value={wikiLoading ? "…" : wikiPending.length.toLocaleString("en-US")}
          sub="pending submissions"
          tone={wikiPending.length > 0 ? "warn" : "ok"}
          onClick={() => onJump("content", "wiki-review")}
        />
      </div>

      {/* Two-column priority detail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Suspicious activity list */}
        <div className="rounded-xl border border-card-border bg-card shadow-sm lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-card-border/60 p-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Suspicious activity</h3>
              <p className="mt-0.5 text-xs text-muted">
                {totalSuspicious === 0
                  ? "No open flags."
                  : severityFilter === "all"
                    ? `Showing top ${Math.min(suspiciousEntries.length, 10)} of ${totalSuspicious} open flags`
                    : `Showing ${suspiciousEntries.length} of ${suspiciousCounts[severityFilter]} ${severityFilter}-severity flags`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onJump("players", "suspicious")}
              className="shrink-0 rounded-md border border-card-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-white/5 hover:text-foreground"
            >
              Open queue →
            </button>
          </div>

          {/* Severity filter chips */}
          <div
            className="flex flex-wrap gap-1.5 border-b border-card-border/60 px-4 py-2"
            role="tablist"
            aria-label="Filter by severity"
          >
            {SEVERITY_FILTERS.map((opt) => {
              const isActive = severityFilter === opt.id;
              const count =
                opt.id === "all" ? totalSuspicious : suspiciousCounts[opt.id as Severity];
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSeverityFilter(opt.id)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    isActive
                      ? "border-info/40 bg-info/10 text-info"
                      : "border-card-border text-muted hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`rounded px-1 text-[10px] tabular-nums ${
                      isActive ? "bg-info/15 text-info" : "bg-white/5 text-muted"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="divide-y divide-card-border/60">
            {suspiciousLoading && (
              <div className="p-6 text-center text-sm text-muted">Loading priority queue…</div>
            )}
            {!suspiciousLoading && suspiciousError && (
              <div className="p-4 text-sm text-error">
                Could not load suspicious activity ({suspiciousError}).
              </div>
            )}
            {!suspiciousLoading && !suspiciousError && suspiciousEntries.length === 0 && (
              <div className="p-6 text-center text-sm text-muted">
                {severityFilter === "all"
                  ? "No open flags. Nice work."
                  : `No ${severityFilter}-severity flags right now.`}
              </div>
            )}
            {!suspiciousLoading &&
              !suspiciousError &&
              suspiciousEntries.map((entry) => {
                const sev = entry.highestSeverity;
                return (
                  <button
                    key={entry._id}
                    type="button"
                    onClick={() => onJump("players", "suspicious")}
                    className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-white/5 sm:p-4"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[sev]}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {entry.characterName}
                        </span>
                        <span className="text-xs text-muted">@{entry.username}</span>
                        <span className="rounded border border-card-border px-1.5 py-0.5 text-[10px] tracking-wide text-muted uppercase">
                          {entry.countryId}
                        </span>
                        <span
                          className={`text-[10px] font-bold tracking-widest uppercase ${SEV_TONE[sev]}`}
                        >
                          {sev}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted">
                        {entry.flags?.[0]?.detail ?? "Multiple flags pending review."}
                        {entry.flagCount > 1 && (
                          <span className="ml-1 text-muted/80">(+{entry.flagCount - 1} more)</span>
                        )}
                      </div>
                      <div className="mt-1.5 text-[10px] text-muted">
                        Updated {relativeTime(entry.lastUpdated)} · {entry.flagCount} flag
                        {entry.flagCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>

        {/* Side-rail: queues to triage + jump links */}
        <div className="space-y-4">
          {/* Wiki review preview */}
          <div className="rounded-xl border border-card-border bg-card shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-card-border/60 p-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Wiki review queue</h3>
                <p className="mt-0.5 text-xs text-muted">
                  Player submissions awaiting moderator approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onJump("content", "wiki-review")}
                className="shrink-0 rounded-md border border-card-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-white/5 hover:text-foreground"
              >
                Review →
              </button>
            </div>
            <div className="divide-y divide-card-border/60">
              {wikiLoading && <div className="p-4 text-sm text-muted">Loading wiki queue…</div>}
              {!wikiLoading && wikiError && (
                <div className="p-3 text-sm text-error">
                  Could not load wiki queue ({wikiError}).
                </div>
              )}
              {!wikiLoading && !wikiError && wikiPending.length === 0 && (
                <div className="p-4 text-sm text-muted">No pending submissions.</div>
              )}
              {!wikiLoading &&
                !wikiError &&
                wikiPending.slice(0, 5).map((page) => (
                  <button
                    key={page._id}
                    type="button"
                    onClick={() => onJump("content", "wiki-review")}
                    className="block w-full p-3 text-left transition-colors hover:bg-white/5"
                  >
                    <div className="truncate text-sm font-medium text-foreground">{page.title}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {page.submitterName ? `by ${page.submitterName}` : "submitted"} ·{" "}
                      {relativeTime(page.updatedAt ?? page.createdAt)}
                    </div>
                  </button>
                ))}
              {!wikiLoading && !wikiError && wikiPending.length > 5 && (
                <div className="p-2 text-center text-[11px] text-muted">
                  +{wikiPending.length - 5} more
                </div>
              )}
            </div>
          </div>

          {/* Quick jump to other moderation surfaces */}
          <div className="rounded-xl border border-card-border bg-card shadow-sm">
            <div className="border-b border-card-border/60 p-4">
              <h3 className="text-sm font-semibold">Other queues</h3>
              <p className="mt-0.5 text-xs text-muted">Open the full tooling for any surface.</p>
            </div>
            <div className="grid grid-cols-1 divide-y divide-card-border/60">
              <JumpRow
                label="Banner ads"
                desc="Review pending player ad creatives."
                onClick={() => onJump("content", "banner-ads")}
              />
              <JumpRow
                label="News posts"
                desc="Take down or approve player wire posts."
                onClick={() => onJump("content", "news")}
              />
              <JumpRow
                label="Activity log"
                desc="Search login / fund / turn events."
                onClick={() => onJump("players", "activity-log")}
              />
              <JumpRow
                label="Mod audit log"
                desc="Review your recent moderation actions."
                onClick={() => onJump("players", "audit-log")}
              />
              <JumpRow
                label="Transactions"
                desc="Inspect financial transaction logs."
                onClick={() => onJump("transactions")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PriorityStatProps {
  label: string;
  value: string;
  sub: string;
  tone: "urgent" | "warn" | "ok" | "neutral";
  onClick?: () => void;
}

function PriorityStat({ label, value, sub, tone, onClick }: PriorityStatProps) {
  const toneRing =
    tone === "urgent"
      ? "border-error/40 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]"
      : tone === "warn"
        ? "border-warning/40"
        : "border-card-border";
  const valueColor =
    tone === "urgent" ? "text-error" : tone === "warn" ? "text-warning" : "text-foreground";

  const Tag: "button" | "div" = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex flex-col rounded-xl border bg-card p-3 text-left shadow-sm transition-colors sm:p-4 ${toneRing} ${
        onClick ? "hover:bg-white/5" : ""
      }`}
    >
      <span className="text-[10px] font-semibold tracking-widest text-muted uppercase">
        {label}
      </span>
      <span className={`mt-1 text-xl leading-none font-bold sm:text-2xl ${valueColor}`}>
        {value}
      </span>
      <span className="mt-1.5 text-[11px] text-muted">{sub}</span>
    </Tag>
  );
}

function JumpRow({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-white/5"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted">{desc}</span>
      </span>
      <span aria-hidden className="shrink-0 text-muted">
        →
      </span>
    </button>
  );
}
