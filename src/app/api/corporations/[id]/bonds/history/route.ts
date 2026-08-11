import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { bondHistoryQuerySchema, type BondHistoryDirection } from "@/lib/api/schemas/bondHistory";
import type { Bond, Corporation, FinancialTxLogEntry } from "@/lib/db/types";
import { TX_TTL_TURNS } from "@/lib/db/types/financialTxLog";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Type-derived list of bond-related FinancialTxType values. Auto-syncs when a
 * new `bond_*` type is added to the FinancialTxType union — no need to update
 * a hand-maintained string list.
 */
type BondTxType = Extract<FinancialTxLogEntry["type"], `bond_${string}`>;
const BOND_TX_TYPES = [
  "bond_coupon",
  "bond_maturity",
  "bond_purchase",
  "bond_sell",
  "bond_issuance",
  "bond_default",
  "bond_dissolution_payout",
] as const satisfies readonly BondTxType[];

/**
 * Compile-time exhaustiveness check: if a new `bond_*` type is added to
 * `FinancialTxType` but not to BOND_TX_TYPES above, this expression resolves
 * to a tuple type with a literal error message instead of `true`, and the
 * `const _` assignment fails to compile.
 */
type _BondTxTypesCoverage =
  Exclude<BondTxType, (typeof BOND_TX_TYPES)[number]> extends never
    ? true
    : ["MISSING bond_* type in BOND_TX_TYPES — add it to the const array"];
const _bondTxTypesCoverage: _BondTxTypesCoverage = true;
void _bondTxTypesCoverage;

/**
 * GET /api/corporations/[id]/bonds/history
 *
 * Paginated bond ledger for a corporation. `pageSize` counts TURNS per page,
 * not rows — each turn expands into N events in the response.
 *
 * Server-side filter via `direction=income|payment|all`: applied BEFORE page
 * slicing, so `pageCount` and `totalTurns` reflect the filtered universe (no
 * "Page 3 of 5" with zero rows on the page).
 *
 * Out-of-range page values are silently clamped to `[1, pageCount]` — the
 * client doesn't have to do a second round-trip to recover from a stale
 * `?page=999` request.
 *
 * Auth: public read (parallel to /shares/history).
 * Errors: 400 (bad query), 404 (corp not found).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const parsed = bondHistoryQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      direction: url.searchParams.get("direction") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid query" },
        { status: 400 }
      );
    }
    const { page: requestedPage, pageSize, direction } = parsed.data;

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const matchFilter: Record<string, unknown> = {
      subjectId: corporation._id,
      type: { $in: BOND_TX_TYPES },
      ...directionAmountFilter(direction),
    };

    // 1. Distinct turns (newest first). With server-side direction filter,
    //    this returns only turns that actually have rows on the requested
    //    side — UI never sees "Page 3 of 5" with 0 visible accordions.
    const turnAgg = await db
      .collection<FinancialTxLogEntry>("financialTxLog")
      .aggregate<{ _id: number }>([
        { $match: matchFilter },
        { $group: { _id: "$turn" } },
        { $sort: { _id: -1 } },
      ])
      .toArray();
    const allTurns = turnAgg.map((t) => t._id);
    const totalTurns = allTurns.length;
    const pageCount = totalTurns === 0 ? 1 : Math.ceil(totalTurns / pageSize);
    // Silent clamp: an out-of-range request (e.g. page=999 against 3 pages)
    // returns the last valid page rather than empty entries — saves the
    // client a round-trip to recover from a stale UI page state.
    const page = Math.min(Math.max(1, requestedPage), pageCount);
    const pageTurns = allTurns.slice((page - 1) * pageSize, page * pageSize);

    // 2. Rows for the page's turns. Empty page → no second query.
    const rows: FinancialTxLogEntry[] =
      pageTurns.length === 0
        ? []
        : await db
            .collection<FinancialTxLogEntry>("financialTxLog")
            .find({ ...matchFilter, turn: { $in: pageTurns } })
            .sort({ createdAt: -1, _id: -1 })
            .toArray();

    // 3. Resolve bond docs referenced via meta.bondId.
    const bondIdStrings = [
      ...new Set(
        rows
          .map((r) => (r.meta as { bondId?: unknown } | undefined)?.bondId)
          .filter((v): v is string => typeof v === "string")
      ),
    ];
    const bondDocs =
      bondIdStrings.length === 0
        ? []
        : await db
            .collection<Bond>("bonds")
            .find({ _id: { $in: bondIdStrings.map((s) => new ObjectId(s)) } })
            .project<
              Pick<
                Bond,
                | "_id"
                | "issuerType"
                | "issuerName"
                | "countryId"
                | "corporationId"
                | "couponRate"
                | "maturityTurn"
              >
            >({
              _id: 1,
              issuerType: 1,
              issuerName: 1,
              countryId: 1,
              corporationId: 1,
              couponRate: 1,
              maturityTurn: 1,
            })
            .toArray();
    const bondById = new Map(bondDocs.map((b) => [b._id.toString(), b]));

    // 3b. Fallback issuer-name lookup for corporate bonds whose `issuerName`
    //     wasn't cached at issuance time.
    const corpIssuerIds = bondDocs
      .filter((b) => b.issuerType === "corporation" && !b.issuerName && b.corporationId)
      .map((b) => b.corporationId!);
    const corpNameById = new Map<string, string>();
    if (corpIssuerIds.length > 0) {
      const corpDocs = await db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: corpIssuerIds } })
        .project<Pick<Corporation, "_id" | "name">>({ _id: 1, name: 1 })
        .toArray();
      for (const c of corpDocs) corpNameById.set(c._id.toString(), c.name);
    }

    const entries = rows.map((r) => {
      const meta = (r.meta ?? {}) as Record<string, unknown>;
      const bondIdRaw = meta.bondId;
      const bondId = typeof bondIdRaw === "string" ? bondIdRaw : null;
      const bondDoc = bondId ? (bondById.get(bondId) ?? null) : null;

      const source = typeof meta.source === "string" ? (meta.source as string) : undefined;
      const refinance = meta.refinance === true ? true : undefined;
      const isIssuerAggregate = source === "issuer_coupon" || source === "issuer_repayment";

      let counterparty: {
        kind: string;
        characterId?: string;
        imperialCharacterId?: string;
        corporationId?: string;
        countryId?: string;
        name: string;
      } | null = null;
      if (r.counterpartyType && r.counterpartyName) {
        counterparty = {
          kind: r.counterpartyType,
          characterId:
            r.counterpartyType === "character" && r.counterpartyId
              ? r.counterpartyId.toString()
              : undefined,
          corporationId:
            r.counterpartyType === "corporation" && r.counterpartyId
              ? r.counterpartyId.toString()
              : undefined,
          countryId: r.counterpartyType === "government" ? (r.countryId ?? undefined) : undefined,
          name: r.counterpartyName,
        };
      } else if (isIssuerAggregate) {
        counterparty = { kind: "bondholders", name: "Bondholders" };
      }

      const bondInfo = bondDoc
        ? {
            bondId: bondDoc._id.toString(),
            issuerType: (bondDoc.issuerType ?? "corporation") as "corporation" | "sovereign",
            issuerName:
              bondDoc.issuerName ??
              (bondDoc.issuerType === "sovereign"
                ? `${bondDoc.countryId ?? "Sovereign"} Government`
                : (bondDoc.corporationId && corpNameById.get(bondDoc.corporationId.toString())) ||
                  "(unknown issuer)"),
            issuerCorporationId:
              bondDoc.issuerType === "corporation" ? bondDoc.corporationId?.toString() : undefined,
            issuerCountryId: bondDoc.issuerType === "sovereign" ? bondDoc.countryId : undefined,
            couponRate: bondDoc.couponRate,
            maturityTurn: bondDoc.maturityTurn,
          }
        : null;

      return {
        id: r._id.toString(),
        type: r.type,
        turn: r.turn,
        createdAt: r.createdAt,
        amount: r.amount,
        anchorAmount: r.anchorAmount,
        currencyCode: r.currencyCode,
        source,
        refinance,
        units: typeof meta.units === "number" ? (meta.units as number) : undefined,
        couponRate: typeof meta.couponRate === "number" ? (meta.couponRate as number) : undefined,
        bondAmount: typeof meta.bondAmount === "number" ? (meta.bondAmount as number) : undefined,
        bondCurrency:
          typeof meta.bondCurrency === "string" ? (meta.bondCurrency as string) : undefined,
        counterparty,
        bond: bondInfo,
      };
    });

    return NextResponse.json({
      entries,
      page,
      pageSize,
      direction,
      totalTurns,
      pageCount,
      windowTurns: TX_TTL_TURNS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Sign-of-amount filter applied to the financialTxLog `$match`. Zero-amount
 * rows (refinance bond_issuance, etc.) are non-directional state changes; we
 * include them under BOTH `income` and `payment` so they don't disappear in
 * filtered views. The user toggling between "Income" and "Payments" still
 * sees the cure/refinance event, just with a 0 amount column.
 */
function directionAmountFilter(direction: BondHistoryDirection): Record<string, unknown> {
  if (direction === "income") return { amount: { $gte: 0 } };
  if (direction === "payment") return { amount: { $lte: 0 } };
  return {};
}
