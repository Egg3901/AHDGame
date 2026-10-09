import type { loadPrimaryPartyData } from "@/lib/elections/primaryPartyDetail";

/**
 * The party's board, shared across the state requests of one zoom. Building it
 * projects every state, and the map asks for counties a state at a time, so a
 * zoom across the Northeast rebuilt it a dozen times. Nothing read here depends
 * on the viewer (only the board's viewer-campaign block does), so the cache is
 * per race and party, for one minute; primary night moves on a minute scale.
 */
const PARTY_DATA_TTL_MS = 60_000;
const partyDataCache = new Map<
  string,
  { at: number; data: Promise<Awaited<ReturnType<typeof loadPrimaryPartyData>>> }
>();

export function cachedPartyData(
  electionId: string,
  partyId: string,
  load: () => ReturnType<typeof loadPrimaryPartyData>
): ReturnType<typeof loadPrimaryPartyData> {
  const key = `${electionId}|${partyId}`;
  const now = Date.now();
  const hit = partyDataCache.get(key);
  if (hit && now - hit.at < PARTY_DATA_TTL_MS) return hit.data;
  const data = load().catch((err) => {
    partyDataCache.delete(key);
    throw err;
  });
  partyDataCache.set(key, { at: now, data });
  if (partyDataCache.size > 200) {
    for (const [k, v] of partyDataCache)
      if (now - v.at >= PARTY_DATA_TTL_MS) partyDataCache.delete(k);
  }
  return data;
}

/** Test hook: forget every cached board. */
export function clearPartyDataCache(): void {
  partyDataCache.clear();
}
