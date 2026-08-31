import type { Db } from "mongodb";
import type { BattleReportDoc } from "@/lib/db/types/battleReport";
import type { CountryId } from "@/lib/constants/countries";
import { contingentsOf, type SideOutcome } from "@/lib/military/battle";

export function getBattleReportsCollection(db: Db) {
  return db.collection<BattleReportDoc>("battleReports");
}

/**
 * The most recent battle reports a country took part in.
 *
 * Coalition rosters are matched too, not just the principals: an ally that joined a
 * merged offensive is neither the declarer nor the target, so a nation could lose ten
 * thousand men in a battle its own war room never listed.
 */
export async function listBattleReportsForCountry(
  db: Db,
  countryId: string,
  limit: number
): Promise<BattleReportDoc[]> {
  const cid = countryId as CountryId;
  return getBattleReportsCollection(db)
    .find({
      $or: [
        { declarerCountry: cid },
        { targetCountry: cid },
        { attackers: cid },
        { defenders: cid },
      ],
    })
    .sort({ turn: -1 })
    .limit(limit)
    .toArray();
}

/** Battle reports at or after a turn (the region-threat recency window). */
export async function listRecentBattleReports(
  db: Db,
  sinceTurn: number
): Promise<BattleReportDoc[]> {
  return getBattleReportsCollection(db)
    .find({ turn: { $gte: sinceTurn } })
    .toArray();
}

/**
 * Cumulative casualties per theater — both sides' losses summed across every battle
 * that actually resolved there. No-contact reports carry `result: null` and are
 * excluded. Theaters with no engagements come back as 0 rather than absent, so the
 * caller never has to tell "none yet" apart from "unknown".
 */
export async function casualtiesByTheater(
  db: Db,
  theaterIds: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (theaterIds.length === 0) return out;
  for (const id of theaterIds) out[id] = 0;

  const rows = await getBattleReportsCollection(db)
    .aggregate<{ _id: string; total: number }>([
      { $match: { theaterId: { $in: theaterIds }, result: { $ne: null } } },
      {
        $group: {
          _id: "$theaterId",
          total: { $sum: { $add: ["$result.attacker.loss", "$result.defender.loss"] } },
        },
      },
    ])
    .toArray();

  for (const r of rows) out[r._id] = r.total;
  return out;
}

/** The two side summaries of one resolved report, as `theaterRecord` projects them. */
export interface ReportSides {
  att: SideSummary;
  def: SideSummary;
}
type SideSummary = Pick<SideOutcome, "country" | "power" | "loss"> & {
  contingents?: SideOutcome["contingents"];
};

/**
 * Dead per belligerent across a front's reports.
 *
 * Goes through `contingentsOf`, so an allied offensive's casualties land on the
 * nation that took them. Reading `result.attacker.country` beside
 * `result.attacker.loss` instead credited the coalition's whole butcher's bill to
 * the principal — live report 6a8fb6a1715ff52ed01059ce filed 10,939 Russian dead
 * under East Germany.
 */
export function foldCasualtiesByCountry(sides: (ReportSides | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of sides) {
    if (!pair) continue;
    for (const side of [pair.att, pair.def]) {
      if (!side?.country) continue;
      for (const c of contingentsOf(side)) {
        if (!c.country) continue;
        out[c.country] = (out[c.country] ?? 0) + (c.loss ?? 0);
      }
    }
  }
  return out;
}

/** One front's cumulative record, counted across EVERY report ever filed there. */
export interface TheaterRecord {
  /** Dead per belligerent country. Public — casualty totals are in the record. */
  casualtiesByCountry: Record<string, number>;
  /** Battles actually fought (a report with a result). */
  engagements: number;
  /** Offensives that met nothing and still took ground. */
  unopposedAdvances: number;
  /** Turn of the most recent battle, or null when none has been fought. */
  lastEngagementTurn: number | null;
  /** Turn of the most recent unopposed advance, or null. */
  lastAdvanceTurn: number | null;
  /**
   * Every country that has taken part in an offensive here, on either side.
   *
   * This is what "committed" means: a nation whose units have fought at a front
   * is a full belligerent in that war and leaves it by victory, capitulation or a
   * separate peace — not by walking away. Casualties alone would miss a country
   * that has only ever advanced unopposed.
   */
  countriesEngaged: string[];
}

/**
 * The headline totals for one conflict's record page.
 *
 * Aggregated in the database over the WHOLE history rather than derived from the
 * page's newest-N report window: a long war's casualty figure and engagement
 * count must not quietly stop climbing once the window fills, which is exactly
 * what counting the rendered rows would do.
 */
export async function theaterRecord(db: Db, theaterId: string): Promise<TheaterRecord> {
  const rows = await getBattleReportsCollection(db)
    .aggregate<{
      _id: null;
      engagements: number;
      unopposedAdvances: number;
      lastEngagementTurn: number | null;
      lastAdvanceTurn: number | null;
      /** One entry per report: its two side summaries, or null for a no-contact report. */
      sides: (ReportSides | null)[];
      /** One entry per report: every country named on it, principals included. */
      engaged: string[][];
    }>([
      { $match: { theaterId } },
      {
        $group: {
          _id: null,
          engagements: { $sum: { $cond: [{ $ne: ["$result", null] }, 1, 0] } },
          unopposedAdvances: { $sum: { $cond: [{ $eq: ["$unopposedAdvance", true] }, 1, 0] } },
          lastEngagementTurn: {
            $max: { $cond: [{ $ne: ["$result", null] }, "$turn", null] },
          },
          lastAdvanceTurn: {
            $max: { $cond: [{ $eq: ["$unopposedAdvance", true] }, "$turn", null] },
          },
          // Both sides' summaries, contingents included. The fallback to the scalar
          // for a pre-coalition report is applied in `foldCasualtiesByCountry` rather
          // than here, so the rule is one testable place instead of a `$ifNull` pair.
          sides: {
            $push: {
              $cond: [
                { $ne: ["$result", null] },
                {
                  att: {
                    country: "$result.attacker.country",
                    power: "$result.attacker.power",
                    loss: "$result.attacker.loss",
                    contingents: "$result.attacker.contingents",
                  },
                  def: {
                    country: "$result.defender.country",
                    power: "$result.defender.power",
                    loss: "$result.defender.loss",
                    contingents: "$result.defender.contingents",
                  },
                },
                null,
              ],
            },
          },
          // Coalition rosters where the report carries them, principals otherwise —
          // pre-coalition reports named only one country per side.
          engaged: {
            $push: {
              $concatArrays: [
                { $ifNull: ["$attackers", ["$declarerCountry"]] },
                { $ifNull: ["$defenders", ["$targetCountry"]] },
              ],
            },
          },
        },
      },
    ])
    .toArray();

  const row = rows[0];
  const casualtiesByCountry = foldCasualtiesByCountry(row?.sides ?? []);
  const engaged = new Set<string>();
  for (const list of row?.engaged ?? []) {
    for (const country of list ?? []) if (country) engaged.add(country);
  }
  return {
    casualtiesByCountry,
    engagements: row?.engagements ?? 0,
    unopposedAdvances: row?.unopposedAdvances ?? 0,
    lastEngagementTurn: row?.lastEngagementTurn ?? null,
    lastAdvanceTurn: row?.lastAdvanceTurn ?? null,
    countriesEngaged: [...engaged],
  };
}
