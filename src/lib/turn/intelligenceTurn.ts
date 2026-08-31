import type { AnyBulkWriteOperation, Db } from "mongodb";
import { getColdWarTension } from "@/lib/coldwar/tension";
import { getAllCountryAccess } from "@/lib/countryAccess";
import {
  getIntelligenceAgenciesCollection,
  getIntelligenceNetworksCollection,
} from "@/lib/db/collections/intelligence";
import type { IntelligenceAgency, IntelligenceNetwork } from "@/lib/db/types/intelligence";
import { deriveCounterIntel } from "@/lib/intelligence/counterIntel";
import { stepNetwork } from "@/lib/intelligence/network";

export interface IntelligenceTurnResult {
  networksStepped: number;
  posturesRefreshed: number;
}

const NOTHING: IntelligenceTurnResult = { networksStepped: 0, posturesRefreshed: 0 };

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

  if (networks.length === 0 && agencies.length === 0) return NOTHING;

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

  const agencyOps: AnyBulkWriteOperation<IntelligenceAgency>[] = [];
  for (const agency of agencies) {
    // `enabledForPlayers` and NOT `nppGoverned`, matching offensiveOptIns: a
    // predicate that also demands the autonomy ladder would leave most of the
    // world defending at a default in any world with autonomy switched off.
    const entry = access[agency.countryId];
    if (!entry || entry.enabledForPlayers) continue;
    const counterIntel = deriveCounterIntel({
      atWar: false,
      alignedShare: 0,
      tensionValue: tension.value,
      securityEstateCount: 0,
    });
    if (counterIntel === agency.counterIntel) continue;
    agencyOps.push({
      updateOne: {
        filter: { _id: agency._id },
        update: { $set: { counterIntel, updatedAt: new Date() } },
      },
    });
  }

  if (networkOps.length > 0) await networksCollection.bulkWrite(networkOps, { ordered: false });
  if (agencyOps.length > 0) await agenciesCollection.bulkWrite(agencyOps, { ordered: false });

  return { networksStepped: networkOps.length, posturesRefreshed: agencyOps.length };
}
