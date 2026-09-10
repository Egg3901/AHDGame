import { ensureRegionalDelegateElections, seatsFromRegionField } from "../shared";

/**
 * Ensure every BR macro-region has an active/upcoming Câmara dos Deputados
 * election. Mirrors `ensureCNElections` — one multi-seat regional election
 * per region, anchored to the preset's `brChamber` cycle anchor.
 */
export async function ensureBRElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "BR",
      electionType: "chamber",
      seatsForRegions: (regions) => Object.fromEntries(regions.map((r) => [r._id as string, 1])),
      openPrimaryImmediately: true,
      label: "Câmara",
    },
    now
  );
}

/**
 * Ensure every BR macro-region has an active/upcoming Federal Senate
 * election. Had NO spawner at all before this — the seeded 81-seat chamber
 * (`brRegions[*].stateSenateSeats`, summing to 81 across the 5 macro-regions
 * — 21/27/12/12/9) never held a single election; seats only ever vacated
 * (resignation/term-end) with nothing to backfill them, so occupancy
 * strictly declined turn over turn.
 *
 * Mirrors `ensureBRElections`: one multi-seat regional election per
 * macro-region, sized by the region's own `stateSenateSeats` (same field NG's
 * multi-seat Senate spawner reads — `ensureNGZoneElections`), anchored to the
 * preset's `brSenate` cycle anchor (see `canonicalCycle.ts`'s `case "senate"`
 * BR branch and `BR_SENATE_CYCLE_PERIOD_HOURS` for the staggering-
 * simplification note: the real chamber renews 1/3 then 2/3 of individual
 * SEATS every 4 years; this elects every seat in a region together every 4
 * years instead, for lack of per-seat class data at the seed layer).
 */
export async function ensureBRSenateElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "BR",
      electionType: "senate",
      seatsForRegions: (regions) => seatsFromRegionField(regions, "stateSenateSeats"),
      openPrimaryImmediately: true,
      label: "Senate",
    },
    now
  );
}

// ─── Soviet Union: Supreme Soviet + republic soviets + First Secretaries ─────
//
// All four families are status-gated via `ruElectionsLive` (#3386): RU stays
// `coming-soon` for players, but its elections run when RU is beta/active (the
// Cold-War presets / the headless sim force this) OR when RU is NPP-governed
// (global autonomy ≥ v1, RU read-only, never player-enabled) — so a live world
// running the NPP brain re-elects the Supreme Soviet instead of freezing it.
// They are ALSO era-gated (null ruSupremeSoviet/ruRepublicSoviet anchors under
// 2019/1991 return no spawn from buildCanonicalSpawn).
