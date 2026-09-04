import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getNationalIdentity } from "@/lib/constants/nationalIdentity";

/** Canonical "is this a state-owned National Corporation" reader. */
export function isStateOwned(
  corp: Pick<Corporation, "countryOwnerId" | "ownershipState">
): boolean {
  return !!corp.countryOwnerId || corp.ownershipState === "stateOwned";
}

/**
 * Build a fresh National Corporation document for a country. Shared by the
 * primary-ensure path and the split-off path; callers set `isPrimaryNationalCorporation`
 * / `assignedSectorTypes` / `name` to taste.
 */
export function buildNationalCorporationDoc(
  countryId: CountryId,
  overrides: Partial<Corporation> = {}
): Omit<Corporation, "_id"> {
  const identity = getNationalIdentity(countryId);
  const now = new Date();
  return {
    name: identity.name,
    type: "financial",
    ceoId: new ObjectId(), // placeholder; a National Corporation has no player CEO until appointed
    ceoVacant: true,
    userId: new ObjectId(),
    countryId,
    countryOwnerId: countryId,
    ownershipState: "stateOwned",
    isNationalized: true,
    // Listed on the exchange as a non-tradable state asset (parity with the
    // seeded primary NatCorps), so every National Corporation — primary and
    // split-off — surfaces in the Stock Market. Not tradable/attackable: the
    // `countryOwnerId` flag gates those paths, and index funds exclude it.
    hiddenFromExchange: false,
    isPrivate: false,
    headquartersState: "",
    liquidCapital: 0,
    liquidCurrencyCode: COUNTRY_CURRENCY_MAP[countryId],
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    totalShares: 0,
    sharePrice: 1,
    publicFloat: 0,
    shareholders: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Returns the country's **primary** National Corporation, creating it if absent
 * (spec §24.1 — one primary + N secondary split-offs). Prefers the corp flagged
 * `isPrimaryNationalCorporation`; falls back to any `{ countryOwnerId }` for
 * pre-backfill safety (the existing seeded SOE), and stamps the primary flag +
 * empty `assignedSectorTypes` ("the remainder") on create.
 *
 * ONE PRIMARY PER COUNTRY IS AN INVARIANT, not a preference. This read — like
 * the sovereign bond issuer lookup and the State Enterprises panel — takes a
 * single document, so with two flagged corporations it returns whichever the
 * natural order yields and every caller silently routes into it. No tiebreak
 * here can recover the right answer, because nothing on the document says which
 * of the two the country means. The invariant is therefore enforced where it can
 * be broken: `mergeNationalCorporations` in `country/mergeCountry.ts` folds the
 * absorbed state's primary into the survivor's when one country absorbs another.
 * Ticket #1254 is what this looks like when it is not held.
 */
export async function ensurePrimaryNationalCorporation(
  db: Db,
  countryId: CountryId
): Promise<Corporation> {
  const corps = db.collection<Corporation>("corporations");

  const primary = await corps
    .find({ countryOwnerId: countryId, isPrimaryNationalCorporation: true })
    .sort({ _id: 1 })
    .limit(1)
    .next();
  if (primary) return primary;

  // Pre-backfill fallback: an existing seeded NatCorp not yet flagged primary.
  const legacy = await corps.find({ countryOwnerId: countryId }).sort({ _id: 1 }).limit(1).next();
  if (legacy) return legacy;

  const doc = buildNationalCorporationDoc(countryId, {
    isPrimaryNationalCorporation: true,
    assignedSectorTypes: [],
  });
  const result = await corps.insertOne(doc as Corporation);
  return { ...(doc as Corporation), _id: result.insertedId };
}

/**
 * Resolve which National Corporation a given sector type routes to in a country:
 * the secondary split-off whose `assignedSectorTypes` includes the type, else
 * the primary (which holds the remainder). Used by every nationalization so
 * future takings of a split-off type land in the right corp (spec §24.1).
 */
export async function resolveNationalCorporationForSector(
  db: Db,
  countryId: CountryId,
  sectorType: CorporationType
): Promise<Corporation> {
  const secondary = await db
    .collection<Corporation>("corporations")
    .findOne({ countryOwnerId: countryId, assignedSectorTypes: sectorType });
  if (secondary) return secondary;
  return ensurePrimaryNationalCorporation(db, countryId);
}
