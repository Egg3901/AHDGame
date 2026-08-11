"use client";

import type { GameHealthSnapshot } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";

interface Props {
  snapshot: GameHealthSnapshot | null;
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function GameHealthPopulationEconomy({ snapshot }: Props) {
  if (!snapshot) return null;

  const { population, economy } = snapshot;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Population</h3>
        <div className="space-y-1 text-sm">
          <Row label="Active Players" value={population.activePlayers} />
          <Row label="Characters" value={population.totalCharacters} />
          <Row label="NPPs" value={population.totalNPPs.toLocaleString("en-US")} />
          <Row
            label="Seats"
            value={`${population.totalSeats - population.emptySeats} / ${population.totalSeats}`}
          />
          <Row label="Empty Seats" value={population.emptySeats} />
          <Row label="Parties" value={population.partiesCount} />
          <Row label="Active Elections" value={population.activeElections} />
          <Row label="Avg Party Size" value={population.averagePartySize.toFixed(1)} />
        </div>
        {Object.entries(population.byCountry).length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">By Country</summary>
            <div className="mt-2 space-y-2">
              {Object.entries(population.byCountry).map(([id, stats]) =>
                stats ? (
                  <div key={id} className="text-xs">
                    <span className="font-medium">{id}:</span> {stats.players} players, {stats.npps}{" "}
                    NPPs, {stats.emptySeats} empty, {stats.parties} parties
                  </div>
                ) : null
              )}
            </div>
          </details>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-foreground">Economy</h3>
        <p className="mb-3 text-xs text-muted">
          Currency-denominated figures are each country&rsquo;s own LOCAL currency (code shown per
          row) — GDP levels are not comparable across countries.
        </p>
        <div className="space-y-3">
          {Object.entries(economy.byCountry).map(([id, stats]) => {
            if (!stats) return null;
            const currencyCode = COUNTRY_CURRENCY_MAP[id as CountryId];
            // Fall back to the currency CODE itself, never a hardcoded symbol —
            // a silent "$" fallback for an un-mapped currency would misrepresent
            // a non-dollar economy as dollar-denominated (the exact mislabeling
            // bug this panel already had for the GDP row below).
            const sym = CURRENCY_SYMBOLS[currencyCode] ?? "";
            const money = (n: number) => `${sym}${Math.round(n).toLocaleString("en-US")}`;
            return (
              <div key={id} className="space-y-1 text-sm">
                <p className="font-medium">{id}</p>
                <div className="ml-2 space-y-0.5 text-xs">
                  {/* RATE (%/yr), not a level. Snapshots written before v0.2.6
                      have no gdpGrowth and their `gdp` field IS the rate, so
                      neither row can render a pre-migration doc's numbers under
                      the new labels — show a dash instead of NaN%/bogus money. */}
                  <Row
                    label="GDP Growth"
                    value={
                      Number.isFinite(stats.gdpGrowth)
                        ? `${(stats.gdpGrowth * 100).toFixed(1)}%`
                        : "—"
                    }
                  />
                  {/* LEVEL, in this country's own local currency, millions. Never compare
                      this figure across countries — see the caption above. */}
                  <Row
                    label={`GDP Level (${currencyCode}, millions)`}
                    value={Number.isFinite(stats.gdpGrowth) ? money(stats.gdp) : "—"}
                  />
                  <Row label="Inflation" value={`${(stats.inflation * 100).toFixed(1)}%`} />
                  <Row label="Interest Rate" value={`${(stats.interestRate * 100).toFixed(1)}%`} />
                  <Row
                    label="Bond Default Rate"
                    value={`${(stats.bondDefaultRate * 100).toFixed(1)}%`}
                  />
                  {/* Snapshot builder normalises corp revenue to the ₳ anchor
                      (gameHealthSnapshot.ts v0.2.6) — NOT local currency like
                      the rows around it, so it must not carry the local code. */}
                  <Row
                    label="Corp Revenue (₳ anchor)"
                    value={`₳${Math.round(stats.totalCorporationRevenue).toLocaleString("en-US")}`}
                  />
                  <Row
                    label={`Avg Player Funds (${currencyCode})`}
                    value={money(stats.averagePlayerFunds)}
                  />
                  <Row
                    label={`Fund Circulation (${currencyCode})`}
                    value={money(stats.fundCirculation)}
                  />
                </div>
              </div>
            );
          })}
          {Object.keys(economy.byCountry).length === 0 && (
            <p className="text-xs text-muted">No economic data available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
