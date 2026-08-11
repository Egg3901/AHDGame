/**
 * Ceremonial head-of-state sync for every country whose head of state is held, by
 * political convention, by the ruling party's chair.
 *
 * The People's Republic had this from the start (`syncCNPresident`, hardcoded to CN);
 * the Warsaw Pact one-party states did not, and so rendered a permanent "Head of
 * State: Vacant" on their country page while their ruling party plainly had a chair —
 * which is exactly what a player asked about. Selection is driven by
 * `headOfStateSelection === "partyChairSync"` and the office by whichever office type
 * carries `isHeadOfState`, so wiring a country is a config change, not a code change.
 *
 * Does NOT touch `character.currentOffice`. The role is ceremonial and stacks on top
 * of whatever primary office the chair already holds (General Secretary, Premier, an
 * NPC delegate seat); the character page surfaces it through `electedOfficials`.
 *
 * Idempotent: on a no-op turn it performs reads and zero writes.
 */
import { ObjectId, type Db } from "mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import {
  COUNTRY_CONFIGS,
  getHeadOfStateOfficeType,
  ALL_COUNTRY_IDS,
  type CountryId,
} from "@/lib/constants/countries";

export type ChairSyncAction =
  "noop" | "seated" | "replaced" | "vacated" | "skipped_no_ruling_party" | "skipped_no_office";

export interface ChairHeadOfStateResult {
  countryId: string;
  action: ChairSyncAction;
  seatedCharacterId?: ObjectId;
  vacatedCharacterId?: ObjectId;
}

/** Every country whose ceremonial head of state follows the ruling-party chair. */
export function partyChairSyncCountries(): CountryId[] {
  return ALL_COUNTRY_IDS.filter(
    (id) => COUNTRY_CONFIGS[id].headOfStateSelection === "partyChairSync"
  );
}

/**
 * The country's ruling party. Prefers the live `regimeStatus: "ruling"` label and
 * falls back to the seeded `rulingPartyId`, so a world whose parties predate the
 * label still resolves.
 */
async function findRulingParty(db: Db, countryId: CountryId): Promise<PoliticalParty | null> {
  const coll = db.collection<PoliticalParty>("politicalParties");
  const ruling = await coll.findOne({ countryId, regimeStatus: "ruling" });
  if (ruling) return ruling;
  const seeded = COUNTRY_CONFIGS[countryId].rulingPartyId;
  if (seeded == null) return null;
  return coll.findOne({ countryId, sequentialId: seeded });
}

/**
 * Reconcile one country's head-of-state row against its ruling party's `chairId`.
 *
 *  - no head-of-state office in config → skipped (nothing to seat them in)
 *  - no ruling party → skipped (degenerate state)
 *  - chair null, nobody seated → no-op
 *  - chair null, someone seated → vacate
 *  - chair already seated → no-op
 *  - chair differs → replace
 */
export async function syncPartyChairHeadOfState(
  db: Db,
  countryId: CountryId,
  now: Date = new Date()
): Promise<ChairHeadOfStateResult> {
  const officeType = getHeadOfStateOfficeType(COUNTRY_CONFIGS[countryId]);
  if (!officeType) return { countryId, action: "skipped_no_office" };

  const rulingParty = await findRulingParty(db, countryId);
  if (!rulingParty) return { countryId, action: "skipped_no_ruling_party" };

  const officials = db.collection<ElectedOfficial>("electedOfficials");
  const currentRow = await officials.findOne({ countryId, officeType });
  const chairId = rulingParty.chairId ?? null;

  if (!chairId) {
    if (!currentRow) return { countryId, action: "noop" };
    await officials.deleteOne({ _id: currentRow._id });
    return {
      countryId,
      action: "vacated",
      vacatedCharacterId: currentRow.characterId ?? undefined,
    };
  }

  if (currentRow?.characterId && currentRow.characterId.equals(chairId)) {
    return { countryId, action: "noop" };
  }

  const insertDoc: ElectedOfficial = {
    _id: new ObjectId(),
    countryId,
    officeType,
    characterId: chairId,
    party: String(rulingParty.sequentialId),
    electedAt: now,
    seatsHeld: 1,
    createdAt: now,
    updatedAt: now,
  };

  if (currentRow) await officials.deleteOne({ _id: currentRow._id });
  await officials.insertOne(insertDoc);

  return {
    countryId,
    action: currentRow ? "replaced" : "seated",
    seatedCharacterId: chairId,
    vacatedCharacterId: currentRow?.characterId ?? undefined,
  };
}

/** Reconcile every chair-synced country. Called from the turn phase and bootstrap. */
export async function syncAllPartyChairHeadsOfState(
  db: Db,
  now: Date = new Date()
): Promise<ChairHeadOfStateResult[]> {
  const out: ChairHeadOfStateResult[] = [];
  for (const countryId of partyChairSyncCountries()) {
    out.push(await syncPartyChairHeadOfState(db, countryId, now));
  }
  return out;
}
