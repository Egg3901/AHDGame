/**
 * Aid buys loyalty.
 *
 * An aid package already moves real money into a member's treasury. This queues
 * the political half of that bargain: the recipient drifts toward the paying
 * organisation's pole, priced against its own economy exactly as an influence
 * play is, and resolved by the same turn phase through the same pull vector.
 *
 * The two instruments are deliberately not interchangeable, and the difference
 * is one that already existed rather than a balance dial:
 *
 * - **Aid can only reach a member** (`proposeLegislation` enforces it) and needs
 *   a member vote to pass. It is how a bloc holds the clients it has.
 * - **A play can reach anyone** and any foreign minister can commit one alone.
 *   It is how a bloc takes a client off somebody else.
 *
 * So aid is retention and plays are acquisition. Aid is not simply the better
 * deal for delivering the money too — it cannot go where the contest is.
 */
import { ObjectId, type Db } from "mongodb";
import type { AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import { ROSTER_BY_KEY } from "@/lib/constants/alignmentRoster";
import type { CountryId } from "@/lib/constants/countries";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";
import { getAlignmentPlaysCollection } from "@/lib/db/collections";
import type { GameState } from "@/lib/db/types";
import { resolveAlignmentEra } from "@/lib/constants/alignmentEras";
import { resolveGameYear } from "@/lib/era/era";
import { isIntOrgAlignmentEnabled } from "../featureFlag";

/**
 * Queue the alignment pull an aid package earns. Returns whether one was
 * recorded — false is the ordinary case for an org with no channel, not an error.
 */
export async function queueAidAlignmentPull(params: {
  db: Db;
  organizationId: InternationalOrganizationId;
  recipient: CountryId;
  /** USD value of the aid actually disbursed. */
  amountUsd: number;
  amountLocal: number;
  turn: number;
}): Promise<boolean> {
  const { db, organizationId, recipient, amountUsd, amountLocal, turn } = params;
  if (!(amountUsd > 0)) return false;

  const gs = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, startingYear: 1, currentTurn: 1, intOrgAlignmentEnabled: 1 } }
    );
  // Fail-closed, and never queue a row the phase will not run: with the gate off
  // the alignment phase does nothing at all, so an insert here would sit pending
  // forever.
  if (!(await isIntOrgAlignmentEnabled(gs ?? {}))) return false;

  const year = (gs ? resolveGameYear(gs) : null) ?? new Date().getFullYear();
  // No channel means this organisation carries no influence this era — the aid
  // still pays, it simply buys no alignment.
  const channel = resolveAlignmentEra(year).channels.find(
    (c) => c.organizationId === organizationId
  );
  if (!channel) return false;
  if (!(recipient in ROSTER_BY_KEY)) return false;

  const plays = await getAlignmentPlaysCollection(db);
  await plays.insertOne({
    _id: new ObjectId(),
    organizationId,
    // The bloc pays as a body; there is no single sponsoring member behind a
    // voted package, so the recipient stands as the counterparty on the row.
    sponsorCountryId: recipient,
    targetEntityId: recipient as AlignmentCountryKey,
    amountUsd,
    amountLocal,
    turn,
    resolvedTurn: null,
    appliedPoints: null,
    source: "aid",
    createdAt: new Date(),
  });
  return true;
}
