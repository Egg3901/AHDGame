/**
 * Aggregated cascade news. The design specifies per-sector aggregation; for
 * Phase 7 the summary is country-level (count of bonds + insolvent corps) +
 * a separate mass-cascade alert when more than MASS_CASCADE_THRESHOLD corps
 * go insolvent in a single sovereign default. Phase 9 UI work will surface
 * per-sector and per-corp detail. Phase 11a adds a parallel page-wide
 * dismissible banner via the globalAlerts collection.
 */

import { ObjectId, type Db } from "mongodb";
import { createSystemNewsPost } from "@/lib/news";
import { MASS_CASCADE_THRESHOLD } from "../constants";
import type { CascadeResult } from "./cascadeOrchestrator";
import type { GlobalAlert } from "@/lib/db/types/globalAlert";

// 100 turns × 30 minutes/turn — keeps a mass-cascade alert visible across
// roughly 2 game days of dashboard load before auto-expiring.
const MASS_CASCADE_ALERT_TTL_MS = 100 * 30 * 60 * 1000;

export async function emitCascadeSummaryNews(
  countryCode: string,
  result: CascadeResult
): Promise<void> {
  if (result.totalBondsCascaded === 0 && result.totalCorpsInsolvent === 0) return;
  const content =
    `Sovereign Default Cascade — ${countryCode}: ${result.totalBondsCascaded} bond series ` +
    `cascaded across ${result.levels} levels; ${result.totalCorpsInsolvent} corporate insolvencies triggered.`;
  await createSystemNewsPost(content, "sovereign");
}

export async function emitMassCascadeAlert(
  db: Db,
  countryCode: string,
  insolventCorpCount: number,
  currentTurn: number
): Promise<void> {
  if (insolventCorpCount <= MASS_CASCADE_THRESHOLD) return;
  const content =
    `Systemic Crisis Alert — ${countryCode}: ${insolventCorpCount} corporations insolvent ` +
    `in a single cascade. IMF Board notified.`;
  await createSystemNewsPost(content, "sovereign");

  // Phase 11a: insert a global alert so a page-wide banner surfaces. Best-
  // effort — failing to insert shouldn't break the cascade flow (the news
  // article above is the audit-of-record).
  try {
    const nowMs = Date.now();
    const alert: GlobalAlert = {
      _id: new ObjectId(),
      kind: "mass-cascade",
      countryCode,
      insolventCorpCount,
      emittedAtTurn: currentTurn,
      emittedAtRealtimeMs: nowMs,
      expiresAtRealtimeMs: nowMs + MASS_CASCADE_ALERT_TTL_MS,
      dismissedByUserIds: [],
    };
    await db.collection<GlobalAlert>("globalAlerts").insertOne(alert);
  } catch (err) {
    console.error("emitMassCascadeAlert: failed to insert globalAlert", err);
  }
}
