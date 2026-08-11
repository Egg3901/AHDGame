"use client";

import { useState, useEffect, useCallback } from "react";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { legislatureApiUrl } from "@/lib/urls";
import type { CountryId } from "@/lib/constants/countries";
import type { BillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";

/**
 * Members data structure from legislature member APIs
 */
export interface MembersData {
  totalSeats: number;
  filledSeats: number;
  vacantSeats: number;
  composition: Array<{
    partyId: string;
    partyName: string;
    partyColor: string;
    economicPosition: number;
    seats: number;
  }>;
  members: Array<{
    characterId: string;
    sequentialId?: number | null;
    characterName: string;
    constituency: string;
    constituencyId?: string | null;
    region?: string;
    party: string;
    partyName: string;
    partyColor: string;
    isNPP: boolean;
    seatsHeld: number;
    avatarUrl?: string | null;
  }>;
}

/**
 * Bills data structure from legislature bill APIs
 */
export interface BillsData {
  bills: BillDisplay[];
  canPropose: boolean;
  adminOverride: boolean;
  hasActiveBill?: boolean;
  blockedProvisions?: { legislationTypeId: string; policyOptionId: string }[];
  proposalWarnings?: Record<string, BillProposalAutoFailWarning | null>;
  total: number;
  page: number;
  limit: number;
}

/**
 * Leaders data structure from legislature leader APIs.
 * Fields are keyed generically — each country maps its executive title
 * (PM, Chancellor) to `primeMinister` for simplicity.
 */
export interface LeadersData {
  primeMinister: {
    characterId: string;
    sequentialId?: number | null;
    characterName: string;
    party: string | null;
    since: string | null;
    avatarUrl?: string | null;
  } | null;
  oppositionLeader: {
    characterId: string;
    sequentialId?: number | null;
    characterName: string;
    party: string | null;
    since: string | null;
    avatarUrl?: string | null;
  } | null;
  speaker: {
    characterId: string;
    sequentialId?: number | null;
    characterName: string;
    party: string | null;
    since: string | null;
    avatarUrl?: string | null;
  } | null;
}

/**
 * Error with details about which endpoints failed
 */
export interface LegislatureDataError extends Error {
  failedEndpoints?: string[];
}

/**
 * Hook return type
 */
export interface UseLegislatureDataReturn {
  members: MembersData | null;
  bills: BillsData | null;
  leaders: LeadersData | null;
  loading: boolean;
  error: LegislatureDataError | null;
  refetch: () => void;
}

/**
 * Build API URLs for a given country and optional chamber.
 */
function getEndpointUrls(
  countryId: string,
  chamber?: string
): { membersUrl: string; billsUrl: string; leadersUrl: string } {
  // Every legislature page that uses this hook is parliamentary and passes its
  // chamber explicitly (UK / DE / JP / CN / IE and the seceded parliaments
  // SCO / WAL); US Congress has its own data layer and never calls this. Members
  // + bills select the chamber via query; leaders are chamber-independent.
  const chamberParam = chamber ? `?chamber=${chamber}` : "";
  return {
    membersUrl: `${legislatureApiUrl(countryId)}/members${chamberParam}`,
    billsUrl: `${legislatureApiUrl(countryId)}/bills?page=1${chamber ? `&chamber=${chamber}` : ""}`,
    leadersUrl: `${legislatureApiUrl(countryId)}/leaders`,
  };
}

/**
 * Shared data fetching hook for legislature pages.
 * Fetches members, bills, and leaders data in parallel.
 *
 * @param countryId - Country code
 * @param chamber - Optional chamber key (e.g., "commons", "bundestag")
 */
export function useLegislatureData(
  countryId: CountryId,
  chamber?: string
): UseLegislatureDataReturn {
  const [members, setMembers] = useState<MembersData | null>(null);
  const [bills, setBills] = useState<BillsData | null>(null);
  const [leaders, setLeaders] = useState<LeadersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LegislatureDataError | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { membersUrl, billsUrl, leadersUrl } = getEndpointUrls(countryId, chamber);

      // Fetch all three endpoints in parallel (no-store to ensure fresh data)
      const [membersResponse, billsResponse, leadersResponse] = await Promise.all([
        fetch(membersUrl, { cache: "no-store" }).catch((err) => ({
          ok: false,
          error: err,
          endpoint: "members",
        })),
        fetch(billsUrl, { cache: "no-store" }).catch((err) => ({
          ok: false,
          error: err,
          endpoint: "bills",
        })),
        fetch(leadersUrl, { cache: "no-store" }).catch((err) => ({
          ok: false,
          error: err,
          endpoint: "leaders",
        })),
      ]);

      // Track failed endpoints
      const failedEndpoints: string[] = [];

      // Process members response
      if ("ok" in membersResponse && membersResponse.ok && "json" in membersResponse) {
        const data = await membersResponse.json();
        setMembers(data);
      } else {
        setMembers(null);
        failedEndpoints.push("members");
      }

      // Process bills response
      if ("ok" in billsResponse && billsResponse.ok && "json" in billsResponse) {
        const data = await billsResponse.json();
        setBills(data);
      } else {
        setBills(null);
        failedEndpoints.push("bills");
      }

      // Process leaders response
      if ("ok" in leadersResponse && leadersResponse.ok && "json" in leadersResponse) {
        const data = await leadersResponse.json();
        setLeaders(data);
      } else {
        setLeaders(null);
        failedEndpoints.push("leaders");
      }

      // Set error if any endpoints failed
      if (failedEndpoints.length > 0) {
        const err: LegislatureDataError = new Error(
          `Failed to fetch: ${failedEndpoints.join(", ")}`
        );
        err.failedEndpoints = failedEndpoints;
        setError(err);
      }
    } catch (err) {
      const error: LegislatureDataError =
        err instanceof Error ? err : new Error("Failed to fetch legislature data");
      setError(error);
      setMembers(null);
      setBills(null);
      setLeaders(null);
    } finally {
      setLoading(false);
    }
  }, [countryId, chamber]);

  // Fetch on mount and when countryId/chamber changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    members,
    bills,
    leaders,
    loading,
    error,
    refetch: fetchData,
  };
}
