"use client";

import { useEffect, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { fetchJson } from "@/lib/observability/fetchJson";

interface ExecutiveResponse {
  isPresident?: boolean;
  isPrimeMinister?: boolean;
}
interface BudgetFederalResponse {
  isFinanceMinister?: boolean;
}
interface OfficialsResponse {
  officials?: { governor?: { characterId?: string | null } | null };
}
interface CharacterMeResponse {
  character?: { _id?: string } | null;
}

/**
 * Resolves whether the current viewer may issue extraction contracts (or
 * commission a government geological survey) for a country and, optionally,
 * a specific state.
 *
 * National eligibility = executive office holder (president / prime minister,
 * however the country's government type names it) OR the finance minister
 * cabinet seat. State eligibility = that state's sitting governor (or
 * country-specific regional-executive equivalent).
 *
 * Reuses the existing, stable per-surface endpoints rather than adding new
 * API routes:
 * - `/api/country/[code]/executive` returns isPresident / isPrimeMinister
 * - `/api/country/[code]/budget/federal` returns isFinanceMinister
 * - `/api/country/[code]/region/[id]/officials` + `/api/character/me` are
 *   cross-referenced for a governor match (officeType "governor" is the
 *   cross-country convention; see src/lib/states/regionalExecutive.ts).
 *
 * NPP/party-officer proxy management of a vacant office is out of scope here;
 * only a human sitting in the seat counts. Each lookup fails independently
 * (a down endpoint just hides that one path) so one bad response never blocks
 * the others.
 */
export function useExtractionIssuerAccess(countryId: CountryId | string, stateId?: string | null) {
  const [isNationalIssuer, setIsNationalIssuer] = useState(false);
  const [isStateIssuer, setIsStateIssuer] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const [execResult, budgetResult] = await Promise.allSettled([
        fetchJson<ExecutiveResponse>(`/api/country/${countryId}/executive`, {
          feature: "extraction:issuer-access:executive",
        }),
        fetchJson<BudgetFederalResponse>(`/api/country/${countryId}/budget/federal`, {
          feature: "extraction:issuer-access:budget",
        }),
      ]);
      const isPresidentOrPm =
        execResult.status === "fulfilled" &&
        !!(execResult.value.isPresident || execResult.value.isPrimeMinister);
      const isFinanceMinister =
        budgetResult.status === "fulfilled" && budgetResult.value.isFinanceMinister === true;
      const nationalIssuer = isPresidentOrPm || isFinanceMinister;

      let stateIssuer = false;
      if (stateId) {
        const [officialsResult, meResult] = await Promise.allSettled([
          fetchJson<OfficialsResponse>(`/api/country/${countryId}/region/${stateId}/officials`, {
            feature: "extraction:issuer-access:officials",
          }),
          fetchJson<CharacterMeResponse>(`/api/character/me`, {
            feature: "extraction:issuer-access:character-me",
          }),
        ]);
        if (officialsResult.status === "fulfilled" && meResult.status === "fulfilled") {
          const myId = meResult.value.character?._id;
          const governor = officialsResult.value.officials?.governor;
          stateIssuer = !!myId && !!governor?.characterId && governor.characterId === myId;
        }
      }

      if (!cancelled) {
        setIsNationalIssuer(nationalIssuer);
        setIsStateIssuer(stateIssuer);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [countryId, stateId]);

  return { isNationalIssuer, isStateIssuer, loading };
}
