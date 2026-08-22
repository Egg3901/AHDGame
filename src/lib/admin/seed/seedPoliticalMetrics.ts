import type { AnyBulkWriteOperation, Db } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import type { State } from "@/lib/db/types/state";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import {
  POLITICAL_METRIC_COUNTRY_IDS,
  type PoliticalMetricId,
  type PoliticalMetricsCountryId,
} from "@/lib/politicalMetrics/types";
import {
  POLITICAL_BASELINE_ANCHORS,
  baselineFor,
} from "@/lib/politicalMetrics/seeds/baselineAnchors";
import { REGIONAL_MODIFIERS_1953 } from "@/lib/politicalMetrics/seeds/regionalModifiers1953";
import { REGIONAL_TEXTURE_1953 } from "@/lib/politicalMetrics/seeds/regionalTexture1953";
import { NON_PLAYABLE_BOARDS } from "@/lib/politicalMetrics/seeds/nonPlayableBoards";

const PLAYABLE = new Set<string>(POLITICAL_METRIC_COUNTRY_IDS);
/**
 * Non-playable countries seed from the committed, derived board file instead of
 * the anchor table. A country in NEITHER set is skipped entirely rather than
 * given a neutral board — a 63-family doc of 50s would look authored while
 * meaning nothing, which is the failure mode this whole project exists to end.
 */
const BOARD_COUNTRIES = new Set<string>(
  Object.values(NON_PLAYABLE_BOARDS).flatMap((byCountry) => Object.keys(byCountry))
);
// PoliticalMetricsCountryId is a subset of CountryId, so the Mongo filter needs
// the wider element type to satisfy the State schema.
const SEEDED_FILTER: State["countryId"][] = [
  ...POLITICAL_METRIC_COUNTRY_IDS,
  ...([...BOARD_COUNTRIES] as State["countryId"][]),
];
const clampScore = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Seeds one politicalMetrics doc per US/UK/RU/DD region present in `states`:
 * value = clamp(baseline at `year` + sparse regional modifier, 0, 100).
 *
 * Baselines resolve by in-game YEAR through the anchor table, never by seed
 * preset. With the current single-1953-anchor table every year yields the
 * authored 1953 value, so this is byte-identical to the pre-era behavior;
 * authoring additional anchors is what gives other eras their own values.
 */
export async function seedPoliticalMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  year: number,
  preset: string
): Promise<{ regionsSeeded: number }> {
  // Non-playable boards are keyed by preset: each era overlays its own authored
  // metric values and is scored against that era's band. A world whose preset
  // has no emitted board seeds NO non-playable boards rather than falling back
  // to another era's — a 2019 world wearing 1953 numbers is exactly the silent
  // wrongness this project exists to end.
  const boardsForPreset = NON_PLAYABLE_BOARDS[preset];
  if (!boardsForPreset) {
    log(`No non-playable political boards emitted for preset ${preset} — playables only`);
  }
  if (reset) {
    await db
      .collection("politicalMetrics")
      .drop()
      .catch((error) => {
        logWarning("Collection drop failed (may not exist)", {
          component: "AdminSeed",
          action: "drop collection",
          metadata: { collection: "politicalMetrics", error: String(error) },
        });
      });
  }

  const states = await db
    .collection<State>("states")
    .find({ countryId: { $in: SEEDED_FILTER } })
    .toArray();

  const now = new Date();
  let regionsSeeded = 0;
  const ops: AnyBulkWriteOperation<PoliticalMetricsDoc>[] = [];
  for (const state of states) {
    const isPlayable = PLAYABLE.has(state.countryId);
    if (!isPlayable && !BOARD_COUNTRIES.has(state.countryId)) continue;
    const values = {} as Record<PoliticalMetricId, number>;
    if (isPlayable) {
      // Playables: year-anchored baselines + sparse regional modifiers, with
      // derived per-region texture filling the families the modifier table is
      // silent on.
      //
      // Ticket #1129: the modifier table covers 24 of 63 families across all
      // four countries combined, so on prod 47 of 63 US families were
      // byte-identical across all 51 states -- including every order.* family,
      // which is the entire Attorney General portfolio. Non-playables never had
      // this problem: they seed from a per-region derived board.
      //
      // Either/or, never additive. A hand-authored modifier encodes deliberate
      // history (Mississippi society.integration -18) and must not be diluted by
      // a mechanical category average; the generator excludes those pairs from
      // the texture file entirely, so this lookup can simply prefer the
      // modifier.
      const countryId = state.countryId as PoliticalMetricsCountryId;
      const modifiers = REGIONAL_MODIFIERS_1953[countryId][state._id] ?? {};
      const texture = REGIONAL_TEXTURE_1953[countryId]?.[state._id] ?? {};
      for (const metricId of Object.keys(
        POLITICAL_BASELINE_ANCHORS[countryId]
      ) as PoliticalMetricId[]) {
        const offset = modifiers[metricId] ?? texture[metricId] ?? 0;
        values[metricId] = clampScore(baselineFor(countryId, metricId, year) + offset);
      }
    } else {
      // Non-playables: the region's OWN derived board. The legacy seeds carry
      // real per-region variation in the political half, so a national board
      // replicated across regions would flatten regional approval, corp margins,
      // crises and demographics. A region missing from the board is skipped, not
      // given its country's board as a fallback — same rule as an unknown
      // country, for the same reason: a plausible-looking wrong board is exactly
      // the failure mode this project exists to end.
      const regionBoard = boardsForPreset?.[state.countryId]?.[state._id];
      if (!regionBoard) continue;
      for (const [metricId, v] of Object.entries(regionBoard)) {
        values[metricId as PoliticalMetricId] = clampScore(v);
      }
    }
    const countryId = state.countryId as PoliticalMetricsCountryId;
    const doc: PoliticalMetricsDoc = { _id: state._id, countryId, values, lastUpdated: now };
    ops.push({
      updateOne: { filter: { _id: state._id }, update: { $set: doc }, upsert: true },
    });
    regionsSeeded++;
  }

  if (ops.length > 0) {
    await db.collection<PoliticalMetricsDoc>("politicalMetrics").bulkWrite(ops, { ordered: true });
  }
  log(`Seeded political metrics for ${regionsSeeded} regions (playables + board countries)`);
  return { regionsSeeded };
}
