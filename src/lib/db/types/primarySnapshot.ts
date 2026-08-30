import type { ObjectId } from "mongodb";

export interface PrimarySnapshotEntry {
  candidateId: string;
  characterName: string;
  party: string;
  primaryScore: number;
  sharePct: number;
}

export interface PrimarySnapshot {
  _id: ObjectId;
  electionId: ObjectId;
  recordedAt: Date;
  /**
   * Game turn this snapshot (and its ballot accrual) belongs to. The accrual
   * phase skips an election that already has a snapshot for the turn, so a
   * re-run of a stuck turn cannot accrue the same slice twice. Absent on docs
   * written before the guard existed.
   */
  turn?: number;
  byParty: Record<string, PrimarySnapshotEntry[]>;
}
