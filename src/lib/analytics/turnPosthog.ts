import { PostHog } from "posthog-node";
import type { Db } from "mongodb";
import type {
  FederalBudget,
  User,
  WealthListSnapshot,
  TurnPhaseTelemetryMap,
  Election,
} from "@/lib/db/types";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { Crisis } from "@/lib/db/types/crisis";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCountryHistoryCollection } from "@/lib/db/collections/countryHistory";

let client: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  client ??= new PostHog(key, {
    host: "https://us.i.posthog.com",
    // A turn produces a small batch. Do not create a timer per event.
    flushAt: 1000,
    flushInterval: 0,
  });
  return client;
}

type WorldEventType = "election" | "war" | "bill_passed" | "crisis" | "record_wealth";

/** Runs after the turn commits. Failures are contained by the detached caller. */
export async function captureTurnPosthog(input: {
  db: Db;
  turn: number;
  durationMs: number;
  phaseStatuses: TurnPhaseTelemetryMap;
  errorCount: number;
}): Promise<void> {
  const posthog = getClient();
  if (!posthog) return;
  try {
    const { db, turn, durationMs, phaseStatuses, errorCount } = input;
    const countryHistory = await getCountryHistoryCollection(db);
    const [playersActive, budgets, wealth, history, elections, wars, crises] = await Promise.all([
      db.collection<User>("users").countDocuments({
        lastActivity: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        isBanned: { $ne: true },
      }),
      db
        .collection<FederalBudget>("federalBudget")
        .find(
          {},
          { projection: { countryId: 1, treasuryBalance: 1, "economicFactors.inflationRate": 1 } }
        )
        .toArray(),
      db
        .collection<WealthListSnapshot>("wealthListSnapshots")
        .findOne({ _id: "global", turn }, { projection: { entries: 1 } }),
      countryHistory
        .find({ turn, eventType: "bill_enacted" }, { projection: { eventType: 1, countryId: 1 } })
        .toArray(),
      db
        .collection<Election>("elections")
        .find(
          { endTurn: turn, status: { $in: ["completed", "resolved"] } },
          { projection: { countryId: 1 } }
        )
        .toArray(),
      db.collection<ConflictDoc>("conflicts").countDocuments({
        startTurn: turn,
        type: { $ne: "cold_war" },
      }),
      db.collection<Crisis>("crises").countDocuments({ startTurn: turn }),
    ]);

    posthog.capture({
      distinctId: "system:turn-processor",
      event: "turn_processed",
      properties: {
        turn_number: turn,
        duration_ms: durationMs,
        players_active: playersActive,
        phases_run: Object.values(phaseStatuses).filter(
          (phase) => phase.status === "completed" || phase.status === "failed"
        ).length,
        error_count: errorCount,
        $process_person_profile: false,
      },
    });

    const countryNameToId = new Map(
      Object.entries(COUNTRY_CONFIGS).map(([id, country]) => [country.name, id])
    );
    const wealthByCountry = new Map<string, number[]>();
    for (const entry of wealth?.entries ?? []) {
      const countryId = countryNameToId.get(entry.country);
      if (!countryId || !Number.isFinite(entry.totalWealth)) continue;
      const values = wealthByCountry.get(countryId) ?? [];
      values.push(Math.max(0, entry.totalWealth));
      wealthByCountry.set(countryId, values);
    }
    for (const budget of budgets) {
      const values = wealthByCountry.get(budget.countryId) ?? [];
      const total = values.reduce((sum, value) => sum + value, 0);
      values.sort((a, b) => b - a);
      const topCount = Math.ceil(values.length / 100);
      const topShare = total > 0 ? values.slice(0, topCount).reduce((a, b) => a + b, 0) / total : 0;
      posthog.capture({
        distinctId: `nation:${budget.countryId}`,
        event: "economy_snapshot",
        properties: {
          turn_number: turn,
          nation_id: budget.countryId,
          treasury: budget.treasuryBalance,
          total_player_wealth: total,
          top_1pct_wealth_share: topShare,
          inflation_rate: budget.economicFactors?.inflationRate ?? 0,
          $process_person_profile: false,
        },
      });
    }

    const worldEvent = (type: WorldEventType, headline: string) =>
      posthog.capture({
        distinctId: "system:turn-processor",
        event: "world_event",
        properties: { turn_number: turn, type, headline, $process_person_profile: false },
      });
    // Fixed headlines avoid forwarding player-authored names or bill text.
    for (const row of history) worldEvent("bill_passed", `Bill passed in ${row.countryId}`);
    for (const row of elections) worldEvent("election", `Election resolved in ${row.countryId}`);
    for (let index = 0; index < wars; index++) worldEvent("war", "War began");
    for (let index = 0; index < crises; index++) worldEvent("crisis", "Crisis began");
    const currentRecord = (wealth?.entries ?? []).reduce(
      (highest, entry) => Math.max(highest, entry.totalWealth),
      0
    );
    if (currentRecord > 0) {
      const records = db.collection<{ _id: string; value: number }>("analyticsRecords");
      const previous = await records.findOne({ _id: "player-wealth" });
      if (currentRecord > (previous?.value ?? 0)) {
        await records.updateOne(
          { _id: "player-wealth" },
          { $max: { value: currentRecord } },
          { upsert: true }
        );
        worldEvent("record_wealth", "New player wealth record");
      }
    }
    await posthog.flush();
  } catch (error) {
    console.warn("[PostHog] Turn telemetry failed", error);
  }
}
