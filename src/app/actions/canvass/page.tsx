"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui";
import type { Character } from "@/lib/db/types";
import { CanvassingPanel } from "@/app/campaign/[id]/components/CanvassingPanel";

export default function CanvassingActionPage() {
  const router = useRouter();
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCharacter = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/character");
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setCharacter(data);
    } catch (error) {
      console.error("Failed to fetch character:", error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchCharacter();
  }, [fetchCharacter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <div className="mb-6 space-y-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="min-h-[420px] space-y-4 rounded-lg border border-card-border bg-card p-6">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </main>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-error">No character found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground">Voter Canvassing</h1>
          <p className="mt-2 text-muted">
            Target voters who align with your positions for maximum effectiveness.
          </p>
        </div>

        <CanvassingPanel
          countryId={character.countryId}
          characterActions={character.actions}
          // LOCAL home-currency balance (canonical source of truth).
          characterFunds={character.currencyBalances?.campaign ?? character.funds ?? 0}
          onResourcesSpent={fetchCharacter}
        />

        <div className="mt-6">
          <button
            onClick={() => router.push("/actions")}
            className="text-sm text-primary hover:text-primary-dark transition-colors"
          >
            ← Back to Actions
          </button>
        </div>
      </main>
    </div>
  );
}
