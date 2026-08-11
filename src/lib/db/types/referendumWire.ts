import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type WireEventKind =
  | "requested"
  | "opened"
  | "granted"
  | "declined"
  | "declared"
  | "withdrew"
  | "swing"
  | "ground"
  | "vote"
  | "settled"
  | "consent"
  | "reunified"
  | "seceded"
  | "cancelled";

/** One campaign-wire event for a referendum (kept forever; paginated 10/page). */
export interface ReferendumWireEvent {
  _id?: ObjectId;
  referendumId: ObjectId;
  countryId: CountryId;
  regionId: string;
  turn: number;
  at: Date;
  kind: WireEventKind;
  side?: "yes" | "no";
  /** Signed pp change toward Reunify/Independence (powers the wire swing tag). */
  delta?: number;
  /** Pre-rendered, fully-named display text. */
  summary: string;
}
