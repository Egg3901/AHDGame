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
  byParty: Record<string, PrimarySnapshotEntry[]>;
}
