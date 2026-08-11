import type { TxThresholds } from "./financialTxLog";

export interface SystemSettings {
  _id: string;
  integrityCheckCadenceTurns: number;
  updatedBy: string | null;
  updatedAt: Date;
  financialTxLog?: {
    thresholds: TxThresholds;
    suspectScanWindowTurns?: number; // defaults to 6
    velocityThreshold?: number; // defaults to 5
  };
}
