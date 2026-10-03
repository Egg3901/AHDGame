/**
 * Capture a world's actual opening cash before its first simulated turn.
 * Existing closing snapshots remain unchanged when a run resumes. A missing
 * or invalid persisted baseline stops advancement rather than skipping proof.
 */
import type { Db } from "mongodb";
import { loadBalanceSnapshot, writeBalanceSnapshot } from "@/lib/ledger/balanceSnapshot";
import type { BalanceSnapshot } from "@/lib/ledger/types";

export interface OpeningLedgerSnapshot {
  turn: number;
  snapshotId: string;
  accounts: number;
  reused: boolean;
}

function validateSnapshot(snapshot: BalanceSnapshot | null, turn: number): BalanceSnapshot {
  if (
    !snapshot ||
    snapshot.turn !== turn ||
    !snapshot.balances ||
    typeof snapshot.balances !== "object" ||
    Array.isArray(snapshot.balances) ||
    Object.values(snapshot.balances).some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`Missing or invalid opening cash snapshot at turn ${turn}`);
  }
  return snapshot;
}

export async function prepareOpeningLedgerSnapshot(
  db: Db,
  turn: number
): Promise<OpeningLedgerSnapshot> {
  if (!Number.isSafeInteger(turn) || turn < 0) {
    throw new Error("Opening cash snapshot requires a valid turn number");
  }
  const existing = await loadBalanceSnapshot(db, turn);
  if (!existing) {
    // The shared writer catches storage errors for ordinary shadow turns.
    // Read back the persisted document so a swallowed error cannot admit a run.
    await writeBalanceSnapshot(db, turn);
  }
  const snapshot = validateSnapshot(existing ?? (await loadBalanceSnapshot(db, turn)), turn);
  return {
    turn,
    snapshotId: snapshot._id.toHexString(),
    accounts: Object.keys(snapshot.balances).length,
    reused: existing !== null,
  };
}
