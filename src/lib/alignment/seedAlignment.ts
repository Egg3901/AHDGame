/**
 * Opening alignment for an entity in a given start.
 *
 * Four tiers in precedence order — authored, then the metropole rule, then the
 * decolonised rule, then a neutral default. Provenance comes back with the
 * shares so a report or audit can show which values were reasoned and which
 * were derived.
 */
import { ObjectId, type Db } from "mongodb";
import {
  polesForYear,
  resolveAlignmentEra,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import type { CountryId } from "@/lib/constants/countries";
import { WORLD_ENTITY_MANIFESTS } from "@/lib/world/worldEntityManifest";
import {
  ROSTER_BY_KEY,
  existsAt,
  isLiveCountryKey,
  statusAt,
  type AlignmentCountryKey,
} from "@/lib/constants/alignmentRoster";
import { AUTHORED_ALIGNMENT, DEFAULT_PRESET, PRESET_YEAR } from "@/lib/constants/alignmentSeeds";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import { resolveSeedRoster } from "@/lib/internationalOrganizations/founding";
import { getCountryAlignmentsCollection } from "@/lib/db/collections";
import type { CountryAlignment } from "@/lib/db/types/countryAlignment";
import { normalizeShares, type AlignmentShares } from "./normalize";

export type AlignmentProvenance = "authored" | "metropole" | "decolonised" | "default";

/**
 * A colony sits in its ruler's column, damped — it has no foreign policy of its
 * own, which is exactly why inheriting is right and why copying would be wrong.
 */
const METROPOLE_RETENTION = 0.85;
/** What a newly independent state keeps of its former ruler's alignment. */
const DECOLONISED_RETENTION = 0.3;
/** An unauthored minor sovereign leans mildly toward the era's first pole. */
const DEFAULT_LEAN = 34;

/**
 * Highest opening share a NON-MEMBER may hold in a bloc's own pole.
 *
 * Below {@link JOIN_SHARE}, and that is the entire point. Alignment lets an
 * unplayed nation apply to a bloc it has swung toward, so any non-member seeded
 * at or above the join gate applies on turn one — no play, no spending, no
 * decision by anyone. A 1953 world opened with South Korea at 84, Nicaragua 82,
 * Panama 80 and Cuba 78 toward the West, so NATO's roster would have grown by
 * itself before a player took a single action.
 *
 * Ten points of headroom under the gate is deliberate: `PER_NATION_TURN_CAP` is
 * 5, so flipping even the most pro-Western non-member still takes two full turns
 * of sustained effort at the cap, and the accession must then hold for
 * `SUSTAIN_TURNS` before it counts. Members are untouched — a bloc's own
 * countries are supposed to sit deep in its column.
 */
const NON_MEMBER_SEED_CAP = 50;

function rowToShares(row: number[], poles: readonly AlignmentPoleId[]): AlignmentShares {
  const raw: Partial<Record<AlignmentPoleId, number>> = {};
  poles.forEach((pole, i) => {
    raw[pole] = row[i] ?? 0;
  });
  return normalizeShares(raw, poles);
}

export interface OpeningShares {
  shares: AlignmentShares;
  provenance: AlignmentProvenance;
  /**
   * Era the shares are expressed in — the PRESET's era, not the live year's.
   * Returned so a caller healing a row mid-game stamps the vocabulary the
   * shares actually use, and the next turn's crossing converts it.
   */
  eraKey: string;
}

/**
 * Caps a non-member's share in each bloc's own pole, leaving members alone.
 *
 * Only channels flagged `alignmentAccession` are considered — those are the orgs
 * a nation can be admitted to on alignment alone, so they are exactly the ones a
 * runaway opening share would auto-apply to. An org with a channel but no
 * accession rule (the EU) carries influence without a gate, and capping against
 * it would restrict a country for a membership it was never going to be granted.
 *
 * The trimmed points are not redistributed: `normalizeShares` treats whatever
 * the poles do not hold as the remainder, so they land in non-alignment, which
 * is the honest place for "this country has not committed".
 */
function capNonMemberShares(
  row: number[],
  poles: readonly AlignmentPoleId[],
  key: AlignmentCountryKey,
  preset: string,
  year: number
): number[] {
  const capped = [...row];
  for (const channel of resolveAlignmentEra(year).channels) {
    if (!channel.alignmentAccession) continue;
    const def =
      INTERNATIONAL_ORGANIZATIONS[
        channel.organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS
      ];
    if (!def) continue;
    if (resolveSeedRoster(def, preset).some((m) => String(m) === key)) continue;
    const i = poles.indexOf(channel.poleId);
    if (i < 0) continue;
    capped[i] = Math.min(capped[i] ?? 0, NON_MEMBER_SEED_CAP);
  }
  return capped;
}

export function resolveOpeningShares(params: {
  key: AlignmentCountryKey;
  preset: string;
}): OpeningShares {
  const year = PRESET_YEAR[params.preset] ?? PRESET_YEAR[DEFAULT_PRESET];
  const poles = polesForYear(year);
  const eraKey = resolveAlignmentEra(year).key;
  // Every branch below caps through the same call, so no future source of
  // opening shares can quietly reintroduce a nation that joins on turn one.
  const cap = (row: number[]) => capNonMemberShares(row, poles, params.key, params.preset, year);

  const authored = AUTHORED_ALIGNMENT[params.preset]?.[params.key];
  if (authored)
    return { shares: rowToShares(cap(authored), poles), provenance: "authored", eraKey };

  const entry = ROSTER_BY_KEY[params.key];
  const metro = entry?.metro;
  const metroRow = metro ? AUTHORED_ALIGNMENT[params.preset]?.[metro] : undefined;

  if (metroRow) {
    const dependent = statusAt(params.key, year) === "dependent";
    const factor = dependent ? METROPOLE_RETENTION : DECOLONISED_RETENTION;
    // A newly independent state needs no explicit non-aligned share: keeping
    // only 30% of its former ruler's alignment leaves the other 70% in the
    // remainder, which IS non-alignment.
    const scaled = metroRow.map((v) => v * factor);
    return {
      shares: rowToShares(cap(scaled), poles),
      provenance: dependent ? "metropole" : "decolonised",
      eraKey,
    };
  }

  const row = poles.map(() => 0);
  row[0] = DEFAULT_LEAN;
  return { shares: rowToShares(cap(row), poles), provenance: "default", eraKey };
}

/**
 * Seed opening alignments for a world.
 *
 * Runs REGARDLESS of the feature gate — it is the only gate-off write in the
 * system, so flipping the gate on a live world reveals a populated map rather
 * than blank rows.
 *
 * Two populations get a row:
 *
 * 1. Playable countries in this preset's roster. Being implemented and being in
 *    the preset are independent — `DD` is implemented but absent from
 *    `2019-default`, Egypt is rostered but not implemented — so both are checked.
 * 2. Every sphere-macro entity in the preset manifest. These are the entities the
 *    sphere system sponsors, and alignment owns their `alignment` score, so a
 *    missing row would leave that number with nothing driving it.
 * 3. Every seed-roster member of a built-in organization. Membership is
 *    entity-wide, so a bloc can seat a Background Nation — NATO seats Canada,
 *    the Benelux, Norway, Denmark, Portugal and Iceland; the Warsaw Pact seats
 *    Albania. Without a row those members have no standing at all: they vanish
 *    from the Influence tab's roster, and nothing can ever measure them against
 *    the leave gate, so a bloc could never lose one however far it drifted.
 *
 * Idempotent: an existing row is left untouched, so a reseed never clobbers a
 * world that has already drifted.
 */
function seedTargets(
  preset: string,
  presetCountries: readonly CountryId[],
  year: number
): AlignmentCountryKey[] {
  const keys = new Set<AlignmentCountryKey>();
  for (const countryId of presetCountries) {
    if (isLiveCountryKey(countryId)) keys.add(countryId);
  }
  // Sphere-macro entities are sponsored by the sphere system but are not
  // playable, so they never appear in presetCountries. Indexed rather than
  // fetched through the throwing accessor: seeding runs for presets that have
  // no manifest (2023-default), and those simply contribute no macro entities.
  for (const entry of WORLD_ENTITY_MANIFESTS[preset]?.entries ?? []) {
    if (entry.simulationTier !== "sphere-macro") continue;
    if (entry.entityId in ROSTER_BY_KEY) keys.add(entry.entityId as AlignmentCountryKey);
  }
  // Org members, whatever their tier — but only for organisations that exist in
  // this preset's year. Without that gate the Warsaw Pact's default roster
  // reaches into a 2019 world and seeds East Germany, a country that has not
  // existed since 1990: `foundingMembersByEra` has no 2019 entry, so the
  // era-independent fallback applies and carries DD with it.
  // Known presets only. `year` falls back to the default preset's when a preset
  // is unrecognised, which for the "empty" preset would invent a 2019 world and
  // seed NATO's roster into a world that is supposed to contain nothing.
  const orgSeatsApply = preset in PRESET_YEAR;
  for (const def of orgSeatsApply ? Object.values(INTERNATIONAL_ORGANIZATIONS) : []) {
    if (def.foundedYear != null && year < def.foundedYear) continue;
    if (def.dissolvedYear != null && year >= def.dissolvedYear) continue;
    for (const member of resolveSeedRoster(def, preset)) {
      if (member in ROSTER_BY_KEY) keys.add(member as AlignmentCountryKey);
    }
  }
  return [...keys];
}

export async function seedCountryAlignments(
  db: Db,
  preset: string,
  presetCountries: readonly CountryId[]
): Promise<number> {
  const year = PRESET_YEAR[preset] ?? PRESET_YEAR[DEFAULT_PRESET];
  const col = await getCountryAlignmentsCollection(db);
  const now = new Date();
  let inserted = 0;

  // Pre-release cleanup: rows written before alignment was re-keyed from
  // `countryId` to `entityId` can never be matched or read again, and would
  // otherwise sit alongside their own replacements forever.
  await col.deleteMany({ entityId: { $exists: false } });

  // One existence read for the whole roster instead of a findOne per entity.
  // Read AFTER the cleanup above so the deleted legacy rows can never land in
  // the set and suppress their own replacements. Staged ids join the set as we
  // go, preserving the old loop's see-your-own-insert behaviour.
  const seen = new Set<string>(
    (await col.find({}, { projection: { entityId: 1 } }).toArray()).map((d) => d.entityId)
  );
  const docs: CountryAlignment[] = [];

  for (const entityId of seedTargets(preset, presetCountries, year)) {
    if (!existsAt(entityId, year)) continue;
    if (seen.has(entityId)) continue;
    seen.add(entityId);

    // eraKey comes back from the resolver so seeding and mid-game healing can
    // never disagree about which vocabulary the shares are written in.
    const { shares, eraKey } = resolveOpeningShares({ key: entityId, preset });
    docs.push({
      _id: new ObjectId(),
      entityId,
      eraKey,
      shares: shares.shares,
      nonAligned: shares.nonAligned,
      previous: null,
      turn: 0,
      updatedAt: now,
    });
    inserted++;
  }

  if (docs.length > 0) await col.insertMany(docs);
  return inserted;
}
