import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation, FederalBudget } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type {
  Defect,
  DetectResult,
  HealContext,
  HealPlan,
  HealResult,
  VerifyResult,
} from "../types";

export const DEFECT_ID = "AHD-tinky-stale-vote-excess";

const CORPORATION_ID = "6a842cb29201d287c650b9c9";
const MARKER_PATH = `remediation.${DEFECT_ID}`;

const SOURCE_TRADE_IDS = [
  "6a87103477553ad23817e4e3",
  "6a87105d77553ad23817e4fd",
  "6a87109d77553ad23817e565",
  "6a8710a777553ad23817e56d",
  "6a87119277553ad23817e5e6",
  "6a87119f77553ad23817e5f9",
  "6a87134577553ad23817ec28",
  "6a87139177553ad23817ec7b",
  "6a87142977553ad23817ecbc",
  "6a87165b77553ad23817ed6d",
  "6a87166677553ad23817ed73",
  "6a87169277553ad23817f391",
  "6a87169d77553ad23817f39c",
  "6a8716c577553ad238183c50",
  "6a8716db77553ad238184063",
  "6a87171177553ad238184415",
  "6a87183477553ad23818452e",
  "6a87190577553ad238184586",
  "6a87191277553ad238184593",
  "6a87192577553ad2381845b2",
  "6a8719a777553ad2381845f7",
  "6a871a1477553ad238184618",
  "6a871a2877553ad23818462c",
  "6a871e5577553ad2381848bb",
] as const;

export interface IncidentClaim {
  id: string;
  anchorAmount: number;
  destination: "character" | "treasury";
  destinationId: string;
  reason: "direct_loss" | "participant_excess" | "deleted_claimant";
}

/**
 * Material direct losses, rounded to anchor cents after replaying the 24 fills
 * against the undiluted execution anchor of 27.558392417094588.
 */
export const CLAIMS: readonly IncidentClaim[] = [
  {
    id: "participant-character",
    anchorAmount: 17_540_006.01,
    destination: "treasury",
    destinationId: "US",
    reason: "participant_excess",
  },
  {
    id: "direct-character-1",
    anchorAmount: 10_594.37,
    destination: "character",
    destinationId: "6a7a023a71e5d11a9601e36c",
    reason: "direct_loss",
  },
  {
    id: "direct-character-2",
    anchorAmount: 1_959_913.1,
    destination: "character",
    destinationId: "6a81e51d129b255e3b5ecd1b",
    reason: "direct_loss",
  },
  {
    id: "direct-character-3",
    anchorAmount: 27_054.07,
    destination: "character",
    destinationId: "6a84e5e5564b232829e97638",
    reason: "direct_loss",
  },
  {
    id: "direct-character-4",
    anchorAmount: 972_411.02,
    destination: "character",
    destinationId: "6a78c7c6346400213cf9d2c5",
    reason: "direct_loss",
  },
  {
    id: "participant-corporation",
    anchorAmount: 166_905_772.74,
    destination: "treasury",
    destinationId: "US",
    reason: "participant_excess",
  },
  {
    id: "deleted-corporation",
    anchorAmount: 1_354_041_027.95,
    destination: "treasury",
    destinationId: "UK",
    reason: "deleted_claimant",
  },
] as const;

export function totalClaimAnchor(claims: readonly IncidentClaim[] = CLAIMS): number {
  return Math.round(claims.reduce((sum, claim) => sum + claim.anchorAmount, 0) * 100) / 100;
}

function roundLocal(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function hasMarker(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const remediation = (doc as { remediation?: Record<string, unknown> }).remediation;
  return remediation?.[DEFECT_ID] !== undefined;
}

interface CharacterCreditPlan {
  claimId: string;
  characterId: string;
  characterName: string;
  currencyCode: CurrencyCode;
  fxRate: number;
  anchorAmount: number;
  localAmount: number;
}

interface TreasuryCreditPlan {
  countryId: string;
  budgetId: string;
  currencyCode: CurrencyCode;
  fxRate: number;
  anchorAmount: number;
  localAmount: number;
  claimIds: string[];
}

interface IncidentPlanPayload {
  corporationId: string;
  corporationName: string;
  corporationCurrencyCode: CurrencyCode;
  corporationFxRate: number;
  debitAnchor: number;
  debitLocal: number;
  characterCredits: CharacterCreditPlan[];
  treasuryCredits: TreasuryCreditPlan[];
  sourceTradeIds: string[];
}

interface Survey {
  corporation: Corporation | null;
  sourceTradeCount: number;
  payload: IncidentPlanPayload | null;
  missing: string[];
}

async function survey(db: Db): Promise<Survey> {
  const characterClaims = CLAIMS.filter(
    (claim): claim is IncidentClaim & { destination: "character" } =>
      claim.destination === "character"
  );
  const treasuryCountries = [
    ...new Set(
      CLAIMS.filter((claim) => claim.destination === "treasury").map((claim) => claim.destinationId)
    ),
  ];

  const [corporation, characters, budgets, sourceTradeCount, fxByCurrency] = await Promise.all([
    db.collection<Corporation>("corporations").findOne({ _id: new ObjectId(CORPORATION_ID) }),
    db
      .collection<Character>("characters")
      .find({ _id: { $in: characterClaims.map((claim) => new ObjectId(claim.destinationId)) } })
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find({ countryId: { $in: treasuryCountries } })
      .toArray(),
    db.collection("shareTradeHistory").countDocuments({
      _id: { $in: SOURCE_TRADE_IDS.map((id) => new ObjectId(id)) },
      corporationId: new ObjectId(CORPORATION_ID),
    }),
    loadFxRatesByCurrency(db),
  ]);

  const missing: string[] = [];
  if (!corporation) missing.push("incident corporation");
  if (sourceTradeCount !== SOURCE_TRADE_IDS.length) {
    missing.push(`${SOURCE_TRADE_IDS.length - sourceTradeCount} immutable source trade rows`);
  }

  const characterById = new Map(characters.map((row) => [row._id.toString(), row]));
  const budgetByCountry = new Map(budgets.map((row) => [row.countryId, row]));
  for (const claim of characterClaims) {
    if (!characterById.has(claim.destinationId)) missing.push(`recipient ${claim.id}`);
  }
  for (const countryId of treasuryCountries) {
    if (!budgetByCountry.has(countryId)) missing.push(`${countryId} federal budget`);
  }
  if (!corporation || missing.length > 0) {
    return { corporation, sourceTradeCount, payload: null, missing };
  }

  const corporationCurrencyCode = (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode;
  const corporationFxRate = fxByCurrency.get(corporationCurrencyCode);
  if (!corporationFxRate) missing.push(`${corporationCurrencyCode} FX rate`);

  const characterCredits: CharacterCreditPlan[] = [];
  for (const claim of characterClaims) {
    const character = characterById.get(claim.destinationId)!;
    const currencyCode = getHomeCurrency(character);
    const fxRate = fxByCurrency.get(currencyCode);
    if (!fxRate) {
      missing.push(`${currencyCode} FX rate for ${claim.id}`);
      continue;
    }
    characterCredits.push({
      claimId: claim.id,
      characterId: claim.destinationId,
      characterName: character.name,
      currencyCode,
      fxRate,
      anchorAmount: claim.anchorAmount,
      localAmount: roundLocal(claim.anchorAmount * fxRate),
    });
  }

  const treasuryCredits: TreasuryCreditPlan[] = [];
  for (const countryId of treasuryCountries) {
    const budget = budgetByCountry.get(countryId)!;
    const currencyCode = (budget.currencyCode ??
      COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
      "USD") as CurrencyCode;
    const fxRate = fxByCurrency.get(currencyCode);
    if (!fxRate) {
      missing.push(`${currencyCode} FX rate for ${countryId} treasury`);
      continue;
    }
    const countryClaims = CLAIMS.filter(
      (claim) => claim.destination === "treasury" && claim.destinationId === countryId
    );
    const anchorAmount = totalClaimAnchor(countryClaims);
    treasuryCredits.push({
      countryId,
      budgetId: budget._id.toString(),
      currencyCode,
      fxRate,
      anchorAmount,
      localAmount: roundLocal(anchorAmount * fxRate),
      claimIds: countryClaims.map((claim) => claim.id),
    });
  }

  if (!corporationFxRate || missing.length > 0) {
    return { corporation, sourceTradeCount, payload: null, missing };
  }

  const debitAnchor = totalClaimAnchor();
  return {
    corporation,
    sourceTradeCount,
    missing,
    payload: {
      corporationId: corporation._id.toString(),
      corporationName: corporation.name,
      corporationCurrencyCode,
      corporationFxRate,
      debitAnchor,
      debitLocal: roundLocal(debitAnchor * corporationFxRate),
      characterCredits,
      treasuryCredits,
      sourceTradeIds: [...SOURCE_TRADE_IDS],
    },
  };
}

async function detect(db: Db): Promise<DetectResult> {
  const result = await survey(db);
  if (!result.corporation || result.sourceTradeCount !== SOURCE_TRADE_IDS.length) {
    return {
      affected: 0,
      sample: [],
      notes: result.missing.length > 0 ? result.missing : ["incident source is not present"],
    };
  }
  const affected = hasMarker(result.corporation) ? 0 : CLAIMS.length;
  return {
    affected,
    sample: affected > 0 ? [{ corporationId: CORPORATION_ID, claims: CLAIMS.length }] : [],
    notes: [
      `${result.sourceTradeCount} source fills verified`,
      affected > 0
        ? `${CLAIMS.length} material claims remain`
        : "durable remediation marker present",
      ...result.missing,
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const result = await survey(db);
  if (!result.corporation || hasMarker(result.corporation)) {
    return {
      affected: 0,
      touched: [],
      moneyDelta: 0,
      summary: `${DEFECT_ID}: nothing to heal`,
      notes: result.missing,
    };
  }
  if (!result.payload || result.missing.length > 0) {
    throw new Error(`${DEFECT_ID} cannot build a complete plan: ${result.missing.join(", ")}`);
  }

  return {
    affected: CLAIMS.length,
    touched: [
      { collection: "corporations", ids: [result.payload.corporationId] },
      {
        collection: "characters",
        ids: result.payload.characterCredits.map((credit) => credit.characterId),
      },
      {
        collection: "federalBudget",
        ids: result.payload.treasuryCredits.map((credit) => credit.budgetId),
      },
    ],
    moneyDelta: 0,
    summary:
      `${DEFECT_ID}: remove ${result.payload.debitAnchor.toFixed(2)} anchor of stale-vote excess ` +
      `from the issuer, repay four direct losses, and route participant or unclaimed value to treasuries`,
    notes: [
      "The heal changes cash only. It does not rewrite shares or historical trades.",
      "Four live non-participants receive their mechanical direct loss at current FX.",
      "Participant-associated excess is routed to the US treasury rather than refunded.",
      "The dissolved claimant and deleted owner left no legal successor, so its claim is routed to the UK treasury.",
      "shareIssuanceProceeds is reduced alongside liquidCapital so the cumulative proceeds marker remains truthful.",
    ],
    payload: result.payload,
  };
}

function marker(payload: IncidentPlanPayload, ctx: HealContext, detail: Record<string, unknown>) {
  return {
    runId: ctx.runId ?? null,
    appliedAt: ctx.now,
    debitAnchor: payload.debitAnchor,
    sourceTradeIds: payload.sourceTradeIds,
    ...detail,
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const payload = healPlan.payload as IncidentPlanPayload | undefined;
  if (!payload || healPlan.affected === 0) {
    return { documentsScanned: 0, documentsUpdated: 0, notes: ["nothing to heal"] };
  }

  let updated = 0;
  for (const credit of payload.characterCredits) {
    const path = `currencyBalances.personal.${credit.currencyCode}`;
    const result = await db.collection<Character>("characters").updateOne(
      { _id: new ObjectId(credit.characterId), [MARKER_PATH]: { $exists: false } },
      {
        $inc: { [path]: credit.localAmount },
        $set: {
          [MARKER_PATH]: marker(payload, ctx, {
            claimId: credit.claimId,
            creditAnchor: credit.anchorAmount,
            creditLocal: credit.localAmount,
            currencyCode: credit.currencyCode,
            fxRate: credit.fxRate,
          }),
          updatedAt: ctx.now,
        },
      }
    );
    if (result.modifiedCount !== 1)
      throw new Error(`recipient ${credit.claimId} moved during apply`);
    updated += 1;
  }

  for (const credit of payload.treasuryCredits) {
    const result = await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: credit.budgetId, [MARKER_PATH]: { $exists: false } },
      {
        $inc: { treasuryBalance: credit.localAmount },
        $set: {
          [MARKER_PATH]: marker(payload, ctx, {
            claimIds: credit.claimIds,
            creditAnchor: credit.anchorAmount,
            creditLocal: credit.localAmount,
            currencyCode: credit.currencyCode,
            fxRate: credit.fxRate,
          }),
          updatedAt: ctx.now,
        },
      }
    );
    if (result.modifiedCount !== 1)
      throw new Error(`${credit.countryId} treasury moved during apply`);
    updated += 1;
  }

  const corporation = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: new ObjectId(payload.corporationId),
      [MARKER_PATH]: { $exists: false },
      liquidCapital: { $gte: payload.debitLocal },
      shareIssuanceProceeds: { $gte: payload.debitLocal },
    },
    {
      $inc: {
        liquidCapital: -payload.debitLocal,
        shareIssuanceProceeds: -payload.debitLocal,
      },
      $set: {
        [MARKER_PATH]: marker(payload, ctx, {
          debitLocal: payload.debitLocal,
          currencyCode: payload.corporationCurrencyCode,
          fxRate: payload.corporationFxRate,
        }),
        updatedAt: ctx.now,
      },
    }
  );
  if (corporation.modifiedCount !== 1) throw new Error("issuer balance moved or is insufficient");
  updated += 1;

  const thresholds = await loadTxThresholds(db);
  await emitTxBulk(
    db,
    [
      {
        type: "admin_transfer" as const,
        turn: 262,
        createdAt: ctx.now,
        subjectType: "corporation" as const,
        subjectId: new ObjectId(payload.corporationId),
        subjectName: payload.corporationName,
        amount: -payload.debitLocal,
        currencyCode: payload.corporationCurrencyCode,
        anchorAmount: -payload.debitAnchor,
        counterpartyType: "system" as const,
        counterpartyName: "Stale-vote incident remediation",
        meta: { defectId: DEFECT_ID, runId: ctx.runId ?? null, side: "issuer_debit" },
      },
      ...payload.characterCredits.map((credit) => ({
        type: "admin_transfer" as const,
        turn: 262,
        createdAt: ctx.now,
        subjectType: "character" as const,
        subjectId: new ObjectId(credit.characterId),
        subjectName: credit.characterName,
        amount: credit.localAmount,
        currencyCode: credit.currencyCode,
        anchorAmount: credit.anchorAmount,
        counterpartyType: "system" as const,
        counterpartyName: "Stale-vote incident remediation",
        meta: {
          defectId: DEFECT_ID,
          runId: ctx.runId ?? null,
          claimId: credit.claimId,
          side: "direct_loss_credit",
        },
      })),
      ...payload.treasuryCredits.map((credit) => ({
        type: "admin_transfer" as const,
        turn: 262,
        createdAt: ctx.now,
        subjectType: "government" as const,
        countryId: credit.countryId,
        subjectName: `${credit.countryId} Treasury`,
        amount: credit.localAmount,
        currencyCode: credit.currencyCode,
        anchorAmount: credit.anchorAmount,
        counterpartyType: "system" as const,
        counterpartyName: "Stale-vote incident remediation",
        meta: {
          defectId: DEFECT_ID,
          runId: ctx.runId ?? null,
          claimIds: credit.claimIds,
          side: "treasury_credit",
        },
      })),
    ],
    thresholds
  );

  const insertedTxIds = ctx.runId
    ? await db
        .collection<FinancialTxLogEntry>("financialTxLog")
        .find({ type: "admin_transfer", "meta.runId": ctx.runId }, { projection: { _id: 1 } })
        .toArray()
    : [];

  return {
    documentsScanned: CLAIMS.length,
    documentsUpdated: updated,
    insertedIds:
      insertedTxIds.length > 0
        ? [{ collection: "financialTxLog", ids: insertedTxIds.map((row) => row._id.toString()) }]
        : undefined,
    notes: [
      `updated ${updated} balance documents`,
      `emitted ${insertedTxIds.length} admin_transfer receipts`,
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const after = await detect(db);
  const result = await survey(db);
  const payload = result.payload;
  const markerCount = result.corporation && hasMarker(result.corporation) ? 1 : 0;
  const recipientIds = payload?.characterCredits.map((row) => new ObjectId(row.characterId)) ?? [];
  const budgetIds = payload?.treasuryCredits.map((row) => row.budgetId) ?? [];
  const [markedCharacters, markedBudgets] = await Promise.all([
    recipientIds.length > 0
      ? db.collection<Character>("characters").countDocuments({
          _id: { $in: recipientIds },
          [MARKER_PATH]: { $exists: true },
        })
      : 0,
    budgetIds.length > 0
      ? db.collection<FederalBudget>("federalBudget").countDocuments({
          _id: { $in: budgetIds },
          [MARKER_PATH]: { $exists: true },
        })
      : 0,
  ]);
  const expectedMarkers =
    1 + (payload?.characterCredits.length ?? 0) + (payload?.treasuryCredits.length ?? 0);
  const actualMarkers = markerCount + markedCharacters + markedBudgets;
  return {
    ok: after.affected === 0 && actualMarkers === expectedMarkers,
    remaining: after.affected,
    notes: [
      `${actualMarkers} of ${expectedMarkers} balance documents carry the durable marker`,
      after.affected === 0 ? "detector is clean" : `${after.affected} claims remain`,
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "A stale shareholder ballot authorized a post-split issuance at obsolete terms",
  severity: "P1",
  codeFix: {
    pr: 692,
    mergedTo: "main",
    requiredCommit: "de013b0fe5eae522039c3a1a0776296893b69305",
  },
  seedFix: {
    status: "not-needed",
    note: "The incident required a live vote, a concurrent reverse split, and subsequent market fills. Seed data cannot reproduce it.",
  },
  envs: ["prod"],
  idempotent: true,
  guards: ["turn-lock-free", "max-affected:10", "money-conserving"],
  detect,
  plan,
  apply,
  verify,
};
