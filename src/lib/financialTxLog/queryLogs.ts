import { ObjectId, type Db, type Filter } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  FinancialTxLogEntry,
  FinancialSubjectType,
  FinancialTxType,
  SuspectFlagSeverity,
} from "@/lib/db/types/financialTxLog";
import { ALL_TX_TYPES } from "@/lib/financialTxLog/types-extended";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 50;

const VALID_SUBJECT_TYPES = new Set<string>(["character", "corporation", "party", "government"]);

// VALID_TX_TYPES used to be a hardcoded copy of the union members. Source of
// truth now lives in `types-extended.ts`, which carries a typecheck assertion
// that ALL_TX_TYPES enumerates every variant of FinancialTxType. Keeping a
// single list prevents drift the next time a new tx type ships.
const VALID_TX_TYPES = new Set<string>(ALL_TX_TYPES);

type BuildFilterResult =
  | { ok: true; filter: Filter<FinancialTxLogEntry> & Record<string, unknown>; limit: number }
  | { ok: false; error: string };

export function buildTxLogFilter(searchParams: URLSearchParams): BuildFilterResult {
  const filter: Filter<FinancialTxLogEntry> & Record<string, unknown> = {};

  const subjectTypeParam = searchParams.get("subjectType");
  const subjectIdParam = searchParams.get("subjectId");
  const subjectNameParam = searchParams.get("subjectName");
  const typesParam = searchParams.get("types");
  const currenciesParam = searchParams.get("currencies");
  const amountMinParam = searchParams.get("amountMin");
  const amountMaxParam = searchParams.get("amountMax");
  const turnMinParam = searchParams.get("turnMin");
  const turnMaxParam = searchParams.get("turnMax");
  const flaggedParam = searchParams.get("flagged");
  const cursorParam = searchParams.get("cursor");
  const limitParam = searchParams.get("limit");

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  if (subjectTypeParam) {
    if (!VALID_SUBJECT_TYPES.has(subjectTypeParam)) {
      return { ok: false, error: "Invalid subjectType" };
    }
    filter.subjectType = subjectTypeParam as FinancialSubjectType;
  }

  if (subjectIdParam) {
    if (!/^[0-9a-f]{24}$/i.test(subjectIdParam)) {
      return { ok: false, error: "Invalid subjectId" };
    }
    filter.subjectId = new ObjectId(subjectIdParam);
  }

  if (subjectNameParam?.trim()) {
    filter.subjectName = { $regex: subjectNameParam.trim(), $options: "i" };
  }

  if (typesParam) {
    const types = typesParam
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const invalid = types.find((t) => !VALID_TX_TYPES.has(t));
    if (invalid) return { ok: false, error: `Invalid type: ${invalid}` };
    filter.type = { $in: types as FinancialTxType[] };
  }

  if (currenciesParam) {
    const currencies = currenciesParam
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    filter.currencyCode = { $in: currencies as CurrencyCode[] };
  }

  const amountFilter: Record<string, number> = {};
  if (amountMinParam) {
    const v = parseFloat(amountMinParam);
    if (!isFinite(v)) return { ok: false, error: "Invalid amountMin" };
    amountFilter.$gte = v;
  }
  if (amountMaxParam) {
    const v = parseFloat(amountMaxParam);
    if (!isFinite(v)) return { ok: false, error: "Invalid amountMax" };
    amountFilter.$lte = v;
  }
  if (Object.keys(amountFilter).length > 0) filter.amount = amountFilter;

  const turnFilter: Record<string, number> = {};
  if (turnMinParam) {
    const v = parseInt(turnMinParam, 10);
    if (!isFinite(v)) return { ok: false, error: "Invalid turnMin" };
    turnFilter.$gte = v;
  }
  if (turnMaxParam) {
    const v = parseInt(turnMaxParam, 10);
    if (!isFinite(v)) return { ok: false, error: "Invalid turnMax" };
    turnFilter.$lte = v;
  }
  if (Object.keys(turnFilter).length > 0) filter.turn = turnFilter;

  if (flaggedParam === "true") filter.flagged = true;
  else if (flaggedParam === "false") filter.flagged = false;

  if (cursorParam) {
    if (!/^[0-9a-f]{24}$/i.test(cursorParam)) {
      return { ok: false, error: "Invalid cursor" };
    }
    filter._id = { $lt: new ObjectId(cursorParam) };
  }

  return { ok: true, filter, limit };
}

export async function queryTxLog(
  db: Db,
  filter: Filter<FinancialTxLogEntry> & Record<string, unknown>,
  limit: number
): Promise<{ entries: FinancialTxLogEntry[]; nextCursor: string | null; hasMore: boolean }> {
  const entries = await db
    .collection<FinancialTxLogEntry>("financialTxLog")
    .find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = entries.length > limit;
  if (hasMore) entries.pop();

  const nextCursor = hasMore ? entries[entries.length - 1]._id.toHexString() : null;

  return { entries, nextCursor, hasMore };
}

export interface TxAlertGroup {
  entityKey: string;
  subjectType: string;
  subjectId?: string;
  countryId?: string;
  subjectName: string;
  flagCount: number;
  highestSeverity: SuspectFlagSeverity;
  mostRecentAt: Date;
  sampleDocIds: string[];
  flagTypes: string[];
}

const RANK_TO_SEVERITY: SuspectFlagSeverity[] = ["low", "medium", "high"];

export async function queryTxAlerts(db: Db): Promise<{ alerts: TxAlertGroup[]; total: number }> {
  type GroupedDoc = {
    _id: {
      subjectType: string;
      subjectId?: ObjectId;
      countryId?: string;
      subjectName: string;
    };
    flagCount: number;
    highestSeverityRank: number;
    mostRecentAt: Date;
    sampleDocIds: ObjectId[];
    flagTypes: string[];
  };

  const raw = await db
    .collection<FinancialTxLogEntry>("financialTxLog")
    .aggregate<GroupedDoc>([
      { $match: { flagged: true } },
      { $unwind: "$suspectFlags" },
      { $match: { "suspectFlags.dismissed": { $ne: true } } },
      {
        $group: {
          _id: {
            subjectType: "$subjectType",
            subjectId: "$subjectId",
            countryId: "$countryId",
            subjectName: "$subjectName",
          },
          flagCount: { $sum: 1 },
          highestSeverityRank: {
            $max: {
              $switch: {
                branches: [
                  { case: { $eq: ["$suspectFlags.severity", "high"] }, then: 2 },
                  { case: { $eq: ["$suspectFlags.severity", "medium"] }, then: 1 },
                ],
                default: 0,
              },
            },
          },
          mostRecentAt: { $max: "$createdAt" },
          sampleDocIds: { $addToSet: "$_id" },
          flagTypes: { $addToSet: "$suspectFlags.type" },
        },
      },
      { $sort: { highestSeverityRank: -1, mostRecentAt: -1 } },
    ])
    .toArray();

  const alerts: TxAlertGroup[] = raw.map((doc) => {
    const { subjectType, subjectId, countryId, subjectName } = doc._id;
    const entityKey =
      subjectType === "government" ? `gov:${countryId}` : (subjectId?.toHexString() ?? subjectName);
    const rank = Math.min(Math.max(doc.highestSeverityRank, 0), 2);

    return {
      entityKey,
      subjectType,
      subjectId: subjectId?.toHexString(),
      countryId,
      subjectName,
      flagCount: doc.flagCount,
      highestSeverity: RANK_TO_SEVERITY[rank],
      mostRecentAt: doc.mostRecentAt,
      sampleDocIds: doc.sampleDocIds.slice(0, 5).map((id) => id.toHexString()),
      flagTypes: doc.flagTypes,
    };
  });

  return { alerts, total: alerts.length };
}
