import type { PartyActivityFeedItem, PartyActivityFeedResponse } from "@/lib/parties/dto/partyView";
import type { RecruitmentSlate, SlateCandidate, TreasuryTransaction } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { SLATE_REFUSAL_LABEL, isSlateFilingFailure } from "@/lib/slate/refusalReasons";
import type { Db } from "mongodb";

const HIDDEN_OVERVIEW_TREASURY_CATEGORIES = new Set(["gotv", "suppression", "fund_generation"]);

export function shouldIncludePartyOverviewTreasuryActivity(
  tx: Pick<TreasuryTransaction, "category" | "memo">
): boolean {
  if (HIDDEN_OVERVIEW_TREASURY_CATEGORIES.has(tx.category)) return false;
  if (/org building/i.test(tx.memo)) return false;
  return true;
}

export function describeSlateActivity(
  row: Pick<
    SlateCandidate,
    "status" | "invitedAt" | "respondedAt" | "filedAt" | "updatedAt" | "refusalReason"
  >
): { createdAt: Date; summary: string } {
  if (row.status === "filed" && row.filedAt) {
    return { createdAt: row.filedAt, summary: "filed via slate" };
  }
  if (row.status === "declined" && row.respondedAt) {
    return { createdAt: row.respondedAt, summary: "declined slate offer" };
  }
  if (row.status === "withdrawn") {
    // #1181: a tombstone with a filing-failure reason is the turn giving up on
    // the row, not the chair removing it. Saying "removed from slate" there
    // pinned a system failure on the chair.
    return {
      createdAt: row.updatedAt,
      summary: isSlateFilingFailure(row.refusalReason)
        ? "could not be filed from the slate"
        : "removed from slate",
    };
  }
  if (row.status === "considering" && row.respondedAt) {
    return { createdAt: row.respondedAt, summary: "is considering slate offer" };
  }
  return { createdAt: row.invitedAt, summary: "assigned to slate" };
}

export async function getPartyActivityFeed(
  db: Db,
  {
    countryId,
    partyId,
    before,
    limit,
  }: {
    countryId: CountryId;
    partyId: string;
    before?: Date | null;
    limit: number;
  }
): Promise<PartyActivityFeedResponse> {
  const sourceLimit = limit * 2;
  const txFilter: Record<string, unknown> = { countryId, partyId, holderType: "party" };
  if (before) txFilter.createdAt = { $lt: before };
  const slateFilter: Record<string, unknown> = { countryId, partyId };
  if (before) slateFilter.updatedAt = { $lt: before };

  const [transactions, slateRows] = await Promise.all([
    db
      .collection<TreasuryTransaction>("treasuryTransactions")
      .find(txFilter)
      .sort({ createdAt: -1 })
      .limit(sourceLimit)
      .toArray(),
    db
      .collection<SlateCandidate>("slateCandidates")
      .find(slateFilter)
      .sort({ updatedAt: -1 })
      .limit(sourceLimit)
      .toArray(),
  ]);

  const slates =
    slateRows.length === 0
      ? []
      : await db
          .collection<RecruitmentSlate>("recruitmentSlates")
          .find({ _id: { $in: slateRows.map((row) => row.slateId) } })
          .toArray();
  const slateById = new Map(slates.map((slate) => [slate._id.toString(), slate]));

  const items: PartyActivityFeedItem[] = [];
  for (const tx of transactions) {
    if (!shouldIncludePartyOverviewTreasuryActivity(tx)) continue;
    // Pre-2026-05-18 rows have no currencyCode and are anchor-denominated; fall back to ₳.
    const symbol = tx.currencyCode ? CURRENCY_SYMBOLS[tx.currencyCode] : "₳";
    items.push({
      id: `tx-${tx._id.toString()}`,
      type: "treasury",
      createdAt: tx.createdAt.toISOString(),
      summary: `${tx.direction === "credit" ? "+" : "-"}${symbol}${tx.amount.toLocaleString()} | ${tx.memo}`,
      detail: tx.category,
      link: { tab: "treasury" },
    });
  }

  for (const row of slateRows) {
    const slate = slateById.get(row.slateId.toString());
    const stateLabel = slate?.state.replace(/^.+_/, "") ?? "-";
    const slateActivity = describeSlateActivity(row);
    items.push({
      id: `slate-${row._id.toString()}`,
      type: "slate",
      createdAt: slateActivity.createdAt.toISOString(),
      summary: `${row.candidateName} ${slateActivity.summary} (${stateLabel})`,
      detail: row.refusalReason ? SLATE_REFUSAL_LABEL[row.refusalReason] : undefined,
      link: { tab: "slate" },
    });
  }

  items.sort((left, right) =>
    left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0
  );
  const sliced = items.slice(0, limit);
  return {
    items: sliced,
    nextBefore: sliced.length === limit ? sliced[sliced.length - 1].createdAt : null,
  };
}
