"use client";

import { useState, useEffect, Suspense } from "react";
import { useParams } from "next/navigation";
import BackButton from "@/components/BackButton";
import { Skeleton } from "@/components/ui";
import CorporationPortfolioView from "../../components/CorporationPortfolioView";

export default function CorporationPublicPortfolioPage() {
  return (
    <Suspense>
      <CorporationPublicPortfolioInner />
    </Suspense>
  );
}

function CorporationPublicPortfolioInner() {
  const params = useParams();
  const corpRouteId = params.corpId as string;

  const [isCeo, setIsCeo] = useState(false);
  const [meLoaded, setMeLoaded] = useState(false);

  useEffect(() => {
    if (!corpRouteId) return;
    Promise.all([
      fetch("/api/character/me").then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/corporations/${corpRouteId}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([me, corpPayload]) => {
        const ceoId = corpPayload?.ceo?.characterId;
        if (me?.character?._id && ceoId && me.character._id === ceoId) {
          setIsCeo(true);
        } else {
          setIsCeo(false);
        }
      })
      .catch(() => setIsCeo(false))
      .finally(() => setMeLoaded(true));
  }, [corpRouteId]);

  if (!corpRouteId) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-5xl px-4 py-8">
          <p className="text-muted">Invalid corporation.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <BackButton fallbackHref={`/corporation/${corpRouteId}`} fallbackLabel="Corporation" />
        {!meLoaded ? (
          <div className="space-y-8">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        ) : (
          <CorporationPortfolioView corpRouteId={corpRouteId} isCeo={isCeo} />
        )}
      </main>
    </div>
  );
}
