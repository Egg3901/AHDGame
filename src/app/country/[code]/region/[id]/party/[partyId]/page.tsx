"use client";

import { Suspense, use } from "react";
import { PartyHubPage } from "@/app/country/[code]/parties/[id]/PartyHubPage";
import { PartyPageSkeleton } from "@/app/country/[code]/parties/[id]/PartyPageSkeleton";
import { canonicalRegionId } from "@/lib/constants/countries";

export default function StatePartyPage({
  params,
}: {
  params: Promise<{ code: string; id: string; partyId: string }>;
}) {
  return (
    <Suspense fallback={<PartyPageSkeleton />}>
      <StatePartyPageContent params={params} />
    </Suspense>
  );
}

function StatePartyPageContent({
  params,
}: {
  params: Promise<{ code: string; id: string; partyId: string }>;
}) {
  const { code, id: rawRegionParam, partyId } = use(params);
  // Compact region codes (BUD) arrive from player-facing URLs; re-expand to the
  // canonical `states._id` (HU_BUD) before anything queries by region.
  const regionId = canonicalRegionId(code.toUpperCase(), rawRegionParam.toUpperCase());
  return (
    <PartyHubPage
      scope={{
        kind: "state",
        countryCode: code,
        partyId,
        stateId: regionId,
        regionId,
      }}
    />
  );
}
