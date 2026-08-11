/**
 * Authored 1953 defense boards for non-playable countries.
 *
 * The ONLY part of a derived board that no legacy data can produce: stateMetrics
 * has no defense layer beyond a single militaryReadiness field, and defense
 * posture — diplomatic engagement, multilateral standing, power projection — is
 * not recoverable from outcome metrics like crime rates or literacy. So these
 * are hand-authored per country.
 *
 * The seven families and what they measure (lean in brackets — a POSITION on
 * the axis, never a quality judgment):
 *   diplomacy       [-5]  engagement, alliance-building, arms restraint
 *   institutions    [-3]  standing in international bodies, development aid
 *   softPower       [-1]  attraction of culture, science, and model abroad
 *   security        [ 0]  protection against espionage, subversion, direct threats
 *   defenseIndustry [+1]  defense production and military technology
 *   armedForces     [+3]  manpower, training, readiness
 *   projection      [+5]  power projection and deterrence at distance
 *
 * Authoring rules (binding — see the Plan 4 spec):
 *   1. Score the country AS IT WAS at campaign start, not its later self.
 *   2. Lean is not quality: high projection is not "better" than high diplomacy.
 *   3. 50 is genuinely neutral, not a default — use the full range.
 *   4. `institutions` tracks STANDING, not alignment.
 *   5. The Yugoslav split is real; Tito is not a satellite.
 *
 * Playable countries are deliberately absent: US/UK/RU/DD have authored boards
 * via POLITICAL_BASELINE_ANCHORS already.
 *
 * ERA COVERAGE — 1953 ONLY. Rule 1 above ("score the country AS IT WAS at
 * campaign start") makes these values era-specific by construction, and the
 * 1979/1991/2019 presets carry the SAME 22 countries. Authoring them is
 * 22 x 7 x 3 = 462 values of per-country historical judgment that has not been
 * done. Until it is, `defenseBoardFor` hands 1953 values to those eras and
 * RECORDS the substitution (see DEFENSE_BOARDS_BY_YEAR below), so the emit
 * script prints the gap per preset instead of shipping a 2019 board where
 * Germany has `armedForces: 8` and reading as though someone meant it.
 */

export const DEFENSE_FAMILY_IDS = [
  "defense.diplomacy",
  "defense.institutions",
  "defense.softPower",
  "defense.security",
  "defense.defenseIndustry",
  "defense.armedForces",
  "defense.projection",
] as const;

type DefenseBoard = Record<(typeof DEFENSE_FAMILY_IDS)[number], number>;

const board = (
  diplomacy: number,
  institutions: number,
  softPower: number,
  security: number,
  defenseIndustry: number,
  armedForces: number,
  projection: number
): DefenseBoard => ({
  "defense.diplomacy": diplomacy,
  "defense.institutions": institutions,
  "defense.softPower": softPower,
  "defense.security": security,
  "defense.defenseIndustry": defenseIndustry,
  "defense.armedForces": armedForces,
  "defense.projection": projection,
});

export const DEFENSE_BOARDS_1953: Record<string, DefenseBoard> = {
  // ── Western Europe ────────────────────────────────────────────────────────
  /**
   * West Germany: occupied, sovereignty incomplete, and constitutionally and
   * practically disarmed — the Bundeswehr is not founded until 1955 and rearmament
   * is still bitterly contested. Adenauer's Westbindung makes diplomacy the whole
   * strategy; standing is low because NATO and UN membership have not happened yet.
   */
  DE: board(62, 35, 45, 40, 15, 8, 5),
  /**
   * France: a UN Security Council permanent seat and enormous cultural reach, set
   * against a draining colonial war in Indochina and a nascent nuclear programme.
   * Real projection, but projection that is being spent rather than accumulated.
   */
  FR: board(58, 78, 72, 50, 68, 66, 62),
  /** Italy: NATO from 1949, economy still reconstructing, modest and defensive forces. */
  IT: board(55, 52, 58, 45, 38, 42, 20),
  /**
   * Spain: Franco's regime is diplomatically quarantined — excluded from the UN
   * until 1955 — even as the 1953 Pact of Madrid buys American bases. Formidable
   * internal security apparatus, negligible outward reach.
   */
  ES: board(30, 20, 28, 68, 25, 48, 15),
  /** Greece: NATO from 1952 and heavily American-supplied, emerging from civil war. */
  GR: board(45, 44, 40, 42, 15, 52, 12),
  /**
   * Austria: under four-power occupation until the 1955 State Treaty. No meaningful
   * forces and no independent foreign policy; permanent neutrality is still ahead.
   */
  AT: board(55, 30, 48, 32, 12, 10, 5),
  /**
   * Sweden: armed neutrality with teeth. A genuinely world-class domestic arms
   * industry (Saab, Bofors) and a large trained force, deliberately paired with no
   * alliances and no expeditionary ambition — high industry, near-zero projection.
   */
  SE: board(68, 55, 62, 66, 72, 64, 18),
  /**
   * Finland: the YYA treaty constrains foreign policy and caps the military. Real
   * defensive capability and a strong survival instinct, minimal external standing.
   */
  FI: board(60, 35, 45, 48, 32, 52, 8),
  /**
   * Ireland: constitutionally neutral, outside NATO, with a token defence force.
   * Its reach abroad is diaspora and moral argument, not materiel.
   */
  IE: board(62, 38, 52, 42, 8, 18, 4),

  // ── Asia ──────────────────────────────────────────────────────────────────
  /**
   * Japan: Article 9 pacifism, occupation only just ended, and the Self-Defense
   * Forces barely forming. Security is outsourced to the American alliance, so
   * armed forces and projection sit near the floor despite a large economy.
   */
  JP: board(65, 32, 42, 38, 22, 15, 5),
  /**
   * PRC: fresh from fighting the United Nations to a standstill in Korea with a
   * vast, hard, lightly-equipped army. The UN seat is held by Taipei, so standing
   * is near-zero regardless of real power — rule 4 in action.
   */
  CN: board(32, 15, 28, 62, 35, 82, 28),
  /**
   * Turkey: NATO from 1952, guarding the alliance's longest border with the Soviet
   * Union, with a very large conscript army and combat experience from Korea.
   * Manpower far outstrips domestic industry.
   */
  TR: board(45, 48, 32, 55, 20, 68, 18),

  // ── Americas & Africa ─────────────────────────────────────────────────────
  /** Brazil: the dominant regional power facing no serious threat; broad, shallow capability. */
  BR: board(52, 45, 42, 45, 22, 38, 15),
  /**
   * Nigeria: still a British colony — independence is seven years away. Defence,
   * foreign policy and security all belong to London, so every family sits near
   * the floor. This is the clearest case for rule 1.
   */
  NG: board(12, 8, 18, 25, 5, 15, 3),

  // ── Eastern bloc ──────────────────────────────────────────────────────────
  /**
   * Poland: the largest satellite army and the Soviet Union's corridor to Germany.
   * Substantial forces, but doctrine, deployment and diplomacy all run through Moscow.
   */
  PL: board(28, 30, 32, 58, 42, 70, 12),
  /**
   * Czechoslovakia: the bloc's arsenal. Škoda and the Brno works give it genuine
   * defence-industrial depth that its neighbours lack, and it exports arms widely.
   */
  CS: board(28, 32, 38, 58, 62, 60, 12),
  /** Hungary: mid-sized satellite force, tightly supervised; three years before 1956. */
  HU: board(25, 26, 34, 55, 30, 52, 8),
  /** Romania: sizeable conscript army, heavy Soviet oversight, little industry of its own. */
  RO: board(25, 26, 28, 58, 28, 55, 8),
  /** Bulgaria: the most compliant satellite; modest forces, negligible independent reach. */
  BG: board(24, 25, 26, 56, 22, 50, 6),
  /**
   * Yugoslavia: NOT a satellite. Tito's 1948 break with Stalin left it armed,
   * self-reliant and courted by both blocs — a large territorial-defence army, real
   * domestic production, and the diplomatic independence that becomes non-alignment.
   * Its security score is high precisely because it fears subversion from the East.
   */
  YU: board(58, 42, 45, 65, 45, 68, 15),
  /**
   * Baltic republics: annexed Soviet republics, not sovereign states in this era.
   * No independent defence, diplomacy or standing; what security exists is the
   * occupier's, directed partly against the population — and in 1953 there is
   * still an armed resistance in the forests for it to be directed against.
   */
  BAL: board(10, 8, 22, 40, 18, 25, 4),
  /**
   * Byelorussian SSR: likewise a Soviet republic — but one holding its own seat at
   * the United Nations from 1945, a quirk that lifts its standing well above its
   * actual autonomy. Rule 4: institutions measures standing, not independence.
   */
  BLR: board(10, 22, 22, 45, 25, 30, 4),
  /**
   * Ukrainian SSR: the other 1945 UN seat, and by a wide margin the weightiest of
   * the three republics — 41M people, the Donbas, and the industrial base that
   * built and rebuilt the Red Army's tanks. Everything that follows from that is
   * real capability (defenceIndustry, armedForces) and none of it is autonomy:
   * diplomacy stays at the Byelorussian floor because the seat was a Soviet vote,
   * not a Ukrainian one. Security is the highest of the three because the west of
   * the republic was still an active counter-insurgency theatre in 1953.
   */
  UKR: board(10, 24, 26, 52, 45, 42, 6),
};

/**
 * Authored defense boards by ERA, keyed by the first in-game year they describe.
 *
 * Only 1953 is authored. The other eras are not "missing data" in the sense of
 * a bug to be patched around — they are 22 countries x 7 families x 3 eras of
 * historical judgment that has not been done yet, and inventing it would be
 * worse than the visible gap, because these values are the ONLY source for the
 * defense block (no legacy metric can produce them).
 *
 * The table exists so that authoring is a pure DATA change: add a year key,
 * fill in the countries, done. No caller changes.
 */
const DEFENSE_BOARDS_BY_YEAR: Record<number, Record<string, DefenseBoard>> = {
  1953: DEFENSE_BOARDS_1953,
};

/** Every (countryId, requestedYear) that fell back to another era's board. */
const substitutions: Array<{ countryId: string; requestedYear: number; usedYear: number }> = [];

/** Snapshot of the era substitutions taken so far (most recent last). */
export function getDefenseEraSubstitutions(): ReadonlyArray<{
  countryId: string;
  requestedYear: number;
  usedYear: number;
}> {
  return [...substitutions];
}

/** Clear the substitution record — call at the start of an emit run. */
export function resetDefenseEraSubstitutions(): void {
  substitutions.length = 0;
}

/**
 * The authored defense board for a country in a given era, or null when the
 * country has none (every playable — they have POLITICAL_BASELINE_ANCHORS).
 *
 * Falls back to the NEAREST authored era and RECORDS the substitution, rather
 * than silently handing 1953 values to a 2019 world. That silence is what let
 * modern Germany ship with `armedForces: 8` and modern Japan with 15 — values
 * authored for an occupied 1953 Germany with no army and a Japan under Article
 * 9. Omitting `year` keeps the pre-era behaviour for callers that have no year.
 */
export function defenseBoardFor(
  countryId: string,
  year?: number | null
): Record<string, number> | null {
  const authoredYears = Object.keys(DEFENSE_BOARDS_BY_YEAR)
    .map(Number)
    .sort((a, b) => a - b);
  if (year == null || !Number.isFinite(year)) {
    return DEFENSE_BOARDS_1953[countryId] ?? null;
  }
  const exact = DEFENSE_BOARDS_BY_YEAR[year]?.[countryId];
  if (exact) return exact;
  // Nearest authored era, preferring the latest one at or before the request.
  const atOrBefore = authoredYears.filter((y) => y <= year);
  const usedYear = atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : authoredYears[0];
  const board = DEFENSE_BOARDS_BY_YEAR[usedYear]?.[countryId];
  if (!board) return null;
  if (usedYear !== year) substitutions.push({ countryId, requestedYear: year, usedYear });
  return board;
}
