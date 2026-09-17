/**
 * Union dues v1, found a rival union.
 *
 * Before dues v1 there was exactly one union per (countryId, sectorType) pair,
 * seeded by the world. This is what makes a SECOND one possible: any character
 * in the target country may found a new union in an industry that already has
 * one, which is what gives {@link organizeSector}'s raid path something to
 * raid. A founded union starts with nothing, zero treasury, no represented
 * sectors, no services, and must organize its way into the industry exactly
 * like an NPP challenger would.
 */
import { loadCampaignCurrencyRates } from "@/lib/campaigns/campaignCurrency";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { BASE_APPROVAL } from "@/lib/unions/unionDues";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  MAX_UNION_NAME_LENGTH,
  MIN_UNION_NAME_LENGTH,
  UNION_FOUNDING_ACTION_COST,
  unionFoundingCostLocal,
} from "@/lib/unions/unionFounding";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";
import { rejectIfTurnProcessing } from "./unionActions";
import type { UnionActionResult } from "./unionActions";
import {
  applyUnionFoundingSpend,
  FOUNDING_INSERT_BLOCKED,
  FOUNDING_INSERT_FAILED,
  FOUNDING_LEADERSHIP_CHANGED,
  FOUNDING_SPEND_INSUFFICIENT,
} from "@/lib/unions/unionFoundingSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

export { MAX_UNION_NAME_LENGTH, MIN_UNION_NAME_LENGTH, UNION_FOUNDING_ACTION_COST };

export interface FoundUnionInput {
  countryId: CountryId;
  sectorType: CorporationType;
  name: string;
}

/**
 * Found a new union. The founding character must be present in the target
 * country, pays `UNION_FOUNDING_COST_ANCHOR` (era/FX scaled) out of CAMPAIGN
 * FUNDS plus `UNION_FOUNDING_ACTION_COST` action points, and cannot reuse a
 * name already taken by another union in the same (countryId, sectorType) pair.
 *
 * Both costs come out of ONE guarded money-flow leg (issue #1672), the same
 * shape `npps/commands/directAction` uses, so a founder can never pay the
 * funds and keep the action points (or the reverse) and two concurrent
 * foundings cannot both pass on a stale balance. A crash between the
 * founding writes reconciles to exactly one charged founding.
 */
export async function foundUnion(
  db: Db,
  character: Character,
  input: FoundUnionInput,
  options?: { idempotencyKey?: string }
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;

  if (character.countryId !== input.countryId) {
    return {
      ok: false,
      status: 403,
      error: "You must be in this country to found a union here.",
    };
  }

  if (await isUnionsBanned(db, input.countryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  // One union per leader, the same invariant acceptUnionLeadership and
  // voteUnionLeader enforce. Without this a founder could lead every union
  // they could pay for, and reconcileUnionOwnerCache would flap the
  // `unionLeaderOf` cache between them on every page view.
  if (character.unionLeaderOf != null) {
    return {
      ok: false,
      status: 409,
      error: "You already lead a union. Step down before founding another.",
    };
  }

  const name = input.name.trim();
  if (name.length < MIN_UNION_NAME_LENGTH || name.length > MAX_UNION_NAME_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Union name must be between ${MIN_UNION_NAME_LENGTH} and ${MAX_UNION_NAME_LENGTH} characters.`,
    };
  }

  // Duplicate check is scoped to (countryId, sectorType): the same name is
  // fine in a different country or a different industry, but two rival
  // unions organizing the same industry in the same country cannot share one.
  const existingNames = await db
    .collection<Union>("unions")
    .find({ countryId: input.countryId, sectorType: input.sectorType }, { projection: { name: 1 } })
    .toArray();
  const nameLower = name.toLowerCase();
  if (existingNames.some((u) => (u.name ?? "").trim().toLowerCase() === nameLower)) {
    return {
      ok: false,
      status: 409,
      error: "A union with this name already exists in this country and industry.",
    };
  }

  const forexEnabled = await isForexEnabled();
  const preset = await getGameStatePresetOrDefault(db);
  const campaignRates = forexEnabled ? await loadCampaignCurrencyRates(db) : undefined;
  const homeCurrency = getHomeCurrency(character);
  const costLocal = unionFoundingCostLocal({
    preset,
    countryId: input.countryId,
    forexEnabled,
    campaignRates,
  });

  // Campaign funds live in `currencyBalances.campaign` post-forex and on the
  // legacy `funds` field before it, the same resolution `directAction` does.
  const useForexCampaignBalance =
    forexEnabled && typeof character.currencyBalances?.campaign === "number";
  const campaignFundsField = useForexCampaignBalance ? "currencyBalances.campaign" : "funds";
  const availableFunds = useForexCampaignBalance
    ? (character.currencyBalances?.campaign ?? 0)
    : (character.funds ?? 0);
  const availableActions = character.actions ?? 0;

  // Reported up front rather than as a bare rejection, so the founder can see
  // which of the two costs they are short on before anything is spent.
  if (availableFunds < costLocal) {
    return {
      ok: false,
      status: 402,
      error: `Founding a union costs ${costLocal.toLocaleString()} ${homeCurrency} in campaign funds (you have ${Math.floor(availableFunds).toLocaleString()}).`,
    };
  }
  if (availableActions < UNION_FOUNDING_ACTION_COST) {
    return {
      ok: false,
      status: 402,
      error: `Founding a union costs ${UNION_FOUNDING_ACTION_COST} action points (you have ${availableActions}).`,
    };
  }

  const now = new Date();
  // Crash-safe spend (issue #1672): the combined actions+funds debit is a
  // keyed idempotent leg, the union row a deterministic insert, and the
  // leadership claim a guarded keyed update, so a crash between the
  // sequential writes reconciles to exactly one charged founding instead of
  // charging for a union that never landed (or founding it twice). A later
  // failure compensates the applied prefix in reverse, the historical
  // refund-on-failure made crash-safe. `Idempotency-Key` replays the stored
  // outcome without charging again.
  try {
    const settled = await applyUnionFoundingSpend(db, {
      characterId: character._id,
      campaignFundsField,
      costFundsLocal: costLocal,
      costActions: UNION_FOUNDING_ACTION_COST,
      unionDoc: {
        countryId: input.countryId,
        sectorType: input.sectorType,
        name,
        ownerId: character._id,
        ownerType: "character",
        pendingLeaderCharacterId: null,
        treasury: 0,
        strength: 0,
        approval: BASE_APPROVAL,
        duesPerWorkerAnnual: 0,
        activeServices: [],
        foundedByCharacterId: character._id,
        lastCalledStrikeTurn: null,
        demandedWageLevel: null,
        createdAt: now,
        updatedAt: now,
      },
      priorCharacterUpdatedAt: character.updatedAt,
      now,
      fingerprint: `found-union:${input.countryId}:${input.sectorType}:${nameLower}`,
      ...(options?.idempotencyKey !== undefined
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
    });
    return {
      ok: true,
      status: 200,
      unionId: settled.unionId.toString(),
      name,
      countryId: input.countryId,
      sectorType: input.sectorType,
      campaignFundsSpent: costLocal,
      actionsSpent: UNION_FOUNDING_ACTION_COST,
      currency: homeCurrency,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith(FOUNDING_SPEND_INSUFFICIENT)) {
      return {
        ok: false,
        status: 409,
        error: "Your campaign funds or action points changed, reload and try again.",
      };
    }
    if (message.startsWith(FOUNDING_INSERT_BLOCKED)) {
      return {
        ok: false,
        status: 409,
        error:
          "This country and industry already has a union blocking a second one at the database level, contact ops.",
      };
    }
    if (message.startsWith(FOUNDING_INSERT_FAILED)) {
      return {
        ok: false,
        status: 409,
        error: "Failed to found the union, you have been refunded.",
      };
    }
    if (message.startsWith(FOUNDING_LEADERSHIP_CHANGED)) {
      return {
        ok: false,
        status: 409,
        error: "You already lead a union. Step down before founding another.",
      };
    }
    if (error instanceof MoneyFlowKeyConflictError) {
      return {
        ok: false,
        status: 409,
        error: "This founding key was already used for a different founding.",
      };
    }
    if (error instanceof MoneyFlowTerminalError) {
      return {
        ok: false,
        status: 409,
        error: "This founding already settled; retry without the idempotency key.",
      };
    }
    throw error;
  }
}
