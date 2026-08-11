"use client";

import { useEffect, useState } from "react";
import type { DoctrineState } from "@/lib/military/doctrineTree";

/**
 * Client state for the national doctrine tree (Secretary of Defense Office →
 * Doctrine tab). Seeded from the live per-country doctrine passed by the office
 * page; `adopt` posts to the gated adopt route and reflects the server's
 * returned state, then triggers the office refetch.
 */
export function useDoctrineState(
  seed: DoctrineState,
  ctx: { countryCode: string; positionId: string; onAdopt: () => void }
): {
  state: DoctrineState;
  adopt: (key: string) => Promise<{ ok: boolean; reason?: string }>;
} {
  const [state, setState] = useState<DoctrineState>(seed);

  // Keep local state in sync when the office refetch supplies a fresh seed.
  useEffect(() => {
    setState(seed);
  }, [seed]);

  const adopt = async (key: string): Promise<{ ok: boolean; reason?: string }> => {
    const res = await fetch(
      `/api/country/${ctx.countryCode}/executive/cabinet/${ctx.positionId}/doctrine/adopt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      }
    );
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: e.error };
    }
    const next = (await res.json()) as DoctrineState;
    setState(next);
    ctx.onAdopt();
    return { ok: true };
  };

  return { state, adopt };
}
