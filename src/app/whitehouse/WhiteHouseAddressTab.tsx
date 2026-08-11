"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AddressTab,
  type MostRecentAddressSummary,
} from "@/app/country/[code]/region/[id]/office/tabs/AddressTab";
import type { CountryId } from "@/lib/constants/countries";
import { CardSkeleton, Skeleton } from "@/components/ui";

interface AddressResponse {
  countryId: CountryId;
  stateId: string;
  currentTurn: number;
  gubernatorialActions: number;
  lastActionGrantedTurn: number;
  nationalInfluence: number;
  viewerIsLeader: boolean;
  viewerIsAdmin: boolean;
  mostRecentAddress: MostRecentAddressSummary | null;
  addressAvailableAtTurn: number;
  demographicGroups: { id: string; name: string }[];
}

interface Props {
  countryId: CountryId;
}

/**
 * Federal-scope Address tab. Lazy-fetches state from
 * `/api/country/[code]/executive/address` and renders the shared `AddressTab`
 * with `scope="national"`. Mirrors `WhiteHouseOrdersTab` structurally.
 */
export function WhiteHouseAddressTab({ countryId }: Props) {
  const [data, setData] = useState<AddressResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/country/${countryId.toLowerCase()}/executive/address`, {
        cache: "no-store",
      });
      if (res.ok) {
        setData((await res.json()) as AddressResponse);
      } else {
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !data) {
    return (
      <CardSkeleton className="min-h-56 space-y-4">
        <Skeleton className="h-5 w-48" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-9 w-40" />
      </CardSkeleton>
    );
  }

  return (
    <AddressTab
      scope="national"
      countryId={data.countryId}
      stateId={data.stateId}
      mostRecentAddress={data.mostRecentAddress}
      addressAvailableAtTurn={data.addressAvailableAtTurn}
      currentTurn={data.currentTurn}
      viewerIsHolder={data.viewerIsLeader}
      viewerIsAdmin={data.viewerIsAdmin}
      gubernatorialActions={data.gubernatorialActions}
      onAddressDelivered={fetchData}
    />
  );
}
