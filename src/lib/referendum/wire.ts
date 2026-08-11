/**
 * Campaign-wire recording + pagination. Each notable referendum event is one
 * `referendumWire` document (kept forever); the detail page paginates them.
 * Recording is non-critical — callers wrap with `.catch`.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ReferendumWireEvent, WireEventKind } from "@/lib/db/types/referendumWire";
import { getReferendumWireCollection } from "@/lib/db/collections/referendumWire";
import { WIRE_PAGE_SIZE } from "@/lib/constants/referendum";

export interface WireInput {
  referendumId: ObjectId;
  countryId: CountryId;
  regionId: string;
  turn: number;
  kind: WireEventKind;
  side?: "yes" | "no";
  delta?: number;
  summary: string;
}

export async function recordWireEvent(
  db: Db,
  input: WireInput,
  now: Date = new Date()
): Promise<void> {
  await getReferendumWireCollection(db).insertOne({ ...input, at: now });
}

export interface WirePage {
  events: ReferendumWireEvent[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listReferendumWire(
  db: Db,
  referendumId: ObjectId,
  page: number = 1,
  pageSize: number = WIRE_PAGE_SIZE
): Promise<WirePage> {
  const col = getReferendumWireCollection(db);
  const total = await col.countDocuments({ referendumId });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const events = await col
    .find({ referendumId })
    .sort({ at: -1 })
    .skip((clamped - 1) * pageSize)
    .limit(pageSize)
    .toArray();
  return { events, page: clamped, pageSize, total, totalPages };
}
