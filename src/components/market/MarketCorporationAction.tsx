"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { privateEnterpriseBlockedByYear } from "@/lib/economy/queries/privateEnterpriseRegime";
import { getFoundingFxRate } from "@/lib/corporations/foundingCosts";
import { fetchJson } from "@/lib/observability/fetchJson";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import { FoundCorporationModal } from "@/app/country/[code]/stockmarket/components/FoundCorporationModal";

export function MarketCorporationAction() {
  const { navData } = useAuthMe();
  const { currencySymbol, countryId, forexEnabled, baseRates } = useCurrency();
  const turn = useGameTurnStatus();
  const [open, setOpen] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [foundedId, setFoundedId] = useState<number | null>(null);
  const corporationId = foundedId ?? navData?.myCorporationId;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchJson<{ foundingCooldownTurnsRemaining?: number }>("/api/character/me", {
      cache: "no-store",
      feature: "character-me",
    })
      .then((data) => {
        if (!cancelled && data) setCooldown(data.foundingCooldownTurnsRemaining ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const className =
    "inline-flex items-center rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors";
  if (corporationId) {
    return (
      <Link href={`/corporation/${corporationId}`} className={className}>
        My corporation
      </Link>
    );
  }
  if (privateEnterpriseBlockedByYear(countryId?.toUpperCase(), turn?.currentYear)) return null;

  return (
    <>
      <button
        type="button"
        data-coach="nav-corporations"
        className={className}
        onClick={() => setOpen(true)}
      >
        Found corporation
      </button>
      <FoundCorporationModal
        open={open}
        onClose={() => setOpen(false)}
        currencySymbol={currencySymbol}
        countryId={countryId ?? undefined}
        foundingRate={getFoundingFxRate(countryId, forexEnabled, baseRates)}
        foundingCooldownTurnsRemaining={cooldown}
        onSuccess={() => {
          requestCharacterStatsRefetch();
          fetchJson<{ corporation?: { sequentialId: number } }>("/api/character/me", {
            cache: "no-store",
            feature: "character-me",
          })
            .then((data) => {
              if (data?.corporation) setFoundedId(data.corporation.sequentialId);
            })
            .catch(() => {});
        }}
      />
    </>
  );
}
