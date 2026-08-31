import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  CommitteeProposal,
  PartyMembershipEvent,
  PartyMembershipEventReason,
  PoliticalParty,
} from "@/lib/db/types";

/** Shape passed to the UI for one observed membership transition. */
export interface PartyHistoryEntry {
  reason: PartyMembershipEventReason;
  oldPartyId: string | null;
  newPartyId: string | null;
  oldPartyCountryId: CountryId | null;
  newPartyCountryId: CountryId | null;
  oldPartyName: string | null;
  newPartyName: string | null;
  characterCountryId: CountryId | null;
  date: Date;
  turn: number;
  synthetic: boolean;
}

export type TenureStartKind =
  "joined" | "founded" | "switched_to" | "became_independent" | "renamed" | "started";

export type TenureEndKind = "left" | "switched_to" | "purged" | "renamed" | "present";

/** A successful party rename, resolved from the retained committee proposal. */
export interface PartyNameChange {
  partyId: string;
  partyCountryId: CountryId;
  newName: string;
  effectiveAt: Date;
  turn: number;
}

export interface PartyTenure {
  partyId: string | null; // null for Independent
  partyCountryId: CountryId | null;
  partyName: string | null; // UI renders "Independent" when null
  startedAt: Date;
  startKind: TenureStartKind;
  startSynthetic: boolean;
  endedAt: Date | null; // null when ongoing
  endKind: TenureEndKind;
  endSynthetic: boolean;
}

/** Filter reasons we hide from the UI (system-driven, not user-visible). */
const UI_REASONS: PartyMembershipEventReason[] = ["join", "leave", "purge", "create_party"];

export async function fetchPartyHistory(
  db: Db,
  characterId: ObjectId
): Promise<PartyHistoryEntry[]> {
  const docs = await db
    .collection<PartyMembershipEvent>("partyMembershipEvents")
    .find({
      characterId,
      reason: { $in: UI_REASONS },
    })
    .sort({ createdAt: 1 })
    .toArray();

  return docs.map((d) => ({
    reason: d.reason,
    oldPartyId: d.oldPartyId,
    newPartyId: d.newPartyId,
    oldPartyCountryId: d.oldPartyCountryId ?? d.countryId,
    newPartyCountryId: d.newPartyCountryId ?? (isReal(d.newPartyId) ? d.countryId : null),
    oldPartyName: d.oldPartyName ?? null,
    newPartyName: d.newPartyName ?? null,
    characterCountryId: d.characterCountryId ?? null,
    date: d.createdAt,
    turn: d.turn,
    synthetic: Boolean((d.metadata as Record<string, unknown> | undefined)?.synthetic),
  }));
}

/**
 * Fetches successful party renames for parties present in a character's membership
 * history. Committee proposals are the durable rename ledger, including renames
 * that happened before membership-event name snapshots were added.
 */
export async function fetchPartyNameChanges(
  db: Db,
  events: PartyHistoryEntry[]
): Promise<PartyNameChange[]> {
  const partyKeys = new Set<string>();
  for (const event of events) {
    if (isReal(event.oldPartyId) && event.oldPartyCountryId) {
      partyKeys.add(`${event.oldPartyCountryId}:${event.oldPartyId}`);
    }
    if (isReal(event.newPartyId) && event.newPartyCountryId) {
      partyKeys.add(`${event.newPartyCountryId}:${event.newPartyId}`);
    }
  }
  if (partyKeys.size === 0) return [];

  const sequentialIds = [...partyKeys]
    .map((key) => Number(key.slice(key.lastIndexOf(":") + 1)))
    .filter((id) => Number.isInteger(id));
  if (sequentialIds.length === 0) return [];

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ sequentialId: { $in: sequentialIds } })
    .project({ _id: 1, countryId: 1, sequentialId: 1 })
    .toArray();
  const relevantParties = parties.filter((party) =>
    partyKeys.has(`${party.countryId}:${party.sequentialId}`)
  );
  if (relevantParties.length === 0) return [];

  const partyByObjectId = new Map(relevantParties.map((party) => [party._id.toString(), party]));
  const proposals = await db
    .collection<CommitteeProposal>("committeeProposals")
    .find({
      type: "rename",
      status: "passed",
      partyId: { $in: relevantParties.map((party) => party._id) },
    })
    .project({ partyId: 1, rename: 1, resolvedAtTurn: 1, updatedAt: 1 })
    .sort({ updatedAt: 1 })
    .toArray();

  return proposals.flatMap((proposal) => {
    const party = partyByObjectId.get(proposal.partyId.toString());
    if (!party || !proposal.rename || proposal.resolvedAtTurn === undefined) return [];
    return [
      {
        partyId: String(party.sequentialId),
        partyCountryId: party.countryId,
        newName: proposal.rename.newName,
        effectiveAt: proposal.updatedAt,
        turn: proposal.resolvedAtTurn,
      },
    ];
  });
}

/** Input describing the character's current state, used for tail reconciliation. */
export interface CurrentTenureInput {
  /** Sequential ID string or "independent" sentinel. */
  partyId: string;
  partyCountryId: CountryId;
  /** Display name when known (null for Independent). */
  partyName: string | null;
  /** When set, used as fallback start date for the final tenure. */
  joinedAt: Date | null;
  /** Wall-clock for the synthetic "now" anchor when no other anchor exists. */
  fallbackDate: Date;
}

const INDEPENDENT = "independent";

interface MutableTenure {
  partyId: string | null;
  partyCountryId: CountryId | null;
  partyName: string | null;
  startedAt: Date;
  startKind: TenureStartKind;
  startSynthetic: boolean;
  endedAt: Date | null;
  endKind: TenureEndKind;
  endSynthetic: boolean;
}

function isReal(id: string | null | undefined): boolean {
  return Boolean(id) && id !== INDEPENDENT;
}

function openIndependent(date: Date, synthetic: boolean): MutableTenure {
  return {
    partyId: null,
    partyCountryId: null,
    partyName: null,
    startedAt: date,
    startKind: "became_independent",
    startSynthetic: synthetic,
    endedAt: null,
    endKind: "present",
    endSynthetic: false,
  };
}

function openParty(
  date: Date,
  startKind: TenureStartKind,
  partyId: string,
  partyCountryId: CountryId | null,
  partyName: string | null,
  synthetic: boolean
): MutableTenure {
  return {
    partyId,
    partyCountryId,
    partyName,
    startedAt: date,
    startKind,
    startSynthetic: synthetic,
    endedAt: null,
    endKind: "present",
    endSynthetic: false,
  };
}

export function buildPartyTenures(
  events: PartyHistoryEntry[],
  current: CurrentTenureInput,
  partyNameChanges: PartyNameChange[] = []
): PartyTenure[] {
  const tenures: MutableTenure[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const last = tenures[tenures.length - 1];

    if (ev.reason === "create_party" && ev.newPartyId && isReal(ev.newPartyId)) {
      if (last) {
        last.endedAt = ev.date;
        last.endKind = "switched_to";
        last.endSynthetic = ev.synthetic;
      }
      tenures.push(
        openParty(
          ev.date,
          "founded",
          ev.newPartyId,
          ev.newPartyCountryId ?? ev.characterCountryId,
          ev.newPartyName,
          ev.synthetic
        )
      );
      continue;
    }

    if (ev.reason === "join" && ev.newPartyId && isReal(ev.newPartyId)) {
      // Defensive: ignore a duplicate join to the party we're already running
      // (live emit prevents this, but data anomalies shouldn't make ugly UI).
      if (last && last.partyId === ev.newPartyId && last.endedAt === null) {
        continue;
      }
      // Same-turn collapse: previous event was a leave/purge that opened an
      // Independent tenure on the same turn — drop it and switch directly.
      const prior = i > 0 ? events[i - 1] : null;
      const collapseIndependent =
        last !== undefined &&
        last.partyId === null &&
        last.endedAt === null &&
        prior !== null &&
        prior.turn === ev.turn &&
        (prior.reason === "leave" || prior.reason === "purge");

      if (collapseIndependent && last) {
        const beforeIndep = tenures[tenures.length - 2];
        if (beforeIndep) {
          beforeIndep.endedAt = ev.date;
          beforeIndep.endKind = "switched_to";
          beforeIndep.endSynthetic = ev.synthetic;
        }
        tenures.pop(); // drop the Independent tenure
        tenures.push(
          openParty(
            ev.date,
            "switched_to",
            ev.newPartyId,
            ev.newPartyCountryId ?? ev.characterCountryId,
            ev.newPartyName,
            ev.synthetic
          )
        );
        continue;
      }

      // Normal join. If there's any prior tenure (party or Independent), this
      // is a transition — startKind = "switched_to". Otherwise it's the first.
      const startKind: TenureStartKind = last ? "switched_to" : "joined";
      if (last) {
        last.endedAt = ev.date;
        last.endKind = "switched_to";
        last.endSynthetic = ev.synthetic;
      }
      tenures.push(
        openParty(
          ev.date,
          startKind,
          ev.newPartyId,
          ev.newPartyCountryId ?? ev.characterCountryId,
          ev.newPartyName,
          ev.synthetic
        )
      );
      continue;
    }

    if (ev.reason === "leave" || ev.reason === "purge") {
      if (last && last.partyId !== null) {
        last.endedAt = ev.date;
        last.endKind = ev.reason === "purge" ? "purged" : "left";
        last.endSynthetic = ev.synthetic;
      }
      tenures.push(openIndependent(ev.date, ev.synthetic));
      continue;
    }
  }

  // ── Tail reconciliation ──
  const last = tenures[tenures.length - 1];
  const currentIsIndependent = !isReal(current.partyId);
  const runningPartyId = last?.partyId ?? null;
  const expectedPartyId = currentIsIndependent ? null : current.partyId;

  if (tenures.length === 0) {
    if (!currentIsIndependent) {
      const startedAt = current.joinedAt ?? current.fallbackDate;
      tenures.push(
        openParty(
          startedAt,
          "joined",
          current.partyId,
          current.partyCountryId,
          current.partyName,
          true
        )
      );
    }
  } else if (runningPartyId !== expectedPartyId) {
    const transitionAt = current.joinedAt ?? current.fallbackDate;
    last.endedAt = transitionAt;
    last.endKind = currentIsIndependent
      ? last.partyId !== null
        ? "left"
        : "present"
      : "switched_to";
    last.endSynthetic = true;
    if (!currentIsIndependent) {
      tenures.push(
        openParty(
          transitionAt,
          "switched_to",
          current.partyId,
          current.partyCountryId,
          current.partyName,
          true
        )
      );
    } else if (last.partyId !== null) {
      tenures.push(openIndependent(transitionAt, true));
    }
  }

  return splitTenuresAtPartyRenames(tenures, partyNameChanges);
}

function splitTenuresAtPartyRenames(
  tenures: MutableTenure[],
  partyNameChanges: PartyNameChange[]
): PartyTenure[] {
  const result: MutableTenure[] = [];

  for (const tenure of tenures) {
    if (tenure.partyId === null) {
      result.push(tenure);
      continue;
    }

    const matchingRenames = partyNameChanges
      .filter(
        (rename) =>
          rename.partyId === tenure.partyId && rename.partyCountryId === tenure.partyCountryId
      )
      .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
    // Legacy membership events can predate name snapshots. A rename that was
    // already in effect when the tenure began is still enough to recover its
    // label exactly; only the period before the first recorded rename remains
    // unknowable on those legacy rows.
    const nameAtStart = [...matchingRenames]
      .reverse()
      .find((rename) => rename.effectiveAt <= tenure.startedAt)?.newName;
    const renames = matchingRenames.filter(
      (rename) =>
        rename.effectiveAt > tenure.startedAt &&
        (tenure.endedAt === null || rename.effectiveAt < tenure.endedAt)
    );

    let segment = { ...tenure, partyName: tenure.partyName ?? nameAtStart ?? null };
    for (const rename of renames) {
      if (rename.newName === segment.partyName) continue;
      segment.endedAt = rename.effectiveAt;
      segment.endKind = "renamed";
      segment.endSynthetic = false;
      result.push(segment);
      segment = {
        ...tenure,
        partyName: rename.newName,
        startedAt: rename.effectiveAt,
        startKind: "renamed",
        startSynthetic: false,
      };
    }
    result.push(segment);
  }

  return result;
}
