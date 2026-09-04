import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";
import {
  INTELLIGENCE_AGENCIES,
  INTELLIGENCE_COVERAGE,
  INTELLIGENCE_NETWORKS,
  INTELLIGENCE_OP_LOG,
} from "@/lib/db/collections/intelligence";

/**
 * Indexes for the national intelligence spine.
 *
 * The first three carry a correctness guarantee, not just speed: one agency per
 * country, one network per (owner, target) pair, and one coverage row per
 * (owner, target, domain) are invariants the read and spend paths assume rather
 * than re-check. A world missing them is quietly wrong, not quietly slow.
 *
 * The op-log indexes are read patterns: a target's incident feed, and an
 * operator's own history.
 */
export async function seedIntelligenceIndexes(db: Db, log: (msg: string) => void) {
  log("Intelligence indexes:");

  await ensureIndex(
    db,
    INTELLIGENCE_AGENCIES,
    { countryId: 1 },
    { name: "intelligenceAgencies_countryId", unique: true, background: true },
    log
  );

  await ensureIndex(
    db,
    INTELLIGENCE_NETWORKS,
    { ownerCountryId: 1, targetCountryId: 1 },
    { name: "intelligenceNetworks_owner_target", unique: true, background: true },
    log
  );

  await ensureIndex(
    db,
    INTELLIGENCE_COVERAGE,
    { ownerCountryId: 1, targetCountryId: 1, domain: 1 },
    { name: "intelligenceCoverage_owner_target_domain", unique: true, background: true },
    log
  );

  await ensureIndex(
    db,
    INTELLIGENCE_OP_LOG,
    { targetCountryId: 1, turn: -1 },
    { name: "intelligenceOpLog_target_turn", background: true },
    log
  );

  await ensureIndex(
    db,
    INTELLIGENCE_OP_LOG,
    { ownerCountryId: 1, turn: -1 },
    { name: "intelligenceOpLog_owner_turn", background: true },
    log
  );
}
