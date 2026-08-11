import { PositionBadges } from "@/components/PositionBadges";
import { PolicyEffectIndicators } from "@/components/legislation/PolicyEffectIndicators";
import { CurrentToProposed } from "@/components/legislature/dispatch";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatLocalAmount } from "@/lib/utils/formatters";
import { NationalizationProvisionDetailCard } from "@/app/congress/bills/[id]/components/NationalizationProvisionDetailCard";
import type { BillProvisionView } from "@/lib/legislature/dto/provisionView";

/**
 * Shared provision box for both the national and state/regional bill-detail
 * pages. Renders the Current → Proposed comparison (with larp descriptions),
 * position badges, projected-effect chips, and archetype-approval rows.
 * Both pages map their DTO into a {@link BillProvisionView} and render this,
 * so the two surfaces cannot drift.
 */
export function BillProvisionCard({
  view,
  billCountry,
  index,
}: {
  view: BillProvisionView;
  billCountry?: string;
  index: number;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-card-border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold">
          <span className="text-muted">Provision {index + 1}: </span>
          {view.legislationTypeName}
        </span>
        <PositionBadges economic={view.economic} social={view.social} countryId={billCountry} />
      </div>
      <CurrentToProposed
        current={view.current ? view.current.title : null}
        currentDescription={view.current?.description}
        proposed={view.proposed.title}
        proposedDescription={view.proposed.description}
        direction={view.effectDirection ?? 0}
      />
      {view.fiscal && <ProvisionFiscalRow fiscal={view.fiscal} />}
      {view.effects && view.effects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span
            className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted"
            title="Change relative to the current law. An arrow shows how each metric moves if this provision passes; green = beneficial, red = harmful."
          >
            Projected effects vs current law
          </span>
          <div className="flex flex-wrap gap-1.5">
            {view.effects.map((effect, j) => {
              const c = effect.isGood ? "var(--success)" : "var(--error)";
              return (
                <span
                  key={j}
                  className="inline-flex items-center gap-1 rounded-md border border-card-border px-2 py-0.5 text-[11px] text-foreground/80"
                  title={`${effect.metric} ${
                    effect.direction === "up" ? "rises" : "falls"
                  } vs the current law — ${effect.isGood ? "beneficial" : "harmful"}`}
                >
                  <span style={{ color: c }} aria-hidden="true">
                    {effect.direction === "up" ? "▲" : "▼"}
                  </span>
                  {effect.metric}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {(!view.effects || view.effects.length === 0) &&
        view.currentPolicyIndex !== undefined &&
        view.currentPolicyIndex === view.proposedPolicyIndex && (
          <p className="text-[11px] text-muted">
            No change from current law
            {view.current?.title ? ` — already ${view.current.title}` : ""}.
          </p>
        )}
      {view.nationalizationDetail && (
        <NationalizationProvisionDetailCard detail={view.nationalizationDetail} />
      )}
      {(view.policyDomain ||
        (view.archetypeApprovals && Object.keys(view.archetypeApprovals).length > 0)) && (
        <PolicyEffectIndicators
          effectDirection={view.effectDirection ?? 0}
          archetypeApprovals={view.archetypeApprovals}
          policyDomain={view.policyDomain}
          currentPolicyIndex={view.currentPolicyIndex ?? 3}
          proposedPolicyIndex={view.proposedPolicyIndex}
          policyOptionScores={view.policyOptionScores}
          billCountry={billCountry}
        />
      )}
    </div>
  );
}

/**
 * Political-legislation v2 (spec §8): the proposal's annual fiscal profile
 * beside the current law's, net delta highlighted — voters see what the
 * CHANGE costs, not just what the program costs. Tax sliders show the rate
 * move and its revenue delta.
 */
function ProvisionFiscalRow({ fiscal }: { fiscal: NonNullable<BillProvisionView["fiscal"]> }) {
  const currency = fiscal.currencyCode as CurrencyCode;
  const money = (amount: number) => formatLocalAmount(amount, currency);

  if (fiscal.proposedRate !== undefined && fiscal.currentRate !== undefined) {
    const delta = fiscal.revenueDelta ?? 0;
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md bg-background/60 px-2.5 py-1.5 text-xs">
        <span className="font-semibold uppercase tracking-[0.14em] text-[9px] text-muted">
          Fiscal impact
        </span>
        <span className="tabular-nums">
          Rate {fiscal.currentRate}% → {fiscal.proposedRate}%
        </span>
        <span className={`font-medium tabular-nums ${delta >= 0 ? "text-success" : "text-error"}`}>
          {delta >= 0 ? "+" : "−"}
          {money(Math.abs(delta))}/yr revenue
        </span>
      </div>
    );
  }

  const proposed = fiscal.proposed;
  if (!proposed) return null;
  const netDelta = fiscal.netDelta ?? proposed.net;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md bg-background/60 px-2.5 py-1.5 text-xs">
      <span className="font-semibold uppercase tracking-[0.14em] text-[9px] text-muted">
        Fiscal impact
      </span>
      <span className="tabular-nums text-muted">
        Proposed: {money(proposed.cost)}/yr cost
        {proposed.revenue > 0 ? ` · ${money(proposed.revenue)}/yr revenue` : ""}
      </span>
      {fiscal.current && (
        <span className="tabular-nums text-muted">Current: {money(fiscal.current.cost)}/yr</span>
      )}
      <span className={`font-medium tabular-nums ${netDelta >= 0 ? "text-success" : "text-error"}`}>
        Net change {netDelta >= 0 ? "+" : "−"}
        {money(Math.abs(netDelta))}/yr
      </span>
    </div>
  );
}
