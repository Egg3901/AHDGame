import { BLOC_DESIGNATION_PRESETS } from "@/lib/constants/orgCategory";
import { ROSTER_BY_KEY, statusAt, type AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import { PRESET_YEAR } from "@/lib/constants/alignmentSeeds";

/**
 * Cold War bloc alignment for the /world globe's BLOCS map mode.
 *
 * The globe's four TIERS (see `components/landing/countryTiers.ts`) answer "how
 * much game is there here?" — player / economic / battleground / background.
 * BLOCS answer a different question: "whose side is this country on?"
 *
 * IT READS THE TREATY, NOT THE SYMPATHY. This used to be a hand-written table
 * that filed every country the era touched as West, East or non-aligned by
 * judgment. That map was handsome and wrong: Spain and Brazil were blue without
 * being in NATO, West Germany was blue two years before it joined, China was red
 * having never been in the Warsaw Pact, and no colour could move when a nation
 * actually acceded or withdrew. A bloc's colour is now its ROLL —
 * `loadBlocMembership` reads live membership of whichever organisations carry an
 * accession-governing pole in the era.
 *
 * So the two alliances are drawn at their real size and everything else is
 * non-aligned, including countries plainly in a superpower's orbit. That is the
 * point: an orbit is not a treaty, and the influence system already has the
 * Cold War Ledger for showing where sympathy lies.
 *
 * SCOPE: the presets that have blocs at all (`BLOC_DESIGNATION_PRESETS`).
 * Elsewhere the mode is not offered and the globe stays in tier coloring, which
 * is correct-but-plain rather than confidently wrong.
 */
/**
 * Non-aligned covers both principled neutrality (SE, IE) and genuinely contested ground.
 *
 * Defined in `@/lib/world/bloc` and re-exported here under the name the map components
 * already import. The domain layer owns it because the military system reads the same
 * three values — `src/lib/military/bloc.ts` — and `src/lib` may not import `src/app`.
 */
export type { WorldBloc } from "@/lib/world/bloc";
import type { WorldBloc } from "@/lib/world/bloc";

export const BLOC_ORDER: readonly WorldBloc[] = ["west", "east", "nonAligned"];

export const BLOC_LABELS: Record<WorldBloc, string> = {
  west: "West",
  east: "East",
  nonAligned: "Non-Aligned",
};

/**
 * Bloc fills. Deliberately NOT the tier palette — a viewer switching modes
 * should see the map change meaning, not just shade. Blue/red is the period
 * cartographic convention; non-aligned takes a neutral sand.
 */
export const BLOC_COLORS: Record<WorldBloc, string> = {
  west: "rgba(59, 130, 246, 0.78)",
  east: "rgba(220, 38, 38, 0.75)",
  nonAligned: "rgba(217, 189, 107, 0.72)",
};

export const BLOC_STROKES: Record<WorldBloc, string> = {
  west: "rgba(191, 219, 254, 0.55)",
  east: "rgba(254, 202, 202, 0.50)",
  nonAligned: "rgba(240, 224, 176, 0.50)",
};

/** Whether this preset has blocs at all (drives whether the mode is offered). */
export function hasBlocData(presetId: string | undefined): boolean {
  return Boolean(presetId && BLOC_DESIGNATION_PRESETS.includes(presetId));
}

/**
 * Feature id → bloc, from live membership.
 *
 * Two passes, and the order is the rule. Every country the globe draws as
 * interactive starts NON-ALIGNED, then members overwrite themselves with their
 * bloc — so a country the era names but no alliance has claimed reads as
 * uncommitted rather than as an uncoloured hole.
 *
 * Members are painted whatever their TIER. NATO seats Canada, the Benelux,
 * Norway, Denmark, Portugal and Iceland as background entities, and an alliance
 * that does not draw its own members is not drawing the alliance. Background
 * NON-members stay out of the map entirely, in their dark grey.
 *
 * Dependents inherit their metropole's bloc when the metropole is a member —
 * Ukraine / Byelorussia / the Baltics are USSR republics in 1953, so they must
 * paint East with Russia rather than the default non-aligned sand. Sovereign
 * non-members (CN, ES, JP, …) stay non-aligned by design: an orbit is not a
 * treaty.
 *
 * Includes the `bi:<entityId>` region-overlay blob keys (split Germany, the
 * soviet-union shard) so an overlaid nation is coloured like its base polygon —
 * which is what puts East Germany on the map, since DD has no feature id of its
 * own.
 */
export function buildBlocLookup(params: {
  presetId: string | undefined;
  /** entityId → bloc, from `loadBlocMembership`. */
  membership: Readonly<Record<string, WorldBloc>>;
  /** Feature ids the globe draws as interactive. */
  interactiveFeatureIds: Iterable<string>;
}): Map<string, WorldBloc> {
  const lookup = new Map<string, WorldBloc>();
  if (!hasBlocData(params.presetId)) return lookup;

  for (const featureId of params.interactiveFeatureIds) lookup.set(featureId, "nonAligned");

  for (const [entityId, bloc] of Object.entries(params.membership)) {
    lookup.set(`bi:${entityId}`, bloc);
    for (const iso of ROSTER_BY_KEY[entityId as AlignmentCountryKey]?.iso ?? []) {
      lookup.set(iso, bloc);
    }
  }

  // Dependents of a bloc member wear their metropole's colour. Without this,
  // USSR republics (UKR/BLR/BAL) and similar full-autonomous dependents render
  // as non-aligned holes inside an otherwise East/West mass.
  const year = PRESET_YEAR[params.presetId!];
  if (year != null) {
    for (const [entityId, entry] of Object.entries(ROSTER_BY_KEY)) {
      const metro = entry.metro;
      if (!metro) continue;
      if (statusAt(entityId as AlignmentCountryKey, year) !== "dependent") continue;
      const bloc = params.membership[metro];
      if (!bloc || bloc === "nonAligned") continue;
      lookup.set(`bi:${entityId}`, bloc);
      for (const iso of entry.iso) lookup.set(iso, bloc);
    }
  }

  return lookup;
}
