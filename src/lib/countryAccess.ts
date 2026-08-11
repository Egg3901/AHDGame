/**
 * Country access control utilities.
 *
 * Determines which countries are accessible to players based on a two-tier
 * resolution: DB documents in `countryGameStates` override the static config
 * defaults in `COUNTRY_CONFIGS`. Fields fall back independently, so an admin
 * can override just `status` or just `enabledForPlayers` without touching the
 * other field.
 *
 * The `countryGameStates` collection is created lazily — documents only exist
 * once an admin has toggled a setting. A missing document always falls back to
 * the config's `status` field, treating "active" as enabled and everything
 * else as disabled.
 *
 * Econ-only nations: every REGISTERED country that is not `enabledForPlayers`
 * is browsable read-only — all of its pages, political ones included. Players
 * cannot act there (the per-action APIs require citizenship/office), but they
 * can see the parties, the legislature, and the elections behind the economy
 * they are investing in. Only an unregistered country (a latent secession
 * target such as SCO/WAL, absent from `COUNTRY_ORDER` until its activation
 * writes a row) stays fully hidden.
 *
 * `economyPreview` no longer gates routes. It survives as the switch that wires
 * a country's economy into the cross-country market lists — see
 * `getEconomyVisibleCountryIds`.
 */

import { AsyncLocalStorage } from "async_hooks";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  type CountryId,
  type CountryStatus,
} from "@/lib/constants/countries";
import type { CountryGameState, GameState } from "@/lib/db/types/gameState";

export interface CountryAccess {
  enabledForPlayers: boolean;
  status: CountryStatus;
  /**
   * True when this country's economy is wired into the cross-country market
   * lists (stock exchange, commodities, bonds) for non-admin players. This is
   * NOT a route gate — see `registered` for what a player may browse.
   */
  economyPreview: boolean;
  /**
   * True when the country exists in the runtime registered set (`COUNTRY_ORDER`
   * plus any latent country activated via a `status: "active"` row). An
   * unregistered country has no seeded world to show and stays hidden.
   */
  registered: boolean;
  /**
   * True when a registered country is browsable but not playable: every page
   * renders read-only, and the per-action APIs still refuse the viewer because
   * they require citizenship or office. Exactly `registered && !enabledForPlayers`.
   */
  econOnly: boolean;
  /**
   * True when this non-player country is run by the NPP autonomy governing brain
   * (global autonomy level ≥ v1). Its political pages — legislature, parties,
   * state/region politics, cabinet — then have a real (NPP-staffed) government to
   * show, so they are surfaced to players **read-only** (actions stay blocked by
   * the per-action APIs, which require citizenship/office). Always false for
   * player-enabled countries.
   */
  nppGoverned: boolean;
}

const NPP_LEVEL_RANK: Record<string, number> = { off: 0, v0: 1, v1: 2, v2: 3, v3: 4, v4: 5 };

/**
 * Read the global NPP-autonomy level directly off `gameState` (mirrors
 * `getNppAutonomyLevel`). Inlined here rather than imported from
 * `nppAutonomy/featureFlag` to avoid an import cycle — that module imports
 * `isCountryEnabledForPlayers` from this one.
 */
async function readGlobalNppLevelRank(db: Db): Promise<number> {
  const doc = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { nppAutonomyLevel: 1, nppAutonomyEnabled: 1 } });
  const level = doc?.nppAutonomyLevel ?? (doc?.nppAutonomyEnabled === true ? "v0" : "off");
  return NPP_LEVEL_RANK[level] ?? 0;
}

/**
 * Resolve access settings for a single country.
 *
 * Per-field fallback: DB values win when present; missing fields fall back to
 * config. `enabledForPlayers` is derived from `resolvedStatus` (not raw config
 * status) so that a DB-set status of "coming-soon" correctly disables access
 * even when `enabledForPlayers` is absent from the document.
 */
export async function getCountryAccess(countryId: CountryId): Promise<CountryAccess> {
  const db = await getDb();
  return getCountryAccessFromDb(db, countryId);
}

/**
 * Boolean shortcut around `getCountryAccessFromDb`. Phase 10 allowlist gates
 * call this from every player-facing layout / admin tool / API route that
 * used to hardcode a `["US", "UK", "DE", "JP"]`-style array. The admin
 * panel writes `countryGameStates` rows; this helper reads them so a flip
 * activates a country with no code redeploy.
 */
export async function isCountryEnabledForPlayers(db: Db, countryId: CountryId): Promise<boolean> {
  const access = await getCountryAccessFromDb(db, countryId);
  return access.enabledForPlayers;
}

/**
 * Dynamically-scoped snapshot of every country's access record.
 *
 * ⚠️ AsyncLocalStorage, NOT a module-level cache. A module cache would outlive
 * the scope that filled it and serve a stale status after an admin flipped a
 * country live — and the reset WRITES `countryGameStates` (seedCountryGameStates)
 * partway through its own run. Here the store exists only for the dynamic extent
 * of one callback and cannot leak.
 *
 * ⚠️ Only valid where nothing in `fn` writes `countryGameStates`. The election
 * battery and founding sweep satisfy that: they are read-only with respect to it,
 * and the seeder that writes it runs long before either.
 */
const countryAccessSnapshot = new AsyncLocalStorage<Record<CountryId, CountryAccess>>();

/**
 * Read every country's access ONCE and serve it to all `getCountryAccessFromDb`
 * calls inside `fn`, instead of one findOne per country per caller.
 */
export async function withCountryAccessSnapshot<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  return countryAccessSnapshot.run(await getAllCountryAccess(db), fn);
}

/**
 * `Db`-injecting variant of `getCountryAccess`. Use from contexts that already
 * hold a `Db` reference (per-turn processors, evaluators) so we don't ping the
 * mongodb singleton's promise unnecessarily.
 */
export async function getCountryAccessFromDb(db: Db, countryId: CountryId): Promise<CountryAccess> {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) throw new Error(`Invalid country ID: ${countryId}`);

  // Served from the ambient snapshot when one is open — see
  // {@link withCountryAccessSnapshot}. Falls through to the per-country read
  // when there is no scope, or when the snapshot does not carry this country
  // (`getAllCountryAccess` only yields REGISTERED ones).
  const snapshot = countryAccessSnapshot.getStore();
  const cached = snapshot?.[countryId];
  if (cached) return cached;

  const doc = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: countryId });

  // Resolve status first so the enabledForPlayers fallback uses the DB-driven value.
  const resolvedStatus = doc?.status ?? config.status;
  const enabledForPlayers = doc?.enabledForPlayers ?? resolvedStatus === "active";

  // A non-player country is "NPP-governed" once the global autonomy level is v1+.
  const nppGoverned = !enabledForPlayers && (await readGlobalNppLevelRank(db)) >= NPP_LEVEL_RANK.v1;

  // Mirrors `registeredBase()`: the static base, plus a latent country whose
  // activation flipped its row to "active".
  const registered = COUNTRY_ORDER.includes(countryId) || resolvedStatus === "active";

  return {
    enabledForPlayers,
    status: resolvedStatus,
    // economyPreview is only meaningful when the country isn't fully enabled.
    // If fully enabled, treat as false (no partial-access banner needed).
    economyPreview: !enabledForPlayers && (doc?.economyPreview ?? false),
    registered,
    econOnly: registered && !enabledForPlayers,
    nppGoverned,
  };
}

/**
 * The registered-country base for the access resolvers: `COUNTRY_ORDER` plus any
 * `countryGameStates` doc flipped to `status: "active"` that isn't already in the
 * static base — i.e. a seceded latent country (SCO/WAL). De-duped, base-first.
 * Behavior for the existing 8 countries is identical (no active extra ⇒ exactly
 * `COUNTRY_ORDER`), so this is what makes activation surface a country at runtime.
 */
function registeredBase(docs: CountryGameState[]): CountryId[] {
  const activeExtra = docs
    .filter((d) => d.status === "active" && !COUNTRY_ORDER.includes(d._id as CountryId))
    .map((d) => d._id as CountryId)
    .sort();
  return [...COUNTRY_ORDER, ...activeExtra];
}

/**
 * Resolve access settings for all countries in a single Mongo round-trip.
 *
 * Use this on landing/index pages (e.g. /world) instead of mapping
 * `getCountryAccess` over every country — that pattern fan-outs to N findOne
 * calls per request and surfaces as an N+1 query in performance tracing.
 */
export async function getAllCountryAccess(dbArg?: Db): Promise<Record<CountryId, CountryAccess>> {
  const db = dbArg ?? (await getDb());
  const docs = await db.collection<CountryGameState>("countryGameStates").find({}).toArray();
  const docMap = new Map(docs.map((d) => [d._id, d]));
  const globalNppRank = await readGlobalNppLevelRank(db);

  const out = {} as Record<CountryId, CountryAccess>;
  for (const countryId of registeredBase(docs)) {
    const config = COUNTRY_CONFIGS[countryId];
    const doc = docMap.get(countryId);
    const resolvedStatus = doc?.status ?? config.status;
    const enabledForPlayers = doc?.enabledForPlayers ?? resolvedStatus === "active";
    out[countryId] = {
      enabledForPlayers,
      status: resolvedStatus,
      economyPreview: !enabledForPlayers && (doc?.economyPreview ?? false),
      // Everything `registeredBase()` yields is registered by construction.
      registered: true,
      econOnly: !enabledForPlayers,
      nppGoverned: !enabledForPlayers && globalNppRank >= NPP_LEVEL_RANK.v1,
    };
  }
  return out;
}

/**
 * Return all country IDs that are currently enabled for players.
 *
 * Uses a single `find()` to fetch all country documents and resolves each
 * against its config default — avoids N per-country queries.
 *
 * Note: economy-preview countries are NOT included here. Use
 * `getEconomyVisibleCountryIds()` when you need to include them.
 */
export async function getEnabledCountryIds(): Promise<CountryId[]> {
  const db = await getDb();
  return getEnabledCountryIdsFromDb(db);
}

/**
 * `Db`-injecting variant of `getEnabledCountryIds`. Use from per-turn
 * processors that already hold a `Db` reference (and need MockDb-injectable
 * enumeration). Resolves each country against its config default, so countries
 * that are active purely via `COUNTRY_CONFIGS` — including the US, which has no
 * `countryGameStates` document — are still returned.
 */
/**
 * Countries the ENGINE is simulating, as opposed to countries players may join.
 *
 * `getEnabledCountryIdsFromDb` answers "can a player enter this country", which
 * is the wrong question for world-level subsystems: auto-disasters, auto-crises
 * and international-organisation broadcasts should fire in every country the
 * turn engine is actually running, whether or not it is open to players. Those
 * three all used the player predicate, so a sandbox that deliberately closes
 * every country to players (the sim harness must, because `isNppAutonomyActive`
 * refuses to seat governments in player-enabled countries) silently produced
 * ZERO disasters and ZERO crises for an entire run while reporting every phase
 * completed.
 *
 * Resolution: a runtime `countryGameStates.status` if present, else the
 * compiled-in config status; `enabledForPlayers: true` additionally qualifies a
 * country (a world with players in it must be simulated even if its status was
 * never flipped from "coming-soon"). The sandbox case above still works: the
 * harness closes countries by NOT setting `enabledForPlayers`, while their
 * status keeps them simulated.
 */
export async function getSimulatedCountryIds(db: Db): Promise<CountryId[]> {
  const docs = await db
    .collection<CountryGameState>("countryGameStates")
    .find({}, { projection: { _id: 1, status: 1, enabledForPlayers: 1 } })
    .toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return registeredBase(docs).filter((countryId) => {
    const doc = byId.get(countryId);
    const resolved = doc?.status ?? COUNTRY_CONFIGS[countryId].status;
    // `enabledForPlayers: true` is how live worlds opened countries before the
    // status field was consistently set (config may still say "coming-soon").
    // A country with real players must stay simulated (crises/disasters), so
    // honor the override in addition to status — same contract as
    // getEnabledCountryIdsFromDb.
    return resolved === "active" || resolved === "beta" || doc?.enabledForPlayers === true;
  });
}

export async function getEnabledCountryIdsFromDb(db: Db): Promise<CountryId[]> {
  const docs = await db.collection<CountryGameState>("countryGameStates").find({}).toArray();

  const docMap = new Map(docs.map((d) => [d._id, d]));

  return registeredBase(docs).filter((countryId) => {
    const doc = docMap.get(countryId);
    const config = COUNTRY_CONFIGS[countryId];
    const resolvedStatus = doc?.status ?? config.status;
    return doc?.enabledForPlayers ?? resolvedStatus === "active";
  });
}

/**
 * Return all country IDs visible to non-admin players — both fully enabled
 * countries and those in economy-preview mode.
 *
 * Use this when filtering economic data (stockmarket, corporations, bonds)
 * that should include economy-preview countries.
 */
export async function getEconomyVisibleCountryIds(): Promise<CountryId[]> {
  const db = await getDb();
  const docs = await db.collection<CountryGameState>("countryGameStates").find({}).toArray();

  const docMap = new Map(docs.map((d) => [d._id, d]));

  return registeredBase(docs).filter((countryId) => {
    const doc = docMap.get(countryId);
    const config = COUNTRY_CONFIGS[countryId];
    const resolvedStatus = doc?.status ?? config.status;
    const enabled = doc?.enabledForPlayers ?? resolvedStatus === "active";
    const preview = !enabled && (doc?.economyPreview ?? false);
    return enabled || preview;
  });
}

/**
 * Check whether a specific country is accessible to the requesting user.
 *
 * Admins bypass the enabled check entirely — they can always access any
 * country regardless of its enabled state. This avoids a DB round-trip for
 * every admin page load.
 */
export async function isCountryAccessible(
  countryId: CountryId,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
  const { enabledForPlayers } = await getCountryAccess(countryId);
  return enabledForPlayers;
}

/**
 * Check whether economy-only pages for a country are visible to the user.
 *
 * Returns true for: admins (always), fully-enabled countries, or countries
 * in economy-preview mode. Political pages should still use
 * `isCountryAccessible()` — this helper is only for economy routes.
 */
export async function isCountryEconomyVisible(
  countryId: CountryId,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
  const { enabledForPlayers, economyPreview } = await getCountryAccess(countryId);
  return enabledForPlayers || economyPreview;
}
