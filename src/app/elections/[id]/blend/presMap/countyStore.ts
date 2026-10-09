import type { CountyApiResponse } from "./countyModel";

/**
 * County results, one request per race, state and turn for the page's
 * lifetime. The state panel's county table and the map's county layer read
 * the same entries, so opening a state the reader has already zoomed into
 * costs nothing.
 *
 * Resolves to null when the state has no county results (404, empty, or a
 * network failure). A failure is not cached, so a later look retries.
 */
const results = new Map<string, CountyApiResponse>();
const inflight = new Map<string, Promise<CountyApiResponse | null>>();

export function countyKey(electionId: string, stateId: string, turn: number | null): string {
  return `${electionId}|${stateId}|${turn ?? ""}`;
}

export function cachedCounties(key: string): CountyApiResponse | undefined {
  return results.get(key);
}

export function loadCounties(
  electionId: string,
  stateId: string,
  turn: number | null
): Promise<CountyApiResponse | null> {
  const key = countyKey(electionId, stateId, turn);
  const hit = results.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await fetch(`/api/elections/${electionId}/state/${stateId}/subdivision-results`);
      if (!res.ok) return null;
      const data = (await res.json()) as CountyApiResponse;
      if (!Array.isArray(data.subdivisions) || data.subdivisions.length === 0) return null;
      results.set(key, data);
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}
