"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Skeleton, StatGridSkeleton } from "@/components/ui";
import { regionPartyApiUrl } from "@/lib/urls";
import type {
  PartyAnalyticsCaucusRiskItem,
  PartyAnalyticsLink,
  PartyAnalyticsRiskItem,
  PartyAnalyticsSlateCoverageItem,
  PartyAnalyticsSlateItem,
  StatePartyAnalyticsPayload,
} from "@/lib/partyAnalytics/types";
import { apiErrorText } from "@/lib/errors/catalog";

function getRiskBadgeColor(riskLabel: PartyAnalyticsRiskItem["riskLabel"]) {
  switch (riskLabel) {
    case "Critical":
      return "error";
    case "Elevated":
      return "warning";
    default:
      return "secondary";
  }
}

function getCaucusRiskBadgeColor(riskLabel: PartyAnalyticsCaucusRiskItem["exitRiskLabel"]) {
  switch (riskLabel) {
    case "Critical":
      return "error";
    case "Elevated":
      return "warning";
    default:
      return "secondary";
  }
}

function SectionHeader({
  title,
  description,
  link,
}: {
  title: string;
  description: string;
  link?: PartyAnalyticsLink;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-heading-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>
      </div>
      {link ? (
        <Link
          href={link.href}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-card-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-card-elevated hover:border-muted/40"
        >
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "error" | "secondary";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "error"
          ? "text-error"
          : tone === "secondary"
            ? "text-secondary"
            : "text-foreground";
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <p className="text-body-sm text-muted">{label}</p>
      <p className={`mt-2 text-heading-sm font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function RiskRow({ item }: { item: PartyAnalyticsRiskItem }) {
  return (
    <Link
      href={item.href}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
          <Badge color={getRiskBadgeColor(item.riskLabel)} className="shrink-0">
            {item.riskLabel}
          </Badge>
        </div>
        <p className="text-body-sm text-muted">
          {item.homeState}
          {item.currentOffice ? ` · ${item.currentOffice}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge color="warning">LOY {item.loyalty.toFixed(1)}</Badge>
        <Badge color="secondary">AMB {item.ambition.toFixed(1)}</Badge>
        <Badge color="error">STUB {item.stubbornness.toFixed(1)}</Badge>
      </div>
    </Link>
  );
}

function CaucusRiskRow({ item }: { item: PartyAnalyticsCaucusRiskItem }) {
  return (
    <Link
      href={item.href}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{item.nppName}</p>
          <Badge color={getCaucusRiskBadgeColor(item.exitRiskLabel)} className="shrink-0">
            {item.exitRiskLabel}
          </Badge>
        </div>
        <p className="text-body-sm text-muted">
          {item.caucusName}
          {item.chairName ? ` · Chair ${item.chairName}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-warning tabular-nums">
          Rel {item.relationshipWithChair.toFixed(1)}
        </p>
        <p className="text-body-sm text-muted">Exit in {item.gapFromExit.toFixed(1)}</p>
      </div>
    </Link>
  );
}

function SlateItemRow({ item }: { item: PartyAnalyticsSlateItem }) {
  return (
    <Link
      href={item.href}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{item.electionLabel}</p>
        <p className="text-body-sm text-muted">{item.state}</p>
      </div>
      <Badge color={item.statusLabel.startsWith("No") ? "warning" : "error"} className="shrink-0">
        {item.statusLabel}
      </Badge>
    </Link>
  );
}

function CoverageSummary({ coverage }: { coverage: PartyAnalyticsSlateCoverageItem | null }) {
  if (!coverage) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Coverage summary</h3>
        <p className="mt-4 text-sm text-muted">
          No active local races are on the Slate board right now.
        </p>
      </div>
    );
  }

  const uncovered = coverage.totalRaces - coverage.coveredRaces;
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Coverage summary</h3>
          <p className="mt-1 text-body-sm text-muted">{coverage.state}</p>
        </div>
        <Badge color={uncovered > 0 ? "warning" : "success"}>
          {uncovered > 0 ? `${uncovered} open` : "Covered"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric label="Active races" value={coverage.totalRaces} />
        <SummaryMetric label="Covered" value={coverage.coveredRaces} tone="success" />
        <SummaryMetric label="Filed" value={coverage.filedRaces} tone="secondary" />
        <SummaryMetric label="Likely declines" value={coverage.likelyDeclines} tone="warning" />
      </div>
    </div>
  );
}

export function StatePartyAnalyticsTab({
  countryCode,
  stateId,
  partyId,
  initialData = null,
}: {
  countryCode: string;
  stateId: string;
  partyId: string;
  initialData?: StatePartyAnalyticsPayload | null;
}) {
  const [data, setData] = useState<StatePartyAnalyticsPayload | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${regionPartyApiUrl(countryCode, stateId, partyId)}/analytics`
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(apiErrorText(body, "Failed to load analytics"));
        }
        const body = (await response.json()) as StatePartyAnalyticsPayload;
        if (!cancelled) setData(body);
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load analytics");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [countryCode, initialData, partyId, stateId]);

  if (loading) {
    return (
      <div className="min-h-[32rem] space-y-8">
        <div className="rounded-xl border border-card-border bg-card p-6 space-y-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <section className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-44" />
          </div>
          <StatGridSkeleton cols={2} count={2} />
        </section>
        <section className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-5 w-36" />
          </div>
          <StatGridSkeleton cols={4} count={4} />
        </section>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-error/30 bg-error/10 p-6">
        <p className="text-sm font-medium text-error">Analytics unavailable</p>
        <p className="mt-2 text-sm text-muted">{error ?? "No analytics payload returned."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-card-border bg-card p-6">
        <SectionHeader
          title={`${data.scope.stateName} command center`}
          description="Track local organization growth, NPP discipline risk, and Slate coverage for this party in-state. Each card links into the local Treasury, Whip Room, NPP, Slate, or Elections tabs so leadership can act directly from the summary."
        />
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="Local organization"
          description="The state party's share of all the organization built in this state. Build Organization adds to it, and a party that stops building here slowly loses share."
          link={data.links.treasury}
        />
        {data.org ? (
          <div className="grid gap-4 md:grid-cols-2">
            <SummaryMetric label="Organization" value={data.org.organization.toFixed(1)} />
            <SummaryMetric
              label="Growth / Turn"
              value={
                data.org.growthPerTurn >= 0
                  ? `+${data.org.growthPerTurn.toFixed(1)}`
                  : data.org.growthPerTurn.toFixed(1)
              }
              tone={
                data.org.growthPerTurn > 0
                  ? "success"
                  : data.org.growthPerTurn < 0
                    ? "warning"
                    : "secondary"
              }
            />
          </div>
        ) : (
          <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted">
            No state organization data is on file for this party yet.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Local NPP risk"
          description="These summaries surface the same-party NPPs in this state who look most likely to resist party direction, plus active whip defiance and caucus-aligned NPPs drifting close to their chair-relationship exit threshold."
          link={data.links.whipRoom}
        />
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <SummaryMetric
            label="Low loyalty"
            value={data.discipline.lowLoyaltyCount}
            tone="warning"
          />
          <SummaryMetric
            label="Likely whip breakers"
            value={data.discipline.likelyWhipBreakers}
            tone="error"
          />
          <SummaryMetric
            label="Caution pool"
            value={data.discipline.cautionCount}
            tone="secondary"
          />
          <SummaryMetric
            label="Active defiance"
            value={data.discipline.activeDefianceCount}
            tone="error"
          />
          <SummaryMetric
            label="Caucus risk"
            value={data.discipline.caucusRiskCount}
            tone="warning"
          />
          <SummaryMetric
            label="Critical risk"
            value={data.discipline.criticalRiskCount}
            tone="error"
          />
          <SummaryMetric
            label="Elevated risk"
            value={data.discipline.elevatedRiskCount}
            tone="secondary"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {[data.links.whipRoom, data.links.npps].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex h-8 items-center justify-center rounded-md border border-card-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-card-elevated hover:border-muted/40"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryMetric
            label="Players defying"
            value={data.discipline.playerDefianceCount}
            tone="warning"
          />
          <SummaryMetric
            label="NPPs defying"
            value={data.discipline.nppDefianceCount}
            tone="error"
          />
          <SummaryMetric
            label="Whip room watch"
            value={data.discipline.activeDefianceCount > 0 ? "Attention" : "Clear"}
            tone={data.discipline.activeDefianceCount > 0 ? "warning" : "success"}
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Discipline watch</h3>
            <div className="mt-4 space-y-3">
              {data.discipline.disciplineWatch.length === 0 ? (
                <p className="text-sm text-muted">
                  No same-state NPPs are in the discipline watch band.
                </p>
              ) : (
                data.discipline.disciplineWatch.map((item) => (
                  <RiskRow key={`watch-${item.id}`} item={item} />
                ))
              )}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Stubbornness risk</h3>
            <div className="mt-4 space-y-3">
              {data.discipline.highStubbornness.length === 0 ? (
                <p className="text-sm text-muted">
                  No same-state NPPs currently stand out for stubbornness.
                </p>
              ) : (
                data.discipline.highStubbornness.map((item) => (
                  <RiskRow key={`stub-${item.id}`} item={item} />
                ))
              )}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Caucus exit risk</h3>
            <div className="mt-4 space-y-3">
              {data.discipline.caucusRisk.length === 0 ? (
                <p className="text-sm text-muted">
                  No same-state caucus NPPs are close to their chair-exit threshold.
                </p>
              ) : (
                data.discipline.caucusRisk.map((item) => (
                  <CaucusRiskRow key={`caucus-${item.caucusId}-${item.nppId}`} item={item} />
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Local filing readiness"
          description="These cards show whether the party has local races covered, which assignments are still unresolved, and where likely declines could create filing gaps in this state."
          link={data.links.slate}
        />
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          <SummaryMetric label="Active races" value={data.slate.activeRaceCount} />
          <SummaryMetric label="No coverage" value={data.slate.uncoveredRaceCount} tone="warning" />
          <SummaryMetric
            label="Awaiting resolution"
            value={data.slate.awaitingResolutionCount}
            tone="secondary"
          />
          <SummaryMetric label="Filed" value={data.slate.filedCount} tone="success" />
          <SummaryMetric
            label="Likely declines"
            value={data.slate.likelyDeclineCount}
            tone="warning"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {[data.links.slate, data.links.elections].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex h-8 items-center justify-center rounded-md border border-card-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-card-elevated hover:border-muted/40"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <CoverageSummary coverage={data.slate.coverage} />
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Open races</h3>
            <div className="mt-4 space-y-3">
              {data.slate.noCoverage.length === 0 ? (
                <p className="text-sm text-muted">
                  Every active local race currently has Slate coverage.
                </p>
              ) : (
                data.slate.noCoverage.map((item) => (
                  <SlateItemRow key={`open-${item.electionId}-${item.statusLabel}`} item={item} />
                ))
              )}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Likely declines</h3>
            <div className="mt-4 space-y-3">
              {data.slate.atRiskAssignments.length === 0 ? (
                <p className="text-sm text-muted">
                  No local Slate assignments are currently flagged as likely declines.
                </p>
              ) : (
                data.slate.atRiskAssignments.map((item) => (
                  <SlateItemRow key={`risk-${item.electionId}-${item.statusLabel}`} item={item} />
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
