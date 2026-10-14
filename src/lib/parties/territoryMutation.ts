/**
 * Party territory changes serialize across server processes before reading
 * eligibility. A crashed operation fails closed until staff reconcile and
 * clear its token; timed expiry must not admit a second live writer.
 */
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, PoliticalParty } from "@/lib/db/types";
import { PartyTerritoryError } from "./territoryErrors";

export interface TerritoryParty {
  countryId: CountryId;
  partyId: string;
}

export async function withPartyTerritoryMutation<T>(
  db: Db,
  parties: readonly TerritoryParty[],
  work: () => Promise<T>,
  expectedCharacter?: Pick<Character, "_id" | "homeState" | "party" | "countryId">
): Promise<T> {
  const token = new ObjectId().toHexString();
  const unique = new Map(
    parties
      // Match partyLookup's parseInt semantics so URL aliases claim the same party.
      .map((party) => ({ ...party, partyId: String(parseInt(party.partyId, 10)) }))
      .filter((party) => Number.isSafeInteger(Number(party.partyId)) && Number(party.partyId) > 0)
      .map((party) => [`${party.countryId}:${party.partyId}`, party])
  );
  const identities = [...unique.values()].map((party) => ({
    countryId: party.countryId,
    sequentialId: Number(party.partyId),
  }));
  if (identities.length === 0) return work();
  try {
    // updateMany is atomic per party, not across parties. A partial acquisition
    // never runs work: prove every existing requested party has our token,
    // otherwise release only our claims and return a retryable conflict.
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateMany(
        { $or: identities, territoryMutation: { $exists: false } },
        { $set: { territoryMutation: { token, startedAt: new Date() } } }
      );
    const blocked = await db
      .collection<PoliticalParty>("politicalParties")
      .find(
        { $or: identities, "territoryMutation.token": { $ne: token } },
        { projection: { _id: 1 } }
      )
      .limit(1)
      .toArray();
    if (blocked.length > 0) {
      throw new PartyTerritoryError(
        "Another geographic change is in progress for this party. Refresh and try again. If it persists, contact staff."
      );
    }
    if (expectedCharacter) {
      const current = await db
        .collection<Character>("characters")
        .findOne(
          { _id: expectedCharacter._id },
          { projection: { homeState: 1, party: 1, countryId: 1 } }
        );
      if (
        !current ||
        current.party !== expectedCharacter.party ||
        current.homeState !== expectedCharacter.homeState ||
        (current.countryId ?? "US") !== (expectedCharacter.countryId ?? "US")
      ) {
        throw new PartyTerritoryError(
          "Your residence or party membership changed. Refresh before trying again."
        );
      }
    }
    return await work();
  } finally {
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateMany(
        { $or: identities, "territoryMutation.token": token },
        { $unset: { territoryMutation: "" } }
      );
  }
}
