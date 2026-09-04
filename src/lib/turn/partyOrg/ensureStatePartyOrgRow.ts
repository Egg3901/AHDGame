import type { Db } from "mongodb";
import type { PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  findStatePartyOrgRow,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { isUsElectoralState } from "@/lib/constants/states";
import { loadUsPoliticalStateIds } from "@/lib/elections/usPoliticalHome";

export interface EnsureStatePartyOrgRowArgs {
  countryId: CountryId;
  stateId: string;
  party: Pick<PoliticalParty, "sequentialId">;
  /**
   * Presence flag to stamp on a freshly-created row. Callers that have just
   * confirmed live presence (Build Org) pass `true`; the national
   * chair "expand into an empty state" path passes `false`.
   */
  hasPresence: boolean;
  now?: Date;
}

/**
 * Idempotently ensure a `statePartyOrg` row exists for (country, state, party),
 * creating it at 0% Org with neutral defaults if missing. Returns the existing
 * row when present, otherwise the newly-bootstrapped row.
 *
 * Why this exists: the DE seed deliberately omits some (Land, party) pairs that
 * don't organize there historically (e.g. CDU stays out of Bayern under the
 * CDU/CSU Union pact). When a player later establishes genuine presence in such
 * a state, the per-click Build Org action needs a row to grow from — but no
 * seed row exists and only the national-chair budget path used to create one.
 * This helper is the single source of truth for that bootstrap so Build Org and
 * the org-building budget route all create identical rows.
 *
 * Uses an upsert with `$setOnInsert` so two concurrent callers can't double-
 * insert (the `_id` is the canonical `{stateId}_{partySequentialId}` key).
 */
export async function ensureStatePartyOrgRow(
  db: Db,
  args: EnsureStatePartyOrgRowArgs
): Promise<StatePartyOrg> {
  // Federal districts like DC are not organizable US states — they elect no
  // offices and host no state party organization. Alaska and Hawaii, however,
  // are playable territories with their own party chapters before admission.
  if (args.countryId === "US") {
    if (!isUsElectoralState(args.stateId)) {
      throw new Error(
        `Cannot create a state party org for non-electoral US region "${args.stateId}".`
      );
    }
    const { residentPoliticalIds } = await loadUsPoliticalStateIds(db);
    if (!residentPoliticalIds.has(args.stateId)) {
      throw new Error(`Cannot create a state party org for US region "${args.stateId}".`);
    }
  }

  const _id = getStatePartyOrgDocumentId(args.stateId, args.party as PoliticalParty);
  const partyId = getPartyIdString(args.party as PoliticalParty);
  const col = db.collection<StatePartyOrg>("statePartyOrg");

  const existing = await findStatePartyOrgRow(db, args.countryId, args.stateId, args.party);
  if (existing) {
    // Heal a legacy/malformed row whose scope fields drifted from the
    // `{countryId, stateId, partyId}` triple — most importantly a missing
    // `countryId` (older leadership upserts created rows without it), which
    // makes the row invisible to every countryId-scoped query, so the PS spend
    // fails with "missing-row". The triple is the source of truth (it is what
    // the country-scoped reads join on), so repair to match — including
    // RE-KEYING a stale `_id` (e.g. the pre-merge `{stateId}_{oldSeqId}` key a
    // party renumber left behind, ticket #1256) back to the canonical key.
    const fieldPatch: Partial<StatePartyOrg> = {};
    if (existing.countryId !== args.countryId) fieldPatch.countryId = args.countryId;
    if (existing.stateId !== args.stateId) fieldPatch.stateId = args.stateId;
    if (existing.partyId !== partyId) fieldPatch.partyId = partyId;
    const needsRekey = existing._id !== _id;
    if (!needsRekey) {
      if (Object.keys(fieldPatch).length > 0) {
        await col.updateOne({ _id: existing._id }, { $set: fieldPatch });
        return { ...existing, ...fieldPatch };
      }
      return existing;
    }
    // Re-key. MongoDB cannot `$set` an `_id`, so the row moves by
    // delete-then-insert. A squatter can hold the canonical key — a second
    // drifted row whose `_id` matches but whose fields name someone else. The
    // row resolved above carries the party's live org and treasury, so it wins
    // the key and the squatter is removed first.
    await col.deleteOne({ _id, partyId: { $ne: partyId } });
    await col.deleteOne({ _id: existing._id });
    const { _id: _stale, ...rest } = existing;
    void _stale;
    const healed = { ...rest, ...fieldPatch, _id } as StatePartyOrg;
    await col.insertOne(healed);
    return healed;
  }

  const now = args.now ?? new Date();
  const row: StatePartyOrg = {
    _id,
    countryId: args.countryId,
    stateId: args.stateId,
    partyId,
    organization: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    campaignerId: null,
    treasury: 0,
    stateTaxRate: 0,
    politicalStrength: 0,
    hasPresence: args.hasPresence,
    createdAt: now,
    updatedAt: now,
  };

  await col.updateOne({ _id }, { $setOnInsert: row }, { upsert: true });
  return row;
}
