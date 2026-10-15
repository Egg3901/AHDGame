import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { GameConfig } from "@/lib/db/types";
import { createSystemNewsPost } from "@/lib/news";

/**
 * Country recession: an operator-scheduled contraction of one country's
 * productive capacity, spread evenly over a window of turns and applied as
 * extra depreciation, so capacity and its paid basis fall together exactly as
 * ordinary wear does. Used to bring a country whose seeded capacity far
 * exceeds its economy back toward its GDP share without a one-turn cliff.
 * Every corporation operating in the country is affected alike.
 */
export interface CountryRecession {
  countryId: CountryId;
  /** First turn the contraction applies. */
  startTurn: number;
  /** Number of turns the contraction is spread over (at least 1). */
  turns: number;
  /** Total share of capacity removed by the end of the window, in percent (0..50). */
  capacityCutPct: number;
  /** Turn the start was announced on the news wire; absent until then. */
  announcedAtTurn?: number;
}

export const COUNTRY_RECESSION_MAX_CUT_PCT = 50;

function isValid(r: CountryRecession | null | undefined): r is CountryRecession {
  return (
    r != null &&
    typeof r.countryId === "string" &&
    Number.isFinite(r.startTurn) &&
    Number.isFinite(r.turns) &&
    r.turns >= 1 &&
    Number.isFinite(r.capacityCutPct) &&
    r.capacityCutPct > 0 &&
    r.capacityCutPct <= COUNTRY_RECESSION_MAX_CUT_PCT
  );
}

/** Valid recessions configured for this world. */
export function countryRecessionsFrom(
  config: Pick<GameConfig, "countryRecessions"> | null | undefined
): CountryRecession[] {
  const list = config?.countryRecessions;
  return Array.isArray(list) ? list.filter(isValid) : [];
}

/** Whether the recession's window covers this turn. */
export function recessionActive(r: CountryRecession, turn: number): boolean {
  const turns = Math.floor(r.turns);
  return turn >= r.startTurn && turn < r.startTurn + turns;
}

/**
 * Per-turn capacity factor for one recession: (1 - cut)^(1 / turns), so the
 * product over the whole window is exactly 1 - cut.
 */
export function recessionPerTurnFactor(r: CountryRecession): number {
  const cut = Math.max(0, Math.min(COUNTRY_RECESSION_MAX_CUT_PCT, r.capacityCutPct)) / 100;
  return Math.pow(1 - cut, 1 / Math.max(1, Math.floor(r.turns)));
}

/** countryId → capacity factor for this turn; countries without an active recession are absent. */
export function recessionCapacityFactors(
  recessions: readonly CountryRecession[],
  turn: number
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of recessions) {
    if (!recessionActive(r, turn)) continue;
    out.set(r.countryId, (out.get(r.countryId) ?? 1) * recessionPerTurnFactor(r));
  }
  return out;
}

/**
 * Announce each recession on the national wire once, on the first turn it is
 * active. The claim is an atomic conditional update on the config entry, so a
 * retried turn never posts twice. Best-effort: a wire failure never blocks
 * the turn.
 */
export async function announceCountryRecessions(
  db: Db,
  recessions: readonly CountryRecession[],
  turn: number
): Promise<number> {
  let posted = 0;
  const due = recessions.filter((r) => recessionActive(r, turn) && r.announcedAtTurn == null);
  if (due.length === 0) return 0;
  // One atomic claim for every due entry: the run that flips them posts.
  const claim = await db.collection<GameConfig>("gameConfig").updateOne(
    {
      _id: "default",
      countryRecessions: {
        $elemMatch: { startTurn: { $lte: turn }, announcedAtTurn: { $exists: false } },
      },
    } as Record<string, unknown>,
    { $set: { "countryRecessions.$[r].announcedAtTurn": turn } },
    {
      arrayFilters: [{ "r.startTurn": { $lte: turn }, "r.announcedAtTurn": { $exists: false } }],
    }
  );
  if (claim.modifiedCount !== 1) return 0;
  for (const r of due) {
    const name = COUNTRY_CONFIGS[r.countryId]?.name ?? r.countryId;
    try {
      await createSystemNewsPost(
        `Asset prices in ${name} have fallen sharply after years of speculative growth. Banks are calling in loans and companies are closing plants they can no longer keep busy. Economists expect ${name}'s productive capacity to shrink by about ${Math.round(r.capacityCutPct)}% over the next ${Math.floor(r.turns)} turns before the economy steadies.`,
        "general",
        { title: `Bubble Bursts in ${name} as Recession Takes Hold` }
      );
      posted++;
    } catch {
      // The wire is best-effort; the contraction itself is config-driven.
    }
  }
  return posted;
}
