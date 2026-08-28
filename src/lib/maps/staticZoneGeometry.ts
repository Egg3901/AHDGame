/**
 * Which static shard, if any, draws a conflict host.
 *
 * Split out of `proxyHostGeometry` because these two are PURE and the server
 * needs them: the conflict record decides whether to render a map column at all,
 * and a host with neither region shards nor a static shard draws nothing but a
 * "no mapped territory" sentence in a 620px box. That decision has to be made
 * before the layout is chosen, which means on the server — and it cannot import
 * them through the `"use client"` module the hook lives in.
 */
import { VIETNAM_FEATURE_IDS, VIETNAM_GEO_URL } from "@/lib/maps/vietnamGeometry";
import { HISTORICAL_FEATURE_IDS, HISTORICAL_GEO_URL } from "@/lib/maps/historicalGeometry";

export interface StaticHostGeometry {
  url: string;
  /**
   * The roster codes this host contributes.
   *
   * ⚠️ Both consumers filter features against a roster — `RegionalGeoMap` builds a
   * Set from `regionCodes` and drops everything outside it, and `FrontLineMap`
   * filters inline. Supplying the features WITHOUT these codes renders an empty box
   * rather than a map, and every "features is non-empty" assertion still passes.
   */
  codes: string[];
}

/** The static shard covering this host, or null when nothing draws it. */
export function staticHostGeometry(hostEntityId: string): StaticHostGeometry | null {
  if ((VIETNAM_FEATURE_IDS as readonly string[]).includes(hostEntityId)) {
    // Both halves: a Vietnam proxy is the whole country split at the 17th
    // parallel, not a single successor state. Drawing only the host left a
    // half-outline and a west-east fallback axis because the other capital
    // sat off the map.
    return { url: VIETNAM_GEO_URL, codes: [...VIETNAM_FEATURE_IDS] };
  }
  if ((HISTORICAL_FEATURE_IDS as readonly string[]).includes(hostEntityId)) {
    return { url: HISTORICAL_GEO_URL, codes: [hostEntityId] };
  }
  return null;
}

/**
 * Every static shard a whole conflict zone needs, and the codes they contribute.
 *
 * A conflict is fought over `hostEntities`, not over one country — a proxy war can
 * be hosted in two, and the German Question widens its war to both Germanies. Each
 * host resolves independently, so a zone can mix an ordinary country (no shard),
 * a Vietnam half and a historical territory; the urls dedupe because two hosts
 * often share one file.
 */
export function staticZoneGeometry(hostEntityIds: readonly string[]): {
  urls: string[];
  codes: string[];
} {
  const urls: string[] = [];
  const codes = new Set<string>();
  for (const id of hostEntityIds) {
    const source = staticHostGeometry(id);
    if (!source) continue;
    if (!urls.includes(source.url)) urls.push(source.url);
    for (const code of source.codes) codes.add(code);
  }
  return { urls, codes: [...codes] };
}
