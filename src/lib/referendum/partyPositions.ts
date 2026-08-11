/**
 * Declare / withdraw a party's public referendum position. A stance only —
 * independent of campaign spend, and mutable solely while the campaign runs.
 * One entry per party (declaring replaces, withdrawing removes).
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import type { ReferendumPartyPosition } from "@/lib/db/types/referendum";
import { recordWireEvent } from "@/lib/referendum/wire";

export interface DeclarePositionInput {
  referendumId: string;
  partyId: string;
  side: "yes" | "no";
  declaredByCharacterId: ObjectId;
  turn: number;
  /** Party abbreviation for the wire (resolved at the route). */
  actorName?: string;
}

export interface PositionResult {
  status: number;
  body: { error?: string; positions?: ReferendumPartyPosition[] };
}

export async function declarePartyPosition(
  db: Db,
  input: DeclarePositionInput
): Promise<PositionResult> {
  const refs = getReferendumCollection(db);
  const ref = await refs.findOne({ _id: new ObjectId(input.referendumId) });
  if (!ref) return { status: 404, body: { error: "Referendum not found." } };
  if (ref.status !== "campaigning") {
    return { status: 400, body: { error: "Positions can only change during the campaign." } };
  }

  const positions: ReferendumPartyPosition[] = [
    ...(ref.partyPositions ?? []).filter((p) => p.partyId !== input.partyId),
    {
      partyId: input.partyId,
      side: input.side,
      declaredByCharacterId: input.declaredByCharacterId,
      declaredTurn: input.turn,
    },
  ];
  await refs.updateOne(
    { _id: ref._id },
    { $set: { partyPositions: positions, updatedAt: new Date() } }
  );
  await recordWireEvent(db, {
    referendumId: ref._id!,
    countryId: ref.countryId,
    regionId: ref.regionId,
    turn: input.turn,
    kind: "declared",
    side: input.side,
    summary: `${input.actorName ?? "A party"} declared ${input.side === "yes" ? "FOR" : "AGAINST"}.`,
  }).catch(() => {});
  return { status: 200, body: { positions } };
}

export async function withdrawPartyPosition(
  db: Db,
  input: { referendumId: string; partyId: string; turn?: number; actorName?: string }
): Promise<PositionResult> {
  const refs = getReferendumCollection(db);
  const ref = await refs.findOne({ _id: new ObjectId(input.referendumId) });
  if (!ref) return { status: 404, body: { error: "Referendum not found." } };
  if (ref.status !== "campaigning") {
    return { status: 400, body: { error: "Positions can only change during the campaign." } };
  }
  const positions = (ref.partyPositions ?? []).filter((p) => p.partyId !== input.partyId);
  await refs.updateOne(
    { _id: ref._id },
    { $set: { partyPositions: positions, updatedAt: new Date() } }
  );
  await recordWireEvent(db, {
    referendumId: ref._id!,
    countryId: ref.countryId,
    regionId: ref.regionId,
    turn: input.turn ?? 0,
    kind: "withdrew",
    summary: `${input.actorName ?? "A party"} withdrew its position.`,
  }).catch(() => {});
  return { status: 200, body: { positions } };
}
