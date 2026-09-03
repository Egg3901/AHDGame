import type { Db, ObjectId } from "mongodb";
import type { BankCharter, BankCharterType } from "@/lib/db/types/bank";
import type { Corporation, CorporateSector, GameConfig } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { CORPORATION_FOUNDING_COST } from "@/lib/constants/corporations";
import {
  getGdpAnchorRate,
  loadWorldEraUnitScale,
  loadWorldPreset,
} from "@/lib/currency/gdpAnchorRate";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { archiveCharter } from "@/lib/banking/charterHistory";
import { getLegalCharterTypes } from "@/lib/banking/separationLaw";
import { freezeAccountsAt, returnDepositBook } from "@/lib/banking/depositBookReturn";
import { lifecycleRefusal } from "@/lib/banking/rules/lifecycle";
import { clampOffsets, getRateCorridors } from "@/lib/banking/regulationQ";
import { getBankId } from "@/lib/centralBank/helpers";
import { getCurrentTurn } from "@/lib/currentTurn";
import { charterTypeMay } from "@/lib/banking/rules/capabilities";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { depositBookReturnKey } from "@/lib/banking/depositBookReturn";

/**
 * Charter capital as a multiple of the corporation founding cost.
 *
 * Was 10x. Cut to 5x once the deposit fix landed, because the old number was
 * doing two jobs and failing both. It was set high to keep a bank solvent, but
 * solvency was never a capital problem: deposits arrived without their cash, so
 * no amount of posted capital saved a bank and a simulated charter died on turn
 * 8 at 1x and turn 47 at 5x. With deposits carrying their cash, the same
 * simulation survives 60 turns at 1x, so capital no longer has to buy survival.
 *
 * What it should price is commitment, and 5x the cost of creating the
 * corporation is a real commitment without being a wall. At 1953 US scale that
 * is ~71,700 from the corporate treasury against a ~14,300 founding cost.
 */
export const CHARTER_CAPITAL_FOUNDING_MULTIPLE = 5;

/** Modern-era USD reference. Era/FX scaled at call time. */
const CHARTER_CAPITAL_REFERENCE_USD = CORPORATION_FOUNDING_COST * CHARTER_CAPITAL_FOUNDING_MULTIPLE;

/**
 * Share of the full requirement an INVESTMENT charter posts.
 *
 * Posted capital exists to stand between a bank failure and a depositor
 * haircut. An investment bank has no depositors, so charging it the same as a
 * retail bank was pricing a protection nobody receives. It still posts
 * something, because the prop desk can lose money and the resolution waterfall
 * needs a floor, but a third of the retail bar rather than all of it.
 */
export const INVESTMENT_CHARTER_CAPITAL_FRACTION = 1 / 3;

/**
 * Turns a charter type is locked after a switch.
 *
 * Sized against the corporation type-switch cooldown (72 turns) and then cut,
 * because the two decisions are not the same size. Changing what industry a
 * corporation is in should be close to permanent. Changing a bank between
 * taking deposits and running a proprietary book is a strategy change, and the
 * switch already costs the whole deposit base — that is the real price, and the
 * cooldown only exists to stop a bank flipping charter every few turns to
 * arbitrage whichever facility happens to be cheaper.
 */
export const CHARTER_SWITCH_COOLDOWN_TURNS = 24;

export type CharterEligibilityResult = {
  eligible: boolean;
  reasons: string[];
  /** Capital requirement computed during the check, reused by issueCharter. */
  requirement: number;
};

export type IssueCharterResult =
  { ok: true; charter: BankCharter; postedCapital: number } | { ok: false; reasons: string[] };

export type RevokeCharterResult =
  | {
      ok: true;
      /** Residual bank equity paid up to the parent, after depositors. */
      refundedCapital: number;
      /** Player savings pointers moved back to the central bank. */
      depositorsFlipped: number;
      /** Household deposits returned to the money supply. */
      npcDepositsReturned: number;
      charter: BankCharter;
    }
  | { ok: false; error: string };

/**
 * Minimum capital to post for a bank charter, in `currency` face value.
 *
 * Base is 10× {@link CORPORATION_FOUNDING_COST} in USD-1953 reference terms,
 * deflated by the world's era unit scale, then converted to the bank's
 * currency via {@link getGdpAnchorRate} (local = anchor / rate).
 */
export async function getCharterCapitalRequirement(
  db: Db,
  currency: CurrencyCode,
  charterType?: BankCharterType
): Promise<number> {
  const [eraUnitScale, preset] = await Promise.all([
    loadWorldEraUnitScale(db),
    loadWorldPreset(db),
  ]);
  const scale = eraUnitScale > 0 && Number.isFinite(eraUnitScale) ? eraUnitScale : 1;
  const countryId = getCountryIdForCurrency(currency);
  const rate = getGdpAnchorRate(countryId, preset);
  const safeRate = rate > 0 && Number.isFinite(rate) ? rate : 1;
  const typeFraction = charterType === "investment" ? INVESTMENT_CHARTER_CAPITAL_FRACTION : 1;
  const anchor = (CHARTER_CAPITAL_REFERENCE_USD * typeFraction) / scale;
  return Math.max(1, Math.round(anchor / safeRate));
}

async function corpOwnsFinancialSector(db: Db, corporationId: ObjectId): Promise<boolean> {
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ corporationId, sectorType: "financial" }, { projection: { _id: 1 } });
  return sector != null;
}

/**
 * Objective charter gates (no approval step). All reasons are collected so the
 * UI can show every blocker at once.
 */
export async function checkCharterEligibility(
  db: Db,
  corporation: Corporation,
  requestedType: BankCharterType,
  currency: CurrencyCode,
  options?: { skipFlagCheck?: boolean }
): Promise<CharterEligibilityResult> {
  const reasons: string[] = [];

  if (!options?.skipFlagCheck) {
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          privateBankingEnabled: 1,
          bankPropTradingEnabled: 1,
          bankContagionEnabled: 1,
        },
      }
    );

    if (!(await isPrivateBankingEnabled(config))) {
      reasons.push("Private banking is not enabled");
    }
  }

  if (!(await corpOwnsFinancialSector(db, corporation._id))) {
    reasons.push("Corporation must own at least one financial sector");
  }

  if (corporation.bankCharter?.status === "active") {
    reasons.push("Corporation already has an active bank charter");
  }

  // Bank / fund separation: a corporation that sponsors an index fund may not
  // also charter a bank. Creation-time only, so existing dual holders are
  // grandfathered. The mirror check lives in
  // `indexFunds/sponsorship/charterFund.ts`.
  const sponsoredFundCount = await db
    .collection("indexFunds")
    .countDocuments({ sponsorCorporationId: corporation._id, status: { $ne: "delisted" } });
  if (sponsoredFundCount > 0) {
    reasons.push("Corporation sponsors an index fund; wind it down before chartering a bank");
  }

  const legalTypes = await getLegalCharterTypes(db, getCountryIdForCurrency(currency));
  if (legalTypes.length === 0) {
    reasons.push("Private bank charters are not available in a command economy");
  } else if (!legalTypes.includes(requestedType)) {
    // When only retail is on offer the withheld types are gated globally
    // (playerAdvancedBankChartersEnabled), not by this nation's separation law.
    reasons.push(
      legalTypes.length === 1 && legalTypes[0] === "retail"
        ? "Only retail bank charters are available right now."
        : requestedType === "universal"
          ? "Universal charters are not legal under this nation's banking separation law"
          : `Charter type "${requestedType}" is not legal in this jurisdiction`
    );
  }

  const corpCurrency = resolveCorpLiquidCurrencyCode(corporation) ?? "USD";
  if (corpCurrency !== currency) {
    reasons.push(`Corporation treasury is denominated in ${corpCurrency}, not ${currency}`);
  }

  const requirement = await getCharterCapitalRequirement(db, currency, requestedType);
  if ((corporation.liquidCapital ?? 0) < requirement) {
    reasons.push(
      `Insufficient treasury: need ${requirement.toLocaleString()} ${currency} posted capital`
    );
  }

  return { eligible: reasons.length === 0, reasons, requirement };
}

/**
 * Issue a bank charter: re-check eligibility, then atomically debit posted
 * capital and write `bankCharter` on the same corporation document (standalone
 * Mongo - one-doc update is crash-safe).
 */
export async function issueCharter(
  db: Db,
  corporationId: ObjectId,
  requestedType: BankCharterType,
  currency: CurrencyCode,
  options?: { skipFlagCheck?: boolean }
): Promise<IssueCharterResult> {
  const result = await issueCharterInner(db, corporationId, requestedType, currency, options);
  emitBankingAuditEvent(
    result.ok
      ? {
          kind: "charter.issued",
          command: "bank.charter.issue",
          turn: result.charter.charteredTurn,
          outcome: "ok",
          currency,
          bankId: corporationId.toString(),
          statusAfter: "active",
          amount: result.postedCapital,
          meta: { charterType: requestedType },
        }
      : {
          kind: "charter.issued",
          command: "bank.charter.issue",
          turn: await getCurrentTurn(db),
          outcome: "rejected",
          reason: result.reasons[0] ?? "ineligible",
          currency,
          bankId: corporationId.toString(),
          meta: { charterType: requestedType },
        },
    db
  );
  return result;
}

async function issueCharterInner(
  db: Db,
  corporationId: ObjectId,
  requestedType: BankCharterType,
  currency: CurrencyCode,
  options?: { skipFlagCheck?: boolean }
): Promise<IssueCharterResult> {
  const corporation = await db.collection<Corporation>("corporations").findOne({
    _id: corporationId,
  });
  if (!corporation) {
    return { ok: false, reasons: ["Corporation not found"] };
  }

  // skipFlagCheck is for SEED-TIME use only (NPC banks charter before the
  // world flag is on). Player routes must never pass it.
  const eligibility = await checkCharterEligibility(
    db,
    corporation,
    requestedType,
    currency,
    options
  );
  if (!eligibility.eligible) {
    return { ok: false, reasons: eligibility.reasons };
  }

  const postedCapital = eligibility.requirement;
  const charteredTurn = await getCurrentTurn(db);
  const now = new Date();

  // Overwriting a non-active charter: archive the old sub-doc first so history
  // survives the $set that replaces bankCharter entirely.
  const prior = corporation.bankCharter;
  if (prior && prior.status !== "active") {
    await archiveCharter(db, corporationId, prior, charteredTurn, "recharter");
  }

  // Initial offsets must sit inside the era corridor; 0/0 is out of band in
  // historical worlds (deposit ceiling below prime, lending floor above it).
  const corridors = await getRateCorridors(db, getCountryIdForCurrency(currency));
  const initialOffsets = clampOffsets({ depositOffset: 0, lendingOffset: 0 }, corridors);

  const charter: BankCharter = {
    type: requestedType,
    status: "active",
    currency,
    charteredTurn,
    postedCapital,
    // Posted capital IS the bank's opening cash. It was debited from the
    // corporation a line below; this is where it lands.
    cashReserves: postedCapital,
    depositOffset: initialOffsets.depositOffset,
    lendingOffset: initialOffsets.lendingOffset,
    blacklist: {},
  };

  // Single-document atomic debit + charter write. Filter re-gates capital and
  // rejects a race that already activated a charter.
  const updated = await db.collection<Corporation>("corporations").findOneAndUpdate(
    {
      _id: corporationId,
      liquidCapital: { $gte: postedCapital },
      $or: [{ bankCharter: { $exists: false } }, { "bankCharter.status": { $ne: "active" } }],
    },
    {
      $inc: { liquidCapital: -postedCapital },
      $set: {
        bankCharter: charter,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    return {
      ok: false,
      reasons: ["Failed to post capital (insufficient funds or charter already active)"],
    };
  }

  return {
    ok: true,
    charter: updated.bankCharter ?? charter,
    postedCapital,
  };
}

/**
 * Revoke a charter, returning the deposit book on the way out.
 *
 * This used to set `status: "revoked"` and stop. Depositors stayed pointed at a
 * dead bank, `npcDeposits` stayed on its books with the matching cash beside
 * it, and the owner got nothing back because the refund was gated on the
 * deposit book being empty, which nobody could make it be. That is ticket
 * 1093: a revoke that erased the balance sheet and stranded everything on it.
 *
 * Revocation now runs the same {@link returnDepositBook} waterfall as failure,
 * admin unwind and a charter switch: household deposits go back to the money
 * supply out of the bank's cash (insurance covers any shortfall), player
 * pointers flip to the central bank, and only what is genuinely left over,
 * capped at book equity, reaches the shareholder.
 */
export async function revokeCharter(
  db: Db,
  corporationId: ObjectId,
  reason: string
): Promise<RevokeCharterResult> {
  const result = await revokeCharterInner(db, corporationId, reason);
  if (result.ok) {
    emitBankingAuditEvent(
      {
        kind: "charter.revoked",
        command: "bank.charter.revoke",
        turn: result.charter.revokedTurn ?? 0,
        outcome: "ok",
        currency: result.charter.currency,
        bankId: corporationId.toString(),
        statusBefore: "active",
        statusAfter: "revoked",
        settlementId: depositBookReturnKey(
          corporationId,
          "revocation",
          result.charter.revokedTurn ?? 0
        ),
        amount: result.refundedCapital,
        meta: {
          depositorsFlipped: result.depositorsFlipped,
          npcDepositsReturned: result.npcDepositsReturned,
        },
      },
      db
    );
  } else {
    emitBankingAuditEvent(
      {
        kind: "charter.revoked",
        command: "bank.charter.revoke",
        turn: await getCurrentTurn(db),
        outcome: "rejected",
        reason: result.error,
        bankId: corporationId.toString(),
      },
      db
    );
  }
  return result;
}

async function revokeCharterInner(
  db: Db,
  corporationId: ObjectId,
  reason: string
): Promise<RevokeCharterResult> {
  const corporation = await db.collection<Corporation>("corporations").findOne({
    _id: corporationId,
  });
  if (!corporation) {
    return { ok: false, error: "Corporation not found" };
  }
  if (corporation.bankCharter?.status !== "active") {
    return { ok: false, error: "Corporation has no active bank charter" };
  }

  const charter = corporation.bankCharter;
  const currentTurn = await getCurrentTurn(db);
  const now = new Date();

  // Claim the estate before anything moves. The claim puts the charter in the
  // `resolving` stage, where deposits, loans, payouts and switches are all
  // refused, and a second revocation racing this one matches nothing. A
  // revocation that crashed after claiming is finished here as well, under
  // the turn it was claimed on, so the waterfall's idempotency key is the
  // same and the money moves once.
  const claim = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporationId,
      "bankCharter.status": "active",
      "bankCharter.resolutionClaimedTurn": { $exists: false },
    },
    {
      $set: {
        "bankCharter.resolutionClaimedTurn": currentTurn,
        "bankCharter.pendingRevocationReason": reason,
        updatedAt: now,
      },
    }
  );
  let revokedTurn = currentTurn;
  if (claim.modifiedCount !== 1) {
    if (typeof charter.resolutionClaimedTurn !== "number") {
      return { ok: false, error: "The charter is already being revoked." };
    }
    revokedTurn = charter.resolutionClaimedTurn;
  }
  await freezeAccountsAt(db, corporationId.toString(), charter.currency as CurrencyCode, now);

  // Depositors before shareholders, and the waterfall decides what is left
  // rather than a gate deciding whether anything is returned at all. The
  // residual it releases is the whole cash balance when the bank has no
  // deposits, which is the case the old refund rule handled and the only case
  // it handled correctly.
  const returned = await returnDepositBook(db, corporationId, {
    cause: "revocation",
    turn: revokedTurn,
    releaseResidualToOwner: true,
  });
  if (returned.error) {
    // Claimed and frozen, not settled. The charter reads as `resolving` and the
    // recovery worker finishes it; nothing here is undone, because undoing a
    // half-moved waterfall is the one thing a retry must never do.
    return { ok: false, error: `Could not return the deposit book: ${returned.error}` };
  }
  const refund = returned.ownerResidual;

  const revokedCharter: BankCharter = {
    ...charter,
    status: "revoked",
    revokedTurn,
    revokedReason: reason,
  };

  const update: {
    $set: Record<string, unknown>;
    $unset: Record<string, "">;
  } = {
    $set: {
      "bankCharter.status": "revoked",
      "bankCharter.revokedTurn": revokedTurn,
      "bankCharter.revokedReason": reason,
      updatedAt: now,
    },
    $unset: { "bankCharter.pendingRevocationReason": "" },
  };
  // No cash leg here: `returnDepositBook` already moved every currency unit it
  // was going to move, with a netting check on the legs. Writing a second
  // refund here is how the unwind path used to pay the shareholder twice.

  const result = await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: corporationId, "bankCharter.status": "active" }, update);

  if (result.modifiedCount !== 1) {
    return { ok: false, error: "Failed to revoke charter (no longer active)" };
  }

  await archiveCharter(db, corporationId, revokedCharter, revokedTurn, "revoked");

  return {
    ok: true,
    refundedCapital: refund,
    depositorsFlipped: returned.depositorsFlipped,
    npcDepositsReturned: returned.npcReturned,
    charter: revokedCharter,
  };
}

export type CharterSwitchBlocker =
  | "no_active_charter"
  | "same_type"
  | "illegal_type"
  | "cooldown"
  | "discount_window_outstanding"
  | "cb_margin_outstanding"
  /** The charter's lifecycle stage does not admit a switch (impaired, or not active). */
  | "lifecycle_stage";

export type CharterSwitchPreview = {
  allowed: boolean;
  blockers: CharterSwitchBlocker[];
  /** Human-readable reason per blocker, in the same order. */
  reasons: string[];
  /** Turn the cooldown expires, when one is running. */
  cooldownUntilTurn?: number;
  /** Deposits that will be returned if the switch goes ahead. */
  depositsReleased: number;
  /** Whether the target charter can hold deposits at all. */
  targetTakesDeposits: boolean;
};

export type SwitchCharterResult =
  | {
      ok: true;
      charter: BankCharter;
      depositorsFlipped: number;
      npcDepositsReturned: number;
      cooldownUntilTurn: number;
    }
  | { ok: false; blockers: CharterSwitchBlocker[]; reasons: string[] };

const SWITCH_BLOCKER_MESSAGE: Record<CharterSwitchBlocker, string> = {
  no_active_charter: "This corporation has no active bank charter.",
  same_type: "The bank already holds that charter type.",
  illegal_type: "That charter type is not legal in this jurisdiction.",
  cooldown: "The charter was switched too recently.",
  discount_window_outstanding:
    "Repay the discount window first. The window is open to deposit-taking charters only, and an investment bank cannot carry one.",
  cb_margin_outstanding:
    "Repay the CB margin line first. Only investment and universal charters may carry margin debt.",
  lifecycle_stage: "An impaired bank may not change charter type. Restore its capital first.",
};

function takesDeposits(type: BankCharterType): boolean {
  return charterTypeMay(type, "acceptPlayerDeposits");
}

function mayBorrowOnMargin(type: BankCharterType): boolean {
  return charterTypeMay(type, "centralBankMargin");
}

/**
 * Can this bank change charter type, and what will it cost?
 *
 * Read-only, so the console can show the consequences before the CEO commits
 * rather than after. Every blocker is collected instead of returning the first,
 * for the same reason `checkCharterEligibility` does it.
 */
export async function previewCharterSwitch(
  db: Db,
  corporation: Corporation,
  targetType: BankCharterType,
  currentTurn: number
): Promise<CharterSwitchPreview> {
  const blockers: CharterSwitchBlocker[] = [];
  const charter = corporation.bankCharter;

  if (!charter || charter.status !== "active") {
    return {
      allowed: false,
      blockers: ["no_active_charter"],
      reasons: [SWITCH_BLOCKER_MESSAGE.no_active_charter],
      depositsReleased: 0,
      targetTakesDeposits: takesDeposits(targetType),
    };
  }

  if (charter.type === targetType) blockers.push("same_type");

  const legalTypes = await getLegalCharterTypes(db, getCountryIdForCurrency(charter.currency));
  if (!legalTypes.includes(targetType)) blockers.push("illegal_type");

  const cooldownUntilTurn = charter.charterSwitchCooldownUntilTurn;
  if (typeof cooldownUntilTurn === "number" && currentTurn < cooldownUntilTurn) {
    blockers.push("cooldown");
  }

  // The stage table, not a band check here: an impaired bank restructuring
  // its way out of supervision is the case the rule exists for.
  if (lifecycleRefusal(charter, "switchType")) blockers.push("lifecycle_stage");

  // Facilities that do not survive the target charter must be settled first.
  // Carrying them across would leave the bank holding a line it is no longer
  // eligible to draw on, which the servicing passes have no rule for.
  const windowDebt =
    Math.max(0, charter.discountWindowDebt ?? 0) + Math.max(0, charter.discountWindowArrears ?? 0);
  if (!takesDeposits(targetType) && windowDebt > 0) {
    blockers.push("discount_window_outstanding");
  }
  const marginDebt =
    Math.max(0, charter.cbMarginDebt ?? 0) + Math.max(0, charter.cbMarginArrears ?? 0);
  if (!mayBorrowOnMargin(targetType) && marginDebt > 0) {
    blockers.push("cb_margin_outstanding");
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    reasons: blockers.map((b) => SWITCH_BLOCKER_MESSAGE[b]),
    cooldownUntilTurn: typeof cooldownUntilTurn === "number" ? cooldownUntilTurn : undefined,
    // Moving to a charter that cannot hold deposits returns the whole book.
    depositsReleased: takesDeposits(targetType) ? 0 : Math.max(0, charter.totalDeposits ?? 0),
    targetTakesDeposits: takesDeposits(targetType),
  };
}

/**
 * Change a bank's charter type in place.
 *
 * Before this existed the only route from retail to investment was to persuade
 * the central-bank chair to revoke your charter and then charter again from
 * scratch, posting capital twice — which is to say there was no route, and a
 * player who picked the wrong type at founding was stuck with it. That is the
 * complaint this fixes.
 *
 * ## Deposits do not survive a move to an investment charter
 *
 * An investment bank cannot hold deposits, so switching to one returns the
 * whole book: player savings pointers flip back to the central bank (balances
 * untouched — it is a pointer, exactly as `moveCharacterSavings` treats it) and
 * NPC household deposits go back to `externalBroadMoney` with conservation.
 *
 * The alternative was to refuse the switch until the CEO had shed deposits by
 * hand, and there is no mechanism for them to do that — they cannot evict
 * depositors. Refusing would have reproduced the original complaint with extra
 * steps. Returning the book is also the honest price: the bank gives up the
 * funding base it spent turns building, which is a real cost that the cooldown
 * on its own would not impose.
 *
 * Loans are LEFT IN PLACE and keep amortizing, the same rule `unwindBank` uses.
 * They are assets the bank owns; a charter change is not a jubilee.
 */
export async function switchCharterType(
  db: Db,
  corporationId: ObjectId,
  targetType: BankCharterType
): Promise<SwitchCharterResult> {
  const result = await switchCharterTypeInner(db, corporationId, targetType);
  const turn = result.ok ? (result.charter.charterSwitchTurn ?? 0) : await getCurrentTurn(db);
  emitBankingAuditEvent(
    result.ok
      ? {
          kind: "charter.switched",
          command: "bank.charter.switch",
          turn,
          outcome: "ok",
          currency: result.charter.currency,
          bankId: corporationId.toString(),
          statusAfter: result.charter.type,
          ...(result.npcDepositsReturned > 0 || result.depositorsFlipped > 0
            ? { settlementId: depositBookReturnKey(corporationId, "charter_switch", turn) }
            : {}),
          meta: {
            depositorsFlipped: result.depositorsFlipped,
            npcDepositsReturned: result.npcDepositsReturned,
            cooldownUntilTurn: result.cooldownUntilTurn,
          },
        }
      : {
          kind: "charter.switched",
          command: "bank.charter.switch",
          turn,
          outcome: "rejected",
          reason: result.reasons[0] ?? result.blockers[0] ?? "blocked",
          bankId: corporationId.toString(),
          statusAfter: targetType,
        },
    db
  );
  return result;
}

async function switchCharterTypeInner(
  db: Db,
  corporationId: ObjectId,
  targetType: BankCharterType
): Promise<SwitchCharterResult> {
  const corporation = await db.collection<Corporation>("corporations").findOne({
    _id: corporationId,
  });
  if (!corporation) {
    return { ok: false, blockers: ["no_active_charter"], reasons: ["Corporation not found"] };
  }

  const currentTurn = await getCurrentTurn(db);
  const preview = await previewCharterSwitch(db, corporation, targetType, currentTurn);
  if (!preview.allowed) {
    return { ok: false, blockers: preview.blockers, reasons: preview.reasons };
  }

  const charter = corporation.bankCharter!;
  const currency = charter.currency as CurrencyCode;
  const now = new Date();
  const cooldownUntilTurn = currentTurn + CHARTER_SWITCH_COOLDOWN_TURNS;

  let depositorsFlipped = 0;
  let npcDepositsReturned = 0;

  if (!preview.targetTakesDeposits) {
    // The shared waterfall, not a local copy of it. The local copy credited the
    // central bank's money pool with the household book and left the matching
    // cash in the bank, so the same money existed twice.
    const returned = await returnDepositBook(db, corporationId, {
      cause: "charter_switch",
      turn: currentTurn,
      // A switch is not a wind-up: the bank keeps trading, so its cash stays
      // with it rather than being paid up to the parent.
      releaseResidualToOwner: false,
    });
    if (returned.error) {
      return {
        ok: false,
        blockers: ["no_active_charter"],
        reasons: [`Could not return the deposit book: ${returned.error}`],
      };
    }
    depositorsFlipped = returned.depositorsFlipped;
    npcDepositsReturned = returned.npcReturned;
  }

  // Offsets are re-clamped: the Regulation Q corridor an investment bank sits
  // in is not the one a retail bank sits in, and carrying an out-of-band offset
  // across would have the rates pass silently correct it later.
  const corridors = await getRateCorridors(db, getCountryIdForCurrency(currency));
  const offsets = clampOffsets(
    { depositOffset: charter.depositOffset, lendingOffset: charter.lendingOffset },
    corridors
  );

  // Deposit aggregates are cleared by `returnDepositBook`, after its cash legs
  // land. Clearing them here as well would be harmless today and wrong the day
  // the waterfall stops half way, because it would hide the hole.

  const updated = await db.collection<Corporation>("corporations").findOneAndUpdate(
    { _id: corporationId, "bankCharter.status": "active", "bankCharter.type": charter.type },
    {
      $set: {
        "bankCharter.type": targetType,
        "bankCharter.depositOffset": offsets.depositOffset,
        "bankCharter.lendingOffset": offsets.lendingOffset,
        "bankCharter.charterSwitchTurn": currentTurn,
        "bankCharter.charterSwitchCooldownUntilTurn": cooldownUntilTurn,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );

  if (!updated?.bankCharter) {
    return {
      ok: false,
      blockers: ["no_active_charter"],
      reasons: ["The charter changed while the switch was in flight. Try again."],
    };
  }

  await archiveCharter(db, corporationId, charter, currentTurn, "recharter");

  return {
    ok: true,
    charter: updated.bankCharter,
    depositorsFlipped,
    npcDepositsReturned,
    cooldownUntilTurn,
  };
}

/**
 * Whether `characterId` is the seated chair of the central bank that issues
 * `currency` (via the currency's anchor country → shared bank id).
 */
export async function isChairOfCurrencyBank(
  db: Db,
  characterId: ObjectId,
  currency: CurrencyCode
): Promise<boolean> {
  const countryId = getCountryIdForCurrency(currency);
  const bankId = getBankId(countryId);
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: bankId }, { projection: { chairCharacterId: 1 } });
  return !!bank?.chairCharacterId && bank.chairCharacterId.equals(characterId);
}
