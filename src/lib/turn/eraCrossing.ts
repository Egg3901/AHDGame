import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { eraFromYear } from "@/lib/era/era";
import { getNewlyActivatedMetrics } from "@/lib/era/metricCatalog";
import { createSystemNewsPost } from "@/lib/news";
import { sendNewsEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";

export interface EraCrossingResult {
  ran: boolean;
  eraId?: string;
  year?: number;
  /** True when the era marker was stamped without news (mid-decade enable self-heal). */
  healed?: boolean;
}

/**
 * Decade-era crossing fires in Week 1 of years ending in 0, exactly like the
 * census (`shouldRunCensus`): `currentYear` increments at year rollover, so
 * the first turn it becomes ≡0 mod 10 IS Week 1; `lastEraCrossedYear` guards
 * re-fire. No preset start year (1953/1979/1991/2019) is ≡0 mod 10, so
 * nothing fires at bootstrap.
 *
 * The whole phase is gated on `eraSystemEnabled` — while the era system is
 * disabled, no marker is stamped and no news posts (and scoring stays legacy
 * via getEraContext). When the flag is enabled mid-decade, the phase quietly
 * self-heals `currentEraId` on the next turn without posting a "decade
 * begins" wire item; news only fires on a real decade rollover. Scoring never
 * reads the stamp (it computes from currentYear), so a missed stamp cannot
 * skew math.
 */
export function shouldCrossEra(
  currentYear: number,
  lastEraCrossedYear: number | undefined
): boolean {
  if (!Number.isFinite(currentYear)) return false;
  if (currentYear % 10 !== 0) return false;
  return currentYear > (lastEraCrossedYear ?? -Infinity);
}

/** Player-facing wire copy for the decade rollover. */
export function buildEraCrossingContent(eraLabel: string): string {
  return `A new decade dawns. Commentators are already asking what the ${eraLabel} will bring — and which of the old certainties will survive them.`;
}

export async function runEraCrossing(db: Db): Promise<EraCrossingResult> {
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: { currentYear: 1, lastEraCrossedYear: 1, currentEraId: 1, eraSystemEnabled: 1 },
    }
  );
  if (!gameState?.eraSystemEnabled) return { ran: false };

  const currentYear = gameState.currentYear;
  if (currentYear === undefined || !Number.isFinite(currentYear)) return { ran: false };

  const era = eraFromYear(currentYear);

  if (shouldCrossEra(currentYear, gameState.lastEraCrossedYear)) {
    await db
      .collection<GameState>("gameState")
      .updateOne(
        { _id: "current" },
        { $set: { currentEraId: era.id, lastEraCrossedYear: currentYear, updatedAt: new Date() } }
      );

    await createSystemNewsPost(buildEraCrossingContent(era.label), "general", {
      title: `The ${era.label} Begin`,
    });

    return { ran: true, eraId: era.id, year: currentYear };
  }

  // Mid-decade enable: stamp the marker quietly (no news, no crossing-guard
  // update) so the flags route / admin panel show the right era immediately.
  if (gameState.currentEraId !== era.id) {
    await db
      .collection<GameState>("gameState")
      .updateOne({ _id: "current" }, { $set: { currentEraId: era.id, updatedAt: new Date() } });
    return { ran: true, eraId: era.id, year: currentYear, healed: true };
  }

  return { ran: false };
}

export interface MetricActivationResult {
  /** Titles of the activation posts made this run (empty when nothing crossed). */
  posted: string[];
  /** True when the guard was stamped without posting (first flag-on run). */
  healed?: boolean;
}

/**
 * Metric activation news (metric era catalog): when the live year rolls past a
 * window's `from`, post that activation event's OWN flavored copy as a World
 * News post AND to the Discord News Channel webhook. One post per activation
 * EVENT — the base window and each countryOverride carry separate custom copy.
 *
 * Guarded by `gameState.lastMetricActivationYear`. Initialization is a QUIET
 * self-heal (mirrors the eraCrossing marker heal): the first flag-on run stamps
 * the current year WITHOUT posting, so enabling the era system mid-game never
 * bursts decades of missed "inventions" into the wire.
 */
export async function runMetricActivation(db: Db): Promise<MetricActivationResult> {
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentYear: 1,
        lastMetricActivationYear: 1,
        eraSystemEnabled: 1,
      },
    }
  );
  if (!gameState?.eraSystemEnabled) return { posted: [] };

  const currentYear = gameState.currentYear;
  if (currentYear === undefined || !Number.isFinite(currentYear)) return { posted: [] };

  const lastYear = gameState.lastMetricActivationYear;
  if (lastYear === undefined || !Number.isFinite(lastYear)) {
    // Quiet self-heal: stamp without posting (no mid-game news burst).
    await db
      .collection<GameState>("gameState")
      .updateOne(
        { _id: "current" },
        { $set: { lastMetricActivationYear: currentYear, updatedAt: new Date() } }
      );
    return { posted: [], healed: true };
  }

  if (currentYear <= lastYear) return { posted: [] };

  const events = getNewlyActivatedMetrics(lastYear, currentYear);
  const posted: string[] = [];
  for (const event of events) {
    await createSystemNewsPost(event.news.body, "general", { title: event.news.title });
    await sendNewsEvent({
      title: event.news.title,
      description: event.news.body,
      color: DISCORD_COLORS.worldMilestone,
    });
    posted.push(event.news.title);
  }

  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current" },
      { $set: { lastMetricActivationYear: currentYear, updatedAt: new Date() } }
    );
  return { posted };
}
