"use client";

import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  BriefingCoalitionBucket,
  CampaignBriefing,
  CampaignData,
} from "@/lib/campaigns/dto/campaignView";
import { LevelBar } from "./LevelBar";

interface CampaignRoomBriefingProps {
  campaign: CampaignData;
}

/**
 * Owner-only campaign-room briefing. Renders the read-only strategic digest the
 * server composed on `campaign.briefing` (path to victory, cash runway, where
 * the coalition is weak, operations saturation, and action tradeoffs). The
 * parent gates this on owner access, so a non-owner never reaches it; it also
 * no-ops defensively if the block is absent.
 */
export function CampaignRoomBriefing({ campaign }: CampaignRoomBriefingProps) {
  const briefing = campaign.briefing;
  if (!briefing) return null;

  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Campaign Room</h2>
        <span className="text-[11px] uppercase tracking-wider text-muted">Manager briefing</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PathToVictoryCard path={briefing.path} />
        <CashRunwayCard cashRunway={briefing.cashRunway} currencyCode={campaign.currencyCode} />
        <CoalitionWeaknessCard buckets={briefing.coalitionWeakness} />
        <OpsSaturationCard saturation={briefing.opsSaturation} />
        <div className="sm:col-span-2">
          <ActionTradeoffsCard
            tradeoffs={briefing.tradeoffs}
            currencyCode={campaign.currencyCode}
          />
        </div>
      </div>
    </section>
  );
}

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-card-border bg-background/40 p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{title}</div>
      {children}
    </div>
  );
}

export function PathToVictoryCard({ path }: { path: CampaignBriefing["path"] }) {
  if (!path) {
    return (
      <CardShell title="Path to Victory">
        <p className="text-sm text-muted">No path data yet for this race.</p>
      </CardShell>
    );
  }

  if (path.kind === "delegate") {
    const pct = path.needed > 0 ? Math.min(100, (path.won / path.needed) * 100) : 0;
    return (
      <CardShell title="Path to Victory — Delegates">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
            {path.won.toLocaleString("en-US")}
          </span>
          <span className="text-sm text-muted">/ {path.needed.toLocaleString("en-US")} needed</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-card-border">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {path.remaining > 0
            ? `${path.remaining.toLocaleString("en-US")} more to clinch`
            : "Majority clinched"}
        </p>
        {path.leaders.length > 0 && (
          <ul className="mt-3 space-y-1">
            {path.leaders.map((l) => (
              <li key={l.candidateId} className="flex justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{l.name}</span>
                <span className="font-mono tabular-nums text-muted">
                  {l.delegates.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardShell>
    );
  }

  const pct = path.evNeeded > 0 ? Math.min(100, (path.evHave / path.evNeeded) * 100) : 0;
  return (
    <CardShell title="Path to Victory — Electoral Votes">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
          {path.evHave.toLocaleString("en-US")}
        </span>
        <span className="text-sm text-muted">/ {path.evNeeded.toLocaleString("en-US")} to win</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-card-border">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      {path.tippingStates.length > 0 ? (
        <>
          <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted">
            Closest states
          </p>
          <ul className="mt-1 space-y-1">
            {path.tippingStates.map((s) => (
              <li key={s.stateId} className="flex justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{s.name}</span>
                <span className="font-mono tabular-nums text-muted">
                  {s.marginPp.toFixed(1)} pt
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted">No contested states yet.</p>
      )}
    </CardShell>
  );
}

export function CashRunwayCard({
  cashRunway,
  currencyCode,
}: {
  cashRunway: CampaignBriefing["cashRunway"];
  currencyCode: CurrencyCode;
}) {
  const fmt = (v: number) => formatCurrencyFaceAmount(v, currencyCode);
  const net = cashRunway.netPerTurn;
  const runway = cashRunway.turnsOfRunway;
  return (
    <CardShell title="Cash Runway">
      <div className="font-mono text-2xl font-bold tabular-nums text-amber-400">
        {fmt(cashRunway.funds)}
      </div>
      <p className={`mt-1 font-mono text-xs ${net >= 0 ? "text-success" : "text-error"}`}>
        {net >= 0 ? "+" : "-"}
        {fmt(Math.abs(net))}/turn
      </p>
      <p className="mt-2 text-sm text-muted">
        {runway === null ? (
          <span className="text-success">Balance is stable or growing.</span>
        ) : (
          <>
            <span className="font-semibold text-foreground">{runway.toLocaleString("en-US")}</span>{" "}
            turn{runway === 1 ? "" : "s"} of runway at the current burn.
          </>
        )}
      </p>
    </CardShell>
  );
}

/** "race:white" -> "White · Race". Falls back to the raw key. */
function prettyBucket(bucket: string): string {
  const [dim, val] = bucket.split(":");
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ") : s);
  return val ? `${cap(val)} · ${cap(dim)}` : cap(bucket);
}

export function CoalitionWeaknessCard({ buckets }: { buckets: BriefingCoalitionBucket[] }) {
  return (
    <CardShell title="Coalition Weakness">
      {buckets.length === 0 ? (
        <p className="text-sm text-muted">No coalition breakdown available yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {buckets.map((b) => (
            <li key={b.bucket} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-foreground">{prettyBucket(b.bucket)}</span>
              <span className="font-mono tabular-nums text-muted">
                {(b.appealShare * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

export function OpsSaturationCard({
  saturation,
}: {
  saturation: CampaignBriefing["opsSaturation"];
}) {
  return (
    <CardShell title="Operations Saturation">
      <ul className="space-y-2">
        {saturation.map((s) => (
          <li key={s.category} className="space-y-1">
            <div className="flex justify-between gap-2 text-sm">
              <span className="capitalize text-foreground">
                {s.category.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <span className="font-mono tabular-nums text-muted">
                {s.level}/{s.max}
              </span>
            </div>
            <LevelBar level={s.level} max={Math.max(s.max, 1)} barClass="bg-primary" />
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

export function ActionTradeoffsCard({
  tradeoffs,
  currencyCode,
}: {
  tradeoffs: CampaignBriefing["tradeoffs"];
  currencyCode: CurrencyCode;
}) {
  const fmt = (v: number) => formatCurrencyFaceAmount(v, currencyCode);
  return (
    <CardShell title="Action Tradeoffs">
      {tradeoffs.length === 0 ? (
        <p className="text-sm text-muted">Every operation is maxed out.</p>
      ) : (
        <ul className="space-y-2">
          {tradeoffs.map((t) => (
            <li
              key={t.actionId}
              className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">{t.label}</span>
                <span className="ml-2 text-xs text-muted">{t.expectedEffect}</span>
              </div>
              <span className="shrink-0 font-mono text-xs text-muted">
                {fmt(t.cost.funds)} · {t.cost.actions} action{t.cost.actions === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}
