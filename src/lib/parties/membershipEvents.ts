import { ObjectId, type Db } from "mongodb";
import type { Character, GameState, PartyMembershipEvent, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { recordAudit } from "@/lib/audit/recordAudit";

export interface PartyEventSnapshots {
  oldPartyCountryId: CountryId | null;
  newPartyCountryId: CountryId | null;
  oldPartyName: string | null;
  newPartyName: string | null;
  characterCountryId: CountryId | undefined;
}

/**
 * Resolves the optional snapshot fields for a PartyMembershipEvent.
 *
 * Pass the party docs already fetched at the call site (they always are —
 * routes resolve them for the auth/cooldown checks). If a party doc isn't
 * available (e.g. prior party for a brand-new character with no oldParty),
 * pass `null` and the helper leaves the snapshot null too.
 */
export function buildPartyEventSnapshots(args: {
  character: Pick<Character, "countryId">;
  oldParty: Pick<PoliticalParty, "sequentialId" | "name" | "countryId"> | null;
  newParty: Pick<PoliticalParty, "sequentialId" | "name" | "countryId"> | null;
  /** True when the "new" side is the independent sentinel, not a real party. */
  newIsIndependent: boolean;
}): PartyEventSnapshots {
  const { character, oldParty, newParty, newIsIndependent } = args;
  return {
    oldPartyCountryId: oldParty?.countryId ?? null,
    newPartyCountryId: newIsIndependent ? null : (newParty?.countryId ?? null),
    oldPartyName: oldParty?.name ?? null,
    newPartyName: newIsIndependent ? null : (newParty?.name ?? null),
    characterCountryId: character.countryId,
  };
}

export interface EmitPartyMembershipEventArgs {
  db: Db;
  countryId: CountryId;
  character: Pick<Character, "_id" | "name" | "userId" | "countryId">;
  oldPartyId: string | null;
  newPartyId: string | null;
  reason: PartyMembershipEvent["reason"];
  actor?: Pick<Character, "_id" | "name"> | null;
  actorRole?: PartyMembershipEvent["actorRole"];
  metadata?: Record<string, unknown>;
  now?: Date;
  turn?: number;
  /** Optional snapshot fields — recommended at every call site. */
  snapshots?: PartyEventSnapshots;
}

export async function emitPartyMembershipEvent(
  args: EmitPartyMembershipEventArgs
): Promise<PartyMembershipEvent | null> {
  try {
    const now = args.now ?? new Date();
    const turn =
      args.turn ??
      (
        await args.db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" }, { projection: { currentTurn: 1 } })
      )?.currentTurn ??
      0;

    const doc: PartyMembershipEvent = {
      _id: new ObjectId(),
      countryId: args.countryId,
      characterId: args.character._id,
      characterName: args.character.name,
      userId: args.character.userId ?? null,
      actorId: args.actor?._id ?? null,
      actorName: args.actor?.name ?? null,
      actorRole: args.actorRole,
      oldPartyId: args.oldPartyId,
      newPartyId: args.newPartyId,
      reason: args.reason,
      turn,
      createdAt: now,
      metadata: args.metadata,
      ...(args.snapshots ?? {}),
    };

    const insertResult = await args.db
      .collection<PartyMembershipEvent>("partyMembershipEvents")
      .insertOne(doc);

    // Central seam for party join/leave/purge/admin/cleanup — one call site
    // covers all of them (§P4 breadth). `subject` is the affected character;
    // `counterparty` the party they moved to (falls back to old party for a
    // pure leave). No dedicated ref field for `partyMembershipEvents` rows —
    // the id is carried in `meta` instead.
    recordAudit({
      source: "api",
      action: `party.${doc.reason}`,
      category: "party",
      turn: doc.turn,
      actor: doc.actorId
        ? {
            kind: doc.actorRole === "admin" ? "admin" : "player",
            userId: undefined,
            characterId: doc.actorId,
            name: doc.actorName ?? undefined,
          }
        : undefined,
      subject: { type: "character", id: doc.characterId, name: doc.characterName },
      counterparty: doc.newPartyId
        ? { type: "party", id: doc.newPartyId, name: doc.newPartyName ?? undefined }
        : doc.oldPartyId
          ? { type: "party", id: doc.oldPartyId, name: doc.oldPartyName ?? undefined }
          : undefined,
      outcome: "ok",
      meta: {
        partyMembershipEventId: insertResult.insertedId,
        oldPartyId: doc.oldPartyId,
        ...doc.metadata,
      },
    });

    return doc;
  } catch (error) {
    console.error("[partyMembershipEvents] Failed to emit membership event:", error);
    return null;
  }
}
