"use client";

import { StatePartyHQ } from "@/components/party/hq/StatePartyHQ";

/**
 * National HQ surface — sortable state-party table, per-country map, per-state
 * action drawer and bulk operations. Replaces the former bare region-link grid.
 * Keeps the `StatePartyLinksTab` name + base props so the national page import
 * is unchanged; `canManage` / `canSpendPs` thread chair/VC/admin context.
 */
export function StatePartyLinksTab({
  partyId,
  partyColor,
  countryId,
  canManage = false,
  canSpendPs = false,
  nationalPoliticalStrength = 0,
  nationalTreasury = 0,
  onNationalPsSpent,
}: {
  partyId: string;
  partyColor: string;
  countryId: string;
  canManage?: boolean;
  canSpendPs?: boolean;
  nationalPoliticalStrength?: number;
  nationalTreasury?: number;
  onNationalPsSpent?: () => void;
}) {
  return (
    <StatePartyHQ
      countryId={countryId}
      partyId={partyId}
      partyColor={partyColor}
      canManage={canManage}
      canSpendPs={canSpendPs}
      nationalPoliticalStrength={nationalPoliticalStrength}
      nationalTreasury={nationalTreasury}
      onNationalPsSpent={onNationalPsSpent}
    />
  );
}
