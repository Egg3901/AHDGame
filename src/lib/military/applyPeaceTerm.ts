import type { ClientSession, Collection, Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { convertLocal } from "@/lib/internationalOrganizations/organizationFund";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { recordProcurementRestriction } from "@/lib/db/collections/procurementRestrictions";
import { updateCountryState } from "@/lib/countryState";
import { installOnePartyState } from "@/lib/onePartyState/installOnePartyState";
import {
  triggerSystemConversion,
  FORCED_ELECTION_DELAY_TURNS,
  FORCED_LEGACY_RESERVATION,
  FORCED_VOTE_SHARE_PENALTY,
} from "@/lib/onePartyState/systemConversion";
import type { PeaceTerm } from "./peaceTerm";
import { reunifyByPeaceTerm } from "@/lib/settlement/reunifyByPeaceTerm";
import { getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import {
  loadTreasuryCashContext,
  resolveTreasuryCashOptions,
  witnessTreasuryCash,
  type TreasuryCashOptions,
} from "@/lib/nationalization/treasuryLedger";
import { settleTransition } from "@/lib/banking/settlementJournal";

export interface ApplyTermContext {
  /** The country imposing or offering. Receives an indemnity it is not paying. */
  imposer: CountryId;
  /** The country the term lands on. */
  target: CountryId;
  conflictId: string;
  currentTurn: number;
  /** Negotiated acceptance receipt; omitted by the separate imposed-terms road. */
  peaceOfferId?: ObjectId;
}

/**
 * Apply one settlement term to the world.
 *
 * Called from BOTH roads: the impose route on a war won outright, and
 * `acceptPeace` on a negotiated deal. That is the whole point of the function.
 * Winning outright and negotiating do the same thing to the world, so they are the
 * same code, and the two cannot drift on what a term means.
 *
 * Negotiated indemnities are replay-safe: replica sets commit both treasury writes
 * and the offer marker in one transaction, while standalone Mongo uses an atomic
 * per-treasury offer receipt so an interrupted transfer can resume either leg once.
 * The imposed-terms road still owns its separate claim before entering this function.
 *
 * Spec: docs/superpowers/specs/2026-08-27-peace-terms-design.md
 */
export async function applyPeaceTerm(
  db: Db,
  term: PeaceTerm,
  ctx: ApplyTermContext
): Promise<void> {
  // A white peace changes nothing about the world. It is the ABSENCE of a term, and
  // the whole of its effect is in how the war resolves: the caller stamps a
  // stalemate rather than a victor.
  if (term.kind === "white_peace") return;

  if (term.kind === "indemnity") {
    await moveIndemnity(db, term, ctx);
    return;
  }
  if (term.kind === "demilitarisation") {
    // The bar lands on the TARGET. The imposer is the one taking the term, not the
    // one bound by it.
    await recordProcurementRestriction(
      db,
      ctx.target,
      ctx.currentTurn + term.turns,
      ctx.conflictId
    );
    return;
  }

  if (term.kind === "regime_change") {
    await convertRegime(db, term.targetSystem, ctx, term.rulingPartyId);
    return;
  }

  if (term.kind === "reunification") {
    // Everything this term does belongs to the settlement pipeline, so nothing is
    // done here: no money moves, and the TARGET's own system is untouched. The two
    // Germanies are named by the crisis, not by the pair who signed the treaty, and
    // converting the signatory as well would convert the wrong country.
    await reunifyByPeaceTerm(db, ctx.conflictId, ctx.currentTurn);
    return;
  }

  // Exhaustive. If another term is ever added, this line stops compiling rather
  // than letting a settlement report success and change nothing.
  const unreachable: never = term;
  throw new Error(`applyPeaceTerm: unsupported term ${JSON.stringify(unreachable)}`);
}

/**
 * Convert the target's system of government, then queue the election that follows.
 *
 * TWO DIRECTIONS, ONE SHAPE. Converting out of a one-party state is the shipped
 * `triggerSystemConversion`; converting into one is `installOnePartyState`, its
 * mirror. Both end with `pendingPostConversionElection` set, and neither dissolves
 * anything itself.
 *
 * THE ELECTION IS NOT FIRED HERE, deliberately. This runs on a request path, and
 * `processPostConversionElections` is the turn step that reads the marker and calls
 * the snap. Spawning elections from a request would spawn them again on a retry,
 * which is the same reason the settlement wire posts from a tick rather than from
 * the command that caused it.
 */
async function convertRegime(
  db: Db,
  targetSystem: Extract<PeaceTerm, { kind: "regime_change" }>["targetSystem"],
  ctx: ApplyTermContext,
  rulingPartyId?: number
): Promise<void> {
  // A visible interregnum rather than an instant handover: the country spends the
  // delay under a fallen government before the campaign opens.
  const electionAtTurn = ctx.currentTurn + FORCED_ELECTION_DELAY_TURNS;

  if (targetSystem === "onePartyState") {
    // The victor's choice of party, when they named one. Left out, the install
    // resolves it from the target's own formed government or largest bench —
    // which is how this shipped, and which can hand a monopoly to the very party
    // the victor just fought. `installOnePartyState` ignores an id that names no
    // party of this country, so a stale value degrades to that same resolution
    // rather than banning everyone.
    await installOnePartyState(db, ctx.target, ctx.currentTurn, {
      ...(rulingPartyId != null ? { rulingPartyId } : {}),
    });
    // `installOnePartyState` mirrors the FIELDS `triggerSystemConversion` clears and
    // deliberately schedules nothing, so the marker is written here to bring the two
    // directions back to the same end state.
    await updateCountryState(db, ctx.target, {
      pendingPostConversionElection: {
        atTurn: electionAtTurn,
        legacyReservation: FORCED_LEGACY_RESERVATION,
        // The party that has just been installed is the one that would carry a
        // legacy reservation, and it needs no help. Recorded as absent rather than
        // as a party id so the election engine has nothing to award.
        formerRulingPartyId: null,
        forcedVoteSharePenalty: FORCED_VOTE_SHARE_PENALTY,
        path: "forced",
      },
    });
    return;
  }

  // The shipped path out of a one-party state. It writes the marker itself, via
  // `bootstrapNewSystem`, capturing the former ruling party before the flip clears
  // it.
  await triggerSystemConversion(db, ctx.target, ctx.currentTurn, {
    targetSystem,
    legacyReservation: FORCED_LEGACY_RESERVATION,
    path: "forced",
    forcedVoteSharePenalty: FORCED_VOTE_SHARE_PENALTY,
    electionAtTurn,
  });
}

/**
 * Move the indemnity, once.
 *
 * The amount is quoted in the PAYER's local currency, so it is debited as quoted
 * and CONVERTED before it is credited: every treasury is denominated locally, and
 * moving the raw number would invent or destroy value at the exchange rate.
 * `convertLocal` is a no-op for a same-currency pair, so it is called
 * unconditionally rather than guarded; guarding is how a double conversion gets
 * written.
 *
 * `$inc` on `treasuryBalance` only. `debt.principal` belongs to the
 * sovereign bond ledger (see bonds/sovereignPrincipal.ts) and is never
 * re-derived from the balance here; writing both would create two sources of
 * truth (refs #1975).
 *
 * No affordability check. A payment may push the payer negative, which is what
 * national debt is: requiring a surplus would mean a country already in debt could
 * never buy peace, which is most of the countries that would want to.
 */
async function moveIndemnity(
  db: Db,
  term: Extract<PeaceTerm, { kind: "indemnity" }>,
  ctx: ApplyTermContext
): Promise<void> {
  const { payer, amount } = term;
  if (!(amount > 0)) return; // A white peace moves no money at all.

  const recipient: CountryId = payer === ctx.target ? ctx.imposer : ctx.target;
  const preset = await loadWorldPreset(db);
  const credited = convertLocal(payer, recipient, amount, preset);
  const now = new Date();

  // The non-upserting treasury writes below match by countryId. If either party has
  // no federalBudget doc (the partial-seed gap `ensureFederalBudget` exists to
  // close), its write matches zero documents and the indemnity silently vanishes
  // on that side. Heal both first and fail closed if the preset cannot supply one.
  const payerBudget = await ensureFederalBudget(db, payer, preset);
  const recipientBudget = await ensureFederalBudget(db, recipient, preset);
  if (!payerBudget || !recipientBudget) {
    throw new Error(`Cannot apply indemnity: missing federal budget for ${payer} or ${recipient}`);
  }

  const treasuryCash = await loadTreasuryCashContext(db, ctx.currentTurn);
  if (treasuryCash?.treasuryCashLedgerEnabled) {
    const payerCurrency =
      resolveCountryCurrencyCode(payerBudget) ?? COUNTRY_CURRENCY_MAP[payer] ?? "USD";
    const recipientCurrency =
      resolveCountryCurrencyCode(recipientBudget) ?? COUNTRY_CURRENCY_MAP[recipient] ?? "USD";
    const payerRate = treasuryAnchorValuation({
      countryId: payer,
      currencyCode: payerCurrency,
      preset: treasuryCash.preset,
      observedRate: treasuryCash.rates.get(payerCurrency),
    }).anchorRate;
    const recipientRate = treasuryAnchorValuation({
      countryId: recipient,
      currencyCode: recipientCurrency,
      preset: treasuryCash.preset,
      observedRate: treasuryCash.rates.get(recipientCurrency),
    }).anchorRate;
    const fundedCredit = (amount / payerRate) * recipientRate;
    const transition = await settleTransition(db, {
      key: `peace-indemnity:${ctx.peaceOfferId?.toHexString() ?? ctx.conflictId}:${payer}:${recipient}`,
      kind: "peace_indemnity",
      turn: ctx.currentTurn,
      currency: payerCurrency,
      legs: [
        {
          kind: "debit",
          amount,
          valuation: { currencyCode: payerCurrency, localPerAnchor: payerRate },
          collection: "federalBudget",
          filter: { _id: payerBudget._id, treasuryCashLocal: { $gte: amount } },
          path: "treasuryCashLocal",
          note: "Fund the indemnity from payer Treasury cash",
        },
        {
          kind: "credit",
          amount: fundedCredit,
          valuation: { currencyCode: recipientCurrency, localPerAnchor: recipientRate },
          collection: "federalBudget",
          filter: { _id: recipientBudget._id, treasuryCashLocal: { $exists: true } },
          path: "treasuryCashLocal",
          note: "Deliver the indemnity to recipient Treasury cash",
        },
      ],
      projections: [
        {
          collection: "federalBudget",
          filter: { _id: payerBudget._id },
          update: { $inc: { treasuryBalance: -amount } },
          note: "Keep payer signed fiscal position as a noncash projection",
        },
        {
          collection: "federalBudget",
          filter: { _id: recipientBudget._id },
          update: { $inc: { treasuryBalance: fundedCredit } },
          note: "Keep recipient signed fiscal position as a noncash projection",
        },
        ...(ctx.peaceOfferId
          ? [
              {
                collection: "peaceOffers",
                filter: {
                  _id: ctx.peaceOfferId,
                  status: "accepted",
                  "application.phase": "claimed",
                },
                update: { $set: { "application.phase": "term_applied" } },
                note: "Complete the negotiated indemnity after both cash legs land",
              },
            ]
          : []),
      ],
      event: {
        kind: "monetary.executed",
        command: "peace.indemnity.settle",
        amount,
        meta: { sourceCurrency: payerCurrency, destinationCurrency: recipientCurrency },
      },
    });
    if (transition.status !== "applied" && transition.status !== "replayed") {
      throw new Error(transition.error ?? "Funded peace indemnity is incomplete");
    }
    if (transition.status === "applied") {
      await witnessIndemnity(db, payer, recipient, -amount, fundedCredit, now, {
        context: treasuryCash,
      });
    }
    return;
  }

  const budgets = db.collection<FederalBudget>("federalBudget");
  if (ctx.peaceOfferId) {
    const receiptId = String(ctx.peaceOfferId);
    const applyNegotiatedIndemnity = async (session?: ClientSession) => {
      const paid = await applyIndemnityLeg(budgets, payer, -amount, receiptId, now, session);
      const received = await applyIndemnityLeg(
        budgets,
        recipient,
        credited,
        receiptId,
        now,
        session
      );
      await getPeaceOffersCollection(db).updateOne(
        {
          _id: ctx.peaceOfferId,
          status: "accepted",
          "application.phase": "claimed",
        },
        { $set: { "application.phase": "term_applied" } },
        session ? { session } : undefined
      );
      return { paid, received };
    };
    // Witness after the commit, and only the legs this attempt applied: a resumed
    // transfer applies the missing leg alone.
    const landed = await runWithOptionalTransaction(
      (session) => applyNegotiatedIndemnity(session),
      () => applyNegotiatedIndemnity()
    );
    await witnessIndemnity(
      db,
      payer,
      recipient,
      landed.paid ? -amount : 0,
      landed.received ? credited : 0,
      now
    );
    return;
  }

  const paid = await budgets.updateOne(
    { countryId: payer },
    { $inc: { treasuryBalance: -amount }, $set: { updatedAt: now } }
  );
  const received = await budgets.updateOne(
    { countryId: recipient },
    { $inc: { treasuryBalance: credited }, $set: { updatedAt: now } }
  );
  await witnessIndemnity(
    db,
    payer,
    recipient,
    (paid?.matchedCount ?? 0) > 0 ? -amount : 0,
    (received?.matchedCount ?? 0) > 0 ? credited : 0,
    now
  );
}

/**
 * Witness both treasury legs under one reason. Each is in its own treasury's
 * currency, so the money-supply check shows the pair per currency.
 */
async function witnessIndemnity(
  db: Db,
  payer: CountryId,
  recipient: CountryId,
  paid: number,
  received: number,
  now: Date,
  options?: TreasuryCashOptions
): Promise<void> {
  if (paid === 0 && received === 0) return;
  const ledger = await resolveTreasuryCashOptions(db, options);
  const site = "military/applyPeaceTerm";
  await witnessTreasuryCash(db, ledger, {
    flow: "peace_indemnity",
    account: { kind: "government", countryId: payer },
    amount: paid,
    now,
    site,
  });
  await witnessTreasuryCash(db, ledger, {
    flow: "peace_indemnity",
    account: { kind: "government", countryId: recipient },
    amount: received,
    now,
    site,
  });
}

/** Apply one treasury leg at most once, even without multi-document transactions. */
async function applyIndemnityLeg(
  budgets: Collection<FederalBudget>,
  countryId: CountryId,
  delta: number,
  receiptId: string,
  now: Date,
  session?: ClientSession
): Promise<boolean> {
  const result = await budgets.updateOne(
    { countryId, appliedPeaceIndemnityOfferIds: { $ne: receiptId } },
    {
      $inc: { treasuryBalance: delta },
      $set: { updatedAt: now },
      $addToSet: { appliedPeaceIndemnityOfferIds: receiptId },
    },
    session ? { session } : undefined
  );
  return (result?.modifiedCount ?? 0) > 0;
}
