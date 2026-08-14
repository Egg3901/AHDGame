import { ObjectId, type Db } from "mongodb";
import { onBillEnacted } from "@/lib/billEnactment";
import type { PolicyProvision } from "@/lib/db/types/legislation";
import type { EnactedLaw } from "@/lib/db/types/budget";
import type { CountryId } from "@/lib/constants/countries";

export interface RulingBillInput {
  /** Display title, already suffixed by the caller (e.g. "... (Surprise SCOTUS Ruling)"). */
  title: string;
  summary?: string;
  legislationTypeId: string;
  effectDirection: number;
  provision: PolicyProvision;
  countryId: CountryId;
  /** Pseudo-state for the country-scoped enactment ("federal", "uk_national", …). */
  stateId: string;
  source: EnactedLaw["source"];
  /** Seated justices in the majority / minority — surfaced as the bill's vote tally. */
  votesFor?: number;
  votesAgainst?: number;
  currentTurn: number;
  /** Shared clock for the row's timestamps; caller passes its per-turn `now`. */
  now?: Date;
}

/**
 * Enact a court ruling as a bill.
 *
 * Court rulings — SCOTUS docket divergences (#3598), SCOTUS surprise cases
 * (#3607), and UK judicial review — have no legislative lifecycle: nothing ever
 * proposed a bill, so no `bills` row was created. Each path fabricates a
 * bill-shaped object and drives it through the shared `onBillEnacted` pipeline
 * for the metric-registry + regional-lean-drift effects.
 *
 * `onBillEnacted` assumes the `bills` row already exists — it only ever
 * `updateOne`s it — and it posts a Discord "Bill Enacted" webhook deep-linking
 * to `/congress/bills/<id>`. Before this helper, the synthetic id was never
 * persisted, so that link (and `statePolicies.enactedByBillId`) pointed at a
 * document that did not exist: the "View Bill" link 404'd for every ruling.
 *
 * We `insertOne` the `bills` row here, BEFORE `onBillEnacted`, so the
 * choke-point's update and the deep-link both resolve. Status is `"signed"` —
 * the terminal enacted status — because a ruling is law the moment it is handed
 * down; there are no chamber votes to render, so the vote tally carries the
 * seated majority/minority instead.
 */
export async function enactRulingBill(
  db: Db,
  input: RulingBillInput
): Promise<{ billId: ObjectId; enactedLawId?: ObjectId }> {
  const now = input.now ?? new Date();
  const billId = new ObjectId();

  const billDoc = {
    _id: billId,
    countryId: input.countryId,
    stateId: input.stateId,
    title: input.title,
    summary: input.summary ?? "Enacted by a ruling of the court.",
    // Rulings have no chamber; "joint" is a benign, valid BillChamber that the
    // detail renderer echoes without routing through any vote-gating branch.
    originChamber: "joint",
    currentChamber: "joint",
    sponsorId: null,
    sponsorName: "The Court",
    category: "judicial",
    status: "signed" as const,
    source: input.source,
    legislationTypeId: input.legislationTypeId,
    effectDirection: input.effectDirection,
    provisions: [input.provision],
    votesFor: input.votesFor ?? 0,
    votesAgainst: input.votesAgainst ?? 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: now,
    votingStartedAt: now,
    enactedAt: now,
    enactedTurn: input.currentTurn,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("bills").insertOne(billDoc as never);

  await onBillEnacted(
    db,
    {
      _id: billId,
      title: input.title,
      legislationTypeId: input.legislationTypeId,
      effectDirection: input.effectDirection,
      provisions: [input.provision],
      countryId: input.countryId,
      stateId: input.stateId,
      source: input.source,
    },
    input.currentTurn
  );

  const enactedLawRow = await db
    .collection("enactedLaws")
    .findOne<{ _id: ObjectId }>({ billId }, { projection: { _id: 1 }, sort: { enactedAt: -1 } });

  return { billId, enactedLawId: enactedLawRow?._id };
}
