/**
 * governingMetrics — current domain "health" for the governing brain.
 *
 * The agenda sets `target` health values per domain; ministers (V1.4) and the
 * accountability loop (performance scoring) need the *current* value to know
 * whether a goal is met. This reads the national `stateMetrics` doc and reduces
 * it to a `domain → health` map using the shared METRIC_TO_DOMAIN vocabulary —
 * the same source `buildConditionsSignal` reads, so "what's weak" and "what's
 * healthy" stay consistent.
 *
 * The reduction is pure + unit-tested; the loader is a thin DB read.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  loadNationalPoliticalBoard,
  politicalDomainHealth,
} from "@/lib/politicalLegislation/conditionsSignal";
import { METRIC_TO_DOMAIN } from "./selectNppBill";

/**
 * Reduce a national stateMetrics doc to `domain → health` (0–100, higher =
 * healthier). A domain's health is the **worst** (min) of its mapped metrics, so
 * a single failing metric keeps the domain's goal unmet. Pure.
 */
export function domainHealthFromMetrics(
  stateMetrics: Record<string, unknown> | null | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  const metrics = (stateMetrics ?? {}) as Record<string, Record<string, unknown>>;
  for (const [category, metricMap] of Object.entries(METRIC_TO_DOMAIN)) {
    const categoryDoc = metrics[category] ?? {};
    for (const [metricId, domain] of Object.entries(metricMap)) {
      const mv = categoryDoc[metricId];
      const raw =
        typeof mv === "object" && mv !== null && "value" in mv
          ? (mv as { value: unknown }).value
          : mv;
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      out[domain] = domain in out ? Math.min(out[domain], raw) : raw;
    }
  }
  return out;
}

/** Load current `domain → health` for a country's national metrics. */
export async function loadDomainHealth(
  db: Db,
  countryId: CountryId
): Promise<Record<string, number>> {
  const nationalDocId = getNationalDocId(countryId);
  if (!nationalDocId) return {};
  // Two stores, two halves: the economic domains come from macroMetrics, the
  // political domains from the country's board. There is no third branch — the
  // one that read a legacy political doc is gone, and a country without a board
  // (SCO/WAL, latent until the independence process activates them) simply
  // reports economic domains only, exactly as it did when that read returned
  // nothing.
  const [board, doc] = await Promise.all([
    loadNationalPoliticalBoard(db, countryId),
    (
      db.collection("macroMetrics") as import("mongodb").Collection<Record<string, unknown>>
    ).findOne(
      { _id: nationalDocId } as unknown as import("mongodb").Filter<Record<string, unknown>>,
      { projection: { economic: 1 } }
    ),
  ]);
  return {
    ...domainHealthFromMetrics(doc as Record<string, unknown> | null),
    ...(board ? politicalDomainHealth(board) : {}),
  };
}
