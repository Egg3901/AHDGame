import { useEffect, useState } from "react";
import { MAX_MANIFESTO_ELECTION_IDS } from "@/lib/db/types/manifesto";

export interface ManifestoCatalogEntry {
  id: string;
  label: string;
  blurb?: string;
  policyDomain: string;
}

export interface ManifestoView {
  pledges: string[];
  locked: boolean;
  lockedAt?: string | null;
}

export interface CountryManifestos {
  catalog: ManifestoCatalogEntry[];
  pledgeCount: number;
  isPartyLeader: boolean;
  party: { id: string; name: string } | null;
  /** Keyed by election id; `null` where the caller's party has written none. */
  manifestos: Record<string, ManifestoView | null>;
}

/**
 * Every manifesto bar on the elections page, in one request.
 *
 * Each `ManifestoFlavorBar` used to fetch its own election's manifesto on
 * mount, so opening `/country/uk/elections` fired one authenticated request per
 * contested race — 19% of all logged API traffic on live, for a response whose
 * catalog/party/leader half was identical every time. This asks once and the
 * bars render from props.
 *
 * Returns `null` until resolved, and stays `null` on failure so the bars stay
 * hidden rather than rendering a half-truth.
 */
export function useCountryManifestos(
  countryCode: string,
  electionIds: string[]
): CountryManifestos | null {
  // Depend on the ids themselves, not the array identity — the caller derives
  // this list inside a render, so a fresh array arrives on every filter change.
  const idsKey = electionIds.join(",");
  const cacheKey = `${countryCode}|${idsKey}`;
  // The key travels with the data so a resolved batch is never handed back for
  // a different country or election set while its replacement is in flight.
  const [state, setState] = useState<{ key: string; data: CountryManifestos } | null>(null);

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) return;

    let cancelled = false;

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += MAX_MANIFESTO_ELECTION_IDS) {
      chunks.push(ids.slice(i, i + MAX_MANIFESTO_ELECTION_IDS));
    }

    void (async () => {
      try {
        const responses = await Promise.all(
          chunks.map(async (chunk) => {
            const qs = new URLSearchParams({ electionIds: chunk.join(",") });
            const res = await fetch(
              `/api/country/${countryCode.toLowerCase()}/elections/manifestos?${qs}`,
              // Matches the other elections-page fetches. One request now backs
              // every bar, so an unbounded hang would stall all of them.
              { signal: AbortSignal.timeout(15_000) }
            );
            if (!res.ok) throw new Error(`manifestos ${res.status}`);
            return (await res.json()) as CountryManifestos;
          })
        );
        if (cancelled || responses.length === 0) return;

        const [first] = responses;
        setState({
          key: cacheKey,
          data: {
            catalog: first.catalog,
            pledgeCount: first.pledgeCount,
            isPartyLeader: first.isPartyLeader,
            party: first.party,
            manifestos: Object.assign({}, ...responses.map((r) => r.manifestos)),
          },
        });
      } catch (err) {
        // Optional authoring affordance — degrade silently, stay observable.
        if (!cancelled) console.debug("manifesto batch fetch failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [countryCode, idsKey, cacheKey]);

  return state?.key === cacheKey ? state.data : null;
}
