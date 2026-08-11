"use client";

interface Bailout {
  countryCode: string;
  principalOutstanding: number;
  annualRate: number;
  amortizationTurnsRemaining: number;
  incomeCaptureFraction: number;
  cumulativePaidAnchor: number;
  crisisChoice: string | null;
  recoveryStartedAt: { turn: number } | null;
}

interface Props {
  bailouts: Bailout[];
}

function formatBig(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

export function ActiveSovereignBailoutsPanel({ bailouts }: Props) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">Active Sovereign Bailouts</h2>
      {bailouts.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">No active sovereign IMF facilities.</p>
      ) : (
        <table className="mt-3 w-full text-xs">
          <thead className="border-b border-zinc-200 dark:border-zinc-700">
            <tr className="text-left text-zinc-500">
              <th className="py-1">Country</th>
              <th className="py-1 text-right">Principal</th>
              <th className="py-1 text-right">Rate</th>
              <th className="py-1 text-right">Income share</th>
              <th className="py-1 text-right">Paid to date</th>
              <th className="py-1 text-right">Turns left</th>
            </tr>
          </thead>
          <tbody>
            {bailouts.map((b) => (
              <tr key={b.countryCode} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 font-medium">{b.countryCode}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatBig(b.principalOutstanding)}
                </td>
                <td className="py-1 text-right tabular-nums">{b.annualRate.toFixed(1)}%</td>
                <td className="py-1 text-right tabular-nums">
                  {(b.incomeCaptureFraction * 100).toFixed(0)}%
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatBig(b.cumulativePaidAnchor)}
                </td>
                <td className="py-1 text-right tabular-nums">{b.amortizationTurnsRemaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
