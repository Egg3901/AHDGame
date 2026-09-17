import type { Db } from "mongodb";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import type { PoliticalParty } from "@/lib/db/types";
import { getUKPartyConferencesCollection } from "@/lib/db/collections/ukPartyConferences";
import {
  applyConferencePayoff,
  conferencePayoffNeedsSettle,
  conferenceResolutionNeedsHeal,
  ensureNppPlatformProposal,
  postConferenceNews,
  resolveConference,
} from "@/lib/uk/conference/conferenceCommands";
import {
  conferenceHistoryEntry,
  getOrSeedConference,
  pushConferenceHistory,
} from "@/lib/uk/conference/conferenceStore";
import {
  conferenceOpensAtTurn,
  conferenceVotingClosesTurn,
  conferenceYearForTurn,
} from "@/lib/uk/conference/rules";

export interface UkPartyConferenceTurnResult {
  scheduled: number;
  opened: number;
  completed: number;
  ratified: number;
  expired: number;
  payoffs: number;
}

const EMPTY: UkPartyConferenceTurnResult = {
  scheduled: 0,
  opened: 0,
  completed: 0,
  ratified: 0,
  expired: 0,
  payoffs: 0,
};

/**
 * UK party-conference turn driver (ticket #862).
 *
 * Annual lifecycle per UK party, all idempotent: seed this year's row at
 * the year's first turn, open scheduled rows at their opening turn, ensure
 * an NPP platform proposal on open AI-run conferences, close + resolve
 * rows past their voting window (player votes or deterministic NPP
 * acclamation), apply each ratified row's payoff exactly once, and expire
 * rows a past year left behind. UK-gated: a cheap no-op on worlds without
 * a registered UK.
 */
export async function processUkPartyConferenceTurn(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<UkPartyConferenceTurnResult> {
  const registered = new Set(await getRegisteredCountryIds(db));
  if (!registered.has("UK")) return { ...EMPTY };
  const result: UkPartyConferenceTurnResult = { ...EMPTY };

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "UK" })
    .project<PoliticalParty>({
      sequentialId: 1,
      name: 1,
      chairId: 1,
      economicPosition: 1,
      socialPosition: 1,
    })
    .toArray();
  const year = conferenceYearForTurn(currentTurn);

  for (const party of parties) {
    const partySeqId = String(party.sequentialId);
    // Seed-before-read: every operation below is idempotent on the row, so
    // a missing row is created rather than skipped. A null read before the
    // seed marks a genuinely new row for telemetry (retries re-read present).
    const opensAt = conferenceOpensAtTurn(year);
    const closesAt = conferenceVotingClosesTurn(opensAt);
    const before = await getUKPartyConferencesCollection(db).findOne({
      _id: `UK:${partySeqId}:${year}`,
    });
    await getOrSeedConference(db, "UK", party, year, opensAt, closesAt, now, currentTurn);
    if (!before) result.scheduled += 1;
    let doc = await getUKPartyConferencesCollection(db).findOne({
      _id: `UK:${partySeqId}:${year}`,
    });
    if (!doc) continue;

    if (doc.status === "scheduled" && currentTurn >= doc.opensAtTurn) {
      const opened = await getUKPartyConferencesCollection(db).findOneAndUpdate(
        { _id: doc._id, status: "scheduled" },
        { $set: { status: "open", openedAtTurn: currentTurn, updatedAt: now } },
        { returnDocument: "after" }
      );
      if (opened) {
        result.opened += 1;
        await getUKPartyConferencesCollection(db).updateOne(
          { _id: doc._id },
          {
            $set: {
              history: pushConferenceHistory(
                opened.history,
                conferenceHistoryEntry(
                  currentTurn,
                  "opened",
                  `${party.name} conference ${year} opened (voting closes turn ${doc.votingClosesTurn})`
                )
              ),
              updatedAt: now,
            },
          }
        );
      }
      doc = (await getUKPartyConferencesCollection(db).findOne({ _id: doc._id })) ?? doc;
    }

    // Expire rows a past year left behind (missed deadline, no payoff).
    const stale = await getUKPartyConferencesCollection(db)
      .find({ countryId: "UK", partyId: partySeqId, status: { $in: ["scheduled", "open"] } })
      .toArray();
    for (const row of stale) {
      if (row.conferenceYear >= year) continue;
      // Expire only rows whose voting window actually passed. A row seeded
      // with a window that outlives its conference year must not be killed
      // while votes are still live; it expires once the window closes.
      if (currentTurn < row.votingClosesTurn) continue;
      const claimed = await getUKPartyConferencesCollection(db).findOneAndUpdate(
        { _id: row._id, status: { $in: ["scheduled", "open"] } },
        { $set: { status: "expired", outcome: "missed", updatedAt: now } },
        { returnDocument: "after" }
      );
      if (claimed) {
        await getUKPartyConferencesCollection(db).updateOne(
          { _id: row._id },
          {
            $set: {
              history: pushConferenceHistory(
                claimed.history,
                conferenceHistoryEntry(
                  currentTurn,
                  "expired",
                  `Conference ${row.conferenceYear} missed its window and expired with no platform`
                )
              ),
              updatedAt: now,
            },
          }
        );
        result.expired += 1;
      }
    }

    doc = (await getUKPartyConferencesCollection(db).findOne({ _id: doc._id })) ?? doc;
    if (doc.status === "open") {
      const full = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ _id: party._id });
      if (!full) continue;
      if (!full.chairId) {
        await ensureNppPlatformProposal(db, "UK", full, doc, currentTurn, now);
        doc = (await getUKPartyConferencesCollection(db).findOne({ _id: doc._id })) ?? doc;
      }
      if (currentTurn >= doc.votingClosesTurn) {
        const resolution = await resolveConference(db, "UK", full, doc, currentTurn, now);
        if (resolution.completed) {
          result.completed += 1;
          if (resolution.ratified) result.ratified += 1;
          try {
            await postConferenceNews(party.name, doc.conferenceYear, resolution.ratified);
          } catch {
            // News is decorative; the resolution is already persisted.
          }
        }
        doc = (await getUKPartyConferencesCollection(db).findOne({ _id: doc._id })) ?? doc;
      }
    } else if (
      doc.status === "completed" &&
      (doc.outcome == null || conferenceResolutionNeedsHeal(doc))
    ) {
      // Recovery: a previous tick won the open->completed claim but crashed
      // before the fill (outcome null), or before the side effects landed.
      // resolveConference resumes both; only a won fill counts telemetry.
      const full = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ _id: party._id });
      if (full) {
        const resolution = await resolveConference(db, "UK", full, doc, currentTurn, now);
        if (resolution.completed) {
          result.completed += 1;
          if (resolution.ratified) result.ratified += 1;
          try {
            await postConferenceNews(party.name, doc.conferenceYear, resolution.ratified);
          } catch {
            // News is decorative; the resolution is already persisted.
          }
        }
        doc = (await getUKPartyConferencesCollection(db).findOne({ _id: doc._id })) ?? doc;
      }
    }

    if (doc.status === "completed" && conferencePayoffNeedsSettle(doc)) {
      const full = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ _id: party._id });
      if (full) {
        const payoff = await applyConferencePayoff(db, "UK", full, doc, currentTurn, now);
        if (payoff.applied) result.payoffs += 1;
      }
    }
  }

  return result;
}
