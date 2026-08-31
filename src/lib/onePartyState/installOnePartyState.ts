import type { Db, ObjectId } from "mongodb";
import {
  COUNTRY_CONFIGS,
  DEFAULT_OPS_VOTE_MULTIPLIERS,
  type CountryId,
} from "@/lib/constants/countries";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { updateCountryState } from "@/lib/countryState";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { ensureInitialEscalationState } from "@/lib/turn/regimeEscalationTurn";

/**
 * Turn a country into a one-party state.
 *
 * The MIRROR of `triggerSystemConversion`, which only ever ran the other way: that
 * function flips a one-party state into a democracy, clears `opsVoteMultipliers`
 * and `hasLeaderConfidenceModel`, and wipes `regimeStatus` on every party. This
 * restores exactly what that clears, so the pair reads as one reversible operation
 * rather than two unrelated writes.
 *
 * Does NOT dissolve the legislature or schedule elections. Those belong to the
 * caller, so that the same dissolution and the same election run whichever
 * direction the conversion went.
 *
 * Spec: docs/superpowers/specs/2026-08-27-peace-terms-design.md
 */
export interface InstallOnePartyStateOptions {
  /**
   * The party to install, bypassing resolution entirely.
   *
   * Reunification needs this and cannot work without it. `resolveRulingParty`
   * reads the SURVIVING shell's formed government -- Germany's, whose governing
   * party is the SPD -- so a merge that let it resolve would install the side
   * that just LOST the war and ban the winner. Naming the party explicitly is
   * the only way to say "this specific party takes power".
   *
   * Ignored when it does not name a party of this country, so a stale id
   * degrades to the ordinary resolution rather than banning everyone.
   */
  rulingPartyId?: number;
  /**
   * Non-ruling parties that are TOLERATED (`approved`) rather than banned.
   *
   * The default -- everyone but the ruling party is banned -- is right for a
   * conversion imposed on a country from outside, which is what the
   * `regime_change` peace term is. It is wrong for a merge: the absorbed state
   * arrives with its own settled arrangement, and the GDR's is a National Front
   * of four tolerated bloc parties beside the SED. Banning them on the way in
   * would have the winning side dissolve its own coalition at the moment it won.
   *
   * Ids that do not name a party of this country are ignored, and the ruling
   * party is never demoted to `approved` by appearing here.
   */
  toleratedPartyIds?: number[];
  /**
   * Vacate every elected office held by a party this install BANS.
   *
   * Off by default so the shipped `regime_change` peace term keeps behaving
   * exactly as it did. Reunification turns it on: without it the unified
   * chamber seats the banned western parties at 71% of a state their own
   * parties are outlawed in, and the ruling party governs as a 28.9% minority
   * of a chamber that is nominally opposed to it.
   *
   * VACATES, does not reapportion. The seats stay in the chamber's nominal size
   * -- that is `getLiveLowerChamberSeats` summing region `houseDistricts`, and
   * the western Laender genuinely still exist -- they simply stand empty until
   * something fills them. That keeps the change reversible: a regime that later
   * democratises refills them at the next election rather than having to
   * reconstruct a chamber somebody deleted.
   */
  vacateBannedSeats?: boolean;
}

export async function installOnePartyState(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  opts?: InstallOnePartyStateOptions
): Promise<void> {
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .toArray();

  const explicit =
    opts?.rulingPartyId != null && parties.some((p) => p.sequentialId === opts.rulingPartyId)
      ? opts.rulingPartyId
      : null;
  const rulingPartyId = explicit ?? (await resolveRulingParty(db, countryId, parties));

  await updateCountryState(db, countryId, {
    governmentType: "onePartyState",
    hasLeaderConfidenceModel: true,
    // Restored from the country's own config where it has one (a country that has
    // BEEN a one-party state keeps its tuned weights), and from the shared default
    // otherwise. Most democracies carry none, because they have never needed them,
    // and inventing a per-country set here would be a balance decision hidden
    // inside a conversion.
    opsVoteMultipliers: COUNTRY_CONFIGS[countryId]?.opsVoteMultipliers ?? {
      ...DEFAULT_OPS_VOTE_MULTIPLIERS,
    },
    ...(rulingPartyId != null ? { rulingPartyId } : {}),
  });

  if (rulingPartyId != null) {
    const col = db.collection<PoliticalParty>("politicalParties");
    const now = new Date();
    // Only ids that name a real party of this country, and never the ruling one
    // -- a party cannot be both `ruling` and `approved`, and the two
    // `updateMany`s below would otherwise race on which wrote last.
    const tolerated = (opts?.toleratedPartyIds ?? []).filter(
      (id) => id !== rulingPartyId && parties.some((p) => p.sequentialId === id)
    );

    // Three `updateMany`s rather than a loop, mirroring `clearAllRegimeStatusForCountry`.
    await col.updateMany(
      { countryId, sequentialId: rulingPartyId },
      { $set: { regimeStatus: "ruling", updatedAt: now } }
    );
    if (tolerated.length > 0) {
      await col.updateMany(
        { countryId, sequentialId: { $in: tolerated } },
        { $set: { regimeStatus: "approved", updatedAt: now } }
      );
    }
    // Everyone else is BANNED, not `approved`. A settlement that installs a single
    // party installs a single party; leaving the others merely approved would be a
    // different constitutional outcome than the one imposed. Callers that mean to
    // tolerate a bloc say so through `toleratedPartyIds`.
    const bannedIds = parties
      .map((p) => p.sequentialId)
      .filter((id) => id !== rulingPartyId && !tolerated.includes(id));
    if (bannedIds.length > 0) {
      await col.updateMany(
        { countryId, sequentialId: { $in: bannedIds } },
        { $set: { regimeStatus: "banned", updatedAt: now } }
      );
      if (opts?.vacateBannedSeats) {
        await vacateSeatsOfParties(db, countryId, parties, bannedIds, now);
      }
    }
  }

  // The per-turn escalation driver needs a document to advance. Without this the
  // new regime would sit outside the discontent ladder entirely, which is not a
  // one-party state so much as a country wearing the label.
  await ensureInitialEscalationState(db, countryId, currentTurn);

  await recordCountryEvent(db, {
    countryId,
    turn: currentTurn,
    eventType: "regime_escalation",
    title: `${COUNTRY_CONFIGS[countryId]?.name ?? countryId} is reconstituted as a one-party state`,
    details: { subtype: "conversion", path: "forced", targetSystem: "onePartyState" },
  }).catch((err) => console.error(`${countryId} install history write failed:`, err));
}

/**
 * Empty every elected office held by one of the banned parties.
 *
 * The seats are VACATED, not reassigned: the chamber's nominal size comes from
 * region `houseDistricts` and is untouched, so the rows simply stop existing and
 * the seats stand empty until an election refills them. Reassigning them to the
 * ruling party would be inventing a result no ballot produced.
 *
 * Matches `party` the same three ways `resolveRulingParty` does -- sequentialId
 * first, then name, then abbreviation. Production writes `String(sequentialId)`,
 * but the display surfaces have written the other two, and a vacate that missed
 * those rows would leave banned members seated with no sign of why.
 *
 * The holders' denormalised `currentOffice` is cleared only for holders left
 * with NO remaining seat in this country, so a member who somehow still holds an
 * office through another party keeps the pointer to it.
 */
async function vacateSeatsOfParties(
  db: Db,
  countryId: CountryId,
  parties: PoliticalParty[],
  bannedIds: number[],
  now: Date
): Promise<void> {
  const banned = new Set(bannedIds);
  const tokens = new Set<string>();
  for (const party of parties) {
    if (!banned.has(party.sequentialId)) continue;
    tokens.add(String(party.sequentialId));
    if (party.name) tokens.add(party.name);
    if (party.abbreviation) tokens.add(party.abbreviation);
  }

  // AMBIGUOUS TOKENS ARE DROPPED, and this is not hypothetical: reunification
  // leaves Germany holding TWO parties abbreviated "CDU" — the western one it
  // bans and the eastern one it tolerates. A name or abbreviation shared with a
  // party that is NOT banned cannot identify a bench, so matching on it would
  // unseat the tolerated party's members alongside the banned one's.
  //
  // `sequentialId` is never dropped: it is unique per country by index, it is
  // what production actually stores, and it is the only token that is safe by
  // construction.
  for (const party of parties) {
    if (banned.has(party.sequentialId)) continue;
    if (party.name) tokens.delete(party.name);
    if (party.abbreviation) tokens.delete(party.abbreviation);
  }
  for (const id of banned) tokens.add(String(id));

  if (tokens.size === 0) return;

  const officials = db.collection<ElectedOfficial>("electedOfficials");
  const doomed = await officials.find({ countryId, party: { $in: [...tokens] } }).toArray();
  if (doomed.length === 0) return;

  const characterIds = doomed.map((o) => o.characterId).filter(Boolean) as ObjectId[];
  const nppIds = doomed.map((o) => o.nppId).filter(Boolean) as ObjectId[];

  await officials.deleteMany({ _id: { $in: doomed.map((o) => o._id) } });

  // AFTER the delete: "still seated" has to be measured against the rows that
  // survive, not the ones about to go.
  const stillSeated = await officials
    .find({ countryId, $or: [{ characterId: { $in: characterIds } }, { nppId: { $in: nppIds } }] })
    .toArray();
  const seatedCharacters = new Set(stillSeated.map((o) => o.characterId?.toString()));
  const seatedNpps = new Set(stillSeated.map((o) => o.nppId?.toString()));

  const clearCharacters = characterIds.filter((id) => !seatedCharacters.has(id.toString()));
  const clearNpps = nppIds.filter((id) => !seatedNpps.has(id.toString()));

  if (clearCharacters.length > 0) {
    await db
      .collection("characters")
      .updateMany(
        { _id: { $in: clearCharacters } },
        { $set: { currentOffice: null, updatedAt: now } }
      );
  }
  if (clearNpps.length > 0) {
    await db
      .collection("npps")
      .updateMany({ _id: { $in: clearNpps } }, { $set: { currentOffice: null, updatedAt: now } });
  }
}

/**
 * Which party takes power, as a sequentialId, or null when none can be resolved.
 *
 * Three sources, in order of how directly they answer "who governs here":
 *
 *   1. The FORMED GOVERNMENT's governing party. `governingPartyId` can be a
 *      non-numeric marker such as "independent", which `Number()` would turn into
 *      NaN, so it is integer-checked exactly as `syncRulingPartyIdFromFormedGovernment`
 *      does.
 *   2. The largest party in the chamber by seats held. A presidential system has no
 *      government formation to read, so the legislature answers instead.
 *   3. Nobody. A country with no parties tags none, rather than banning every party
 *      in a state with no ruling one.
 *
 * Deterministic throughout: a re-run picks the same party.
 */
async function resolveRulingParty(
  db: Db,
  countryId: CountryId,
  parties: PoliticalParty[]
): Promise<number | null> {
  if (parties.length === 0) return null;

  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (gov?.status === "formed") {
    const seqId = Number(gov.governingPartyId);
    if (Number.isInteger(seqId) && parties.some((p) => p.sequentialId === seqId)) {
      return seqId;
    }
  }

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId })
    .toArray();

  const seatsBySeqId = new Map<number, number>();
  for (const official of officials) {
    if (!official.party) continue;
    // `ElectedOfficial.party` holds `String(sequentialId)` in production -- the
    // convention the seeders write and `candidateEnrichment` reads, and what
    // every row in the live world carries.
    //
    // THE SEQUENTIAL ID IS TRIED FIRST, and its absence here was a real defect:
    // this fallback compared only against the party's NAME and ABBREVIATION, so
    // it never matched a production row, always returned null, and left the
    // caller's `if (rulingPartyId != null)` block unentered. A presidential
    // country converted to a one-party state therefore got no ruling party and
    // nobody banned -- a one-party state with no party.
    //
    // Name and abbreviation are still accepted afterwards. They are what the
    // display surfaces write, and dropping them would trade one silent
    // mismatch for another.
    const seqId = Number(official.party);
    const party = Number.isInteger(seqId)
      ? (parties.find((p) => p.sequentialId === seqId) ??
        parties.find((p) => p.name === official.party || p.abbreviation === official.party))
      : parties.find((p) => p.name === official.party || p.abbreviation === official.party);
    if (!party) continue;
    seatsBySeqId.set(
      party.sequentialId,
      (seatsBySeqId.get(party.sequentialId) ?? 0) + (official.seatsHeld ?? 1)
    );
  }

  let best: number | null = null;
  let bestSeats = -1;
  // Sorted by sequentialId so a tie resolves the same way on every run rather than
  // on Mongo's return order.
  for (const [seqId, seats] of [...seatsBySeqId.entries()].sort((a, b) => a[0] - b[0])) {
    if (seats > bestSeats) {
      best = seqId;
      bestSeats = seats;
    }
  }
  return best;
}
