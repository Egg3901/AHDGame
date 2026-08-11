"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { useCurrency } from "@/contexts/CurrencyContext";
import { centralBankUrl } from "@/lib/urls";

interface LocMeResponse {
  composite: number;
  spreadPercentPoints: number;
  outstandingInternal: number;
  availableBorrowInternal: number;
  drawFrozen: boolean;
  homePrimePercent?: number;
}

/**
 * Portfolio / character-profile strip linking to central-bank LOC when forex + feature are on.
 */
export function LocWalletStrip({ countryId }: { countryId: CountryId }) {
  const { formatAmount } = useCurrency();
  const [data, setData] = useState<LocMeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    void fetch("/api/character/loc")
      .then(async (r) => {
        if (!r.ok) {
          setData(null);
          return;
        }
        const j = (await r.json()) as LocMeResponse;
        setData(j);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- initial fetch
  }, [load]);

  if (loading || !data) return null;

  const ccy = COUNTRY_CURRENCY_MAP[countryId];
  const href = `${centralBankUrl(countryId)}?tab=loc`;
  const primeLabel =
    typeof data.homePrimePercent === "number" ? `${data.homePrimePercent.toFixed(2)}%` : null;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.06] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">
            Line of credit ({ccy})
          </div>
          <div className="text-xs text-muted">
            {primeLabel ? <>Home policy prime {primeLabel} · </> : null}
            Composite {(data.composite ?? 0).toFixed(0)} · spread{" "}
            {(data.spreadPercentPoints ?? 0) >= 0 ? "+" : ""}
            {(data.spreadPercentPoints ?? 0).toFixed(2)}% vs prime
            {data.drawFrozen ? (
              <span className="ml-2 font-semibold text-warning"> · Draws frozen</span>
            ) : null}
          </div>
          <div className="mt-1 text-xs tabular-nums text-foreground/90">
            Outstanding {formatAmount(data.outstandingInternal)} · headroom{" "}
            {formatAmount(data.availableBorrowInternal)}
          </div>
        </div>
        <Link
          href={href}
          className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
        >
          Manage loan
        </Link>
      </div>
    </div>
  );
}
