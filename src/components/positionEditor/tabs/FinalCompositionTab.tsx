"use client";
import { formatLeanValue } from "@/lib/utils/demographics";
import type { DerivedComposition } from "@/lib/positionEditor/types";

export function FinalCompositionTab({ derived }: { derived: DerivedComposition }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-card shadow-card">
      <table className="w-full text-sm text-foreground">
        <thead>
          <tr className="border-b border-card-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Archetype</th>
            <th className="px-3 py-2 text-right">Pop %</th>
            <th className="px-3 py-2 text-right">Voting pool %</th>
            <th className="px-3 py-2 text-right">Econ</th>
            <th className="px-3 py-2 text-right">Social</th>
            <th className="px-3 py-2 text-right">Turnout %</th>
          </tr>
        </thead>
        <tbody>
          {derived.archetypes.map((a) => (
            <tr key={a.id} className="border-t border-card-border">
              <td className="px-3 py-2">{a.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{a.populationShare.toFixed(1)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{a.votingPoolShare.toFixed(1)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatLeanValue(a.economicLean)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatLeanValue(a.socialLean)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{a.turnout}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-muted/40 font-semibold">
            <td className="px-3 py-2">State lean</td>
            <td />
            <td />
            <td className="px-3 py-2 text-right tabular-nums">
              {formatLeanValue(derived.stateEconomicLean)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatLeanValue(derived.stateSocialLean)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
