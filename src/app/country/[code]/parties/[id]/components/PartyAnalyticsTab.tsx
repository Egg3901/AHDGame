"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { partyApiUrl } from "@/lib/urls";
import type { CaucusHealthItem } from "@/lib/caucus/caucusHealth";
import type {
  PartyAnalyticsCaucusRiskItem,
  PartyAnalyticsLink,
  PartyAnalyticsPayload,
  PartyAnalyticsRiskItem,
  PartyAnalyticsSlateCoverageItem,
  PartyAnalyticsSlateItem,
  PartyAnalyticsStateMetric,
} from "@/lib/partyAnalytics/types";

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
  eyebrow,
  title,
  description,
  link,
}: {
  eyebrow: string;
  title: string;
  description: string;
  link?: PartyAnalyticsLink;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-heading-sm font-semibold text-foreground">{title}</h2>
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

function MetricList({
  title,
  items,
  render,
  empty,
}: {
  title: string;
  items: readonly unknown[];
  render: (item: unknown) => React.ReactNode;
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted">{empty}</p>
        ) : (
          items.map((item, index) => <div key={index}>{render(item)}</div>)
        )}
      </div>
    </div>
  );
}

function StateMetricRow({ item }: { item: PartyAnalyticsStateMetric }) {
  const growthTone =
    item.growthPerTurn > 0
      ? "text-success"
      : item.growthPerTurn < 0
        ? "text-warning"
        : "text-muted";
  const growthLabel =
    item.growthPerTurn > 0
      ? `Growth +${item.growthPerTurn.toFixed(1)}/turn`
      : item.growthPerTurn < 0
        ? `Growth ${item.growthPerTurn.toFixed(1)}/turn`
        : "Growth 0.0/turn";
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{item.stateName}</p>
        <p className="text-body-sm text-muted">{item.organization.toFixed(1)} org</p>
      </div>
      <div className="text-right">
        <p className={`text-body-sm ${growthTone}`}>{growthLabel}</p>
      </div>
    </Link>
  );
}

function RiskRow({ item }: { item: PartyAnalyticsRiskItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
          <Badge color={getRiskBadgeColor(item.riskLabel)}>{item.riskLabel}</Badge>
        </div>
        <p className="text-body-sm text-muted">
          {item.homeState}
          {item.currentOffice ? ` · ${item.currentOffice}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
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
      className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{item.nppName}</p>
          <Badge color={getCaucusRiskBadgeColor(item.exitRiskLabel)}>{item.exitRiskLabel}</Badge>
        </div>
        <p className="text-body-sm text-muted">
          {item.caucusName}
          {item.chairName ? ` · Chair ${item.chairName}` : ""}
        </p>
      </div>
      <div className="text-right">
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
      className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{item.electionLabel}</p>
        <p className="text-body-sm text-muted">{item.state}</p>
      </div>
      <Badge color={item.statusLabel.startsWith("No") ? "warning" : "error"}>
        {item.statusLabel}
      </Badge>
    </Link>
  );
}

function SlateCoverageRow({ item }: { item: PartyAnalyticsSlateCoverageItem }) {
  const uncovered = item.totalRaces - item.coveredRaces;
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div>
        <p className="text-sm font-medium text-foreground">{item.state}</p>
        <p className="text-body-sm text-muted">
          {item.coveredRaces}/{item.totalRaces} covered · {item.filedRaces} filed
        </p>
      </div>
      <Badge color={uncovered > 0 ? "warning" : "success"}>
        {uncovered > 0 ? `${uncovered} open` : "Covered"}
      </Badge>
    </Link>
  );
}

function getCaucusStatusBadgeColor(statusLabel: CaucusHealthItem["statusLabel"]) {
  switch (statusLabel) {
    case "Fragile":
      return "error";
    case "Strained":
      return "warning";
    default:
      return "success";
  }
}

function formatChurnCount(item: CaucusHealthItem, recentWindowTurns: number) {
  const parts = [
    item.recentJoinCount > 0 ? `+${item.recentJoinCount}` : null,
    item.recentLeaveCount > 0 ? `-${item.recentLeaveCount}` : null,
    item.recentForcedExitCount > 0 ? `${item.recentForcedExitCount} forced` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0
    ? `${parts.join(" · ")} in ${recentWindowTurns}t`
    : `Quiet ${recentWindowTurns}t`;
}

function CaucusHealthRow({
  item,
  recentWindowTurns,
}: {
  item: CaucusHealthItem;
  recentWindowTurns: number;
}) {
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card-muted/50 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-card-muted"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{item.caucusName}</p>
          <Badge color={getCaucusStatusBadgeColor(item.statusLabel)}>{item.statusLabel}</Badge>
        </div>
        <p className="truncate text-body-sm text-muted">{item.statusReason}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {item.memberCounts.total} members
        </p>
        <p className="text-body-sm text-muted">{formatChurnCount(item, recentWindowTurns)}</p>
      </div>
    </Link>
  );
}

export function PartyAnalyticsTab({
  countryCode,
  partyId,
  initialData = null,
}: {
  countryCode: string;
  partyId: string;
  initialData?: PartyAnalyticsPayload | null;
}) {
  const [data, setData] = useState<PartyAnalyticsPayload | null>(initialData);
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
        const response = await fetch(`${partyApiUrl(countryCode, partyId)}/analytics`);
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Failed to load analytics");
        }
        const body = (await response.json()) as PartyAnalyticsPayload;
        if (!cancelled) setData(body);
      } catch (fetchError) {
        if (!cancelled)
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [countryCode, partyId, initialData]);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <p className="text-sm text-muted animate-pulse">Loading analytics...</p>
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
          eyebrow="Analytics"
          title="Party Command Center"
          description="Track where the party is growing, which NPPs look unstable, and where Slate coverage is breaking down. Every card links directly to the place leadership can go act on it."
        />
      </div>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Org & Growth"
          title="Expansion Watch"
          description="These cards surface where the party is strongest, where it still has the most room to build, and how quickly state organization is growing or shrinking each turn. Click any state row to jump straight into that state party page."
          link={data.links.stateParties}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryMetric label="Tracked State Parties" value={data.org.totalStateOrgs} />
          <SummaryMetric
            label="Growing States"
            value={data.org.positiveGrowthCount}
            tone="success"
          />
          <SummaryMetric
            label="Shrinking States"
            value={data.org.negativeGrowthCount}
            tone="warning"
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <MetricList
            title="Growth Leaders"
            items={data.org.growthLeaders}
            render={(item) => <StateMetricRow item={item as PartyAnalyticsStateMetric} />}
            empty="No state organization data on file."
          />
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Growth Watch</h3>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-body-sm font-medium text-success">Growing</p>
                <div className="mt-3 space-y-3">
                  {data.org.positiveGrowth.length === 0 ? (
                    <p className="text-sm text-muted">No states are growing right now.</p>
                  ) : (
                    data.org.positiveGrowth.map((item) => (
                      <StateMetricRow key={`rise-${item.stateId}`} item={item} />
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="text-body-sm font-medium text-warning">Shrinking</p>
                <div className="mt-3 space-y-3">
                  {data.org.negativeGrowth.length === 0 ? (
                    <p className="text-sm text-muted">No states are shrinking right now.</p>
                  ) : (
                    data.org.negativeGrowth.map((item) => (
                      <StateMetricRow key={`slide-${item.stateId}`} item={item} />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Discipline & Compliance"
          title="Whip Risk"
          description="These summaries surface the NPPs most likely to ignore party direction, plus active whip defiance and caucus members drifting close to their chair-relationship exit threshold. Click any row to jump directly to that NPP profile."
          link={data.links.whipRoom}
        />
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
          <SummaryMetric
            label="Low Loyalty"
            value={data.discipline.lowLoyaltyCount}
            tone="warning"
          />
          <SummaryMetric
            label="Likely Whip Breakers"
            value={data.discipline.likelyWhipBreakers}
            tone="error"
          />
          <SummaryMetric
            label="Caution Pool"
            value={data.discipline.cautionCount}
            tone="secondary"
          />
          <SummaryMetric
            label="Active Defiance"
            value={data.discipline.activeDefianceCount}
            tone="error"
          />
          <SummaryMetric
            label="Caucus Risk"
            value={data.discipline.caucusRiskCount}
            tone="warning"
          />
          <SummaryMetric
            label="Critical Risk"
            value={data.discipline.criticalRiskCount}
            tone="error"
          />
          <SummaryMetric
            label="Elevated Risk"
            value={data.discipline.elevatedRiskCount}
            tone="secondary"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {[data.links.whipRoom, data.links.caucuses, data.links.npps].map((link) => (
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
            label="Players Defying"
            value={data.discipline.playerDefianceCount}
            tone="warning"
          />
          <SummaryMetric
            label="NPPs Defying"
            value={data.discipline.nppDefianceCount}
            tone="error"
          />
          <SummaryMetric
            label="Whip Room Watch"
            value={data.discipline.activeDefianceCount > 0 ? "Attention" : "Clear"}
            tone={data.discipline.activeDefianceCount > 0 ? "warning" : "success"}
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <MetricList
            title="Discipline Watch"
            items={data.discipline.disciplineWatch}
            render={(item) => <RiskRow item={item as PartyAnalyticsRiskItem} />}
            empty="No low-loyalty NPPs on watch."
          />
          <MetricList
            title="High Stubbornness"
            items={data.discipline.highStubbornness}
            render={(item) => <RiskRow item={item as PartyAnalyticsRiskItem} />}
            empty="No stubbornness spikes on file."
          />
          <MetricList
            title="Caucus Exit Risk"
            items={data.discipline.caucusRisk}
            render={(item) => <CaucusRiskRow item={item as PartyAnalyticsCaucusRiskItem} />}
            empty="No caucus NPPs are close to the exit threshold."
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Caucus Health"
          title="Bloc Stability"
          description="These cards show which caucuses are stable, where member churn or whip defiance is building, and which blocs have NPPs drifting close to their chair-relationship exit floor."
          link={data.links.caucuses}
        />
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <SummaryMetric label="Healthy" value={data.caucuses.healthyCount} tone="success" />
          <SummaryMetric label="Strained" value={data.caucuses.strainedCount} tone="warning" />
          <SummaryMetric label="Fragile" value={data.caucuses.fragileCount} tone="error" />
          <SummaryMetric
            label="Chair Elections"
            value={data.caucuses.activeElectionCount}
            tone="secondary"
          />
          <SummaryMetric
            label="Recent Forced Exits"
            value={data.caucuses.recentForcedExitCount}
            tone="error"
          />
          <SummaryMetric
            label="Active Caucus Defiance"
            value={data.caucuses.activeDefianceCount}
            tone="warning"
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <MetricList
            title="Fragile or Strained Caucuses"
            items={data.caucuses.caucuses.filter((item) => item.statusLabel !== "Healthy")}
            render={(item) => (
              <CaucusHealthRow
                item={item as CaucusHealthItem}
                recentWindowTurns={data.caucuses.recentWindowTurns}
              />
            )}
            empty="All caucuses are currently healthy."
          />
          <MetricList
            title="All Caucuses"
            items={data.caucuses.caucuses}
            render={(item) => (
              <CaucusHealthRow
                item={item as CaucusHealthItem}
                recentWindowTurns={data.caucuses.recentWindowTurns}
              />
            )}
            empty="No caucuses founded yet."
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Slate & Race Coverage"
          title="Election Bench Management"
          description="This section summarizes whether the party is covering its live races, where slates are still unresolved, and where assignments already look shaky. Analytics drill-ins open the Slate tab already focused on the relevant state."
          link={data.links.slate}
        />
        <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
          <SummaryMetric label="Active Races" value={data.slate.activeRaceCount} />
          <SummaryMetric label="No Coverage" value={data.slate.uncoveredRaceCount} tone="warning" />
          <SummaryMetric
            label="Awaiting Resolution"
            value={data.slate.awaitingResolutionCount}
            tone="secondary"
          />
          <SummaryMetric label="Filed" value={data.slate.filedCount} tone="success" />
          <SummaryMetric
            label="Likely Declines"
            value={data.slate.likelyDeclineCount}
            tone="error"
          />
          <SummaryMetric
            label="States Needing Coverage"
            value={data.slate.statesNeedingCoverageCount}
            tone="warning"
          />
          <SummaryMetric
            label="States With Declines"
            value={data.slate.statesWithLikelyDeclinesCount}
            tone="error"
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
        <div className="grid gap-4 xl:grid-cols-3">
          <MetricList
            title="Open Races Without Coverage"
            items={data.slate.noCoverage}
            render={(item) => <SlateItemRow item={item as PartyAnalyticsSlateItem} />}
            empty="Every live race has Slate coverage."
          />
          <MetricList
            title="At-Risk Assignments"
            items={data.slate.atRiskAssignments}
            render={(item) => <SlateItemRow item={item as PartyAnalyticsSlateItem} />}
            empty="No current assignments are flashing decline risk."
          />
          <MetricList
            title="State Coverage Heat List"
            items={data.slate.stateCoverage}
            render={(item) => <SlateCoverageRow item={item as PartyAnalyticsSlateCoverageItem} />}
            empty="No live state coverage data."
          />
        </div>
      </section>
    </div>
  );
}
