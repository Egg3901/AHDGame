/**
 * What a country is CALLED and shown as, once runtime events are taken into
 * account.
 *
 * THE PROBLEM THIS SOLVES. A country's name, flag and government-type label are
 * compiled seed data, and `getCountryConfig` only ever layers era overrides onto
 * them — it never reads `countryState`. That is fine for a world that stays as it
 * was set up, and wrong the moment something converts a country at runtime. A
 * reunified Germany rendered as "West Germany", a "Parliamentary Republic", after
 * its government had genuinely become a one-party state and the other Germany had
 * ceased to exist. Every one of those reads was of the compiled value.
 *
 * WHY A RESOLVER RATHER THAN A RENAME. `COUNTRY_CONFIGS.name` is the identity
 * roughly ninety synchronous call sites depend on, many of them client
 * components; rewriting it is not available. This is the display layer asking one
 * question — "given what has happened, what should a reader be told?" — in one
 * place, so the answer cannot drift between surfaces.
 */
import type { Db } from "mongodb";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getCountryDisplayName,
  type CountryId,
  type GovernmentType,
} from "@/lib/constants/countries";
import { getCountryState, primeCountryStates } from "@/lib/countryState";

/** Everything a header, card or listing needs to name a country correctly. */
export interface CountryIdentity {
  name: string;
  flagEmoji: string;
  /** The live system of government, which may differ from the compiled one. */
  governmentType: GovernmentType;
  /** Its player-facing label, agreeing with `governmentType`. */
  governmentTypeLabel: string;
}

/**
 * Title-case names for the systems, for the `governmentTypeLabel` slot.
 *
 * Deliberately separate from `GOVERNMENT_SYSTEM_LABELS` in `peaceTerm`, which is
 * lower-case prose for mid-sentence use ("becomes a one-party state"). These are
 * labels; that is a clause. Merging them would force one register to read wrong.
 */
const GOVERNMENT_TYPE_TITLES: Record<GovernmentType, string> = {
  presidential: "Presidential Republic",
  parliamentaryRepublic: "Parliamentary Republic",
  parliamentaryMonarchy: "Parliamentary Monarchy",
  onePartyState: "One Party State",
};

/**
 * The label for a country whose system may have changed under it.
 *
 * When runtime and compiled agree, the COMPILED label wins — it carries nuance a
 * type cannot ("Semi-Presidential Republic" for France, whose `governmentType` is
 * just `presidential`). When they disagree, the compiled label is describing a
 * system the country no longer has, so the runtime type is named instead.
 */
export function governmentTypeLabelFor(
  countryId: CountryId,
  runtimeType: GovernmentType,
  preset?: string
): string {
  const config = Object.hasOwn(COUNTRY_CONFIGS, countryId)
    ? getCountryConfig(countryId, preset)
    : undefined;
  if (config && config.governmentType === runtimeType) return config.governmentTypeLabel;
  return GOVERNMENT_TYPE_TITLES[runtimeType] ?? config?.governmentTypeLabel ?? runtimeType;
}

/**
 * Resolve one country's presentation, runtime state included.
 *
 * Server-side, because it reads `countryState`. Client components take the result
 * as props rather than calling this, which is also what keeps the database out of
 * the browser bundle.
 */
export async function resolveCountryIdentity(
  db: Db,
  countryId: CountryId,
  preset?: string
): Promise<CountryIdentity> {
  const config = Object.hasOwn(COUNTRY_CONFIGS, countryId)
    ? getCountryConfig(countryId, preset)
    : undefined;
  const runtime = await getCountryState(db, countryId);
  const governmentType =
    runtime.governmentType ?? config?.governmentType ?? "parliamentaryRepublic";

  return {
    name: runtime.displayNameOverride ?? getCountryDisplayName(countryId, preset),
    flagEmoji: runtime.flagEmojiOverride ?? config?.flagEmoji ?? "",
    governmentType,
    governmentTypeLabel: governmentTypeLabelFor(countryId, governmentType, preset),
  };
}

/**
 * Every runtime display-name override in the world, for hydrating the client.
 *
 * The client cannot call `resolveCountryIdentity` — it reads the database, and
 * the point of the resolver living server-side is to keep the driver out of the
 * browser bundle. But roughly a dozen CLIENT surfaces name countries: the
 * navbar, the nation switcher, the world cards, the maps. They all call
 * `getCountryDisplayName`, which reads compiled seed data and so cannot know a
 * country was renamed at runtime — a reunified Germany went on calling itself
 * East Germany everywhere a player actually looks.
 *
 * So the overrides ride into the tree the same way `preset` already does, and
 * `useCountryDisplayName` applies them. One read for the whole world, because
 * the root layout runs on every request.
 *
 * Only non-empty strings are returned: a null or "" override means "no override"
 * and must fall through to the compiled name rather than blanking the country.
 */
export async function loadCountryNameOverrides(
  db: Db
): Promise<Partial<Record<CountryId, string>>> {
  // FAILS SOFT, deliberately. Every caller is a page render, and the worst case
  // of an empty map is a country shown under its compiled name — which is what
  // every one of these surfaces did before this existed. A page that 500s
  // because a cosmetic lookup threw would be the worse outcome, and the root
  // layout already wraps its own call for the same reason. It also keeps this
  // usable from the hand-built MockDbs several page tests supply, matching how
  // `getCountryState` guards its own read.
  try {
    const rows = await db
      .collection<{ _id: CountryId; displayNameOverride?: string | null }>("countryState")
      .find(
        { displayNameOverride: { $type: "string", $ne: "" } },
        { projection: { displayNameOverride: 1 } }
      )
      .toArray();
    const out: Partial<Record<CountryId, string>> = {};
    for (const row of rows) {
      if (typeof row.displayNameOverride === "string" && row.displayNameOverride.length > 0) {
        out[row._id] = row.displayNameOverride;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The same for several countries at once, for listings.
 *
 * PRIMED FIRST, deliberately. `getCountryState` memoises per Db instance and
 * `MongoClient.db()` hands back a new instance every call, so that memo is cold
 * at the top of every request: resolving the whole world one at a time is eighty
 * sequential round trips on a public endpoint. One `$in` read up front turns the
 * loop below into cache hits.
 */
export async function resolveCountryIdentities(
  db: Db,
  countryIds: CountryId[],
  preset?: string
): Promise<Map<CountryId, CountryIdentity>> {
  await primeCountryStates(db, countryIds);
  const out = new Map<CountryId, CountryIdentity>();
  for (const id of countryIds) {
    out.set(id, await resolveCountryIdentity(db, id, preset));
  }
  return out;
}
