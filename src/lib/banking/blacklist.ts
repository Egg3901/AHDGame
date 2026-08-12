import { ObjectId, type Db } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import type { Character, Corporation } from "@/lib/db/types";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";

export type BankBlacklist = NonNullable<BankCharter["blacklist"]>;

export type SetBlacklistResult =
  { ok: true; blacklist: BankBlacklist } | { ok: false; error: string };

/** Resolve index-fund blacklist entries to constituent corporation id hex strings. */
export type ResolveFundConstituents = (fundId: string) => readonly string[];

const VALID_FUND_SLUGS: ReadonlySet<string> = new Set(
  getAllFundDefinitions().map((fund) => fund.slug)
);

/**
 * Entries allowed per list. The arrays live inline on the corporation document
 * and every refusal check walks them, so an uncapped list is both unbounded
 * document growth and a per-transaction cost. Fifty named parties is far past
 * any real refusal list.
 */
export const BLACKLIST_MAX_ENTRIES = 50;

function uniqueStrings(ids: readonly string[] | undefined): string[] {
  if (!ids || ids.length === 0) return [];
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
}

/**
 * CEO replaces the bank's blacklist. Validates that every corporation,
 * character, and index-fund id exists (funds via the static fundDefinitions catalog).
 */
export async function setBlacklist(
  db: Db,
  corporationId: ObjectId,
  blacklist: BankBlacklist
): Promise<SetBlacklistResult> {
  if (!(await isPrivateBankingEnabled())) {
    return { ok: false, error: "Private banking is not enabled" };
  }

  const corporation = await db.collection<Corporation>("corporations").findOne({
    _id: corporationId,
  });
  if (!corporation) {
    return { ok: false, error: "Corporation not found" };
  }
  if (corporation.bankCharter?.status !== "active") {
    return { ok: false, error: "Corporation has no active bank charter" };
  }

  const corporationIds = uniqueStrings(blacklist.corporationIds);
  const characterIds = uniqueStrings(blacklist.characterIds);
  const indexFundIds = uniqueStrings(blacklist.indexFundIds);

  for (const [label, list] of [
    ["corporations", corporationIds],
    ["characters", characterIds],
    ["index funds", indexFundIds],
  ] as const) {
    if (list.length > BLACKLIST_MAX_ENTRIES) {
      return {
        ok: false,
        error: `A blacklist holds at most ${BLACKLIST_MAX_ENTRIES} ${label}.`,
      };
    }
  }

  for (const id of corporationIds) {
    if (!ObjectId.isValid(id) || id.length !== 24) {
      return { ok: false, error: `Invalid corporation id: ${id}` };
    }
  }
  for (const id of characterIds) {
    if (!ObjectId.isValid(id) || id.length !== 24) {
      return { ok: false, error: `Invalid character id: ${id}` };
    }
  }
  for (const id of indexFundIds) {
    if (!VALID_FUND_SLUGS.has(id)) {
      return { ok: false, error: `Unknown index fund id: ${id}` };
    }
  }

  if (corporationIds.length > 0) {
    const objectIds = corporationIds.map((id) => new ObjectId(id));
    const count = await db
      .collection<Corporation>("corporations")
      .countDocuments({ _id: { $in: objectIds } });
    if (count !== corporationIds.length) {
      return { ok: false, error: "One or more corporation ids do not exist" };
    }
  }

  if (characterIds.length > 0) {
    const objectIds = characterIds.map((id) => new ObjectId(id));
    const count = await db
      .collection<Character>("characters")
      .countDocuments({ _id: { $in: objectIds } });
    if (count !== characterIds.length) {
      return { ok: false, error: "One or more character ids do not exist" };
    }
  }

  const next: BankBlacklist = {
    corporationIds,
    characterIds,
    indexFundIds,
  };

  const result = await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId, "bankCharter.status": "active" },
    {
      $set: {
        "bankCharter.blacklist": next,
        updatedAt: new Date(),
      },
    }
  );

  if (result.matchedCount !== 1) {
    return { ok: false, error: "Failed to update blacklist (charter no longer active)" };
  }

  return { ok: true, blacklist: next };
}

/**
 * Whether a character is refused as a depositor. Only `blacklist.characterIds`
 * apply - corporation and index-fund entries do not block characters.
 */
export function isBlockedDepositor(
  charter: Pick<BankCharter, "blacklist">,
  characterId: string
): boolean {
  const blocked = charter.blacklist?.characterIds;
  if (!blocked || blocked.length === 0) return false;
  return blocked.includes(characterId);
}

/**
 * Whether a borrower is refused. Named characters and corporations are checked
 * directly; index-fund entries block every constituent returned by
 * `resolveFundConstituents` (typically from indexFunds targetConstituents /
 * or buildIndexFundTargetConstituents in constituents.ts).
 */
export function isBlockedBorrower(
  charter: Pick<BankCharter, "blacklist">,
  party: { corporationId?: string; characterId?: string },
  resolveFundConstituents: ResolveFundConstituents
): boolean {
  const list = charter.blacklist;
  if (!list) return false;

  if (party.characterId && list.characterIds?.includes(party.characterId)) {
    return true;
  }

  if (party.corporationId) {
    if (list.corporationIds?.includes(party.corporationId)) {
      return true;
    }
    for (const fundId of list.indexFundIds ?? []) {
      const constituents = resolveFundConstituents(fundId);
      if (constituents.includes(party.corporationId)) {
        return true;
      }
    }
  }

  return false;
}
