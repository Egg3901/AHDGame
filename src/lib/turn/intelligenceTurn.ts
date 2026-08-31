import type { AnyBulkWriteOperation, Db } from "mongodb";
import { getColdWarTension } from "@/lib/coldwar/tension";
import { getAllCountryAccess } from "@/lib/countryAccess";
import {
  getIntelligenceAgenciesCollection,
  getIntelligenceNetworksCollection,
} from "@/lib/db/collections/intelligence";
import type { CountryId } from "@/lib/constants/countries";
import type { IntelligenceAgency, IntelligenceNetwork } from "@/lib/db/types/intelligence";
import { OP_SLOTS_PER_TURN, TRADECRAFT_DEFAULT } from "@/lib/intelligence/config";
import { deriveCounterIntel } from "@/lib/intelligence/counterIntel";
import { stepNetwork } from "@/lib/intelligence/network";

export interface IntelligenceTurnResult {
  networksStepped: number;
  posturesRefreshed: number;
}

/**
 * Per-turn intelligence upkeep.
 *
 * Deliberately NOT here:
 *
 * - Coverage decay, which is derived on read from `lastCollectedTurn`. Writing
 *   every coverage row every turn would be roughly (countries x countries x
 *   domains) pointless writes for a value that is a pure function of a stored
 *   turn. Same lazy reasoning as `DiplomaticActionBudget`.
 * - Player operations, which resolve on request rather than on the tick.
 *
 * NPP posture is refreshed whether or not the NPP OPERATIONS switch is on: the
 * switch decides whether an NPP country ACTS, never whether it RESISTS. Without
 * this, most of the world would defend at a constant default forever, and the
 * only countries with a moving counter-intelligence posture would be the handful
 * with a player setting it by hand.
 */
export async function processIntelligenceTurn(
  db: Db,
  turn: number
): Promise<IntelligenceTurnResult> {
  const networksCollection = await getIntelligenceNetworksCollection(db);
  const agenciesCollection = await getIntelligenceAgenciesCollection(db);

  const [networks, agencies] = await Promise.all([
    networksCollection.find({}).toArray(),
    agenciesCollection.find({}).toArray(),
  ]);

  const networkOps: AnyBulkWriteOperation<IntelligenceNetwork>[] = [];
  for (const net of networks) {
    const stepped = stepNetwork(net, turn);
    networkOps.push({
      updateOne: {
        filter: { _id: net._id },
        update: {
          $set: {
            level: stepped.level,
            progress: stepped.progress,
            suspicion: stepped.suspicion,
            status: stepped.status,
            cooledUntilTurn: stepped.cooledUntilTurn,
            updatedAt: stepped.updatedAt,
          },
        },
      },
    });
  }

  // One access sweep and one tension read for the whole pass, not per country.
  const [access, tension] = await Promise.all([getAllCountryAccess(db), getColdWarTension(db)]);

  const counterIntel = deriveCounterIntel({
    atWar: false,
    alignedShare: 0,
    tensionValue: tension.value,
    securityEstateCount: 0,
  });
  const byCountry = new Map(agencies.map((a) => [String(a.countryId), a]));

  // Iterate the COUNTRY LIST, not the existing agency rows.
  //
  // Agencies are created lazily when someone opens the console, and nobody ever
  // opens an NPP country's console — so walking existing rows would refresh the
  // posture of exactly the countries that already had a player and leave every
  // NPP country at zero forever. That would make "defence needs no order" inert
  // and every unplayed country a free target. Upsert instead, so the row exists
  // the first time anything needs to read it.
  const agencyOps: AnyBulkWriteOperation<IntelligenceAgency>[] = [];
  for (const [countryId, entry] of Object.entries(access)) {
    // `enabledForPlayers` and NOT `nppGoverned`, matching offensiveOptIns: a
    // predicate that also demands the autonomy ladder would leave most of the
    // world defending at a default in any world with autonomy switched off.
    if (entry.enabledForPlayers) continue;
    const existing = byCountry.get(countryId);
    if (existing && existing.counterIntel === counterIntel) continue;
    agencyOps.push({
      updateOne: {
        filter: { countryId: countryId as CountryId },
        update: {
          $set: { counterIntel, updatedAt: new Date() },
          $setOnInsert: {
            directorCharacterId: null,
            tradecraft: TRADECRAFT_DEFAULT,
            budgetRemaining: 0,
            opSlots: { turn, remaining: OP_SLOTS_PER_TURN },
            foundedTurn: turn,
          },
        },
        upsert: true,
      },
    });
  }

  if (networkOps.length > 0) await networksCollection.bulkWrite(networkOps, { ordered: false });
  if (agencyOps.length > 0) await agenciesCollection.bulkWrite(agencyOps, { ordered: false });

  return { networksStepped: networkOps.length, posturesRefreshed: agencyOps.length };
}
