import type { Db } from "mongodb";
import { COUNTRY_ELECTION_PHASES } from "@/lib/turn/countryPhases";

/**
 * Election families that `bootstrapGameWorld` offers an explicit opt-out for.
 * Keyed by the phase name in {@link COUNTRY_ELECTION_PHASES}.
 */
const SKIP_REGIONAL_COUNCIL_PHASES = new Set(["ukRegionalCouncilElections"]);

export interface FoundingSpawnResult {
  /** Families invoked (after opt-outs). */
  attempted: number;
  /** Families whose spawner threw. */
  failed: number;
  /** `elections` documents at `cycle: 0` once the sweep finished. */
  foundingRaces: number;
}

/**
 * Spawn the cycle-0 "founding" race for EVERY registered election family.
 *
 * Why this exists as its own sweep rather than more entries in the
 * `bootstrapGameWorld` ensure* battery: that battery is a hand-maintained list
 * and has drifted from {@link COUNTRY_ELECTION_PHASES}, the registry the TURN
 * LOOP iterates. On a normal world the drift self-heals — the missing families
 * spawn on turn 1. During the founding phase it does NOT, because the turn loop
 * deliberately suppresses every canonical spawner while `preIteration.active` is
 * set (`electionCoverageAndSuccession` in turnPhaseRegistry). A family missing
 * from the bootstrap battery therefore gets no cycle-0 race and its chamber sits
 * empty for the whole founding phase. On 1953-default that is exactly the
 * Warsaw-Pact six (PL/CS/HU/RO/BG/YU — none of which the battery calls), plus
 * several UK/JP/DE/NG regional and upper-chamber families.
 *
 * Driving the founding spawn from the turn loop's own registry means the two
 * cannot drift again: adding a country to `COUNTRY_ELECTION_PHASES` automatically
 * founds it.
 *
 * Safety properties this relies on, all pre-existing:
 *   - every `ensure*` is idempotent (it skips a family that already has an
 *     active/upcoming race), so re-running the families the bootstrap battery
 *     already spawned is a no-op rather than a duplicate;
 *   - every `ensure*` self-gates on the runtime `countryGameStates.status` and
 *     on the era anchor, so a coming-soon or out-of-era family (e.g. ES under
 *     Franco in 1953) still spawns nothing;
 *   - `pickNextCanonicalCycle` returns cycle 0 with a fixed 24h+24h window for
 *     every race while `ctx.preIterationActive` is set, so all classes found
 *     together and the phase converges.
 *
 * Entries run sequentially in registry order per country because a few mirror a
 * sibling race created moments earlier (DE Minister-President after the Landtag,
 * JP Regional Council after the Shugiin).
 *
 * COUNTRIES run concurrently; only that within-country order is a constraint.
 * Nothing in the registry mirrors a race in a DIFFERENT country — both documented
 * dependencies are intra-country — and the turn loop already drives all 54
 * entries fully concurrently every turn (`turnPhaseRegistry`, one flat
 * `Promise.all` with no per-country sequencing), so this is strictly more
 * conservative than what already runs in production. It stays sequential per
 * country anyway, because DE's Minister-President spawner documents a hard
 * "must run after deLandtagElections" that the flat version only satisfies by
 * luck plus a recompute fallback.
 *
 * A single failing family must never abort the reset, and it cannot hang the
 * phase either — `detectPreIterationComplete` only waits on races that actually
 * spawned. Failures are logged and the sweep continues.
 *
 * ⚠️ Failure logs are buffered per country and flushed in registry order, so the
 * emitted log is identical to the sequential version regardless of which country
 * finishes first. The seed op-profiler parses this log for phase gaps and
 * repeated passes; interleaved output would corrupt that reading. Same reason
 * `seedIndexes` buffers per module (D1).
 */
export async function spawnFoundingElections(
  db: Db,
  now: Date,
  options: { skipRegionalCouncil?: boolean; log?: (msg: string) => void } = {}
): Promise<FoundingSpawnResult> {
  const log = options.log ?? (() => {});
  const skipRegionalCouncil = options.skipRegionalCouncil === true;

  const countries = Object.entries(COUNTRY_ELECTION_PHASES);
  const perCountry = await Promise.all(
    countries.map(async ([countryId, entries]) => {
      let attempted = 0;
      let failed = 0;
      const lines: string[] = [];
      for (const { name, fn } of entries ?? []) {
        if (skipRegionalCouncil && SKIP_REGIONAL_COUNCIL_PHASES.has(name)) continue;
        attempted++;
        try {
          await fn(now);
        } catch (error) {
          failed++;
          lines.push(
            `Founding spawn failed for ${countryId}/${name}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      return { attempted, failed, lines };
    })
  );

  // Flushed in registry order, so the log does not depend on completion order.
  for (const { lines } of perCountry) for (const line of lines) log(line);
  const attempted = perCountry.reduce((sum, c) => sum + c.attempted, 0);
  const failed = perCountry.reduce((sum, c) => sum + c.failed, 0);

  const foundingRaces = await db.collection("elections").countDocuments({ cycle: 0 });
  log(
    `Founding spawn sweep: ${attempted} family/families across ${
      Object.keys(COUNTRY_ELECTION_PHASES).length
    } countries, ${foundingRaces} cycle-0 race(s)` +
      (failed > 0 ? ` (${failed} family/families failed — see above)` : "")
  );

  return { attempted, failed, foundingRaces };
}
