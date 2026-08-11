import { natMoney } from "@/components/national/natMoney";
import type { NationalizationProvisionDetail } from "@/lib/congress/billEnrichment";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";

/**
 * Renders the affected-corporation / payout breakdown for a nationalize bill
 * provision — the same information the proposal modal shows, surfaced on the
 * enacted/voting bill view. Sector takeovers list every affected holder + the
 * treasury cost; whole-corp takeovers show the target's profile.
 */
export function NationalizationProvisionDetailCard({
  detail,
}: {
  detail: NationalizationProvisionDetail;
}) {
  if (detail.kind === "sector") {
    const s = detail.sector;
    return (
      <div className="mt-1.5 rounded-lg border border-card-border bg-card-muted p-3 text-xs">
        {detail.approximate && <ApproximateNote />}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-foreground">
            {s.affectedCount} corporation{s.affectedCount === 1 ? "" : "s"} affected
          </span>
          <span className="text-muted">
            {detail.actualPayoutLocal !== undefined ? "Est. treasury cost ~" : "Treasury cost ~"}
            <span className="font-medium text-foreground">
              {natMoney(s.totalCompensationLocal, s.currency)}
            </span>
          </span>
        </div>
        {detail.actualPayoutLocal !== undefined && (
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
            <span className="text-muted">Actual payout</span>
            <span className="font-semibold text-success">
              {natMoney(detail.actualPayoutLocal, s.currency)}
            </span>
          </div>
        )}
        {s.unownedSliceRevenuePerTurn > 0 && s.scope !== "corporations" && (
          <div className="mt-1 text-[11px] text-muted">
            + {natMoney(s.unownedSliceRevenuePerTurn, s.currency)}/turn of unowned market taken
            free.
          </div>
        )}
        {s.affectedCorps.length > 0 && (
          <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
            {s.affectedCorps.map((c) => (
              <li key={c.corporationId} className="flex items-center justify-between gap-3">
                <span className="truncate text-foreground">
                  {c.name}{" "}
                  <span className="text-[10px] text-muted">
                    · {c.sectorCount} in {c.regionCount} region{c.regionCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-muted">
                  {natMoney(c.estCompensationLocal, s.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {s.affectedCount === 0 && s.scope !== "unowned" && (
          <p className="mt-1 text-[11px] text-muted">
            No corporation currently holds this sector type.
          </p>
        )}
      </div>
    );
  }

  const c = detail.corp;
  return (
    <div className="mt-1.5 rounded-lg border border-card-border bg-card-muted p-3 text-xs">
      {detail.approximate && <ApproximateNote />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{c.name}</span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full border border-card-border px-1.5 py-0.5 text-[10px] text-muted capitalize">
            {c.ownerKind}-owned
          </span>
          {c.triggers.map((t) => (
            <span
              key={t}
              className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400 capitalize"
            >
              {t}
            </span>
          ))}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        <Stat label="CEO" value={c.ceoVacant ? "Vacant" : (c.ceoName ?? "—")} />
        <Stat label="Revenue/turn" value={natMoney(c.totalRevenuePerTurn, c.currency)} />
        <Stat label="Avg growth" value={`${c.avgGrowthPct}%`} />
        <Stat label="Avg production" value={`${c.avgProductionPct}%`} />
        <Stat label="HQ" value={c.hqStateName} />
        <Stat label="Cash reserve" value={natMoney(c.liquidCapitalLocal, c.currency)} />
        <Stat
          label="Footprint"
          value={`${c.sectorCount} sector${c.sectorCount === 1 ? "" : "s"} · ${c.regionCount} region${c.regionCount === 1 ? "" : "s"}`}
        />
        {c.marketCapLocal > 0 && (
          <Stat label="Market cap" value={natMoney(c.marketCapLocal, c.currency)} />
        )}
        {detail.actualPayoutLocal !== undefined && (
          <Stat label="Actual payout" value={natMoney(detail.actualPayoutLocal, c.currency)} />
        )}
      </dl>
      {c.sectors.length > 0 && (
        <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto border-t border-card-border/40 pt-1.5">
          {c.sectors.map((sec, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <span className="truncate text-foreground">
                {CORPORATION_TYPE_LABELS[sec.sectorType as CorporationType] ?? sec.sectorType}{" "}
                <span className="text-[10px] text-muted">· {sec.stateName}</span>
              </span>
              <span className="shrink-0 font-mono text-muted">
                {natMoney(sec.revenuePerTurn, c.currency)}/turn
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApproximateNote() {
  return (
    <div className="mb-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-[10px] text-amber-400">
      Approximate — reconstructed from a backup near passage (a gap in backup coverage means the
      exact passage-time figures weren&apos;t recoverable).
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
