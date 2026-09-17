import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import type { CountryGameState } from "@/lib/db/types/gameState";
import type { CountryStatus } from "@/lib/constants/countries";
import { isShippingPreset, tierFor, type CountryEraTier } from "@/lib/world/eraRoster";
import { isKnownPreset } from "@/lib/seeds/presetSelector";
import { assertCanOpenCountryToPlayers } from "@/lib/world/countryReadinessContract";

/**
 * Per-preset country enablement. `countryGameStates` rows are normally written
 * only by the admin panel; without this, a reset/bootstrap leaves enablement at
 * each country's CONFIG status, so era-specific countries (USSR, the bloc) never
 * turn on. This seeder writes the access tier (enabledForPlayers / economyPreview
 * / status) for the chosen preset so the era is playable straight after reset.
 *
 * Rows are written for EVERY registered country in every shipping preset. This
 * deliberately reverses the previous behaviour, where a preset without an
 * explicit manifest map (2019) wrote nothing so "admin-managed rows keep winning
 * exactly as before" — an admin toggle surviving a reset is how 2019 drifted
 * into six player countries instead of three. Release-note this.
 *
 * US is omitted: it runs off the global GameState, not a CountryGameState row.
 *
 * Player tiers are gated by the archetype-aware readiness contract (#3722): a
 * manifest `player` legacyAccess that still has hard blockers fails loudly
 * rather than shipping an incomplete player launch.
 */
export type Tier = {
  enabledForPlayers: boolean;
  economyPreview: boolean;
  status: CountryStatus;
};

const PLAYER: Tier = { enabledForPlayers: true, economyPreview: false, status: "active" };
const ECON: Tier = { enabledForPlayers: false, economyPreview: true, status: "beta" };
// NPP-only countries still participate in the turn engine. `coming-soon` is a
// presentation state that getSimulatedCountryIds deliberately excludes, so it
// cannot represent an autonomous NPC country. `beta` keeps the country in the
// simulation while economyPreview=false keeps it out of expanded-economy UI.
const NPP: Tier = { enabledForPlayers: false, economyPreview: false, status: "beta" };
const GLOBAL_GAME_STATE_COUNTRY_ID = COUNTRY_CONFIGS.US.id;

/** The row the roster says a country should carry in a given preset. */
type RosterRow = Tier & { absentInEra: boolean };

const TIER_ROWS: Record<CountryEraTier, RosterRow | null> = {
  player: { ...PLAYER, absentInEra: false },
  econ: { ...ECON, absentInEra: false },
  npp: { ...NPP, absentInEra: false },
  // A country absent from this era gets the NPP row plus the flag. It is a
  // separate concept from dissolution — see `absentInEra` in gameState.ts.
  absent: { ...NPP, absentInEra: true },
  // Latent countries are unregistered by definition, so they are never in
  // COUNTRY_ORDER and this loop never reaches them. Null rather than a row, so
  // a roster/registry contradiction fails loudly instead of writing a state
  // that would surface a country the codebase deliberately hides.
  latent: null,
};

/**
 * Reject a preset that is neither a shipping era nor one of the deliberate
 * special presets (`empty`, `2019-no-parties`).
 *
 * Returning null for anything unrecognised would turn a typo into a silent
 * no-op reset — the failure mode this whole sub-project exists to remove. The
 * previous implementation failed loudly via the manifest lookup; that property
 * is preserved here now the manifest is no longer consulted.
 */
function assertRecognisedPreset(preset: string): void {
  if (isShippingPreset(preset) || isKnownPreset(preset)) return;
  throw new Error(
    `No world entity roster for preset "${preset}"; refusing to guess an enablement map.`
  );
}

/**
 * Countries this preset contains: every registered country the roster does not
 * mark `absent`, minus the US, which runs off the global `GameState`. Null for
 * the special presets that deliberately seed no era.
 *
 * Not the same set as the rows `seedCountryGameStates` writes — that writes one
 * for every registered country, absent ones included, carrying
 * `absentInEra: true`. Callers of this function ask what a reset *produces*
 * (`seededCountryIdsForPreset` turns it into the seed diagnostic's expected
 * country set), so an absent country here makes the diagnostic demand budgets
 * and regions for a country the seeders correctly skip.
 */
export function getPresetEnablementCountries(preset: string): CountryId[] | null {
  assertRecognisedPreset(preset);
  if (!isShippingPreset(preset)) return null;
  return COUNTRY_ORDER.filter(
    (id) => id !== GLOBAL_GAME_STATE_COUNTRY_ID && tierFor(preset, id) !== "absent"
  );
}

/**
 * Per-country access tier for a preset, or null when this era does not contain
 * the country.
 *
 * `absent` returns null rather than the NPP row `seedCountryGameStates` writes.
 * The two paths answer different questions: the seeder needs a row for every
 * registered country so a world moving 2019 -> 1953 brings East Germany back,
 * while this accessor answers "is this country enabled here", and a country the
 * era does not contain is not enabled at any tier. The pre-roster
 * implementation drew the same line by reading manifest entries, which an
 * absent country does not have.
 */
export function getPresetEnablementTier(preset: string, countryId: CountryId): Tier | null {
  assertRecognisedPreset(preset);
  if (countryId === GLOBAL_GAME_STATE_COUNTRY_ID) return null;
  if (!isShippingPreset(preset)) return null;
  const tierId = tierFor(preset, countryId);
  if (tierId === "absent") return null;
  const row = TIER_ROWS[tierId];
  if (!row) return null;
  const { absentInEra: _absentInEra, ...tier } = row;
  void _absentInEra;
  return tier;
}

export async function seedCountryGameStates(
  db: Db,
  preset: string,
  startingYear: number,
  log: (msg: string) => void = () => {}
) {
  assertRecognisedPreset(preset);
  if (!isShippingPreset(preset)) {
    log(`[countryGameStates] ${preset} seeds no era — no enablement rows written`);
    return;
  }
  const now = new Date();
  let n = 0;
  for (const cid of COUNTRY_ORDER) {
    // The US runs off the global GameState and has no countryGameStates row.
    if (cid === GLOBAL_GAME_STATE_COUNTRY_ID) continue;
    const tier = TIER_ROWS[tierFor(preset, cid)];
    if (!tier) {
      throw new Error(
        `${cid} is latent in ${preset} but present in COUNTRY_ORDER — the roster and the ` +
          `registered set disagree. Fix the roster or COUNTRY_ORDER; do not write a row.`
      );
    }
    if (tier.enabledForPlayers) {
      assertCanOpenCountryToPlayers(cid, preset);
    }
    await db.collection<CountryGameState>("countryGameStates").updateOne(
      { _id: cid },
      {
        $set: {
          enabledForPlayers: tier.enabledForPlayers,
          economyPreview: tier.economyPreview,
          status: tier.status,
          // Written true OR false on every reset, never only-when-true, so a
          // world moving 1991 -> 1953 brings East Germany back rather than
          // stranding a flag the previous era set.
          absentInEra: tier.absentInEra,
          updatedAt: now,
        },
        $setOnInsert: {
          currentTurn: 1,
          currentYear: startingYear,
          cycleStartTurn: 1,
          snapElectionPending: false,
          isActive: false,
          lastTurnProcessed: now,
          nextScheduledTurn: null,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    n++;
  }
  log(`[countryGameStates] seeded ${n} country enablement rows for preset ${preset}`);
}
