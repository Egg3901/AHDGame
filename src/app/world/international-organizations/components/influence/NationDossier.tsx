"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { previewEffectivePlay } from "@/lib/alignment/rules/previewEffectivePlay";
import { POLE_TEXT, ShareBar } from "@/components/alignment/ShareBar";
import type { InfluenceTarget, OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { formatShare, roundToShareGrid } from "@/lib/alignment/normalize";
import { MIN_PLAY_POINTS } from "@/lib/alignment/influence";
import { PER_NATION_TURN_CAP } from "@/lib/constants/alignmentEras";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { parseMoneyAmountInput } from "@/lib/utils/parseMoneyAmountInput";
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
  const t = useTranslations("worldOrganizations.influence");
  // Costs are informational — what a nation would take — so they read in the
  // viewer's currency. The commit input below deliberately does not: the route
  // takes `amountLocal` in the FUND's currency, and a field that accepted one
  // currency while labelled another would spend the wrong number.
  const fundAmount = useFundFormatter(view);

  const modifiers: string[] = [];
  if (target.resistsAtHalfStrength) {
    modifiers.push("Genuinely uncommitted, so it absorbs pushes at half strength.");
  }
  if (target.crisis) {
    modifiers.push(
      `Flashpoint open for ${target.crisis.turnsRemaining} more turns. The movement ceiling here is raised to ${target.crisis.movementCap}.`
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
  const turnCap = turnCapFor(target);

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
            ? `, ${formatShare(pointsToGate)} short of the ${view.joinShare} it takes to join.`
            : `, already past the ${view.joinShare} it takes to join.`}{" "}
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
                applying to join. The members&rsquo; vote now decides.
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
          <p className="text-body-sm text-muted">{t("noRivals")}</p>
        ) : (
          intel.map((e, i) => (
            <p key={`${e.poleLabel}-${i}`} className="text-body-sm text-foreground">
              <span className={POLE_TEXT[e.accentToken]}>
                {t(e.pointsLanded == null ? "rivalUnknown" : "rivalGain", {
                  pole: e.poleLabel,
                  points: formatShare(e.pointsLanded ?? 0),
                  when: e.turnsAgo === 0 ? t("thisTurn") : t("turnsAgo", { count: e.turnsAgo }),
                })}
              </span>
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
          {t("pricing", {
            nation: target.name,
            cap: turnCap,
            spend: fundAmount(target.playCapCostLocal ?? 0),
          })}
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

/** The most this nation can move in one turn: raised while a flashpoint is open. */
function turnCapFor(target: InfluenceTarget): number {
  return target.crisis?.movementCap ?? PER_NATION_TURN_CAP;
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
  const t = useTranslations("worldOrganizations.influence");

  // Everything below is in the FUND's own currency, never the viewer's. The
  // costs stated above this form read in the viewer's preferred currency, so
  // quoting the balance or the preview in anything else would leave a player
  // typing a number that means something different from the one they just read.
  const fundCode = COUNTRY_CONFIGS[view.fundCurrencyCountryId]?.currencyCode ?? "USD";
  const inFundCurrency = (n: number) => formatFundAmount(n, fundCode);

  // The field takes the K/M/B shorthand the panel itself prints, via the same
  // parser every other money input uses. A plain-units field next to figures
  // quoted as "SUR 4.0M" reads as "type 4", which buys nothing (ticket #1236).
  const typed = parseMoneyAmountInput(amount);
  const pointCost = target.pointCostLocal ?? 0;
  const hasPreview = typed > 0 && pointCost > 0;
  // The quote carries resistance but not channel strength, strain, opposition,
  // the turn ceiling or normalization. Never display this intermediate pressure.
  // One play is capped before anything else, so
  // past playMaxPoints the money buys nothing even against a rival (ticket #1371).
  // The turn limit is different: it bounds what is left after opposing pushes
  // cancel, so points past it still count when a rival pushes back.
  const rawPoints = hasPreview ? typed / pointCost : 0;
  const playPoints = Math.min(rawPoints, target.playMaxPoints);
  const overPlayCap = rawPoints > target.playMaxPoints;
  const turnCap = turnCapFor(target);
  const strength = (view.channel?.weight ?? 1) * (view.blocStress?.effectiveness ?? 1);
  const overTurnCap = !overPlayCap && playPoints * strength > turnCap;
  const effectivePoints = view.channel
    ? previewEffectivePlay({
        shares: { shares: target.shares, nonAligned: target.nonAligned },
        poles: view.poles.map((pole) => pole.id),
        poleId: view.channel.poleId,
        amountLocal: typed,
        pointCostLocal: pointCost,
        playMaxPoints: target.playMaxPoints,
        resistsAtHalfStrength: target.resistsAtHalfStrength,
        weight: view.channel.weight,
        effectiveness: view.blocStress?.effectiveness ?? 1,
        turnCap,
      })
    : 0;
  const overBalance = typed > view.fundBalanceLocal;
  // Preserve the existing form minimum. It is not a guarantee of movement:
  // strain, normalization and opposing pressure can still leave zero gain.
  const minSpendLocal = pointCost > 0 ? Math.ceil(pointCost * MIN_PLAY_POINTS) : 0;
  const buysNothing = hasPreview && roundToShareGrid(playPoints) < MIN_PLAY_POINTS;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountLocal = parseMoneyAmountInput(amount);
    if (!(amountLocal > 0)) {
      setError("Enter an amount.");
      return;
    }
    if (buysNothing) {
      setError(t("minimumSpend", { spend: inFundCurrency(minSpendLocal) }));
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
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 49M"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 font-mono text-body-sm tabular-nums text-foreground"
          />
        </label>
        <button
          type="submit"
          disabled={submitting || buysNothing}
          className="rounded-lg border border-card-border bg-card-muted px-4 py-2 text-body-sm font-semibold text-foreground transition-colors hover:bg-card disabled:opacity-50"
        >
          {submitting ? "Committing…" : "Commit play"}
        </button>
      </div>

      <p className="text-body-xs text-muted">
        Shorthand works here: 4.0M means 4,000,000, and the full number is fine too.
      </p>

      {hasPreview && (
        <p className={`text-body-xs ${buysNothing ? "text-warning" : "text-muted"}`}>
          {t("preview", { points: formatShare(effectivePoints) })}{" "}
          {buysNothing
            ? t("minimumSpend", { spend: inFundCurrency(minSpendLocal) })
            : overPlayCap
              ? t("overPlay", { spend: inFundCurrency(target.playCapCostLocal ?? 0) })
              : overTurnCap
                ? t("overTurn", { cap: turnCap })
                : null}
        </p>
      )}

      {overBalance && (
        <p className="text-body-xs text-warning">
          That is more than the fund holds. The play will be refused.
        </p>
      )}

      <p className="text-body-xs text-muted">{t("settlement")}</p>

      {error && <p className="text-body-sm text-error">{error}</p>}
    </form>
  );
}
