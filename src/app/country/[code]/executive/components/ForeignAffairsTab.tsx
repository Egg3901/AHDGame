"use client";

import type { CountryId } from "@/lib/constants/countries";
import { DeclareWarPanel } from "../cabinet/[positionId]/office/components/military/DeclareWarPanel";
import { PeacePanel } from "../cabinet/[positionId]/office/components/PeacePanel";

/**
 * The head of government's war-and-peace surface.
 *
 * Both APIs already authorize the head of government; before this tab existed they
 * had nowhere to click, because the cabinet office page gates its controls on
 * `isHolder || isAdmin` — the holder of THAT seat. That gate is correct for a seat's
 * own office, so the head of government gets their own surface rather than controls
 * inside someone else's.
 *
 * Mounted by BOTH executive shells (`ExecutiveTabsClient` for parliamentary and
 * one-party, `WhiteHouseClient` for presidential) so the two cannot drift.
 *
 * Spec: the design doc
 */
export function ForeignAffairsTab({
  countryId,
  canAct,
}: {
  countryId: CountryId;
  /** True for the sitting head of government, or an admin. */
  canAct: boolean;
}) {
  // The panels' fetch paths are lowercase (`/api/country/us/...`); the shells carry
  // the uppercase CountryId. Converting here keeps that detail in one place.
  const countryCode = countryId.toLowerCase();
  return (
    <div className="space-y-6">
      <DeclareWarPanel countryCode={countryCode} countryId={countryId} canAct={canAct} />
      <PeacePanel countryCode={countryCode} countryId={countryId} canAct={canAct} />
    </div>
  );
}
