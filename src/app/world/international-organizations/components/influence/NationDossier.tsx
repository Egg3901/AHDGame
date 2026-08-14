"use client";

import { useState } from "react";
import { POLE_TEXT, ShareBar } from "@/components/alignment/ShareBar";
import type { InfluenceTarget, OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { formatShare, roundToShareGrid } from "@/lib/alignment/normalize";
import { PER_NATION_TURN_CAP } from "@/lib/constants/alignmentEras";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { useFundFormatter } from "../useFundFormatter";
import { formatFundAmount } from "../fundCurrency";

interface Props {
  view: OrgInfluenceView;
  target: InfluenceTarget;
  orgId: string;
  /** The viewer's foreign-minister country, or null when they hold no such seat. */
  viewerCountryId: string | null;
  onCommitted: () => void;
}

/**
 * Everything worth knowing about one nation before spending on it.
 *
 * The share bar is the same grammar the Cold War Ledger uses, so a country
 * reads the same way on both screens. Its gate captions name the join and leave
 * thresholds, which are positions on a SHARE — the locked gate is deliberately
 * absent because it is a threshold on LEAD, and drawing it on this axis would
 * put it somewhere it does not mean.
 */
export function NationDossier({ view, target, orgId, viewerCountryId, onCommitted }: Props) {
  // Costs are informational — what a nation would take — so they read in the
  // viewer's currency. The commit input below deliberately does not: the route
  // takes `amountLocal` in the FUND's currency, and a field that accepted one
  // currency while labelled another would spend the wrong number.
  const fundAmount = useFundFormatter(view);

  const modifiers: string[] = [];
  if (target.resistsAtHalfStrength) {
    modifiers.push("Genuinely uncommitted — it absorbs pushes at half strength.");
  }
  if (target.crisis) {
    modifiers.push(
      `Flashpoint open for ${target.crisis.turnsRemaining} more turns — the movement ceiling here is raised to ${target.crisis.movementCap}.`
    );
  }
  for (const org of target.sanctionedBy) {
    modifiers.push(`Under sanctions from ${org}, eroding that bloc's own standing here.`);
  }

  // The bar above already states the number; this line's job is to say which
  // pole is YOURS and how far it still has to travel.
  const pointsToGate = roundToShareGrid(Math.max(0, view.joinShare - target.ourShare));

  const intel = view.rivalIntel[target.entityId] ?? [];
  const canAct = viewerCountryId != null && target.pointCostLocal != null;

  return (
    <section
      data-testid="nation-dossier"
      className="space-y-4 rounded-lg border border-card-border bg-card p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body-lg font-semibold text-foreground">{target.name}</h3>
        <span className="text-body-xs uppercase tracking-wide text-muted">{target.status}</span>
      </header>

      <div className="space-y-2">
        <ShareBar
          poles={view.poles}
          shares={target.shares}
          nonAligned={target.nonAligned}
          remainderLabel={view.remainderLabel}
          size="lead"
        />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body-xs">
          {view.poles.map((p) => (
            <span key={p.id} className={`font-mono tabular-nums ${POLE_TEXT[p.accentToken]}`}>
              {p.label} {formatShare(target.shares[p.id] ?? 0)}
            </span>
          ))}
          <span className="font-mono tabular-nums text-muted">
            {view.remainderLabel} {formatShare(target.nonAligned)}
          </span>
        </div>
        <p className="text-body-xs text-muted">
          {view.channel?.poleLabel} is yours here, at {formatShare(target.ourShare)}
          {pointsToGate > 0
            ? ` — ${formatShare(pointsToGate)} short of the ${view.joinShare} it takes to join.`
            : ` — already past the ${view.joinShare} it takes to join.`}{" "}
          A member that falls to {view.leaveShare} and stays there leaves the bloc.
        </p>
        {/* Over the gate is only the first step. The turn engine makes a nation
            hold the gate for a sustained run before it even applies, then the
            members vote — so a share past 60 that has not "joined" is working as
            designed, not stuck. This line is where a player sees the clock. */}
        {target.joinCountdown && (
          <p className="text-body-xs text-muted">
            {target.joinCountdown.turnsToApply > 0 ? (
              <>
                It has held above the {view.joinShare} for{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {target.joinCountdown.turnsHeld}/{view.sustainTurns}
                </span>{" "}
                turns. If it holds, it applies to join in{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {target.joinCountdown.turnsToApply}
                </span>{" "}
                more turn{target.joinCountdown.turnsToApply === 1 ? "" : "s"}, then the members vote
                it in. Drop it back below the {view.joinShare} and the clock resets.
              </>
            ) : (
              <>
                It has held above the {view.joinShare} for the full {view.sustainTurns} turns and is
                applying to join — the members&rsquo; vote now decides.
              </>
            )}
          </p>
        )}
      </div>

      {modifiers.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-body-xs uppercase tracking-wide text-muted">
            What&rsquo;s affecting this nation
          </h4>
          {modifiers.map((m) => (
            <p key={m} className="text-body-sm text-foreground">
              {m}
            </p>
          ))}
        </div>
      )}

      <div data-testid="rival-intel" className="space-y-1">
        <h4 className="text-body-xs uppercase tracking-wide text-muted">Rival activity</h4>
        {intel.length === 0 ? (
          <p className="text-body-sm text-muted">No rival has moved here recently.</p>
        ) : (
          intel.map((e, i) => (
            <p key={`${e.poleLabel}-${i}`} className="text-body-sm text-foreground">
              <span className={POLE_TEXT[e.accentToken]}>{e.poleLabel}</span> landed{" "}
              {e.pointsLanded} here{" "}
              {e.turnsAgo === 0
                ? "this turn"
                : `${e.turnsAgo} turn${e.turnsAgo === 1 ? "" : "s"} ago`}
              .
            </p>
          ))
        )}
      </div>

      {target.pointCostLocal == null ? (
        <p className="text-body-sm text-muted">
          This nation&rsquo;s economy is not on record, so the cost of influencing it cannot be
          priced.
        </p>
      ) : (
        <p className="text-body-xs text-muted">
          {target.name} costs{" "}
          <span className="font-mono tabular-nums text-foreground">
            {fundAmount(target.pointCostLocal)}
          </span>{" "}
          a point.{" "}
          {target.resistsAtHalfStrength
            ? "That is twice the usual one percent of its economy, because of the resistance noted above."
            : "That is one percent of its economy."}{" "}
          Moving it as far as a turn allows costs{" "}
          <span className="font-mono tabular-nums text-foreground">
            {fundAmount(target.turnCapCostLocal ?? 0)}
          </span>
          ; beyond that the money buys nothing more this turn unless a rival is pushing back.
        </p>
      )}

      {canAct && (
        <CommitPlayForm
          view={view}
          target={target}
          orgId={orgId}
          viewerCountryId={viewerCountryId}
          onCommitted={onCommitted}
        />
      )}
    </section>
  );
}

/**
 * Local to the dossier because nothing else renders it. If a second caller ever
 * appears, that is the moment to promote it.
 */
function CommitPlayForm({
  view,
  target,
  orgId,
  viewerCountryId,
  onCommitted,
}: {
  view: OrgInfluenceView;
  target: InfluenceTarget;
  orgId: string;
  viewerCountryId: string;
  onCommitted: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountLocal = Number(amount);
    if (!(amountLocal > 0)) {
      setError("Enter an amount.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${viewerCountryId}/international-organizations/${orgId}/influence`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetEntityId: target.entityId, amountLocal }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body?.error ?? "Failed to commit the play");
      }
      setAmount("");
      onCommitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to commit the play");
    } finally {
      setSubmitting(false);
    }
  }

  // Everything below is in the FUND's own currency, never the viewer's. The
  // costs stated above this form read in the viewer's preferred currency, so
  // quoting the balance or the preview in anything else would leave a player
  // typing a number that means something different from the one they just read.
  const fundCode = COUNTRY_CONFIGS[view.fundCurrencyCountryId]?.currencyCode ?? "USD";
  const inFundCurrency = (n: number) => formatFundAmount(n, fundCode);

  const typed = Number(amount);
  const pointCost = target.pointCostLocal ?? 0;
  const hasPreview = typed > 0 && pointCost > 0;
  // pointCostLocal already carries the non-aligned resistance, so this is points
  // actually landed, not list price. The per-nation cap bounds the whole nation's
  // turn, so anything past it is the ceiling talking, not this play.
  const rawPoints = hasPreview ? typed / pointCost : 0;
  const cappedPoints = Math.min(rawPoints, PER_NATION_TURN_CAP);
  const overCap = rawPoints > PER_NATION_TURN_CAP;
  const overBalance = typed > view.fundBalanceLocal;

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-body-xs uppercase tracking-wide text-muted">
          Paid from the {view.fundCurrencyCountryId} organisation fund
        </span>
        <span className="font-mono text-body-xs tabular-nums text-foreground">
          {inFundCurrency(view.fundBalanceLocal)} available
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-body-xs uppercase tracking-wide text-muted">
            Amount ({fundCode})
          </span>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 font-mono text-body-sm tabular-nums text-foreground"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg border border-card-border bg-card-muted px-4 py-2 text-body-sm font-semibold text-foreground transition-colors hover:bg-card disabled:opacity-50"
        >
          {submitting ? "Committing…" : "Commit play"}
        </button>
      </div>

      {hasPreview && (
        <p className="text-body-xs text-muted">
          Buys{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatShare(roundToShareGrid(cappedPoints))}
          </span>{" "}
          points at {inFundCurrency(pointCost)} each.{" "}
          {overCap
            ? `Past the ${PER_NATION_TURN_CAP}-point ceiling for one turn — the rest buys nothing unless a rival pushes back.`
            : "One point is one share of this nation's alignment."}
        </p>
      )}

      {overBalance && (
        <p className="text-body-xs text-warning">
          That is more than the fund holds. The play will be refused.
        </p>
      )}

      <p className="text-body-xs text-muted">
        The fund is debited now; the nation moves when the turn processes, and the points bought
        appear under Recent plays. A play that lands on a nation which locks before then is refunded
        in full.
      </p>

      {error && <p className="text-body-sm text-error">{error}</p>}
    </form>
  );
}
