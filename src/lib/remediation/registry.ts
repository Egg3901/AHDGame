// The defect ledger: every corruption-class bug whose fix has two halves.
//
// Adding a defect:
//   1. Write the DETECTOR first. If you cannot count the bad rows, you cannot
//      prove the heal worked, and the defect does not belong here yet.
//   2. Create src/lib/remediation/defects/<id>.ts exporting `defect: Defect`.
//   3. Import and append below.
//   4. Pin codeFix.requiredCommit once the code half merges, so the code gate
//      can refuse to heal an env the fix has not reached.
//
// What does NOT belong here:
//   - Schema cutovers and one-shot data moves. Those are migrations
//     (src/lib/migrations/registry.ts) and are allowed to be non-idempotent.
//   - Anything you cannot re-run safely. If re-running is not a no-op, it is a
//     migration by definition.

import { defect as orphanNullPartySeats } from "./defects/AHD-951-orphan-null-party-seats";
import { defect as duplicateSectors } from "./defects/AHD-duplicate-sectors";
import { defect as defenceProcurementOveraward } from "./defects/AHD-defence-procurement-overaward";
import { defect as privateMarketCapHistory } from "./defects/AHD-private-market-cap-history";
import { defect as ukVatRevenueGap } from "./defects/AHD-1102-uk-vat-revenue-gap";
import { defect as brlForcedMaturityRestitution } from "./defects/AHD-1124-brl-forced-maturity-restitution";
import { defect as trRepudiationRestitution } from "./defects/AHD-1266-tr-repudiation-restitution";
import { defect as commandEconomyPrivateSectorOwnership } from "./defects/AHD-command-economy-private-sector-ownership";
import { defect as tinkyStaleVoteExcess } from "./defects/AHD-tinky-stale-vote-excess";
import { defect as usMarineLotProgress } from "./defects/AHD-1171-us-marine-lot-progress";
import { defect as defenceSupplierWindfall } from "./defects/AHD-defence-supplier-windfall";
import type { Defect } from "./types";

export const DEFECTS: Defect[] = [
  // #951 — vacate bug stranded seatsHeld on holder-less blocs; tallies skip
  // null-party rows so the seats read as vacant.
  orphanNullPartySeats,
  // Cross-border sectors stamped with the owner's HQ country; a later takeover
  // then created a parallel row for the same (corporation, state, type).
  duplicateSectors,
  defenceProcurementOveraward,
  privateMarketCapHistory,
  // Ticket #1102: the Poon Choi Act was law for 67 turns while a tax-slider
  // enactment bug left UK sales tax and tariffs at 0.
  ukVatRevenueGap,
  // Ticket #1124: BR's 1953 inflation target was the Vargas CPI, so the Taylor
  // rule chased 10% inflation and BRL ran away. Bond maturities are compulsory,
  // so holders were force-converted out of BRL at the corrupted rate.
  brlForcedMaturityRestitution,
  // Ticket #1266: turn-568 TR repudiation double-charged holder cash on top
  // of the paper loss. Repays the second charge to the 19 debited holders.
  trRepudiationRestitution,
  commandEconomyPrivateSectorOwnership,
  tinkyStaleVoteExcess,
  usMarineLotProgress,
  defenceSupplierWindfall,
];

export function getDefect(id: string): Defect | undefined {
  return DEFECTS.find((defect) => defect.id === id);
}

export function requireDefect(id: string): Defect {
  const defect = getDefect(id);
  if (!defect) {
    throw new Error(
      `[remediation] unknown defect "${id}". Known: ${DEFECTS.map((d) => d.id).join(", ")}`
    );
  }
  return defect;
}

/**
 * Structural checks on the ledger itself, asserted by registry.test.ts so a bad
 * entry fails CI rather than failing in front of prod data.
 */
export function validateRegistry(defects: Defect[] = DEFECTS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const defect of defects) {
    if (seen.has(defect.id)) problems.push(`duplicate defect id "${defect.id}"`);
    seen.add(defect.id);

    if (!defect.idempotent) {
      problems.push(
        `${defect.id}: heals must be idempotent — a non-idempotent repair is a migration`
      );
    }
    if (defect.envs.length === 0) problems.push(`${defect.id}: no envs registered`);
    if (defect.guards.length === 0) {
      problems.push(`${defect.id}: declares no guards — at minimum every heal needs a cap`);
    }
    if (!defect.guards.some((g) => /^max-affected:\d+$/.test(g))) {
      problems.push(`${defect.id}: no max-affected cap — unbounded heals are refused`);
    }
    if (defect.mintsMoney === true && !defect.title) {
      problems.push(`${defect.id}: declares mintsMoney without explanation`);
    }

    // The seed question is mandatory to ANSWER, not mandatory to answer well:
    // "unknown" is allowed and warned about at plan time. What is refused is
    // omitting it, because a heal against a bad seed is undone by the next
    // world reset and nobody discovers that until it happens.
    if (!defect.seedFix) {
      problems.push(
        `${defect.id}: no seedFix — state whether a seed reproduces this ("unknown" is allowed)`
      );
    } else if (defect.seedFix.status === "not-needed" && !defect.seedFix.note) {
      problems.push(
        `${defect.id}: seedFix "not-needed" needs a note saying why a seed cannot produce this`
      );
    }
  }

  return problems;
}
