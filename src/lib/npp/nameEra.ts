/**
 * Era gating for generated politician names.
 *
 * A 1953 world could name a senator Aaliyah or Jayden. The name pools are flat
 * lists with no sense of when a name entered use, so every era drew from the
 * same modern-weighted set.
 *
 * WHAT IS GATED, AND WHAT IS NOT
 * ------------------------------
 * Only names that are demonstrably modern in American use: post-war coinages
 * (DeShawn, Aaliyah, Imani) and names whose documented usage surge is firmly
 * mid-century-or-later (Jennifer, Jessica, Ashley, Ryan, Zachary). Traditional
 * names — James, Mary, Margaret, Frank — carry no entry and work in every era,
 * because they genuinely did.
 *
 * Deliberately conservative, in the same spirit as the portrait filter: a name
 * with no entry is ELIGIBLE, not assumed old. Over-excluding would strip the
 * pool and flatten the variety the lists exist to provide, while a slightly
 * over-inclusive 1953 is a mild flavour miss. Errors are cheap in one direction
 * and expensive in the other, so this leans the cheap way.
 *
 * Years are the decade a name became common in the US, not the first recorded
 * use — the question is whether a politician of voting age could plausibly
 * carry it, not whether the name existed at all.
 */

/** Name → earliest year it reads as plausible for an adult politician. */
const NAME_NOT_BEFORE: Record<string, number> = {
  // ── Male: documented post-war usage surges ────────────────────────────────
  Joshua: 1975,
  Jason: 1970,
  Ryan: 1975,
  Zachary: 1985,
  Ethan: 1995,
  Noah: 1995,
  Brandon: 1980,
  Tyler: 1990,
  // Post-war African-American coinages and popularisations.
  DeShawn: 1975,
  Darnell: 1965,
  Jamal: 1970,
  Terrence: 1960,

  // ── Female: same standard ─────────────────────────────────────────────────
  Jennifer: 1970,
  Jessica: 1980,
  Ashley: 1980,
  Kimberly: 1965,
  Michelle: 1965,
  Amanda: 1975,
  Melissa: 1965,
  Stephanie: 1965,
  Nicole: 1975,
  Samantha: 1975,
  Tamika: 1975,
  Keisha: 1975,
  Latoya: 1975,
  Ebony: 1975,
  Jasmine: 1985,
  Aaliyah: 1995,
  Imani: 1975,
};

/**
 * Names plausible for a world at `year`.
 *
 * Null year (no era clock) keeps the whole pool. Never returns empty: a pool
 * whose every entry is gated still has to produce a name, and a generation
 * failure is far worse than an anachronistic first name.
 */
export function namesForYear(pool: string[], year: number | null | undefined): string[] {
  if (year == null || !Number.isFinite(year)) return pool;
  const eligible = pool.filter((name) => {
    const notBefore = NAME_NOT_BEFORE[name];
    return notBefore == null || year >= notBefore;
  });
  return eligible.length > 0 ? eligible : pool;
}

/** Test seam — lets a test assert the table is non-empty without exporting it wholesale. */
export function gatedNameCount(): number {
  return Object.keys(NAME_NOT_BEFORE).length;
}
