"use client";

import { Suspense, use } from "react";
import { PartyHubPage } from "./PartyHubPage";
import { PartyPageSkeleton } from "./PartyPageSkeleton";

export default function PartyPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  return (
    <Suspense fallback={<PartyPageSkeleton />}>
      <PartyPageContent params={params} />
    </Suspense>
  );
}

function PartyPageContent({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = use(params);
  return (
    <PartyHubPage
      scope={{
        kind: "national",
        countryCode: code,
        partyId: id,
      }}
    />
  );
}
