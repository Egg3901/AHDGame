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
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  applyIntelligenceSettlement,
  getIntelligenceAppropriation,
} from "@/lib/db/collections/intelligenceAppropriation";
import {
  intelligenceAccrualPerTurn,
  resolveIntelligenceLineFrom,
} from "@/lib/intelligence/appropriationLine";
import { networkUpkeep } from "@/lib/intelligence/cost";
import { deriveCounterIntel } from "@/lib/intelligence/counterIntel";
import { stepNetwork } from "@/lib/intelligence/network";

export interface IntelligenceTurnResult {
  networksStepped: number;
  posturesRefreshed: number;
  /** Countries whose appropriation was settled this turn (accrual minus upkeep). */
  countriesAccrued: number;
  /** Networks the appropriation could not pay for, which made no progress. */
  networksStalled: number;
}

/**
 * Per-turn intelligence upkeep: settle the appropriation, then step the networks it paid
 * for, then refresh NPP counter-intelligence posture.
 *
 * The money lives HERE rather than in a phase of its own because this pass already loads
 * every network and every agency, and because whether a network was funded is precisely
 * what decides whether it advances. A separate phase would need the same two reads and
 * would have to stay adjacent to this one to stay correct.
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

  // ── Money first ───────────────────────────────────────────────────────────
  //
  // Whether a network was paid for is exactly what decides whether it advances, so
  // the settlement has to happen before the stepping below, in the same pass.
  // Every country with a LINE, plus every country that owns a network.
  //
  // Not just network owners: a service that has just been funded owns nothing yet, and
  // gating accrual on owning a network would deadlock it — no network means no money,
  // and no money means it can never run the operation that would build one. Not just
  // countries with a line either: a service whose line has since lapsed to zero still
  // owns networks, and their upkeep must still be charged against what it has left.
  const networkOwners = new Set(networks.map((n) => String(n.ownerCountryId)));
  const budgetDocs = await db
    .collection<FederalBudget>("federalBudget")
    .find({
      $or: [
        { "spending.byCategory.intelligence": { $gt: 0 } },
        { countryId: { $in: [...networkOwners] } },
      ],
    })
    .toArray();
  const budgetByCountry = new Map(budgetDocs.map((b) => [b.countryId, b]));
  const owners = [...new Set([...budgetByCountry.keys(), ...networkOwners])];

  const fundedNetworkIds = new Set<string>();
  let countriesAccrued = 0;
  let networksStalled = 0;

  for (const owner of owners) {
    const budget = budgetByCountry.get(owner) ?? null;
    const gdp = budget?.gdp ?? 0;
    const accrual = intelligenceAccrualPerTurn(resolveIntelligenceLineFrom(budget));

    // An absent pot must exist before the guarded `$inc` can match it. Seeds to
    // ZERO, never to a year's accrual — see `getIntelligenceAppropriation`.
    const pot =
      budget?.intelligenceAppropriation ?? (await getIntelligenceAppropriation(db, owner));
    // Cheap pre-check; the authoritative guard is the `$lt: turn` filter on the write.
    if (pot.accruedThroughTurn >= turn) continue;

    // Descending level, then target id: a director protects the assets they have
    // already built, and the tie-break keeps the order deterministic across passes.
    const mine = networks
      .filter((n) => String(n.ownerCountryId) === owner)
      .sort(
        (a, b) =>
          b.level - a.level || String(a.targetCountryId).localeCompare(String(b.targetCountryId))
      );

    let available = pot.balance + accrual;
    let upkeepPaid = 0;
    for (const net of mine) {
      const due = networkUpkeep(net.funding, gdp);
      if (due <= 0) {
        // `none` costs nothing and earns nothing. Counting it funded keeps the flag
        // meaning "the turn paid whatever this network asked for".
        fundedNetworkIds.add(String(net._id));
        continue;
      }
      if (available >= due) {
        available -= due;
        upkeepPaid += due;
        fundedNetworkIds.add(String(net._id));
      } else {
        networksStalled += 1;
      }
    }

    // ONE guarded write for accrual and upkeep together. Splitting them would leave
    // the upkeep leg unguarded, and a replayed turn would charge it twice.
    if (await applyIntelligenceSettlement(db, owner, turn, accrual - upkeepPaid)) {
      countriesAccrued += 1;
    }
  }

  const networkOps: AnyBulkWriteOperation<IntelligenceNetwork>[] = [];
  for (const net of networks) {
    const stepped = stepNetwork(net, turn, fundedNetworkIds.has(String(net._id)));
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
            opSlots: { turn, remaining: OP_SLOTS_PER_TURN },
            foundedTurn: turn,
          },
        },
        upsert: true,
      },
    });
  }

  if (networkOps.length > 0) await networksCollection.bulkWrite(networkOps, { ordered: false });
  if (agencyOps.length > 0) {
    // A console GET can create the same agency row at the same moment, and an
    // upsert racing an insert on the unique countryId index throws E11000. That
    // is a benign collision here: the row the other writer inserted is the row
    // this pass wanted, and the next turn re-applies the posture. Anything else
    // is a real fault and must not be swallowed.
    try {
      await agenciesCollection.bulkWrite(agencyOps, { ordered: false });
    } catch (error) {
      const codes = [
        (error as { code?: number }).code,
        ...((error as { writeErrors?: { code?: number }[] }).writeErrors ?? []).map((w) => w.code),
      ];
      if (!codes.every((code) => code === 11000)) throw error;
    }
  }

  return {
    networksStepped: networkOps.length,
    posturesRefreshed: agencyOps.length,
    countriesAccrued,
    networksStalled,
  };
}
