import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Campaign, Character, PoliticalParty } from "@/lib/db/types";

export type CampaignDonationKind = "party" | "character";

export interface CampaignDonationSpendInput {
  kind: CampaignDonationKind;
  /** Party row `_id` (party kind) or donor character `_id` (character kind). */
  donorDocId: ObjectId;
  campaignId: ObjectId;
  /**
   * Character-kind balance field (`currencyBalances.campaign` post-forex,
   * `funds` pre-forex). Unused for the party kind (always `treasury`).
   */
  characterFundsField?: string;
  /** Local-currency amount debited from the donor and credited to the campaign. */
  amountLocal: number;
  /** Donation-log row recorded on the campaign; pushed exactly once per key. */
  donationEntry: Campaign["donationLog"][0];
  /**
   * Caller-chosen fingerprint of the intended donation
   * (e.g. `party:<id>:<campaign>:<amount>`). A retry presenting the same key
   * with a different fingerprint is rejected instead of returning the stored
   * outcome for the wrong donation.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same donation replays the stored outcome instead
   * of charging again. Omit to mint one: the donation is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new donation (still guarded by the atomic balance debit).
   */
  idempotencyKey?: string;
}

/** Debit leg failed: donor balance raced, or the donor row is gone. */
export const CAMPAIGN_DONATION_INSUFFICIENT = "CAMPAIGN_DONATION_INSUFFICIENT";
/** Credit step failed: the campaign row is gone (refunded by compensation). */
export const CAMPAIGN_DONATION_CAMPAIGN_MISSING = "CAMPAIGN_DONATION_CAMPAIGN_MISSING";

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded donor
  // debit (a raced balance was `Insufficient funds` / `Insufficient party
  // funds`, 400). Index 1 is the terminal campaign credit, which can only
  // fail when the campaign row is gone — the old code refunded the debit and
  // answered 404, and compensation does the refund here.
  if (step.index === 0) return new Error(`${CAMPAIGN_DONATION_INSUFFICIENT}:${outcome}`);
  return new Error(`${CAMPAIGN_DONATION_CAMPAIGN_MISSING}:${outcome}`);
}

/**
 * Move a campaign donation (donor debit + campaign credit with donation-log
 * row) so the result is exactly-once on every topology (issue #1672). One
 * shared primitive for party-treasury donations (`treasury` leg) and
 * character donations (campaign-funds leg); the two kinds differ only in
 * which row the debit guards.
 *
 * Under real transactions the debit, the credit, and the idempotency receipt
 * join the transaction and commit atomically, preserving the old behavior.
 * On a standalone deployment the fallback runs the same writes as keyed
 * idempotent steps: a crash between the debit and the credit leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one charged donation instead of charging for a donation that never landed
 * (or landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyCampaignDonationSpend(
  db: Db,
  input: CampaignDonationSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.donorDocId || !input.campaignId) {
    throw new TypeError("Campaign donation spend needs donorDocId and campaignId");
  }
  if (!Number.isFinite(input.amountLocal) || input.amountLocal <= 0) {
    throw new RangeError("Campaign donation amount must be positive");
  }
  if (input.kind === "character" && !input.characterFundsField) {
    throw new TypeError("Character campaign donations need a balance field");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Campaign donation idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const campaigns = db.collection<Campaign>("campaigns");
  const now = new Date();

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        input.kind === "party"
          ? makeLegStep(key, {
              name: "donor-debit",
              collection: db.collection<PoliticalParty>("politicalParties"),
              docId: input.donorDocId,
              field: "treasury",
              delta: -input.amountLocal,
              minBalance: input.amountLocal,
              set: { updatedAt: now },
            })
          : makeLegStep(key, {
              name: "donor-debit",
              collection: db.collection<Character>("characters"),
              docId: input.donorDocId,
              field: input.characterFundsField!,
              delta: -input.amountLocal,
              minBalance: input.amountLocal,
            }),
        {
          // Terminal step: nothing runs after it, so it carries no inverse.
          // A survived credit error (a real crash runs no code at all, so
          // anything observed here is a failure the process lived through)
          // reports `guard-rejected` so the debit prefix is compensated
          // instead of stranded debited-with-no-credit.
          name: "campaign-credit",
          apply: async (stepOpts) => {
            try {
              return await applyKeyedUpdate(
                key,
                {
                  collection: campaigns,
                  filter: { _id: input.campaignId },
                  update: {
                    $inc: { funds: input.amountLocal, totalFundsGenerated: input.amountLocal },
                    $push: { donationLog: { $each: [input.donationEntry], $slice: -100 } },
                    $set: { updatedAt: now },
                  },
                },
                stepOpts ?? {}
              );
            } catch {
              return "guard-rejected";
            }
          },
        },
      ],
      mapSpendError,
      opts
    );
    return { duplicate: claim === "in-progress" };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
